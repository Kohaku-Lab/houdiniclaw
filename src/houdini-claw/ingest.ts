/**
 * Houdini Claw - Knowledge Base Ingest
 *
 * Reads annotated JSON files and writes them into the SQLite knowledge base.
 * Also chunks the content and prepares it for vector embedding.
 *
 * Usage:
 *   bun src/houdini-claw/ingest.ts --input /tmp/houdini-annotated/ --db ~/.openclaw/houdini-claw/houdini_kb.db
 */

import fs from "node:fs";
import path from "node:path";
import { initDatabase, type KnowledgeBase } from "./db.js";
import { chunkNodeAnnotation, chunkParameterAnnotation, rebuildIndex } from "./vector-search.js";

// ── Types ──────────────────────────────────────────────────

interface AnnotatedFile {
  nodeName: string;
  system: string;
  sourceUrls: string[];
  annotatedAt: string;
  model: string;
  annotation: {
    semantic_name_zh?: string;
    semantic_name_en?: string;
    one_line: string;
    analogy?: string;
    prerequisite_nodes?: string[];
    required_context?: string;
    typical_network?: string;
    parameters?: Array<{
      name: string;
      path: string;
      semantic_name_zh?: string;
      semantic_name_en?: string;
      one_line?: string;
      intent_mapping?: Record<string, string>;
      default_value?: number;
      safe_range?: [number, number];
      expert_range?: [number, number];
      danger_zone?: { below?: number; above?: number; description?: string };
      visual_effect?: Record<string, string>;
      interactions?: Array<{
        param: string;
        relationship: string;
        warning?: string;
        tip?: string;
      }>;
      context_adjustments?: Record<string, string>;
    }>;
    recipes?: Array<{
      name: string;
      tags: string[];
      description: string;
      parameters: Record<string, Record<string, unknown>>;
      prerequisites?: string[];
      warnings?: string[];
      variations?: Record<string, Record<string, unknown>>;
    }>;
    error_patterns?: Array<{
      pattern_id: string;
      symptoms: string[];
      root_causes: Array<{
        cause: string;
        probability: string;
        explanation: string;
        fix: string[];
        verify?: string;
      }>;
    }>;
  };
}

// ── Ingest Functions ───────────────────────────────────────

/**
 * Map a system name from the filename to a Houdini node category.
 */
function systemToCategory(system: string): string {
  const map: Record<string, string> = {
    pyro: "DOP",
    rbd: "DOP",
    flip: "DOP",
    vellum: "DOP",
    sop: "SOP",
    chop: "CHOP",
    cop: "COP",
    lop: "LOP",
    vop: "VOP",
  };
  return map[system] ?? "SOP";
}

/**
 * Ingest a single annotated file into the knowledge base.
 */
