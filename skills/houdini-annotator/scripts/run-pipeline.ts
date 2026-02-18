#!/usr/bin/env bun
/**
 * Houdini Claw - Full Annotation Pipeline Runner
 *
 * Orchestrates the complete pipeline:
 *   crawl → download HIP → parse HIP → annotate → ingest → report
 *
 * Usage:
 *   bun skills/houdini-annotator/scripts/run-pipeline.ts --mode full
 *   bun skills/houdini-annotator/scripts/run-pipeline.ts --mode incremental
 *   bun skills/houdini-annotator/scripts/run-pipeline.ts --mode full --system pyro
 *   bun skills/houdini-annotator/scripts/run-pipeline.ts --seed-only
 *   bun skills/houdini-annotator/scripts/run-pipeline.ts --hip-only --scan-local
 *
 * Environment:
 *   OPENAI_API_KEY         - Required for annotation and embedding
 *   HOUDINI_CLAW_DB_PATH   - Optional, defaults to ~/.openclaw/houdini-claw/houdini_kb.db
 *   HOUDINI_INSTALL_PATH   - Optional, for scanning local Houdini example files
 */

import path from "node:path";
import fs from "node:fs";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = getArg(args, "--mode") ?? "full";
  const systems = getArg(args, "--system")?.split(",");
  const seedOnly = args.includes("--seed-only");
  const hipOnly = args.includes("--hip-only");
  const skipCrawl = args.includes("--skip-crawl");
  const skipAnnotate = args.includes("--skip-annotate");
  const skipHip = args.includes("--skip-hip");
  const scanLocal = args.includes("--scan-local");
  const houdiniPath = getArg(args, "--houdini-path");

  const tmpBase = path.join("/tmp", "houdini-claw-pipeline");
  const rawDir = path.join(tmpBase, "raw");
  const annotatedDir = path.join(tmpBase, "annotated");

  console.log("=== Houdini Claw Annotation Pipeline ===");
  console.log(`Mode: ${mode}`);
  console.log(`Systems: ${systems?.join(", ") ?? "all"}`);
  console.log(`Temp dir: ${tmpBase}`);
  if (skipHip) console.log("HIP processing: SKIPPED");
  if (scanLocal) console.log(`Local Houdini scan: ${houdiniPath ?? "auto-detect"}`);
  console.log("");

  // Seed-only mode: just populate with hand-verified data
  if (seedOnly) {
    console.log("[pipeline] Running seed-only mode...");
    const { seedDatabase } = await import("../../../src/houdini-claw/seed.js");
    await seedDatabase();
    console.log("[pipeline] Seed complete.");
    return;
  }

  // HIP-only mode: just process HIP files
  if (hipOnly) {
    await runHipStages({ scanLocal, houdiniPath, systems });
    return;
  }

  // ── Stage 1: Crawl documentation + examples ────────────

  if (!skipCrawl) {
    console.log("[pipeline] Stage 1: Crawling documentation + examples...");
    const { runCrawlWithExamples } = await import("../../../src/houdini-claw/crawl.js");
    const crawled = await runCrawlWithExamples({
      mode: mode as "full" | "incremental",
      outputDir: rawDir,
      systems,
      includeExamples: true,
      onProgress: (fetched, total, nodeName) => {
        process.stdout.write(`\r  [crawl] ${fetched}/${total}: ${nodeName}          `);
      },
    });
    console.log(`\n  Crawled ${crawled.length} pages (docs + examples).`);

    // Also crawl Content Library
    console.log("\n  Crawling Content Library...");
    const { crawlContentLibrary, saveContentLibraryResults } = await import(
      "../../../src/houdini-claw/crawl-content-library.js"
    );
    const clResult = await crawlContentLibrary({
      onProgress: (fetched, name) => {
        process.stdout.write(`\r  [content-library] ${fetched} items (${name})          `);
      },
    });
    saveContentLibraryResults(clResult, path.join(rawDir, "content-library"));
    console.log(`\n  Content Library: ${clResult.totalFound} items found.`);
  } else {
    console.log("[pipeline] Skipping crawl (--skip-crawl)");
  }

  // ── Stage 1.5 & 1.6: Download + Parse HIP files ───────

  if (!skipHip) {
    await runHipStages({ scanLocal, houdiniPath, systems, rawDir });
  } else {
    console.log("\n[pipeline] Skipping HIP processing (--skip-hip)");
  }

  // ── Stage 2: Annotate ─────────────────────────────────

  if (!skipAnnotate) {
    if (!process.env.OPENAI_API_KEY) {
      console.warn("[pipeline] Warning: OPENAI_API_KEY not set, skipping annotation");
    } else {
      console.log("\n[pipeline] Stage 2: Generating annotations...");
      const { annotateAll } = await import("../../../src/houdini-claw/annotate.js");
      const result = await annotateAll({
        inputDir: rawDir,
        outputDir: annotatedDir,
        force: mode === "full",
        onProgress: (done, total, name) => {
          process.stdout.write(`\r  [annotate] ${done}/${total}: ${name}          `);
        },
      });
      console.log(
        `\n  Annotated: ${result.annotated}, Errors: ${result.errors}, Skipped: ${result.skipped}`,
      );
    }
  } else {
    console.log("[pipeline] Skipping annotation (--skip-annotate)");
  }

  // ── Stage 3: Ingest ───────────────────────────────────

  if (fs.existsSync(annotatedDir) && fs.readdirSync(annotatedDir).length > 0) {
    console.log("\n[pipeline] Stage 3: Ingesting into knowledge base...");
    const { ingestAll } = await import("../../../src/houdini-claw/ingest.js");
    const result = await ingestAll({
      inputDir: annotatedDir,
      onProgress: (done, total, name) => {
        process.stdout.write(`\r  [ingest] ${done}/${total}: ${name}          `);
      },
    });
    console.log(`\n  Ingested: ${result.ingested}, Errors: ${result.errors}`);
  } else {
    console.log("\n[pipeline] No annotated files to ingest. Running seed data instead...");
    const { seedDatabase } = await import("../../../src/houdini-claw/seed.js");
    await seedDatabase();
  }

  // ── Stage 4: Report ───────────────────────────────────

  console.log("\n[pipeline] Stage 4: Coverage report");
  const { initDatabase } = await import("../../../src/houdini-claw/db.js");
  const kb = await initDatabase();

  // Annotation coverage
  const report = kb.getCoverageReport();
  console.log("\n  Annotation Coverage:");
  console.log("  System          | Nodes | Verified | Params");
  console.log("  ─────────────────┼───────┼──────────┼───────");
  for (const row of report) {
    const sys = String(row.system).padEnd(15);
    const nodes = String(row.annotated_nodes).padStart(5);
    const verified = String(row.verified_nodes).padStart(8);
    const params = String(row.annotated_params).padStart(6);
    console.log(`  ${sys} | ${nodes} | ${verified} | ${params}`);
  }

  // HIP file coverage
  const hipReport = kb.getHipCoverageReport();
  if (hipReport.length > 0) {
    console.log("\n  HIP File Coverage:");
    console.log("  System          | Files | Parsed | Nodes | Snapshots");
    console.log("  ─────────────────┼───────┼────────┼───────┼──────────");
    for (const row of hipReport) {
      const sys = String(row.system).padEnd(15);
      const files = String(row.total_files).padStart(5);
      const parsed = String(row.parsed_files).padStart(6);
      const nodes = String(row.total_nodes).padStart(5);
      const snaps = String(row.total_snapshots).padStart(9);
      console.log(`  ${sys} | ${files} | ${parsed} | ${nodes} | ${snaps}`);
    }
  }

  kb.close();
  console.log("\n=== Pipeline complete ===");
}

