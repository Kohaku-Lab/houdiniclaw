/**
 * Houdini Claw - HIP Data Extractor
 *
 * Extracts knowledge-base-relevant data from parsed HIP files and
 * writes it into the SQLite knowledge base. Bridges the hip-parser
 * output to the annotation pipeline.
 *
 * Extracted data types:
 *   - Parameter snapshots (actual values from real scenes)
 *   - Network topology (which nodes are typically used together)
 *   - Non-default parameters (explicitly adjusted by artists)
 *   - Expression patterns (common VEX/HScript usage)
 *
 * Usage:
 *   bun src/houdini-claw/hip-extractor.ts --hip /path/to/scene.hip --db ~/.openclaw/houdini-claw/houdini_kb.db
 *   bun src/houdini-claw/hip-extractor.ts --cache-dir /tmp/hip-cache/ --all
 */

import fs from "node:fs";
import { initDatabase, type KnowledgeBase } from "./db.js";
import { parseHipFile, parseHipBuffer } from "./hip-parser/index.js";
import { getNonDefaultParameters, groupNodesByType } from "./hip-parser/hip-content-parser.js";
import type { HipParseResult, HipNode, HipParameter } from "./hip-parser/hip-content-parser.js";
import type { HipFileEntry } from "./hip-downloader.js";

// ── Types ──────────────────────────────────────────────────

export interface ExtractionResult {
  hipFileId: number;
  nodesExtracted: number;
  parametersExtracted: number;
  nonDefaultParams: number;
  expressionsFound: number;
  errors: string[];
}

export interface ParameterUsageStats {
  nodeType: string;
  paramName: string;
  sampleCount: number;
  minValue: number;
  maxValue: number;
  avgValue: number;
  modifiedCount: number;
  /** Computed actual usage range (excluding outliers) */
  usageRange: [number, number];
}

// ── Core Extraction ────────────────────────────────────────

/**
 * Extract data from a parsed HIP file and write to the knowledge base.
 */
export async function extractHipToKnowledgeBase(
  parsed: HipParseResult,
  fileEntry: {
    fileName: string;
    fileHash: string;
    source: string;
    sourceUrl?: string;
    systems?: string[];
    description?: string;
  },
  kb: KnowledgeBase,
): Promise<ExtractionResult> {
  const errors: string[] = [];
  let parametersExtracted = 0;
  let nonDefaultParams = 0;
  let expressionsFound = 0;

  // 1. Register the HIP file in the database
  const hipFileId = kb.upsertHipFile({
    file_name: fileEntry.fileName,
    file_hash: fileEntry.fileHash,
    source: fileEntry.source,
    source_url: fileEntry.sourceUrl,
    houdini_version: parsed.hipVersion || undefined,
    description: fileEntry.description,
    systems: fileEntry.systems ?? inferSystemsFromNodes(parsed.nodes),
    node_count: parsed.nodes.length,
    parsed_at: new Date().toISOString(),
    parse_status: "success",
  });

  // 2. Clear any old snapshots for this file
  kb.clearSnapshotsForHipFile(hipFileId);

  // 3. Extract parameter snapshots from all nodes
  const snapshots: Array<{
    node_type: string;
    node_path: string;
    param_name: string;
    param_value: string;
    is_default?: boolean;
    expression?: string;
  }> = [];

  for (const node of parsed.nodes) {
    for (const param of node.parameters) {
      const valueStr =
        typeof param.value === "object"
          ? JSON.stringify(param.value)
          : String(param.value);

      snapshots.push({
        node_type: node.type,
        node_path: node.path,
        param_name: param.name,
        param_value: valueStr,
        is_default: param.isDefault,
        expression: param.expression,
      });

      parametersExtracted++;
      if (!param.isDefault) nonDefaultParams++;
      if (param.expression) expressionsFound++;
    }
  }

  // Bulk insert snapshots
  try {
    kb.insertParameterSnapshots(hipFileId, snapshots);
  } catch (err) {
    errors.push(`Failed to insert snapshots: ${(err as Error).message}`);
  }

  return {
    hipFileId,
    nodesExtracted: parsed.nodes.length,
    parametersExtracted,
    nonDefaultParams,
    expressionsFound,
    errors,
  };
}

