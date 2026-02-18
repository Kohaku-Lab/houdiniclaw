/**
 * Houdini Claw Knowledge Base - Database Access Layer
 *
 * Provides connection management, initialization, and CRUD operations
 * for the Houdini knowledge base backed by SQLite + sqlite-vec.
 */

import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL, VECTOR_TABLE_SQL } from "./schema.js";

const DEFAULT_DB_DIR = path.join(
  process.env.HOME ?? process.env.USERPROFILE ?? ".",
  ".openclaw",
  "houdini-claw",
);
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, "houdini_kb.db");

export function resolveDbPath(): string {
  return process.env.HOUDINI_CLAW_DB_PATH ?? DEFAULT_DB_PATH;
}

/**
 * Initialize the database: create the directory, open the connection,
 * run schema migrations, and load the sqlite-vec extension.
 *
 * Returns a better-sqlite3 compatible database handle.
 * Caller is responsible for closing the connection.
 */
export async function initDatabase(dbPath?: string): Promise<KnowledgeBase> {
  const resolvedPath = dbPath ?? resolveDbPath();
  const dir = path.dirname(resolvedPath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Dynamic import for better-sqlite3 or bun:sqlite
  let db: DatabaseHandle;
  try {
    // Try bun:sqlite first (faster, built-in)
    const bunSqlite = await import("bun:sqlite");
    db = new bunSqlite.Database(resolvedPath) as unknown as DatabaseHandle;
  } catch {
    // Fall back to better-sqlite3
    const betterSqlite = await import("better-sqlite3");
    db = new betterSqlite.default(resolvedPath) as unknown as DatabaseHandle;
  }

  // Enable WAL mode for concurrent reads
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  // Run schema creation
  db.exec(SCHEMA_SQL);

  // Try to load sqlite-vec extension and create vector table
  try {
    await loadVecExtension(db);
    db.exec(VECTOR_TABLE_SQL);
  } catch (err) {
    console.warn(
      "[houdini-claw] sqlite-vec extension not available, vector search disabled:",
      (err as Error).message,
    );
  }

  return new KnowledgeBase(db, resolvedPath);
}

async function loadVecExtension(db: DatabaseHandle): Promise<void> {
  // sqlite-vec can be loaded as an extension
  // Try common paths
  const possiblePaths = [
    "vec0",
    "sqlite-vec",
    "/usr/lib/sqlite3/vec0",
    "/usr/local/lib/sqlite3/vec0",
  ];

  for (const extPath of possiblePaths) {
    try {
      db.loadExtension(extPath);
      return;
    } catch {
      // Try next path
    }
  }

  // Try the npm package approach
  try {
    const sqliteVec = await import("sqlite-vec");
    if (typeof sqliteVec.load === "function") {
      sqliteVec.load(db);
      return;
    }
  } catch {
    // Not available
  }

  throw new Error("Could not load sqlite-vec extension from any known path");
}

/** Minimal database handle interface compatible with better-sqlite3 and bun:sqlite */
interface DatabaseHandle {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  loadExtension(path: string): void;
  close(): void;
}

interface Statement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * High-level knowledge base wrapper providing typed access to all tables.
 */
export class KnowledgeBase {
  constructor(
    public readonly db: DatabaseHandle,
    public readonly dbPath: string,
  ) {}

  close(): void {
    this.db.close();
  }

  // ── Node Annotations ─────────────────────────────────────

  upsertNodeAnnotation(data: {
    node_name: string;
    node_category: string;
    houdini_version?: string;
    semantic_name_zh?: string;
    semantic_name_en?: string;
    one_line: string;
    analogy?: string;
    prerequisite_nodes?: string[];
    required_context?: string;
    typical_network?: string;
    annotation_yaml: string;
    source_urls?: string[];
    crawled_at?: string;
    annotated_at: string;
    annotation_model: string;
    human_verified?: boolean;
    confidence_score?: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO node_annotations (
        node_name, node_category, houdini_version,
        semantic_name_zh, semantic_name_en, one_line, analogy,
        prerequisite_nodes, required_context, typical_network,
        annotation_yaml, source_urls, crawled_at, annotated_at,
        annotation_model, human_verified, confidence_score, updated_at
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, datetime('now')
      )
      ON CONFLICT(node_name) DO UPDATE SET
        node_category = excluded.node_category,
        houdini_version = excluded.houdini_version,
        semantic_name_zh = excluded.semantic_name_zh,
        semantic_name_en = excluded.semantic_name_en,
        one_line = excluded.one_line,
        analogy = excluded.analogy,
        prerequisite_nodes = excluded.prerequisite_nodes,
        required_context = excluded.required_context,
        typical_network = excluded.typical_network,
        annotation_yaml = excluded.annotation_yaml,
        source_urls = excluded.source_urls,
        crawled_at = excluded.crawled_at,
        annotated_at = excluded.annotated_at,
        annotation_model = excluded.annotation_model,
        human_verified = excluded.human_verified,
        confidence_score = excluded.confidence_score,
        updated_at = datetime('now')
    `);

    stmt.run(
      data.node_name,
      data.node_category,
      data.houdini_version ?? "20.5",
      data.semantic_name_zh ?? null,
      data.semantic_name_en ?? null,
      data.one_line,
      data.analogy ?? null,
      data.prerequisite_nodes ? JSON.stringify(data.prerequisite_nodes) : null,
      data.required_context ?? null,
      data.typical_network ?? null,
      data.annotation_yaml,
      data.source_urls ? JSON.stringify(data.source_urls) : null,
      data.crawled_at ?? null,
      data.annotated_at,
      data.annotation_model,
      data.human_verified ? 1 : 0,
      data.confidence_score ?? 0.0,
    );
  }

  getNodeAnnotation(nodeName: string): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(
      "SELECT * FROM node_annotations WHERE node_name = ?",
    );
    return stmt.get(nodeName) as Record<string, unknown> | undefined;
  }

  listNodes(category?: string): Array<Record<string, unknown>> {
    if (category) {
      const stmt = this.db.prepare(
        "SELECT node_name, node_category, one_line, human_verified FROM node_annotations WHERE node_category = ? ORDER BY node_name",
      );
      return stmt.all(category) as Array<Record<string, unknown>>;
    }
    const stmt = this.db.prepare(
      "SELECT node_name, node_category, one_line, human_verified FROM node_annotations ORDER BY node_category, node_name",
    );
    return stmt.all() as Array<Record<string, unknown>>;
  }

  // ── Parameter Annotations ────────────────────────────────

  upsertParameterAnnotation(data: {
    node_name: string;
    param_name: string;
    param_path: string;
    semantic_name_zh?: string;
    semantic_name_en?: string;
    one_line?: string;
    intent_mapping?: Record<string, string>;
    default_value?: number;
    safe_range_min?: number;
    safe_range_max?: number;
    expert_range_min?: number;
    expert_range_max?: number;
    danger_below?: number;
    danger_above?: number;
    danger_description?: string;
    visual_effect?: Record<string, string>;
    interactions?: unknown[];
    context_adjustments?: Record<string, string>;
    human_verified?: boolean;
    confidence_score?: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO parameter_annotations (
        node_name, param_name, param_path,
        semantic_name_zh, semantic_name_en, one_line,
        intent_mapping, default_value,
        safe_range_min, safe_range_max,
        expert_range_min, expert_range_max,
        danger_below, danger_above, danger_description,
        visual_effect, interactions, context_adjustments,
        human_verified, confidence_score, updated_at
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, datetime('now')
      )
      ON CONFLICT(node_name, param_name) DO UPDATE SET
        param_path = excluded.param_path,
        semantic_name_zh = excluded.semantic_name_zh,
        semantic_name_en = excluded.semantic_name_en,
        one_line = excluded.one_line,
        intent_mapping = excluded.intent_mapping,
        default_value = excluded.default_value,
        safe_range_min = excluded.safe_range_min,
        safe_range_max = excluded.safe_range_max,
        expert_range_min = excluded.expert_range_min,
        expert_range_max = excluded.expert_range_max,
        danger_below = excluded.danger_below,
        danger_above = excluded.danger_above,
        danger_description = excluded.danger_description,
        visual_effect = excluded.visual_effect,
        interactions = excluded.interactions,
        context_adjustments = excluded.context_adjustments,
        human_verified = excluded.human_verified,
        confidence_score = excluded.confidence_score,
        updated_at = datetime('now')
    `);

    stmt.run(
      data.node_name,
      data.param_name,
      data.param_path,
      data.semantic_name_zh ?? null,
      data.semantic_name_en ?? null,
      data.one_line ?? null,
      data.intent_mapping ? JSON.stringify(data.intent_mapping) : null,
      data.default_value ?? null,
      data.safe_range_min ?? null,
      data.safe_range_max ?? null,
      data.expert_range_min ?? null,
      data.expert_range_max ?? null,
      data.danger_below ?? null,
      data.danger_above ?? null,
      data.danger_description ?? null,
      data.visual_effect ? JSON.stringify(data.visual_effect) : null,
      data.interactions ? JSON.stringify(data.interactions) : null,
      data.context_adjustments ? JSON.stringify(data.context_adjustments) : null,
      data.human_verified ? 1 : 0,
      data.confidence_score ?? 0.0,
    );
  }

  getParameterAnnotation(
    nodeName: string,
    paramName: string,
  ): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(
      "SELECT * FROM parameter_annotations WHERE node_name = ? AND param_name = ?",
    );
    return stmt.get(nodeName, paramName) as Record<string, unknown> | undefined;
  }

  getParametersForNode(nodeName: string): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(
      "SELECT * FROM parameter_annotations WHERE node_name = ? ORDER BY param_name",
    );
    return stmt.all(nodeName) as Array<Record<string, unknown>>;
  }

  // ── Recipes ──────────────────────────────────────────────

  upsertRecipe(data: {
    name: string;
    system: string;
    tags: string[];
    description: string;
    prerequisites?: string[];
    parameters: Record<string, Record<string, unknown>>;
    warnings?: string[];
    variations?: Record<string, Record<string, unknown>>;
    source_url?: string;
    human_verified?: boolean;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO recipes (
        name, system, tags, description,
        prerequisites, parameters, warnings, variations,
        source_url, human_verified, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET
        system = excluded.system,
        tags = excluded.tags,
        description = excluded.description,
        prerequisites = excluded.prerequisites,
        parameters = excluded.parameters,
        warnings = excluded.warnings,
        variations = excluded.variations,
        source_url = excluded.source_url,
        human_verified = excluded.human_verified,
        updated_at = datetime('now')
    `);

    stmt.run(
      data.name,
      data.system,
      JSON.stringify(data.tags),
      data.description,
      data.prerequisites ? JSON.stringify(data.prerequisites) : null,
      JSON.stringify(data.parameters),
      data.warnings ? JSON.stringify(data.warnings) : null,
      data.variations ? JSON.stringify(data.variations) : null,
      data.source_url ?? null,
      data.human_verified ? 1 : 0,
    );
  }

  searchRecipes(system?: string, tags?: string[]): Array<Record<string, unknown>> {
    if (system && tags && tags.length > 0) {
      // Search by system and tags (any tag match)
      const placeholders = tags.map(() => "tags LIKE ?").join(" OR ");
      const stmt = this.db.prepare(
        `SELECT * FROM recipes WHERE system = ? AND (${placeholders}) ORDER BY name`,
      );
      return stmt.all(system, ...tags.map((t) => `%"${t}"%`)) as Array<
        Record<string, unknown>
      >;
    }
    if (system) {
      const stmt = this.db.prepare(
        "SELECT * FROM recipes WHERE system = ? ORDER BY name",
      );
      return stmt.all(system) as Array<Record<string, unknown>>;
    }
    const stmt = this.db.prepare("SELECT * FROM recipes ORDER BY system, name");
    return stmt.all() as Array<Record<string, unknown>>;
  }

  // ── Error Patterns ───────────────────────────────────────

  upsertErrorPattern(data: {
    pattern_id: string;
    system: string;
    severity: string;
    symptoms: string[];
    root_causes: unknown[];
    related_patterns?: string[];
    human_verified?: boolean;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO error_patterns (
        pattern_id, system, severity,
        symptoms, root_causes, related_patterns,
        human_verified, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(pattern_id) DO UPDATE SET
        system = excluded.system,
        severity = excluded.severity,
        symptoms = excluded.symptoms,
        root_causes = excluded.root_causes,
        related_patterns = excluded.related_patterns,
        human_verified = excluded.human_verified,
        updated_at = datetime('now')
    `);

    stmt.run(
      data.pattern_id,
      data.system,
      data.severity,
      JSON.stringify(data.symptoms),
      JSON.stringify(data.root_causes),
      data.related_patterns ? JSON.stringify(data.related_patterns) : null,
      data.human_verified ? 1 : 0,
    );
  }

  searchErrorPatterns(
    system?: string,
    keyword?: string,
  ): Array<Record<string, unknown>> {
    if (system && keyword) {
      const stmt = this.db.prepare(
        "SELECT * FROM error_patterns WHERE system = ? AND symptoms LIKE ? ORDER BY severity",
      );
      return stmt.all(system, `%${keyword}%`) as Array<Record<string, unknown>>;
    }
    if (system) {
      const stmt = this.db.prepare(
        "SELECT * FROM error_patterns WHERE system = ? ORDER BY pattern_id",
      );
      return stmt.all(system) as Array<Record<string, unknown>>;
    }
    const stmt = this.db.prepare(
      "SELECT * FROM error_patterns ORDER BY system, pattern_id",
    );
    return stmt.all() as Array<Record<string, unknown>>;
  }

  // ── Embedding Chunks ─────────────────────────────────────

  insertChunk(data: {
    chunk_text: string;
    chunk_type: string;
    source_id: number;
    source_table: string;
    node_name?: string;
    system?: string;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO embedding_chunks (
        chunk_text, chunk_type, source_id, source_table, node_name, system
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.chunk_text,
      data.chunk_type,
      data.source_id,
      data.source_table,
      data.node_name ?? null,
      data.system ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  clearChunksForNode(nodeName: string): void {
    this.db.prepare("DELETE FROM embedding_chunks WHERE node_name = ?").run(nodeName);
  }

  // ── Crawl Log ────────────────────────────────────────────

  logCrawl(data: {
    source_url: string;
    source_type: string;
    content_hash: string;
    status?: string;
    error_message?: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO crawl_log (source_url, source_type, content_hash, status, error_message)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      data.source_url,
      data.source_type,
      data.content_hash,
      data.status ?? "success",
      data.error_message ?? null,
    );
  }

  getLastCrawl(sourceUrl: string): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(
      "SELECT * FROM crawl_log WHERE source_url = ? ORDER BY fetched_at DESC LIMIT 1",
    );
    return stmt.get(sourceUrl) as Record<string, unknown> | undefined;
  }

  // ── Coverage Report ──────────────────────────────────────

  getCoverageReport(): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(`
      SELECT
        na.node_category as system,
        COUNT(DISTINCT na.node_name) as annotated_nodes,
        SUM(CASE WHEN na.human_verified = 1 THEN 1 ELSE 0 END) as verified_nodes,
        (SELECT COUNT(*) FROM parameter_annotations pa WHERE pa.node_name IN
          (SELECT node_name FROM node_annotations WHERE node_category = na.node_category)
        ) as annotated_params,
        (SELECT COUNT(*) FROM parameter_annotations pa WHERE pa.human_verified = 1 AND pa.node_name IN
          (SELECT node_name FROM node_annotations WHERE node_category = na.node_category)
        ) as verified_params
      FROM node_annotations na
      GROUP BY na.node_category
      ORDER BY na.node_category
    `);
    return stmt.all() as Array<Record<string, unknown>>;
  }

  // ── HIP Files ──────────────────────────────────────────────

  upsertHipFile(data: {
    file_name: string;
    file_hash: string;
    source: string;
    source_url?: string;
    houdini_version?: string;
    description?: string;
    systems?: string[];
    node_count?: number;
    parsed_at?: string;
    parse_status?: string;
    parse_error?: string;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO hip_files (
        file_name, file_hash, source, source_url,
        houdini_version, description, systems, node_count,
        parsed_at, parse_status, parse_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_hash) DO UPDATE SET
        file_name = excluded.file_name,
        source = excluded.source,
        source_url = excluded.source_url,
        houdini_version = excluded.houdini_version,
        description = excluded.description,
        systems = excluded.systems,
        node_count = excluded.node_count,
        parsed_at = excluded.parsed_at,
        parse_status = excluded.parse_status,
        parse_error = excluded.parse_error
    `);
    const result = stmt.run(
      data.file_name,
      data.file_hash,
      data.source,
      data.source_url ?? null,
      data.houdini_version ?? null,
      data.description ?? null,
      data.systems ? JSON.stringify(data.systems) : null,
      data.node_count ?? 0,
      data.parsed_at ?? null,
      data.parse_status ?? "pending",
      data.parse_error ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  getHipFile(fileHash: string): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(
      "SELECT * FROM hip_files WHERE file_hash = ?",
    );
    return stmt.get(fileHash) as Record<string, unknown> | undefined;
  }

  listHipFiles(options?: {
    source?: string;
    parseStatus?: string;
  }): Array<Record<string, unknown>> {
    if (options?.source && options?.parseStatus) {
      const stmt = this.db.prepare(
        "SELECT * FROM hip_files WHERE source = ? AND parse_status = ? ORDER BY created_at DESC",
      );
      return stmt.all(options.source, options.parseStatus) as Array<Record<string, unknown>>;
    }
    if (options?.source) {
      const stmt = this.db.prepare(
        "SELECT * FROM hip_files WHERE source = ? ORDER BY created_at DESC",
      );
      return stmt.all(options.source) as Array<Record<string, unknown>>;
    }
    if (options?.parseStatus) {
      const stmt = this.db.prepare(
        "SELECT * FROM hip_files WHERE parse_status = ? ORDER BY created_at DESC",
      );
      return stmt.all(options.parseStatus) as Array<Record<string, unknown>>;
    }
    const stmt = this.db.prepare(
      "SELECT * FROM hip_files ORDER BY created_at DESC",
    );
    return stmt.all() as Array<Record<string, unknown>>;
  }

  // ── HIP Parameter Snapshots ────────────────────────────────

  insertParameterSnapshot(data: {
    hip_file_id: number;
    node_type: string;
    node_path: string;
    param_name: string;
    param_value: string;
    is_default?: boolean;
    expression?: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO hip_parameter_snapshots (
        hip_file_id, node_type, node_path, param_name,
        param_value, is_default, expression
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      data.hip_file_id,
      data.node_type,
      data.node_path,
      data.param_name,
      data.param_value,
      data.is_default ? 1 : 0,
      data.expression ?? null,
    );
  }

  /**
   * Bulk insert parameter snapshots for a HIP file.
   */
  insertParameterSnapshots(
    hipFileId: number,
    snapshots: Array<{
      node_type: string;
      node_path: string;
      param_name: string;
      param_value: string;
      is_default?: boolean;
      expression?: string;
    }>,
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO hip_parameter_snapshots (
        hip_file_id, node_type, node_path, param_name,
        param_value, is_default, expression
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const snap of snapshots) {
      stmt.run(
        hipFileId,
        snap.node_type,
        snap.node_path,
        snap.param_name,
        snap.param_value,
        snap.is_default ? 1 : 0,
        snap.expression ?? null,
      );
    }
  }

  getSnapshotsForNodeType(
    nodeType: string,
  ): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(
      "SELECT * FROM hip_parameter_snapshots WHERE node_type = ? ORDER BY param_name",
    );
    return stmt.all(nodeType) as Array<Record<string, unknown>>;
  }

  /**
   * Aggregate parameter statistics across all HIP files for a given node type.
   * Returns min, max, avg, and count for each parameter.
   */
  getParameterStatistics(
    nodeType: string,
    paramName?: string,
  ): Array<Record<string, unknown>> {
    let sql = `
      SELECT
        param_name,
        COUNT(*) as sample_count,
        MIN(CAST(param_value AS REAL)) as min_value,
        MAX(CAST(param_value AS REAL)) as max_value,
        AVG(CAST(param_value AS REAL)) as avg_value,
        SUM(CASE WHEN is_default = 0 THEN 1 ELSE 0 END) as modified_count
      FROM hip_parameter_snapshots
      WHERE node_type = ?
        AND typeof(param_value) != 'text'
        OR (param_value GLOB '[0-9]*' OR param_value GLOB '-[0-9]*' OR param_value GLOB '[0-9]*.[0-9]*')
    `;
    const params: unknown[] = [nodeType];

    if (paramName) {
      sql += " AND param_name = ?";
      params.push(paramName);
    }

    sql += " GROUP BY param_name ORDER BY sample_count DESC";

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Array<Record<string, unknown>>;
  }

  /**
   * Clear all parameter snapshots for a specific HIP file.
   */
  clearSnapshotsForHipFile(hipFileId: number): void {
    this.db.prepare(
      "DELETE FROM hip_parameter_snapshots WHERE hip_file_id = ?",
    ).run(hipFileId);
  }

  /**
   * Get HIP coverage report: how many files parsed per system.
   */
  getHipCoverageReport(): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(`
      SELECT
        json_each.value as system,
        COUNT(DISTINCT hf.id) as total_files,
        SUM(CASE WHEN hf.parse_status = 'success' THEN 1 ELSE 0 END) as parsed_files,
        SUM(hf.node_count) as total_nodes,
        (SELECT COUNT(*) FROM hip_parameter_snapshots hps
         WHERE hps.hip_file_id IN (SELECT id FROM hip_files)
        ) as total_snapshots
      FROM hip_files hf, json_each(hf.systems)
      GROUP BY json_each.value
      ORDER BY json_each.value
    `);
    return stmt.all() as Array<Record<string, unknown>>;
  }
}
