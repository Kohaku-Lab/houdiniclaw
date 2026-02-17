/**
 * Houdini Claw Knowledge Base Schema
 *
 * Defines the SQLite schema for storing structured Houdini node annotations,
 * parameter metadata, recipes, error patterns, and vector embeddings for
 * semantic search.
 */

/** SQL statements to initialize the knowledge base. Run once on first startup. */
export const SCHEMA_SQL = `
-- Core node annotation table
CREATE TABLE IF NOT EXISTS node_annotations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  node_name       TEXT NOT NULL UNIQUE,
  node_category   TEXT NOT NULL,          -- DOP, SOP, VOP, CHOP, etc.
  houdini_version TEXT NOT NULL DEFAULT '20.5',

  -- Semantic metadata (stored as JSON)
  semantic_name_zh    TEXT,               -- Chinese semantic name
  semantic_name_en    TEXT,               -- English semantic name
  one_line            TEXT NOT NULL,      -- One-sentence explanation
  analogy             TEXT,               -- Physical analogy for the node

  -- Network context
  prerequisite_nodes  TEXT,               -- JSON array of required upstream nodes
  required_context    TEXT,               -- DOP/SOP/etc
  typical_network     TEXT,               -- Description of typical usage in a network

  -- Full annotation blob (complete YAML annotation)
  annotation_yaml     TEXT NOT NULL,

  -- Provenance
  source_urls         TEXT,               -- JSON array of source URLs
  crawled_at          TEXT,
  annotated_at        TEXT NOT NULL,
  annotation_model    TEXT NOT NULL,
  human_verified      INTEGER NOT NULL DEFAULT 0,
  confidence_score    REAL NOT NULL DEFAULT 0.0,

  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_node_annotations_category ON node_annotations(node_category);
CREATE INDEX IF NOT EXISTS idx_node_annotations_name ON node_annotations(node_name);

-- Parameter annotations (one row per parameter per node)
CREATE TABLE IF NOT EXISTS parameter_annotations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  node_name       TEXT NOT NULL,
  param_name      TEXT NOT NULL,
  param_path      TEXT NOT NULL,          -- Full Houdini parameter path

  -- Semantic metadata
  semantic_name_zh    TEXT,
  semantic_name_en    TEXT,
  one_line            TEXT,

  -- Intent mapping (JSON: { "user intent": "adjustment direction" })
  intent_mapping      TEXT,

  -- Ranges
  default_value       REAL,
  safe_range_min      REAL,
  safe_range_max      REAL,
  expert_range_min    REAL,
  expert_range_max    REAL,
  danger_below        REAL,
  danger_above        REAL,
  danger_description  TEXT,

  -- Visual effect descriptions (JSON: { "0.01": "description", ... })
  visual_effect       TEXT,

  -- Interaction warnings (JSON array of interaction objects)
  interactions        TEXT,

  -- Context-specific adjustments (JSON: { "indoor": "range + note", ... })
  context_adjustments TEXT,

  human_verified      INTEGER NOT NULL DEFAULT 0,
  confidence_score    REAL NOT NULL DEFAULT 0.0,

  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(node_name, param_name),
  FOREIGN KEY (node_name) REFERENCES node_annotations(node_name)
);

CREATE INDEX IF NOT EXISTS idx_param_annotations_node ON parameter_annotations(node_name);
CREATE INDEX IF NOT EXISTS idx_param_annotations_param ON parameter_annotations(param_name);

-- Recipe storage
CREATE TABLE IF NOT EXISTS recipes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  system          TEXT NOT NULL,          -- pyro, rbd, flip, vellum, mixed
  tags            TEXT NOT NULL,          -- JSON array of tags
  description     TEXT NOT NULL,

  -- Full recipe (JSON)
  prerequisites   TEXT,                   -- JSON array
  parameters      TEXT NOT NULL,          -- JSON: { node: { param: value } }
  warnings        TEXT,                   -- JSON array
  variations      TEXT,                   -- JSON: { name: { param: value, note: string } }

  source_url      TEXT,
  human_verified  INTEGER NOT NULL DEFAULT 0,

  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recipes_system ON recipes(system);

-- Error pattern storage
CREATE TABLE IF NOT EXISTS error_patterns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id      TEXT NOT NULL UNIQUE,   -- e.g., "PYRO-001"
  system          TEXT NOT NULL,
  severity        TEXT NOT NULL,          -- common, moderate, rare

  -- Pattern data
  symptoms        TEXT NOT NULL,          -- JSON array of symptom strings
  root_causes     TEXT NOT NULL,          -- JSON array of { cause, probability, explanation, fix, verify }
  related_patterns TEXT,                  -- JSON array of related pattern IDs

  human_verified  INTEGER NOT NULL DEFAULT 0,

  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_error_patterns_system ON error_patterns(system);

-- Crawl log (tracks what was fetched and when)
CREATE TABLE IF NOT EXISTS crawl_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url      TEXT NOT NULL,
  source_type     TEXT NOT NULL,          -- sidefx_docs, sidefx_forum, odforce, tutorial
  content_hash    TEXT NOT NULL,          -- SHA-256 of fetched content
  fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
  status          TEXT NOT NULL DEFAULT 'success',  -- success, error, skipped
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_crawl_log_url ON crawl_log(source_url);
CREATE INDEX IF NOT EXISTS idx_crawl_log_type ON crawl_log(source_type);

-- Vector embedding chunks for semantic search
-- Each chunk is a piece of annotation text with its embedding vector.
-- The actual vector data lives in the sqlite-vec virtual table (kb_vec).
CREATE TABLE IF NOT EXISTS embedding_chunks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_text      TEXT NOT NULL,
  chunk_type      TEXT NOT NULL,          -- node, parameter, recipe, error_pattern
  source_id       INTEGER NOT NULL,       -- FK to the source table (based on chunk_type)
  source_table    TEXT NOT NULL,          -- Which table this chunk came from
  node_name       TEXT,                   -- For filtering by node
  system          TEXT,                   -- For filtering by system

  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_embedding_chunks_type ON embedding_chunks(chunk_type);
CREATE INDEX IF NOT EXISTS idx_embedding_chunks_node ON embedding_chunks(node_name);
CREATE INDEX IF NOT EXISTS idx_embedding_chunks_system ON embedding_chunks(system);

-- Coverage tracking
CREATE TABLE IF NOT EXISTS coverage_report (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  system          TEXT NOT NULL,          -- pyro, rbd, flip, vellum, etc.
  total_nodes     INTEGER NOT NULL DEFAULT 0,
  annotated_nodes INTEGER NOT NULL DEFAULT 0,
  verified_nodes  INTEGER NOT NULL DEFAULT 0,
  total_params    INTEGER NOT NULL DEFAULT 0,
  annotated_params INTEGER NOT NULL DEFAULT 0,
  verified_params INTEGER NOT NULL DEFAULT 0,
  total_recipes   INTEGER NOT NULL DEFAULT 0,
  total_errors    INTEGER NOT NULL DEFAULT 0,
  report_date     TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(system, report_date)
);
`;