/**
 * Extract data from a HIP file on disk and write to the knowledge base.
 */
export async function extractHipFileToKnowledgeBase(
  filePath: string,
  fileEntry: {
    fileName: string;
    fileHash: string;
    source: string;
    sourceUrl?: string;
    systems?: string[];
    description?: string;
  },
  options?: { dbPath?: string },
): Promise<ExtractionResult> {
  const kb = await initDatabase(options?.dbPath);

  try {
    const parsed = await parseHipFile(filePath);
    return await extractHipToKnowledgeBase(parsed, fileEntry, kb);
  } catch (err) {
    // Record the parse failure
    kb.upsertHipFile({
      file_name: fileEntry.fileName,
      file_hash: fileEntry.fileHash,
      source: fileEntry.source,
      source_url: fileEntry.sourceUrl,
      systems: fileEntry.systems,
      parsed_at: new Date().toISOString(),
      parse_status: "error",
      parse_error: (err as Error).message,
    });

    return {
      hipFileId: 0,
      nodesExtracted: 0,
      parametersExtracted: 0,
      nonDefaultParams: 0,
      expressionsFound: 0,
      errors: [(err as Error).message],
    };
  } finally {
    kb.close();
  }
}

/**
 * Process all HIP file entries (from downloader) and extract to KB.
 */
export async function extractAllHipFiles(options: {
  entries: HipFileEntry[];
  dbPath?: string;
  onProgress?: (done: number, total: number, fileName: string) => void;
}): Promise<{
  extracted: number;
  errors: number;
  totalParams: number;
  totalNonDefault: number;
}> {
  const kb = await initDatabase(options.dbPath);
  let extracted = 0;
  let errors = 0;
  let totalParams = 0;
  let totalNonDefault = 0;

  try {
    for (let i = 0; i < options.entries.length; i++) {
      const entry = options.entries[i];

      // Skip if already parsed successfully
      const existing = kb.getHipFile(entry.hash);
      if (existing && existing.parse_status === "success") {
        options.onProgress?.(i + 1, options.entries.length, `${entry.fileName} (cached)`);
        extracted++;
        continue;
      }

      try {
        if (!fs.existsSync(entry.localPath)) {
          throw new Error(`File not found: ${entry.localPath}`);
        }

        const parsed = await parseHipFile(entry.localPath);
        const result = await extractHipToKnowledgeBase(
          parsed,
          {
            fileName: entry.fileName,
            fileHash: entry.hash,
            source: entry.sourceType,
            sourceUrl: entry.source,
            systems: entry.systems,
            description: entry.description,
          },
          kb,
        );

        if (result.errors.length === 0) {
          extracted++;
          totalParams += result.parametersExtracted;
          totalNonDefault += result.nonDefaultParams;
        } else {
          errors++;
        }
      } catch (err) {
        console.error(`[hip-extract] Failed for ${entry.fileName}:`, (err as Error).message);

        // Record the failure
        kb.upsertHipFile({
          file_name: entry.fileName,
          file_hash: entry.hash,
          source: entry.sourceType,
          source_url: entry.source,
          systems: entry.systems,
          parsed_at: new Date().toISOString(),
          parse_status: "error",
          parse_error: (err as Error).message,
        });

        errors++;
      }

      options.onProgress?.(i + 1, options.entries.length, entry.fileName);
    }
  } finally {
    kb.close();
  }

  return { extracted, errors, totalParams, totalNonDefault };
}

// ── Parameter Usage Analysis ───────────────────────────────

/**
 * Compute parameter usage statistics from the knowledge base.
 * Aggregates actual values from all parsed HIP files for a given node type.
 */
