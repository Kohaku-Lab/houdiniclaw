/**
 * Houdini Claw - Knowledge Base Module
 *
 * Central module for the Houdini Claw knowledge base system.
 * Provides structured annotations, semantic search, and query capabilities
 * for Houdini node documentation, parameter ranges, recipes, and error patterns.
 *
 * Architecture:
 *   Backend (Cron):  crawl.ts → annotate.ts → ingest.ts → SQLite + sqlite-vec
 *   HIP Pipeline:    hip-downloader.ts → hip-parser/ → hip-extractor.ts → db.ts
 *   Frontend (Query): query.ts → db.ts → vector-search.ts → JSON response
 *   Seed data:       seed.ts → db.ts (human-verified baseline)
 */

export { initDatabase, KnowledgeBase, resolveDbPath } from "./db.js";
export { SCHEMA_SQL, VECTOR_TABLE_SQL } from "./schema.js";
export type {
  NodeCategory,
  SimulationSystem,
  ParameterAnnotation,
  Recipe,
  ErrorPattern,
} from "./schema.js";
export {
  generateEmbedding,
  semanticSearch,
  rebuildIndex,
  indexChunk,
  chunkNodeAnnotation,
  chunkParameterAnnotation,
} from "./vector-search.js";
export type { SearchResult } from "./vector-search.js";
export { runCrawl, runCrawlWithExamples, crawlSideFxDoc, crawlNodeExamples, crawlExamplesIndex, ALL_NODE_PATHS } from "./crawl.js";
export type { CrawledPage } from "./crawl.js";
export { annotateNode, annotateAll } from "./annotate.js";
export { ingestAll } from "./ingest.js";
export { seedDatabase } from "./seed.js";

// HIP file processing pipeline
export { parseHipFile, parseHipBuffer } from "./hip-parser/index.js";
export type { HipParseResult, HipNode, HipParameter, HipConnection } from "./hip-parser/index.js";
export { readCpioFromBuffer, readCpioFromFile, filterTextEntries } from "./hip-parser/cpio-reader.js";
export type { CpioEntry } from "./hip-parser/cpio-reader.js";
export { downloadHipFile, downloadHipFiles, scanLocalHoudiniExamples, listCachedHipFiles } from "./hip-downloader.js";
export type { HipFileEntry, DownloadResult } from "./hip-downloader.js";
export { extractHipToKnowledgeBase, extractHipFileToKnowledgeBase, extractAllHipFiles, getParameterUsageStats, generateHipDataSummary } from "./hip-extractor.js";
export type { ExtractionResult, ParameterUsageStats } from "./hip-extractor.js";
export { crawlContentLibrary, crawlContentLibraryItem, saveContentLibraryResults } from "./crawl-content-library.js";
export type { ContentLibraryItem, ContentLibraryCrawlResult } from "./crawl-content-library.js";