function ingestAnnotation(kb: KnowledgeBase, data: AnnotatedFile): void {
  const { nodeName, system, annotation, sourceUrls, annotatedAt, model } = data;
  const category = systemToCategory(system);

  // 1. Upsert node annotation
  kb.upsertNodeAnnotation({
    node_name: nodeName,
    node_category: category,
    semantic_name_zh: annotation.semantic_name_zh,
    semantic_name_en: annotation.semantic_name_en,
    one_line: annotation.one_line,
    analogy: annotation.analogy,
    prerequisite_nodes: annotation.prerequisite_nodes,
    required_context: annotation.required_context,
    typical_network: annotation.typical_network,
    annotation_yaml: JSON.stringify(annotation),
    source_urls: sourceUrls,
    annotated_at: annotatedAt,
    annotation_model: model,
  });

  // 2. Clear old embedding chunks for this node
  kb.clearChunksForNode(nodeName);

  // 3. Create new embedding chunks for the node overview
  const nodeChunks = chunkNodeAnnotation(nodeName, system, annotation as unknown as Record<string, unknown>);
  for (const chunk of nodeChunks) {
    kb.insertChunk({
      chunk_text: chunk.text,
      chunk_type: chunk.type,
      source_id: 0, // Will be updated when we have the actual ID
      source_table: "node_annotations",
      node_name: nodeName,
      system,
    });
  }

  // 4. Upsert parameter annotations + create chunks
  if (annotation.parameters) {
    for (const param of annotation.parameters) {
      kb.upsertParameterAnnotation({
        node_name: nodeName,
        param_name: param.name,
        param_path: param.path,
        semantic_name_zh: param.semantic_name_zh,
        semantic_name_en: param.semantic_name_en,
        one_line: param.one_line,
        intent_mapping: param.intent_mapping,
        default_value: param.default_value,
        safe_range_min: param.safe_range?.[0],
        safe_range_max: param.safe_range?.[1],
        expert_range_min: param.expert_range?.[0],
        expert_range_max: param.expert_range?.[1],
        danger_below: param.danger_zone?.below,
        danger_above: param.danger_zone?.above,
        danger_description: param.danger_zone?.description,
        visual_effect: param.visual_effect,
        interactions: param.interactions,
        context_adjustments: param.context_adjustments,
      });

      // Create embedding chunks for each parameter
      const paramChunks = chunkParameterAnnotation(
        nodeName,
        system,
        param as unknown as Record<string, unknown>,
      );
      for (const chunk of paramChunks) {
        kb.insertChunk({
          chunk_text: chunk.text,
          chunk_type: chunk.type,
          source_id: 0,
          source_table: "parameter_annotations",
          node_name: nodeName,
          system,
        });
      }
    }
  }

  // 5. Upsert recipes
  if (annotation.recipes) {
    for (const recipe of annotation.recipes) {
      const recipeName = `${nodeName}: ${recipe.name}`;
      kb.upsertRecipe({
        name: recipeName,
        system,
        tags: recipe.tags,
        description: recipe.description,
        prerequisites: recipe.prerequisites,
        parameters: recipe.parameters,
        warnings: recipe.warnings,
        variations: recipe.variations,
      });

      // Create embedding chunk for the recipe
      const recipeText = [
        `Recipe: ${recipeName}`,
        `System: ${system}`,
        `Tags: ${recipe.tags.join(", ")}`,
        `Description: ${recipe.description}`,
        recipe.prerequisites ? `Prerequisites: ${recipe.prerequisites.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      kb.insertChunk({
        chunk_text: recipeText,
        chunk_type: "recipe",
        source_id: 0,
        source_table: "recipes",
        node_name: nodeName,
        system,
      });
    }
  }

  // 6. Upsert error patterns
  if (annotation.error_patterns) {
    for (const pattern of annotation.error_patterns) {
      kb.upsertErrorPattern({
        pattern_id: pattern.pattern_id,
        system,
        severity: "common",
        symptoms: pattern.symptoms,
        root_causes: pattern.root_causes,
      });

      // Create embedding chunk for the error pattern
      const errorText = [
        `Error: ${pattern.pattern_id}`,
        `Symptoms: ${pattern.symptoms.join("; ")}`,
        `Root causes: ${pattern.root_causes.map((c) => c.cause).join("; ")}`,
      ].join("\n");

      kb.insertChunk({
        chunk_text: errorText,
        chunk_type: "error_pattern",
        source_id: 0,
        source_table: "error_patterns",
        node_name: nodeName,
        system,
      });
    }
  }
}

/**
 * Ingest all annotated files from a directory into the knowledge base.
 */
export async function ingestAll(options: {
  inputDir: string;
  dbPath?: string;
  rebuildVectors?: boolean;
  onProgress?: (done: number, total: number, nodeName: string) => void;
}): Promise<{ ingested: number; errors: number }> {
  const kb = await initDatabase(options.dbPath);
  const files = fs.readdirSync(options.inputDir).filter((f) => f.endsWith(".json"));

  let ingested = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(options.inputDir, file), "utf-8"),
      ) as AnnotatedFile;

      ingestAnnotation(kb, data);
      ingested++;
    } catch (err) {
      console.error(`[ingest] Failed for ${file}:`, (err as Error).message);
      errors++;
    }

    options.onProgress?.(ingested + errors, files.length, file);
  }

  // Rebuild vector index if requested
  if (options.rebuildVectors !== false) {
    console.log("[ingest] Rebuilding vector index...");
    try {
      const indexResult = await rebuildIndex(kb, {
        onProgress: (indexed, total) => {
          if (indexed % 50 === 0) {
            console.log(`[ingest] Indexed ${indexed}/${total} chunks`);
          }
        },
      });
      console.log(
        `[ingest] Vector index: ${indexResult.indexed} indexed, ${indexResult.errors} errors`,
      );
    } catch (err) {
      console.warn("[ingest] Vector index rebuild failed:", (err as Error).message);
    }
  }

  kb.close();
  return { ingested, errors };
}

// ── CLI Entry Point ────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf("--input");
  const dbIdx = args.indexOf("--db");
  const skipVectors = args.includes("--skip-vectors");

  const inputDir = inputIdx !== -1 ? args[inputIdx + 1] : "/tmp/houdini-annotated";
  const dbPath = dbIdx !== -1 ? args[dbIdx + 1] : undefined;

  console.log(`[ingest] Ingesting from ${inputDir}`);

  ingestAll({
    inputDir,
    dbPath,
    rebuildVectors: !skipVectors,
    onProgress: (done, total, name) => {
      console.log(`[ingest] ${done}/${total}: ${name}`);
    },
  }).then((result) => {
    console.log(
      `[ingest] Done. Ingested: ${result.ingested}, Errors: ${result.errors}`,
    );
  });
}
