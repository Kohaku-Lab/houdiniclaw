#!/usr/bin/env bun
/**
 * Houdini Claw - Full Annotation Pipeline Runner
 *
 * Orchestrates the complete pipeline: crawl → annotate → ingest → report
 *
 * Usage:
 *   bun skills/houdini-annotator/scripts/run-pipeline.ts --mode full
 *   bun skills/houdini-annotator/scripts/run-pipeline.ts --mode incremental
 *   bun skills/houdini-annotator/scripts/run-pipeline.ts --mode full --system pyro
 *   bun skills/houdini-annotator/scripts/run-pipeline.ts --seed-only
 *
 * Environment:
 *   OPENAI_API_KEY       - Required for annotation and embedding
 *   HOUDINI_CLAW_DB_PATH - Optional, defaults to ~/.openclaw/houdini-claw/houdini_kb.db
 */

import path from "node:path";
import fs from "node:fs";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = getArg(args, "--mode") ?? "full";
  const systems = getArg(args, "--system")?.split(",");
  const seedOnly = args.includes("--seed-only");
  const skipCrawl = args.includes("--skip-crawl");
  const skipAnnotate = args.includes("--skip-annotate");

  const tmpBase = path.join("/tmp", "houdini-claw-pipeline");
  const rawDir = path.join(tmpBase, "raw");
  const annotatedDir = path.join(tmpBase, "annotated");

  console.log("=== Houdini Claw Annotation Pipeline ===");
  console.log(`Mode: ${mode}`);
  console.log(`Systems: ${systems?.join(", ") ?? "all"}`);
  console.log(`Temp dir: ${tmpBase}`);
  console.log("");

  // Seed-only mode: just populate with hand-verified data
  if (seedOnly) {
    console.log("[pipeline] Running seed-only mode...");
    const { seedDatabase } = await import("../../../src/houdini-claw/seed.js");
    await seedDatabase();
    console.log("[pipeline] Seed complete.");
    return;
  }

  // Stage 1: Crawl
  if (!skipCrawl) {
    console.log("[pipeline] Stage 1: Crawling documentation...");
    const { runCrawl } = await import("../../../src/houdini-claw/crawl.js");
    const crawled = await runCrawl({
      mode: mode as "full" | "incremental",
      outputDir: rawDir,
      systems,
      onProgress: (fetched, total, nodeName) => {
        process.stdout.write(`\r  [crawl] ${fetched}/${total}: ${nodeName}          `);
      },
    });
    console.log(`\n  Crawled ${crawled.length} pages.`);
  } else {
    console.log("[pipeline] Skipping crawl (--skip-crawl)");
  }

  // Stage 2: Annotate
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

  // Stage 3: Ingest
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

  // Stage 4: Report
  console.log("\n[pipeline] Stage 4: Coverage report");
  const { initDatabase } = await import("../../../src/houdini-claw/db.js");
  const kb = await initDatabase();
  const report = kb.getCoverageReport();

  console.log("\n  System          | Nodes | Verified | Params");
  console.log("  ─────────────────┼───────┼──────────┼───────");
  for (const row of report) {
    const sys = String(row.system).padEnd(15);
    const nodes = String(row.annotated_nodes).padStart(5);
    const verified = String(row.verified_nodes).padStart(8);
    const params = String(row.annotated_params).padStart(6);
    console.log(`  ${sys} | ${nodes} | ${verified} | ${params}`);
  }

  kb.close();
  console.log("\n=== Pipeline complete ===");
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

main().catch((err) => {
  console.error("[pipeline] Fatal:", err);
  process.exit(1);
});
