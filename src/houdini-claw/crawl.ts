/**
 * Houdini Claw - Documentation Crawler
 *
 * Crawls SideFX official documentation and community sources to build
 * the raw material for the annotation pipeline.
 *
 * Usage:
 *   bun src/houdini-claw/crawl.ts --mode full|incremental --output /tmp/houdini-raw/
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ── Types ──────────────────────────────────────────────────

interface CrawlSource {
  id: string;
  type: "sidefx_docs" | "sidefx_forum" | "odforce" | "tutorial" | "hip_file";
  baseUrl: string;
  priority: number; // 0 = highest
  enabled: boolean;
}

export interface CrawledPage {
  url: string;
  sourceType: string;
  nodeName?: string;
  title: string;
  content: string;
  contentHash: string;
  crawledAt: string;
  /** Names of associated example HIP files discovered on the page */
  exampleFiles?: string[];
  /** URLs for downloading associated HIP/asset files */
  exampleUrls?: string[];
}

// ── Source Configuration ───────────────────────────────────

const CRAWL_SOURCES: CrawlSource[] = [
  {
    id: "sidefx-docs",
    type: "sidefx_docs",
    baseUrl: "https://www.sidefx.com/docs/houdini/",
    priority: 0,
    enabled: true,
  },
  {
    id: "sidefx-forum",
    type: "sidefx_forum",
    baseUrl: "https://www.sidefx.com/forum/",
    priority: 1,
    enabled: true,
  },
  {
    id: "odforce",
    type: "odforce",
    baseUrl: "https://forums.odforce.net/",
    priority: 1,
    enabled: true,
  },
];

// ── Known Houdini Node Paths ───────────────────────────────
// These are the documentation URL paths for key nodes on the SideFX docs site.

const PYRO_NODES = [
  "nodes/dop/pyrosolver",
  "nodes/dop/smokesolver",
  "nodes/dop/smokeobject",
  "nodes/dop/gasresizedynamic",
  "nodes/dop/gasdissipate",
  "nodes/dop/gasbuoyancy",
  "nodes/dop/gasturbulence",
  "nodes/dop/sourcevolume",
  "nodes/dop/gasvorticleforces",
  "nodes/dop/gasenforceboundary",
  "nodes/dop/gasmatchfield",
  "nodes/dop/gasresize",
  "nodes/dop/gasadvect",
  "nodes/dop/gasproject",
  "nodes/dop/gascalculate",
  "nodes/sop/pyrosource",
  "nodes/sop/volumesource",
  "nodes/sop/volume",
  "nodes/sop/volumevop",
  "nodes/sop/volumerasterizeattributes",
];

const RBD_NODES = [
  "nodes/dop/bulletrbdsolver",
  "nodes/dop/rbdpackedobject",
  "nodes/dop/constraintnetwork",
  "nodes/dop/conetwistconrel",
  "nodes/dop/glueconrel",
  "nodes/dop/springconrel",
  "nodes/dop/hardconrel",
  "nodes/sop/voronoifracture",
  "nodes/sop/booleanfracture",
  "nodes/sop/rbdmaterialfracture",
  "nodes/sop/assemble",
  "nodes/sop/connectadjacentpieces",
  "nodes/sop/rbdinteriordetail",
  "nodes/sop/rbdconstraints",
];

const FLIP_NODES = [
  "nodes/dop/flipsolver",
  "nodes/dop/flipobject",
  "nodes/dop/whitewatersolvercompact",
  "nodes/dop/particlefluidobject",
  "nodes/dop/gassandforces",
  "nodes/sop/particlefluidsurface",
  "nodes/sop/oceansource",
  "nodes/sop/oceanspectrum",
  "nodes/sop/oceanevaluate",
  "nodes/sop/flattenedtank",
  "nodes/sop/narrowbandflip",
];

const VELLUM_NODES = [
  "nodes/dop/vellumsolver",
  "nodes/dop/vellumobject",
  "nodes/sop/vellumconstraints",
  "nodes/sop/vellumdrape",
  "nodes/sop/vellumpostprocess",
  "nodes/sop/vellumrestblend",
  "nodes/sop/vellumsolver-sop",
  "nodes/sop/vellumpack",
];

const CORE_SOP_NODES = [
  "nodes/sop/scatter",
  "nodes/sop/attribute_wrangle",
  "nodes/sop/pointwrangle",
  "nodes/sop/for_each",
  "nodes/sop/copytopoints",
  "nodes/sop/transform",
  "nodes/sop/merge",
  "nodes/sop/blast",
  "nodes/sop/group",
  "nodes/sop/fuse",
  "nodes/sop/clean",
  "nodes/sop/normal",
  "nodes/sop/subdivide",
  "nodes/sop/remesh",
  "nodes/sop/boolean",
  "nodes/sop/polyextrude",
  "nodes/sop/measure",
  "nodes/sop/uvunwrap",
];

export const ALL_NODE_PATHS: Record<string, string[]> = {
  pyro: PYRO_NODES,
  rbd: RBD_NODES,
  flip: FLIP_NODES,
  vellum: VELLUM_NODES,
  sop: CORE_SOP_NODES,
};

