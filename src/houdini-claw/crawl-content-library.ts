/**
 * Houdini Claw - SideFX Content Library Crawler
 *
 * Crawls the SideFX Content Library to discover HIP files, HDAs,
 * and other assets available for download. Extracts metadata
 * (name, description, version, category) for integration with
 * the annotation pipeline.
 *
 * Usage:
 *   bun src/houdini-claw/crawl-content-library.ts --output /tmp/houdini-content-library/
 *   bun src/houdini-claw/crawl-content-library.ts --category "Pyro FX" --output /tmp/houdini-content-library/
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ── Types ──────────────────────────────────────────────────

export interface ContentLibraryItem {
  /** Item name */
  name: string;
  /** Item description */
  description: string;
  /** Content Library category (e.g., "Pyro FX", "Destruction", "Fluids") */
  category: string;
  /** Associated Houdini version */
  houdiniVersion?: string;
  /** Download URL for the main asset file */
  downloadUrl?: string;
  /** File type: hip, hda, otl, etc. */
  fileType: string;
  /** Content Library page URL */
  pageUrl: string;
  /** Tags/labels on the item */
  tags: string[];
  /** Mapped simulation system for our knowledge base */
  system?: string;
}

export interface ContentLibraryCrawlResult {
  items: ContentLibraryItem[];
  crawledAt: string;
  totalFound: number;
  errors: number;
}

// ── Category → System Mapping ──────────────────────────────

const CATEGORY_SYSTEM_MAP: Record<string, string> = {
  "pyro fx": "pyro",
  "pyro": "pyro",
  "fire": "pyro",
  "smoke": "pyro",
  "explosion": "pyro",
  "destruction": "rbd",
  "rbd": "rbd",
  "fracture": "rbd",
  "rigid body": "rbd",
  "fluids": "flip",
  "flip": "flip",
  "ocean": "flip",
  "water": "flip",
  "liquid": "flip",
  "vellum": "vellum",
  "cloth": "vellum",
  "hair": "vellum",
  "softbody": "vellum",
  "grains": "vellum",
  "particles": "sop",
  "modeling": "sop",
  "terrain": "sop",
  "crowds": "sop",
  "lighting": "lop",
  "karma": "lop",
  "solaris": "lop",
};

/**
 * Map a Content Library category name to our simulation system.
 */
function categoryToSystem(category: string): string | undefined {
  const lower = category.toLowerCase();
  for (const [key, system] of Object.entries(CATEGORY_SYSTEM_MAP)) {
    if (lower.includes(key)) return system;
  }
  return undefined;
}

// ── Content Library Crawl ──────────────────────────────────

const CONTENT_LIBRARY_BASE = "https://www.sidefx.com/contentlibrary/";

/**
 * Crawl the SideFX Content Library page and extract item metadata.
 *
 * The Content Library is a web-based resource. We fetch the HTML and
 * extract structured data from the page content.
 */
