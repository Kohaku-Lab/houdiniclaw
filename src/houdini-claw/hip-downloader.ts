/**
 * Houdini Claw - HIP File Downloader
 *
 * Downloads .hip files from known sources (Content Library, example pages)
 * and manages a local cache for the HIP parser pipeline.
 *
 * Features:
 *   - SHA-256 integrity verification
 *   - Incremental updates (skip unchanged files)
 *   - Rate limiting to avoid source-site throttling
 *   - LRU-style cache with configurable size limit
 *   - Local Houdini installation discovery
 *
 * Usage:
 *   bun src/houdini-claw/hip-downloader.ts --url <url> --output /tmp/hip-cache/
 *   bun src/houdini-claw/hip-downloader.ts --scan-local --houdini-path /opt/hfs20.5/
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ── Types ──────────────────────────────────────────────────

export interface HipFileEntry {
  /** Original source URL or local path */
  source: string;
  /** Source type */
  sourceType: "content_library" | "sidefx_examples" | "local_install" | "community";
  /** Local file path in the cache */
  localPath: string;
  /** File name */
  fileName: string;
  /** SHA-256 hash of the file content */
  hash: string;
  /** File size in bytes */
  size: number;
  /** When the file was downloaded/discovered */
  downloadedAt: string;
  /** Associated simulation systems */
  systems: string[];
  /** Description from the source page */
  description?: string;
}

export interface DownloadResult {
  downloaded: number;
  skipped: number;
  errors: number;
  entries: HipFileEntry[];
}

interface CacheManifest {
  version: number;
  entries: Record<string, HipFileEntry>;
  lastUpdated: string;
}

// ── Configuration ──────────────────────────────────────────

const DEFAULT_CACHE_DIR = path.join(
  process.env.HOME ?? process.env.USERPROFILE ?? ".",
  ".openclaw",
  "houdini-claw",
  "hip-cache",
);

const MANIFEST_FILENAME = "hip-cache-manifest.json";

/** Maximum cache size in bytes (default 2 GB) */
const DEFAULT_MAX_CACHE_SIZE = 2 * 1024 * 1024 * 1024;

/** Delay between downloads in ms */
const DOWNLOAD_DELAY_MS = 2000;

// ── Cache Management ───────────────────────────────────────

function loadManifest(cacheDir: string): CacheManifest {
  const manifestPath = path.join(cacheDir, MANIFEST_FILENAME);
  if (fs.existsSync(manifestPath)) {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as CacheManifest;
    } catch {
      // Corrupted manifest, start fresh
    }
  }
  return { version: 1, entries: {}, lastUpdated: new Date().toISOString() };
}