// ── Crawler Functions ──────────────────────────────────────

/**
 * Crawl a single SideFX documentation page and extract content.
 */
export async function crawlSideFxDoc(
  nodePath: string,
  baseUrl: string = "https://www.sidefx.com/docs/houdini/",
): Promise<CrawledPage | null> {
  const url = `${baseUrl}${nodePath}.html`;
  const nodeName = nodePath.split("/").pop() ?? nodePath;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "HoudiniClaw/1.0 (knowledge-base-builder)",
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      console.warn(`[crawl] HTTP ${response.status} for ${url}`);
      return null;
    }

    const html = await response.text();
    const content = extractDocContent(html);
    const contentHash = crypto.createHash("sha256").update(content).digest("hex");

    return {
      url,
      sourceType: "sidefx_docs",
      nodeName,
      title: extractTitle(html) ?? nodeName,
      content,
      contentHash,
      crawledAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[crawl] Failed to fetch ${url}:`, (err as Error).message);
    return null;
  }
}

/**
 * Extract the main content from a SideFX documentation HTML page.
 * Strips navigation, headers, footers, and scripts.
 */
function extractDocContent(html: string): string {
  // Remove script and style tags
  let content = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Try to extract the main content area
  const mainMatch = content.match(
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
  );
  if (mainMatch) {
    content = mainMatch[1];
  }

  // Strip HTML tags but keep text
  content = content.replace(/<[^>]+>/g, " ");

  // Clean up whitespace
  content = content
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  return content;
}

/**
 * Extract the page title from HTML.
 */
function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return match?.[1]?.trim();
}

/**
 * Run a full or incremental crawl of all configured sources.
 */
export async function runCrawl(options: {
  mode: "full" | "incremental";
  outputDir: string;
  systems?: string[];
  onProgress?: (fetched: number, total: number, nodeName: string) => void;
}): Promise<CrawledPage[]> {
  const { mode, outputDir, systems } = options;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Determine which nodes to crawl
  const targetSystems = systems ?? Object.keys(ALL_NODE_PATHS);
  const allPaths: Array<{ system: string; path: string }> = [];

  for (const system of targetSystems) {
    const paths = ALL_NODE_PATHS[system];
    if (paths) {
      for (const p of paths) {
        allPaths.push({ system, path: p });
      }
    }
  }

  const results: CrawledPage[] = [];
  const total = allPaths.length;
  let fetched = 0;

  for (const { system, path: nodePath } of allPaths) {
    const nodeName = nodePath.split("/").pop() ?? nodePath;

    // In incremental mode, skip if we already have this page and it hasn't changed
    if (mode === "incremental") {
      const outputFile = path.join(outputDir, `${system}--${nodeName}.json`);
      if (fs.existsSync(outputFile)) {
        fetched++;
        options.onProgress?.(fetched, total, nodeName);
        continue;
      }
    }

    const page = await crawlSideFxDoc(nodePath);
    if (page) {
      // Save to output directory
      const outputFile = path.join(outputDir, `${system}--${nodeName}.json`);
      fs.writeFileSync(outputFile, JSON.stringify(page, null, 2));
      results.push(page);
    }

    fetched++;
    options.onProgress?.(fetched, total, nodeName);

    // Rate limit: wait 500ms between requests
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return results;
}

// ── Examples Page Crawler ─────────────────────────────────

/**
 * Map a node doc path to its corresponding examples page URL.
 * SideFX examples URL pattern: /docs/houdini/examples/nodes/{type}/{name}.html
 */
function nodePathToExamplesUrl(nodePath: string): string {
  // nodePath format: "nodes/dop/pyrosolver" → examples URL: "examples/nodes/dop/pyrosolver.html"
  return `https://www.sidefx.com/docs/houdini/examples/${nodePath}.html`;
}

/**
 * Crawl the SideFX examples page for a node and extract example file references.
 */
export async function crawlNodeExamples(
  nodePath: string,
): Promise<CrawledPage | null> {
  const url = nodePathToExamplesUrl(nodePath);
  const nodeName = nodePath.split("/").pop() ?? nodePath;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "HoudiniClaw/1.0 (knowledge-base-builder)",
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      // Many nodes don't have example pages — this is expected
      if (response.status !== 404) {
        console.warn(`[crawl-examples] HTTP ${response.status} for ${url}`);
      }
      return null;
    }

    const html = await response.text();
    const content = extractDocContent(html);
    const contentHash = crypto.createHash("sha256").update(content).digest("hex");

    // Extract references to .hip / .hipnc files from the page
    const exampleFiles = extractExampleFileNames(html);
    const exampleUrls = extractExampleDownloadUrls(html, url);

    return {
      url,
      sourceType: "sidefx_examples",
      nodeName,
      title: extractTitle(html) ?? `${nodeName} examples`,
      content,
      contentHash,
      crawledAt: new Date().toISOString(),
      exampleFiles: exampleFiles.length > 0 ? exampleFiles : undefined,
      exampleUrls: exampleUrls.length > 0 ? exampleUrls : undefined,
    };
  } catch (err) {
    console.error(`[crawl-examples] Failed to fetch ${url}:`, (err as Error).message);
    return null;
  }
}

