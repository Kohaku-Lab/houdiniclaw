/**
 * HIP File Parser Module
 *
 * Provides a complete pipeline for parsing Houdini .hip files without
 * requiring a Houdini license. Extracts node definitions, parameter
 * values, and network topology from the CPIO archive format.
 *
 * Usage:
 *   import { parseHipFile, parseHipBuffer } from "./hip-parser/index.js";
 *
 *   const result = await parseHipFile("/path/to/scene.hip");
 *   console.log(result.nodes.length, "nodes found");
 *   console.log(result.hipVersion);
 */

export { readCpioFromBuffer, readCpioFromFile, filterTextEntries } from "./cpio-reader.js";
export type { CpioEntry } from "./cpio-reader.js";

export {
  parseHipContent,
  getNonDefaultParameters,
  groupNodesByType,
} from "./hip-content-parser.js";
export type {
  HipParseResult,
  HipNode,
  HipParameter,
  HipConnection,
} from "./hip-content-parser.js";

import { readCpioFromBuffer, readCpioFromFile, filterTextEntries } from "./cpio-reader.js";
import { parseHipContent } from "./hip-content-parser.js";
import type { HipParseResult } from "./hip-content-parser.js";

/**
 * Parse a .hip file from disk into structured data.
 *
 * @param filePath - Path to the .hip/.hipnc file
 * @returns Parsed scene data including nodes, parameters, and connections
 */
export async function parseHipFile(filePath: string): Promise<HipParseResult> {
  const entries = await readCpioFromFile(filePath);
  const textEntries = filterTextEntries(entries);
  return parseHipContent(textEntries);
}

/**
 * Parse a .hip file from a Buffer into structured data.
 *
 * @param buffer - Raw .hip file contents
 * @returns Parsed scene data including nodes, parameters, and connections
 */
export function parseHipBuffer(buffer: Buffer): HipParseResult {
  const entries = readCpioFromBuffer(buffer);
  const textEntries = filterTextEntries(entries);
  return parseHipContent(textEntries);
}