export async function crawlContentLibrary(options?: {
  category?: string;
  maxPages?: number;
  onProgress?: (fetched: number, nodeName: string) => void;
}): Promise<ContentLibraryCrawlResult> {
  const items: ContentLibraryItem[] = [];
  let errors = 0;
  const maxPages = options?.maxPages ?? 10;

  try {
    // Fetch the main content library page
    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1
        ? CONTENT_LIBRARY_BASE
        : `${CONTENT_LIBRARY_BASE}?page=${page}`;

      const response = await fetch(url, {
        headers: {
          "User-Agent": "HoudiniClaw/1.0 (knowledge-base-builder)",
          Accept: "text/html",
        },
      });

      if (!response.ok) {
        if (response.status === 404) break; // No more pages
        console.warn(`[content-library] HTTP ${response.status} for page ${page}`);
        errors++;
        continue;
      }

      const html = await response.text();
      const pageItems = extractContentLibraryItems(html);

      if (pageItems.length === 0) break; // No more items

      // Filter by category if specified
      const filtered = options?.category
        ? pageItems.filter(
            (item) =>
              item.category.toLowerCase().includes(options.category!.toLowerCase()),
          )
        : pageItems;

      items.push(...filtered);
      options?.onProgress?.(items.length, `page ${page}`);

      // Rate limit
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (err) {
    console.error("[content-library] Crawl failed:", (err as Error).message);
    errors++;
  }

  return {
    items,
    crawledAt: new Date().toISOString(),
    totalFound: items.length,
    errors,
  };
}

/**
 * Extract Content Library items from an HTML page.
 */
function extractContentLibraryItems(html: string): ContentLibraryItem[] {
  const items: ContentLibraryItem[] = [];

  // Match content library item cards/blocks
  // SideFX uses various HTML structures; we try multiple patterns

  // Pattern 1: Link blocks with titles and descriptions
  const cardPattern =
    /<a[^>]*href=["']([^"']*contentlibrary[^"']*)["'][^>]*>[\s\S]*?<(?:h[2-4]|span|div)[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/(?:h[2-4]|span|div)>[\s\S]*?<(?:p|div)[^>]*class="[^"]*desc[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/gi;

  let match: RegExpExecArray | null;
  while ((match = cardPattern.exec(html)) !== null) {
    const pageUrl = resolveUrl(match[1]);
    const name = stripHtml(match[2]).trim();
    const description = stripHtml(match[3]).trim();

    if (name) {
      items.push({
        name,
        description,
        category: inferCategoryFromContent(name, description),
        pageUrl,
        fileType: inferFileType(name, description),
        tags: extractTags(name, description),
        system: categoryToSystem(inferCategoryFromContent(name, description)),
      });
    }
  }

  // Pattern 2: Simpler list items with hrefs
  if (items.length === 0) {
    const linkPattern =
      /<a[^>]*href=["']([^"']*contentlibrary\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    while ((match = linkPattern.exec(html)) !== null) {
      const pageUrl = resolveUrl(match[1]);
      const name = stripHtml(match[2]).trim();

      if (name && name.length > 2 && !name.includes("Next") && !name.includes("Previous")) {
        items.push({
          name,
          description: "",
          category: inferCategoryFromContent(name, ""),
          pageUrl,
          fileType: inferFileType(name, ""),
          tags: extractTags(name, ""),
          system: categoryToSystem(inferCategoryFromContent(name, "")),
        });
      }
    }
  }

  return items;
}

/**
 * Crawl a single Content Library item page for detailed metadata.
 */
export async function crawlContentLibraryItem(
  pageUrl: string,
): Promise<ContentLibraryItem | null> {
  try {
    const response = await fetch(pageUrl, {
      headers: {
        "User-Agent": "HoudiniClaw/1.0 (knowledge-base-builder)",
        Accept: "text/html",
      },
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Extract detailed metadata
    const name = extractMetaContent(html, "title") ?? extractPageTitle(html) ?? "";
    const description = extractMetaContent(html, "description") ?? "";

    // Look for download links
    const downloadUrl = extractDownloadUrl(html);

    // Look for Houdini version
    const versionMatch = html.match(/(?:Houdini|version)\s*(\d+\.\d+)/i);

    // Extract tags from the page
    const tagElements = html.match(/<span[^>]*class="[^"]*tag[^"]*"[^>]*>([\s\S]*?)<\/span>/gi);
    const tags = tagElements
      ? tagElements.map((t) => stripHtml(t).trim()).filter(Boolean)
      : extractTags(name, description);

    const category = inferCategoryFromContent(name, description);

    return {
      name: stripHtml(name),
      description: stripHtml(description),
      category,
      houdiniVersion: versionMatch?.[1],
      downloadUrl,
      fileType: inferFileType(name, description),
      pageUrl,
      tags,
      system: categoryToSystem(category),
    };
  } catch (err) {
    console.error(`[content-library] Failed to fetch ${pageUrl}:`, (err as Error).message);
    return null;
  }
}

/**
 * Save Content Library crawl results to disk.
 */
export function saveContentLibraryResults(
  result: ContentLibraryCrawlResult,
  outputDir: string,
): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save index
  const indexPath = path.join(outputDir, "content-library-index.json");
  fs.writeFileSync(indexPath, JSON.stringify(result, null, 2));

  // Save individual items for downstream processing
  for (const item of result.items) {
    const hash = crypto
      .createHash("sha256")
      .update(item.name)
      .digest("hex")
      .slice(0, 8);
    const safeName = item.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 60);
    const filename = `cl--${safeName}--${hash}.json`;
    fs.writeFileSync(path.join(outputDir, filename), JSON.stringify(item, null, 2));
  }
}

// ── Helpers ────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function resolveUrl(href: string): string {
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return `https://www.sidefx.com${href}`;
  return `${CONTENT_LIBRARY_BASE}${href}`;
}

function extractMetaContent(html: string, name: string): string | undefined {
  const pattern = new RegExp(
    `<meta[^>]*(?:name|property)=["'](?:og:)?${name}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  return pattern.exec(html)?.[1];
}

function extractPageTitle(html: string): string | undefined {
  return html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim();
}

function extractDownloadUrl(html: string): string | undefined {
  // Look for download links (.hip, .hipnc, .hda, .otl, .zip)
  const dlPattern =
    /href=["']([^"']*\.(?:hipn?c?|hda|otl|zip))["']/i;
  const match = dlPattern.exec(html);
  return match ? resolveUrl(match[1]) : undefined;
}

function inferFileType(name: string, description: string): string {
  const combined = `${name} ${description}`.toLowerCase();
  if (combined.includes(".hda") || combined.includes("digital asset")) return "hda";
  if (combined.includes(".otl")) return "otl";
  if (combined.includes(".hipnc")) return "hipnc";
  if (combined.includes(".hip")) return "hip";
  return "hip"; // Default assumption for Content Library
}

function inferCategoryFromContent(name: string, description: string): string {
  const combined = `${name} ${description}`.toLowerCase();

  if (combined.match(/pyro|fire|smoke|explosion|combustion/)) return "Pyro FX";
  if (combined.match(/rbd|destroy|fracture|rigid|shatter|debris/)) return "Destruction";
  if (combined.match(/flip|fluid|ocean|water|wave|liquid|splash/)) return "Fluids";
  if (combined.match(/vellum|cloth|hair|softbody|grain|fabric/)) return "Vellum";
  if (combined.match(/crowd|agent|ragdoll/)) return "Crowds";
  if (combined.match(/terrain|height|erosion|landscape/)) return "Terrain";
  if (combined.match(/karma|solaris|lop|light|render/)) return "Lighting";
  if (combined.match(/pdg|top|wedge|farm/)) return "PDG";
  if (combined.match(/kinfx|skeleton|rig|motion/)) return "KineFX";

  return "General";
}

function extractTags(name: string, description: string): string[] {
  const tags: string[] = [];
  const combined = `${name} ${description}`.toLowerCase();

  const tagKeywords = [
    "pyro", "fire", "smoke", "explosion", "rbd", "fracture",
    "flip", "fluid", "ocean", "vellum", "cloth", "hair",
    "particles", "vex", "wrangle", "hda", "sop", "dop",
    "cop", "lop", "top", "chop", "terrain", "crowds",
  ];

  for (const keyword of tagKeywords) {
    if (combined.includes(keyword)) {
      tags.push(keyword);
    }
  }

  return tags;
}

// ── CLI Entry Point ────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const outputIdx = args.indexOf("--output");
  const categoryIdx = args.indexOf("--category");

  const outputDir = outputIdx !== -1 ? args[outputIdx + 1] : "/tmp/houdini-content-library";
  const category = categoryIdx !== -1 ? args[categoryIdx + 1] : undefined;

  console.log(`[content-library] Crawling Content Library → ${outputDir}`);
  if (category) {
    console.log(`[content-library] Category filter: ${category}`);
  }

  crawlContentLibrary({
    category,
    onProgress: (fetched, name) => {
      console.log(`[content-library] ${fetched} items found (${name})`);
    },
  }).then((result) => {
    saveContentLibraryResults(result, outputDir);
    console.log(
      `[content-library] Done. ${result.totalFound} items, ${result.errors} errors.`,
    );
  });
}