/**
 * Run HIP-specific pipeline stages: download, scan local, parse, extract.
 */
async function runHipStages(options: {
  scanLocal?: boolean;
  houdiniPath?: string;
  systems?: string[];
  rawDir?: string;
}): Promise<void> {
  const { scanLocalHoudiniExamples, listCachedHipFiles, downloadHipFiles } = await import(
    "../../../src/houdini-claw/hip-downloader.js"
  );
  const { extractAllHipFiles } = await import("../../../src/houdini-claw/hip-extractor.js");

  // HipFileEntry-compatible array
  let allEntries: Array<{
    source: string;
    sourceType: "content_library" | "sidefx_examples" | "local_install" | "community";
    localPath: string;
    fileName: string;
    hash: string;
    size: number;
    downloadedAt: string;
    systems: string[];
    description?: string;
  }> = [];

  // Stage 1.5a: Scan local Houdini installation
  if (options.scanLocal) {
    console.log("\n[pipeline] Stage 1.5a: Scanning local Houdini installation...");
    const localEntries = scanLocalHoudiniExamples(options.houdiniPath);
    console.log(`  Found ${localEntries.length} local HIP files.`);
    allEntries.push(...localEntries);
  }

  // Stage 1.5b: Download HIP files from Content Library crawl results
  if (options.rawDir) {
    const clDir = path.join(options.rawDir, "content-library");
    const clIndexPath = path.join(clDir, "content-library-index.json");

    if (fs.existsSync(clIndexPath)) {
      console.log("\n[pipeline] Stage 1.5b: Downloading HIP files from Content Library...");
      try {
        const clIndex = JSON.parse(fs.readFileSync(clIndexPath, "utf-8"));
        const downloadUrls = (clIndex.items || [])
          .filter((item: { downloadUrl?: string }) => item.downloadUrl)
          .map((item: { downloadUrl: string; category?: string; name?: string; description?: string }) => ({
            url: item.downloadUrl,
            sourceType: "content_library" as const,
            systems: inferSystemsFromCategory(item.category),
            description: item.name || item.description,
          }));

        if (downloadUrls.length > 0) {
          const dlResult = await downloadHipFiles(downloadUrls, {
            onProgress: (done: number, total: number, name: string) => {
              process.stdout.write(`\r  [hip-dl] ${done}/${total}: ${name}          `);
            },
          });
          console.log(
            `\n  Downloaded: ${dlResult.downloaded}, Skipped: ${dlResult.skipped}, Errors: ${dlResult.errors}`,
          );
          allEntries.push(...dlResult.entries);
        }
      } catch (err) {
        console.warn("  Content Library download failed:", (err as Error).message);
      }
    }
  }

  // Also include any previously cached HIP files
  const cached = listCachedHipFiles();
  for (const entry of cached) {
    if (!allEntries.some((e) => e.hash === entry.hash)) {
      allEntries.push(entry);
    }
  }

  if (allEntries.length === 0) {
    console.log("\n[pipeline] No HIP files to process.");
    return;
  }

  // Stage 1.6: Parse and extract HIP files
  console.log(`\n[pipeline] Stage 1.6: Parsing ${allEntries.length} HIP files...`);
  const extractResult = await extractAllHipFiles({
    entries: allEntries,
    onProgress: (done, total, name) => {
      process.stdout.write(`\r  [hip-parse] ${done}/${total}: ${name}          `);
    },
  });

  console.log(
    `\n  Extracted: ${extractResult.extracted}, Errors: ${extractResult.errors}`,
  );
  console.log(
    `  Parameters: ${extractResult.totalParams} total, ${extractResult.totalNonDefault} non-default`,
  );
}

function inferSystemsFromCategory(category?: string): string[] {
  if (!category) return [];
  const lower = category.toLowerCase();
  const systems: string[] = [];
  if (lower.includes("pyro") || lower.includes("fire") || lower.includes("smoke")) systems.push("pyro");
  if (lower.includes("destruct") || lower.includes("rbd") || lower.includes("fracture")) systems.push("rbd");
  if (lower.includes("fluid") || lower.includes("flip") || lower.includes("ocean")) systems.push("flip");
  if (lower.includes("vellum") || lower.includes("cloth") || lower.includes("hair")) systems.push("vellum");
  return systems;
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

main().catch((err) => {
  console.error("[pipeline] Fatal:", err);
  process.exit(1);
});