/**
 * Extract .hip/.hipnc file names referenced in an HTML page.
 */
function extractExampleFileNames(html: string): string[] {
  const names: string[] = [];
  // Match .hip or .hipnc filenames in text, links, and code blocks
  const pattern = /[\w/.-]+\.hipn?c?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const name = match[0];
    if (name.endsWith(".hip") || name.endsWith(".hipnc")) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * Extract download URLs for example files from an HTML page.
 */
function extractExampleDownloadUrls(html: string, pageUrl: string): string[] {
  const urls: string[] = [];
  // Match href attributes pointing to .hip files
  const hrefPattern = /href=["']([^"']*\.hipn?c?)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html)) !== null) {
    let href = match[1];
    // Resolve relative URLs
    if (!href.startsWith("http")) {
      try {
        href = new URL(href, pageUrl).toString();
      } catch {
        continue;
      }
    }
    if (!urls.includes(href)) {
      urls.push(href);
    }
  }
  return urls;
}

/**
 * Crawl the SideFX examples index page to discover all available examples.
 */
export async function crawlExamplesIndex(
  baseUrl: string = "https://www.sidefx.com/docs/houdini/examples/",
): Promise<Array<{ name: string; path: string; category: string }>> {
  const examples: Array<{ name: string; path: string; category: string }> = [];

  try {
    const response = await fetch(`${baseUrl}index.html`, {
      headers: {
        "User-Agent": "HoudiniClaw/1.0 (knowledge-base-builder)",
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      console.warn(`[crawl-examples] Failed to fetch examples index: HTTP ${response.status}`);
      return examples;
    }

    const html = await response.text();

    // Extract links to example pages
    // Pattern: href="nodes/{type}/{name}.html" or similar
    const linkPattern = /href=["'](?:\.\/)?(?:nodes\/)?(\w+)\/(\w+)\.html["']/gi;
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(html)) !== null) {
      const category = match[1];
      const name = match[2];
      examples.push({
        name,
        path: `nodes/${category}/${name}`,
        category,
      });
    }
  } catch (err) {
    console.error("[crawl-examples] Failed to fetch examples index:", (err as Error).message);
  }

  return examples;
}

/**
 * Run a crawl that includes both documentation pages and their example pages.
 */
export async function runCrawlWithExamples(options: {
  mode: "full" | "incremental";
  outputDir: string;
  systems?: string[];
  includeExamples?: boolean;
  onProgress?: (fetched: number, total: number, nodeName: string) => void;
}): Promise<CrawledPage[]> {
  // First run the standard doc crawl
  const docResults = await runCrawl(options);

  if (options.includeExamples === false) {
    return docResults;
  }

  // Then crawl example pages for each node
  const targetSystems = options.systems ?? Object.keys(ALL_NODE_PATHS);
  const allPaths: Array<{ system: string; path: string }> = [];

  for (const system of targetSystems) {
    const paths = ALL_NODE_PATHS[system];
    if (paths) {
      for (const p of paths) {
        allPaths.push({ system, path: p });
      }
    }
  }

  const exampleResults: CrawledPage[] = [];
  const total = allPaths.length;
  let fetched = 0;

  for (const { system, path: nodePath } of allPaths) {
    const nodeName = nodePath.split("/").pop() ?? nodePath;
    const outputFile = path.join(options.outputDir, `${system}--${nodeName}--examples.json`);

    // In incremental mode, skip if we already have this
    if (options.mode === "incremental" && fs.existsSync(outputFile)) {
      fetched++;
      options.onProgress?.(fetched, total, `${nodeName} (examples)`);
      continue;
    }

    const page = await crawlNodeExamples(nodePath);
    if (page) {
      fs.writeFileSync(outputFile, JSON.stringify(page, null, 2));
      exampleResults.push(page);
    }

    fetched++;
    options.onProgress?.(fetched, total, `${nodeName} (examples)`);

    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return [...docResults, ...exampleResults];
}

// ── CLI Entry Point ────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const modeIdx = args.indexOf("--mode");
  const outputIdx = args.indexOf("--output");
  const systemIdx = args.indexOf("--system");

  const mode = (modeIdx !== -1 ? args[modeIdx + 1] : "full") as "full" | "incremental";
  const outputDir = outputIdx !== -1 ? args[outputIdx + 1] : "/tmp/houdini-raw";
  const systems = systemIdx !== -1 ? args[systemIdx + 1].split(",") : undefined;

  console.log(`[crawl] Starting ${mode} crawl → ${outputDir}`);
  if (systems) {
    console.log(`[crawl] Systems: ${systems.join(", ")}`);
  }

  runCrawl({
    mode,
    outputDir,
    systems,
    onProgress: (fetched, total, nodeName) => {
      console.log(`[crawl] ${fetched}/${total}: ${nodeName}`);
    },
  }).then((results) => {
    console.log(`[crawl] Done. ${results.length} pages crawled.`);
  });
}