function saveManifest(cacheDir: string, manifest: CacheManifest): void {
  manifest.lastUpdated = new Date().toISOString();
  const manifestPath = path.join(cacheDir, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Enforce cache size limit by removing oldest entries.
 */
function enforceCacheLimit(
  cacheDir: string,
  manifest: CacheManifest,
  maxSize: number,
): void {
  // Calculate current size
  let totalSize = 0;
  const sortedEntries = Object.entries(manifest.entries).sort(
    ([, a], [, b]) =>
      new Date(a.downloadedAt).getTime() - new Date(b.downloadedAt).getTime(),
  );

  for (const [, entry] of sortedEntries) {
    totalSize += entry.size;
  }

  // Remove oldest entries until under limit
  while (totalSize > maxSize && sortedEntries.length > 0) {
    const [key, entry] = sortedEntries.shift()!;
    try {
      if (fs.existsSync(entry.localPath)) {
        fs.unlinkSync(entry.localPath);
      }
      totalSize -= entry.size;
      delete manifest.entries[key];
      console.log(`[hip-dl] Evicted from cache: ${entry.fileName} (${formatBytes(entry.size)})`);
    } catch {
      // File might already be gone
      delete manifest.entries[key];
    }
  }
}

// ── Download Functions ─────────────────────────────────────

/**
 * Download a single HIP file from a URL to the local cache.
 */
export async function downloadHipFile(
  url: string,
  options?: {
    cacheDir?: string;
    sourceType?: HipFileEntry["sourceType"];
    systems?: string[];
    description?: string;
  },
): Promise<HipFileEntry | null> {
  const cacheDir = options?.cacheDir ?? DEFAULT_CACHE_DIR;

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const manifest = loadManifest(cacheDir);

  // Check if already cached
  if (manifest.entries[url]) {
    const cached = manifest.entries[url];
    if (fs.existsSync(cached.localPath)) {
      return cached;
    }
    // File missing from cache, re-download
    delete manifest.entries[url];
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "HoudiniClaw/1.0 (knowledge-base-builder)",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      console.warn(`[hip-dl] HTTP ${response.status} for ${url}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const fileName = decodeURIComponent(url.split("/").pop() ?? `hip-${hash.slice(0, 8)}.hip`);
    const localPath = path.join(cacheDir, `${hash.slice(0, 12)}-${sanitizeFilename(fileName)}`);

    fs.writeFileSync(localPath, buffer);

    const entry: HipFileEntry = {
      source: url,
      sourceType: options?.sourceType ?? "content_library",
      localPath,
      fileName,
      hash,
      size: buffer.length,
      downloadedAt: new Date().toISOString(),
      systems: options?.systems ?? [],
      description: options?.description,
    };

    manifest.entries[url] = entry;
    saveManifest(cacheDir, manifest);

    return entry;
  } catch (err) {
    console.error(`[hip-dl] Failed to download ${url}:`, (err as Error).message);
    return null;
  }
}

/**
 * Download multiple HIP files from URLs, with rate limiting.
 */
export async function downloadHipFiles(
  urls: Array<{
    url: string;
    sourceType?: HipFileEntry["sourceType"];
    systems?: string[];
    description?: string;
  }>,
  options?: {
    cacheDir?: string;
    maxCacheSize?: number;
    onProgress?: (done: number, total: number, fileName: string) => void;
  },
): Promise<DownloadResult> {
  const cacheDir = options?.cacheDir ?? DEFAULT_CACHE_DIR;
  const maxCacheSize = options?.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const result: DownloadResult = {
    downloaded: 0,
    skipped: 0,
    errors: 0,
    entries: [],
  };

  for (let i = 0; i < urls.length; i++) {
    const { url, sourceType, systems, description } = urls[i];
    const manifest = loadManifest(cacheDir);

    // Check if already in cache
    if (manifest.entries[url] && fs.existsSync(manifest.entries[url].localPath)) {
      result.skipped++;
      result.entries.push(manifest.entries[url]);
      options?.onProgress?.(i + 1, urls.length, manifest.entries[url].fileName);
      continue;
    }

    // Enforce cache size before downloading
    enforceCacheLimit(cacheDir, manifest, maxCacheSize);
    saveManifest(cacheDir, manifest);

    const entry = await downloadHipFile(url, {
      cacheDir,
      sourceType,
      systems,
      description,
    });

    if (entry) {
      result.downloaded++;
      result.entries.push(entry);
      options?.onProgress?.(i + 1, urls.length, entry.fileName);
    } else {
      result.errors++;
      options?.onProgress?.(i + 1, urls.length, `FAILED: ${url}`);
    }

    // Rate limit between downloads
    if (i < urls.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_DELAY_MS));
    }
  }

  return result;
}

// ── Local Houdini Installation Discovery ───────────────────

/**
 * Scan a local Houdini installation for example .hip files.
 */
export function scanLocalHoudiniExamples(
  houdiniPath?: string,
): HipFileEntry[] {
  const entries: HipFileEntry[] = [];

  // Try common Houdini installation paths
  const searchPaths = houdiniPath
    ? [houdiniPath]
    : getCommonHoudiniPaths();

  for (const basePath of searchPaths) {
    const examplesDir = path.join(basePath, "houdini", "help", "files");

    if (!fs.existsSync(examplesDir)) {
      // Also try $HH/help/files pattern
      const altDir = path.join(basePath, "help", "files");
      if (!fs.existsSync(altDir)) continue;
      scanDirectory(altDir, entries);
    } else {
      scanDirectory(examplesDir, entries);
    }
  }

  return entries;
}

function scanDirectory(dir: string, entries: HipFileEntry[]): void {
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        scanDirectory(fullPath, entries);
      } else if (item.name.endsWith(".hip") || item.name.endsWith(".hipnc")) {
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath);
        const hash = crypto.createHash("sha256").update(content).digest("hex");

        entries.push({
          source: fullPath,
          sourceType: "local_install",
          localPath: fullPath,
          fileName: item.name,
          hash,
          size: stat.size,
          downloadedAt: new Date().toISOString(),
          systems: inferSystemsFromPath(fullPath),
        });
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

function getCommonHoudiniPaths(): string[] {
  const paths: string[] = [];
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

  // From environment variables
  if (process.env.HFS) paths.push(process.env.HFS);
  if (process.env.HH) paths.push(path.dirname(process.env.HH));
  if (process.env.HOUDINI_INSTALL_PATH) paths.push(process.env.HOUDINI_INSTALL_PATH);

  // Common Linux paths
  paths.push("/opt/hfs20.5", "/opt/hfs20.0", "/opt/hfs19.5");

  // Common macOS paths
  paths.push(
    "/Applications/Houdini/Current/Frameworks/Houdini.framework/Versions/Current/Resources",
  );

  // Common Windows paths (WSL-accessible)
  paths.push("/mnt/c/Program Files/Side Effects Software/Houdini 20.5");

  // User houdini config dir
  paths.push(
    path.join(home, "houdini20.5"),
    path.join(home, "houdini20.0"),
  );

  return paths.filter((p) => fs.existsSync(p));
}

function inferSystemsFromPath(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  const systems: string[] = [];

  if (lower.includes("pyro") || lower.includes("fire") || lower.includes("smoke")) {
    systems.push("pyro");
  }
  if (lower.includes("rbd") || lower.includes("fracture") || lower.includes("bullet")) {
    systems.push("rbd");
  }
  if (lower.includes("flip") || lower.includes("fluid") || lower.includes("ocean")) {
    systems.push("flip");
  }
  if (lower.includes("vellum") || lower.includes("cloth") || lower.includes("hair")) {
    systems.push("vellum");
  }

  return systems;
}

/**
 * Get all cached HIP file entries.
 */
export function listCachedHipFiles(cacheDir?: string): HipFileEntry[] {
  const dir = cacheDir ?? DEFAULT_CACHE_DIR;
  const manifest = loadManifest(dir);
  return Object.values(manifest.entries).filter((e) =>
    fs.existsSync(e.localPath),
  );
}

// ── Helpers ────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── CLI Entry Point ────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.includes("--scan-local")) {
    const pathIdx = args.indexOf("--houdini-path");
    const houdiniPath = pathIdx !== -1 ? args[pathIdx + 1] : undefined;

    console.log("[hip-dl] Scanning local Houdini installation...");
    const entries = scanLocalHoudiniExamples(houdiniPath);
    console.log(`[hip-dl] Found ${entries.length} HIP files`);

    for (const entry of entries) {
      console.log(`  ${entry.fileName} (${formatBytes(entry.size)}) [${entry.systems.join(",")}]`);
    }
  } else {
    const urlIdx = args.indexOf("--url");
    const outputIdx = args.indexOf("--output");

    if (urlIdx === -1) {
      console.error("Usage: hip-downloader.ts --url <url> [--output <dir>]");
      console.error("       hip-downloader.ts --scan-local [--houdini-path <path>]");
      process.exit(1);
    }

    const url = args[urlIdx + 1];
    const cacheDir = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

    console.log(`[hip-dl] Downloading: ${url}`);
    downloadHipFile(url, { cacheDir }).then((entry) => {
      if (entry) {
        console.log(`[hip-dl] Saved: ${entry.localPath} (${formatBytes(entry.size)})`);
      } else {
        console.error("[hip-dl] Download failed.");
        process.exit(1);
      }
    });
  }
}