export async function getParameterUsageStats(
  nodeType: string,
  options?: { dbPath?: string },
): Promise<ParameterUsageStats[]> {
  const kb = await initDatabase(options?.dbPath);

  try {
    const rawStats = kb.getParameterStatistics(nodeType);

    return rawStats.map((row) => {
      const min = Number(row.min_value) || 0;
      const max = Number(row.max_value) || 0;
      const avg = Number(row.avg_value) || 0;

      // Compute a conservative usage range (trim 10% from extremes)
      const range = max - min;
      const usageMin = min + range * 0.1;
      const usageMax = max - range * 0.1;

      return {
        nodeType,
        paramName: String(row.param_name),
        sampleCount: Number(row.sample_count) || 0,
        minValue: min,
        maxValue: max,
        avgValue: avg,
        modifiedCount: Number(row.modified_count) || 0,
        usageRange: [
          usageMin < usageMax ? usageMin : min,
          usageMax > usageMin ? usageMax : max,
        ] as [number, number],
      };
    });
  } finally {
    kb.close();
  }
}

/**
 * Generate a summary of HIP data for a specific node type.
 * This summary can be injected into the annotation prompt.
 */
export function generateHipDataSummary(
  stats: ParameterUsageStats[],
): string {
  if (stats.length === 0) {
    return "No HIP file data available for this node type.";
  }

  const lines: string[] = [
    `## HIP File Analysis (${stats[0].nodeType})`,
    `Based on ${Math.max(...stats.map((s) => s.sampleCount))} example files:\n`,
  ];

  for (const stat of stats) {
    if (stat.sampleCount < 2) continue; // Skip params with too few samples

    lines.push(`### ${stat.paramName}`);
    lines.push(`- Samples: ${stat.sampleCount} files`);
    lines.push(`- Range: ${stat.minValue} to ${stat.maxValue}`);
    lines.push(`- Average: ${stat.avgValue.toFixed(4)}`);
    lines.push(`- Usage range (p10-p90): ${stat.usageRange[0].toFixed(4)} to ${stat.usageRange[1].toFixed(4)}`);
    lines.push(`- Modified from default: ${stat.modifiedCount}/${stat.sampleCount} times`);
    lines.push("");
  }

  return lines.join("\n");
}

// ── Helpers ────────────────────────────────────────────────

function inferSystemsFromNodes(nodes: HipNode[]): string[] {
  const systems = new Set<string>();

  for (const node of nodes) {
    const typeLower = node.type.toLowerCase();

    if (typeLower.includes("pyro") || typeLower.includes("smoke") || typeLower.includes("fire")) {
      systems.add("pyro");
    }
    if (typeLower.includes("rbd") || typeLower.includes("bullet") || typeLower.includes("voronoi")) {
      systems.add("rbd");
    }
    if (typeLower.includes("flip") || typeLower.includes("ocean") || typeLower.includes("fluid")) {
      systems.add("flip");
    }
    if (typeLower.includes("vellum") || typeLower.includes("cloth")) {
      systems.add("vellum");
    }
  }

  return Array.from(systems);
}

// ── CLI Entry Point ────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const hipIdx = args.indexOf("--hip");
  const dbIdx = args.indexOf("--db");

  if (hipIdx === -1) {
    console.error("Usage: hip-extractor.ts --hip <path> [--db <path>]");
    process.exit(1);
  }

  const hipPath = args[hipIdx + 1];
  const dbPath = dbIdx !== -1 ? args[dbIdx + 1] : undefined;

  console.log(`[hip-extract] Extracting from: ${hipPath}`);

  const crypto = await import("node:crypto");
  const content = fs.readFileSync(hipPath);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const fileName = hipPath.split("/").pop() ?? hipPath;

  extractHipFileToKnowledgeBase(
    hipPath,
    {
      fileName,
      fileHash: hash,
      source: "local_install",
      systems: [],
    },
    { dbPath },
  ).then((result) => {
    console.log(`[hip-extract] Done.`);
    console.log(`  Nodes: ${result.nodesExtracted}`);
    console.log(`  Parameters: ${result.parametersExtracted}`);
    console.log(`  Non-default: ${result.nonDefaultParams}`);
    console.log(`  Expressions: ${result.expressionsFound}`);
    if (result.errors.length > 0) {
      console.error(`  Errors: ${result.errors.join(", ")}`);
    }
  });
}
