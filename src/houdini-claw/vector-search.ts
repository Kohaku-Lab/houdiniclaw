/**
 * Houdini Claw - Vector Search Layer
 *
 * Provides semantic search over the knowledge base using sqlite-vec
 * for embedding storage and cosine similarity search.
 */

import type { KnowledgeBase } from "./db.js";

/** Embedding dimension (text-embedding-3-small = 1536) */
const EMBEDDING_DIM = 1536;

/** Maximum number of chunks to return from a search */
const DEFAULT_TOP_K = 5;

/**
 * Generate an embedding for the given text using the configured embedding model.
 * Supports OpenAI-compatible embedding APIs.
 */
export async function generateEmbedding(
  text: string,
  options?: {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  },
): Promise<Float32Array> {
  const model = options?.model ?? process.env.HOUDINI_CLAW_EMBEDDING_MODEL ?? "text-embedding-3-small";
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  const baseUrl = options?.baseUrl ?? "https://api.openai.com/v1";

  if (!apiKey) {
    throw new Error("No API key for embeddings. Set OPENAI_API_KEY or pass apiKey option.");
  }

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${body}`);
  }

  const result = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  return new Float32Array(result.data[0].embedding);
}

/**
 * Index a chunk of text: generate its embedding and store it in the vector table.
 */
export async function indexChunk(
  kb: KnowledgeBase,
  chunkId: number,
  text: string,
  embeddingOptions?: {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  },
): Promise<void> {
  const embedding = await generateEmbedding(text, embeddingOptions);

  // Insert into sqlite-vec virtual table
  const stmt = kb.db.prepare(
    "INSERT OR REPLACE INTO kb_vec (chunk_id, embedding) VALUES (?, ?)",
  );
  stmt.run(chunkId, Buffer.from(embedding.buffer));
}

/**
 * Perform a semantic search over the knowledge base.
 * Returns the top-k most similar chunks with their scores and metadata.
 */
export async function semanticSearch(
  kb: KnowledgeBase,
  query: string,
  options?: {
    topK?: number;
    system?: string;
    chunkType?: string;
    nodeName?: string;
    embeddingOptions?: {
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    };
  },
): Promise<SearchResult[]> {
  const topK = options?.topK ?? DEFAULT_TOP_K;
  const queryEmbedding = await generateEmbedding(query, options?.embeddingOptions);

  // Build the vector search query with optional filters
  let sql: string;
  const params: unknown[] = [Buffer.from(queryEmbedding.buffer), topK];

  if (options?.system || options?.chunkType || options?.nodeName) {
    // Join with embedding_chunks for filtering
    const filters: string[] = [];
    if (options.system) {
      filters.push("ec.system = ?");
      params.push(options.system);
    }
    if (options.chunkType) {
      filters.push("ec.chunk_type = ?");
      params.push(options.chunkType);
    }
    if (options.nodeName) {
      filters.push("ec.node_name = ?");
      params.push(options.nodeName);
    }

    sql = `
      SELECT
        v.chunk_id,
        v.distance,
        ec.chunk_text,
        ec.chunk_type,
        ec.node_name,
        ec.system,
        ec.source_table,
        ec.source_id
      FROM kb_vec v
      JOIN embedding_chunks ec ON ec.id = v.chunk_id
      WHERE v.embedding MATCH ?
        AND k = ?
        ${filters.length > 0 ? "AND " + filters.join(" AND ") : ""}
      ORDER BY v.distance
    `;
  } else {
    sql = `
      SELECT
        v.chunk_id,
        v.distance,
        ec.chunk_text,
        ec.chunk_type,
        ec.node_name,
        ec.system,
        ec.source_table,
        ec.source_id
      FROM kb_vec v
      JOIN embedding_chunks ec ON ec.id = v.chunk_id
      WHERE v.embedding MATCH ?
        AND k = ?
      ORDER BY v.distance
    `;
  }

  const stmt = kb.db.prepare(sql);
  const rows = stmt.all(...params) as Array<{
    chunk_id: number;
    distance: number;
    chunk_text: string;
    chunk_type: string;
    node_name: string | null;
    system: string | null;
    source_table: string;
    source_id: number;
  }>;

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    score: 1 - row.distance, // Convert distance to similarity
    text: row.chunk_text,
    chunkType: row.chunk_type,
    nodeName: row.node_name,
    system: row.system,
    sourceTable: row.source_table,
    sourceId: row.source_id,
  }));
}

/**
 * Build embedding index for all chunks in the database.
 * Use after bulk-inserting annotations.
 */
export async function rebuildIndex(
  kb: KnowledgeBase,
  options?: {
    batchSize?: number;
    embeddingOptions?: {
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    };
    onProgress?: (indexed: number, total: number) => void;
  },
): Promise<{ indexed: number; errors: number }> {
  const batchSize = options?.batchSize ?? 50;

  // Get all chunks that need indexing
  const allChunks = kb.db
    .prepare(
      `SELECT ec.id, ec.chunk_text
       FROM embedding_chunks ec
       LEFT JOIN kb_vec v ON v.chunk_id = ec.id
       WHERE v.chunk_id IS NULL
       ORDER BY ec.id`,
    )
    .all() as Array<{ id: number; chunk_text: string }>;

  const total = allChunks.length;
  let indexed = 0;
  let errors = 0;

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);

    for (const chunk of batch) {
      try {
        await indexChunk(kb, chunk.id, chunk.chunk_text, options?.embeddingOptions);
        indexed++;
      } catch (err) {
        console.error(`[houdini-claw] Failed to index chunk ${chunk.id}:`, (err as Error).message);
        errors++;
      }
    }

    options?.onProgress?.(indexed, total);
  }

  return { indexed, errors };
}

/**
 * Create text chunks from a node annotation for embedding.
 * Breaks the annotation into semantically meaningful pieces.
 */
export function chunkNodeAnnotation(
  nodeName: string,
  system: string,
  annotation: Record<string, unknown>,
): Array<{ text: string; type: string }> {
  const chunks: Array<{ text: string; type: string }> = [];

  // Chunk 1: Node overview
  const overview = [
    `Node: ${nodeName}`,
    annotation.semantic_name_en ? `English: ${annotation.semantic_name_en}` : "",
    annotation.semantic_name_zh ? `Chinese: ${annotation.semantic_name_zh}` : "",
    annotation.one_line ? `Summary: ${annotation.one_line}` : "",
    annotation.analogy ? `Analogy: ${annotation.analogy}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  chunks.push({ text: overview, type: "node" });

  // Chunk 2: Prerequisites and network context
  if (annotation.prerequisite_nodes || annotation.typical_network) {
    const context = [
      `Node: ${nodeName} - Network Context`,
      annotation.prerequisite_nodes
        ? `Prerequisites: ${JSON.stringify(annotation.prerequisite_nodes)}`
        : "",
      annotation.required_context ? `Context: ${annotation.required_context}` : "",
      annotation.typical_network ? `Typical network: ${annotation.typical_network}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    chunks.push({ text: context, type: "node" });
  }

  return chunks;
}

/**
 * Create text chunks from a parameter annotation for embedding.
 */
export function chunkParameterAnnotation(
  nodeName: string,
  system: string,
  param: Record<string, unknown>,
): Array<{ text: string; type: string }> {
  const chunks: Array<{ text: string; type: string }> = [];

  // Main parameter chunk
  const paramText = [
    `Parameter: ${nodeName} > ${param.param_name}`,
    `Path: ${param.param_path}`,
    param.semantic_name_en ? `English: ${param.semantic_name_en}` : "",
    param.semantic_name_zh ? `Chinese: ${param.semantic_name_zh}` : "",
    param.one_line ? `Description: ${param.one_line}` : "",
    param.safe_range_min !== null
      ? `Safe range: ${param.safe_range_min} to ${param.safe_range_max}`
      : "",
    param.intent_mapping ? `Intent mapping: ${param.intent_mapping}` : "",
    param.context_adjustments ? `Context adjustments: ${param.context_adjustments}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  chunks.push({ text: paramText, type: "parameter" });

  // Interaction warnings chunk (separate for focused retrieval)
  if (param.interactions) {
    const interactionText = [
      `Parameter interactions for ${nodeName} > ${param.param_name}:`,
      String(param.interactions),
    ].join("\n");

    chunks.push({ text: interactionText, type: "parameter" });
  }

  return chunks;
}

export interface SearchResult {
  chunkId: number;
  score: number;
  text: string;
  chunkType: string;
  nodeName: string | null;
  system: string | null;
  sourceTable: string;
  sourceId: number;
}