/** SQL to create the sqlite-vec virtual table for vector search. */
export const VECTOR_TABLE_SQL = `
-- sqlite-vec virtual table for semantic search embeddings
-- dimension=1536 matches text-embedding-3-small output
CREATE VIRTUAL TABLE IF NOT EXISTS kb_vec USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding float[1536]
);
`;

/** Node categories in Houdini */
export const NODE_CATEGORIES = [
  "SOP",
  "DOP",
  "VOP",
  "CHOP",
  "COP",
  "ROP",
  "OBJ",
  "LOP",
  "TOP",
] as const;

/** Simulation systems tracked by Houdini Claw */
export const SIMULATION_SYSTEMS = [
  "pyro",
  "rbd",
  "flip",
  "vellum",
  "chop",
  "sop",
  "cop",
  "lop",
] as const;

export type NodeCategory = (typeof NODE_CATEGORIES)[number];
export type SimulationSystem = (typeof SIMULATION_SYSTEMS)[number];

/** Shape of a parameter annotation for TypeScript usage */
export interface ParameterAnnotation {
  node_name: string;
  param_name: string;
  param_path: string;
  semantic_name_zh?: string;
  semantic_name_en?: string;
  one_line?: string;
  intent_mapping?: Record<string, string>;
  default_value?: number;
  safe_range: [number, number];
  expert_range: [number, number];
  danger_zone?: { below?: number; above?: number; description?: string };
  visual_effect?: Record<string, string>;
  interactions?: Array<{
    param: string;
    relationship: string;
    warning?: string;
    tip?: string;
  }>;
  context_adjustments?: Record<string, string>;
}

/** Shape of a recipe for TypeScript usage */
export interface Recipe {
  name: string;
  system: SimulationSystem;
  tags: string[];
  description: string;
  prerequisites?: string[];
  parameters: Record<string, Record<string, unknown>>;
  warnings?: string[];
  variations?: Record<string, Record<string, unknown>>;
}

/** Shape of an error pattern for TypeScript usage */
export interface ErrorPattern {
  pattern_id: string;
  system: SimulationSystem;
  severity: "common" | "moderate" | "rare";
  symptoms: string[];
  root_causes: Array<{
    cause: string;
    probability: "high" | "medium" | "low";
    explanation: string;
    fix: string[];
    verify?: string;
  }>;
  related_patterns?: string[];
}
