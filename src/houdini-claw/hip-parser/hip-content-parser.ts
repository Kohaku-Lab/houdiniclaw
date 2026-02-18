/**
 * HIP Content Parser
 *
 * Parses the expanded CPIO content from a .hip file to extract
 * node definitions, parameter values, and network topology.
 *
 * Houdini scene structure inside CPIO:
 *   - Top-level entries define the scene hierarchy
 *   - Node definitions are in files like: obj/geo1/sopnet/...
 *   - Each node directory contains:
 *     - A definition section with node type, flags, parameters
 *     - Parameter values as key=value pairs
 *     - Connection info for the node graph
 */

import type { CpioEntry } from "./cpio-reader.js";

// ── Types ──────────────────────────────────────────────────

export interface HipParseResult {
  /** Houdini version that saved this file */
  hipVersion: string;
  /** When the file was last saved */
  saveTime: string;
  /** All nodes found in the scene */
  nodes: HipNode[];
  /** Node connections (edges in the network graph) */
  connections: HipConnection[];
  /** Raw metadata from the scene header */
  metadata: Record<string, string>;
}

export interface HipNode {
  /** Full node path, e.g. /obj/pyro_sim/pyro_solver1 */
  path: string;
  /** Node type, e.g. pyrosolver::2.0 */
  type: string;
  /** Node category: OBJ, SOP, DOP, VOP, CHOP, etc. */
  category: string;
  /** Node name (last path component) */
  name: string;
  /** Parameter name→value pairs */
  parameters: HipParameter[];
  /** Node flags: display, render, bypass, etc. */
  flags: Record<string, boolean>;
}

export interface HipParameter {
  /** Parameter name, e.g. "dissipation" */
  name: string;
  /** Parameter value as parsed from the file */
  value: string | number | number[];
  /** Whether this appears to be the default value */
  isDefault: boolean;
  /** VEX/HScript expression if the parameter is expression-driven */
  expression?: string;
  /** Channel reference if any */
  channelRef?: string;
}

export interface HipConnection {
  /** Source node path */
  from: string;
  /** Source output index */
  fromOutput: number;
  /** Destination node path */
  to: string;
  /** Destination input index */
  toInput: number;
}

// ── Regex Patterns ─────────────────────────────────────────

/** Match Houdini version string in scene header */
const RE_VERSION = /(?:houdini_version|_HIP_SAVEVERSION)\s*=?\s*["']?(\d+\.\d+(?:\.\d+)?)/;

/** Match save time in scene header */
const RE_SAVE_TIME = /(?:_HIP_SAVETIME|hip_savetime)\s*=?\s*["']?([^"'\n]+)/;

/** Match node type definition: type = <type> */
const RE_NODE_TYPE = /^\s*type\s*=\s*(\S+)/m;

/** Match parameter assignment: name (value) or name [ value ] */
const RE_PARM_VALUE = /^\s*parm\s*\{\s*$/m;

/** Match a stanza block: keyword { ... } */
const RE_STANZA_START = /^(\w+)\s*\{/;

/** Match node flags */
const RE_FLAGS = /^\s*flags\s*=\s*(.+)/m;

// ── Parser Implementation ──────────────────────────────────

/**
 * Parse all CPIO entries from a HIP file into structured data.
 */
export function parseHipContent(entries: CpioEntry[]): HipParseResult {
  const result: HipParseResult = {
    hipVersion: "",
    saveTime: "",
    nodes: [],
    connections: [],
    metadata: {},
  };

  // Separate entries by role
  const nodeEntries = new Map<string, string>(); // path → content
  let headerContent = "";

  for (const entry of entries) {
    const content = entry.data.toString("utf-8");
    const filename = normalizeFilename(entry.filename);

    // Scene-level header files
    if (
      filename === ".hip" ||
      filename === "Houdini" ||
      filename === ".OPfallbacks" ||
      filename.endsWith(".def") ||
      filename === "houdini.hip"
    ) {
      headerContent += "\n" + content;
      continue;
    }

    // Node definition files
    nodeEntries.set(filename, content);
  }

  // Parse header metadata
  parseHeader(headerContent, result);

  // Also scan all entries for metadata if header didn't have it
  if (!result.hipVersion) {
    for (const entry of entries) {
      const content = entry.data.toString("utf-8");
      const vMatch = content.match(RE_VERSION);
      if (vMatch) {
        result.hipVersion = vMatch[1];
        break;
      }
    }
  }

  // Build the node tree from entries
  parseNodes(nodeEntries, result);

  return result;
}

/**
 * Parse the scene header for metadata.
 */
function parseHeader(content: string, result: HipParseResult): void {
  if (!content) return;

  const vMatch = content.match(RE_VERSION);
  if (vMatch) {
    result.hipVersion = vMatch[1];
  }

  const tMatch = content.match(RE_SAVE_TIME);
  if (tMatch) {
    result.saveTime = tMatch[1].trim();
  }

  // Extract all variable assignments
  const varPattern = /(\w+)\s*=\s*["']?([^"'\n]+)["']?/g;
  let match: RegExpExecArray | null;
  while ((match = varPattern.exec(content)) !== null) {
    result.metadata[match[1]] = match[2].trim();
  }
}

/**
 * Parse node definition entries into HipNode objects.
 *
 * Houdini stores nodes as a hierarchy in the CPIO. The content
 * format uses stanza blocks like:
 *
 *   type = pyrosolver::2.0
 *   ...
 *   parm {
 *     name dissipation
 *     value 0.1
 *   }
 */
function parseNodes(
  entries: Map<string, string>,
  result: HipParseResult,
): void {
  for (const [filename, content] of entries) {
    // Skip non-node files
    if (!content.includes("type")) continue;

    const nodes = extractNodesFromContent(filename, content);
    result.nodes.push(...nodes);

    // Extract connections from this entry
    const connections = extractConnections(filename, content);
    result.connections.push(...connections);
  }
}

/**
 * Extract node definitions from a single CPIO entry's content.
 */
function extractNodesFromContent(
  filename: string,
  content: string,
): HipNode[] {
  const nodes: HipNode[] = [];
  const lines = content.split("\n");

  let currentNode: Partial<HipNode> | null = null;
  let inParm = false;
  let parmDepth = 0;
  let currentParmName = "";
  let currentParmValue: string | number | number[] = "";
  let currentParmExpr = "";
  let currentParmIsDefault = true;

  const basePath = "/" + filename.replace(/\\/g, "/").replace(/^\/*/, "");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect node type definition
    const typeMatch = trimmed.match(/^type\s*=\s*(\S+)/);
    if (typeMatch && !inParm) {
      // Save previous node
      if (currentNode?.type) {
        nodes.push(finalizeNode(currentNode, basePath));
      }

      currentNode = {
        type: typeMatch[1],
        parameters: [],
        flags: {},
        name: "",
        path: basePath,
        category: inferCategory(typeMatch[1], filename),
      };
      continue;
    }

    // Detect node name
    const nameMatch = trimmed.match(/^name\s*=?\s*(\S+)/);
    if (nameMatch && currentNode && !inParm) {
      currentNode.name = nameMatch[1];
      currentNode.path = basePath + "/" + nameMatch[1];
      continue;
    }

    // Detect flags
    const flagsMatch = trimmed.match(RE_FLAGS);
    if (flagsMatch && currentNode) {
      parseFlags(flagsMatch[1], currentNode);
      continue;
    }

    // Parameter block start
    if (trimmed === "parm {" || trimmed.startsWith("parm\t{")) {
      inParm = true;
      parmDepth = 1;
      currentParmName = "";
      currentParmValue = "";
      currentParmExpr = "";
      currentParmIsDefault = true;
      continue;
    }

    if (inParm) {
      // Track brace depth
      for (const ch of trimmed) {
        if (ch === "{") parmDepth++;
        if (ch === "}") parmDepth--;
      }

      if (parmDepth <= 0) {
        // End of parm block — save parameter
        if (currentParmName && currentNode) {
          const param: HipParameter = {
            name: currentParmName,
            value: parseParamValue(currentParmValue),
            isDefault: currentParmIsDefault,
          };
          if (currentParmExpr) {
            param.expression = currentParmExpr;
          }
          currentNode.parameters ??= [];
          currentNode.parameters.push(param);
        }
        inParm = false;
        continue;
      }

      // Parse parm content
      const pNameMatch = trimmed.match(/^name\s+(\S+)/);
      if (pNameMatch) {
        currentParmName = pNameMatch[1];
        continue;
      }

      const pValueMatch = trimmed.match(/^(?:default)?\s*value\s+(.+)/);
      if (pValueMatch) {
        currentParmValue = pValueMatch[1].trim();
        continue;
      }

      // Check for non-default flag
      if (trimmed.includes("parmdef") || trimmed.includes("default {")) {
        currentParmIsDefault = false;
      }

      // Expression
      const exprMatch = trimmed.match(/^expression\s+(.+)/);
      if (exprMatch) {
        currentParmExpr = exprMatch[1].trim();
        currentParmIsDefault = false;
      }
    }

    // Look for connection definitions: inputs/outputs
    if (trimmed.startsWith("wire ") || trimmed.startsWith("input ")) {
      // Connections are parsed separately
      continue;
    }
  }

  // Save last node
  if (currentNode?.type) {
    nodes.push(finalizeNode(currentNode, basePath));
  }

  return nodes;
}

/**
 * Extract node connections from content.
 *
 * Connection formats vary:
 *   - wire <from_node> <from_output> <to_node> <to_input>
 *   - input <index> <node_name> <output_index>
 */
function extractConnections(
  filename: string,
  content: string,
): HipConnection[] {
  const connections: HipConnection[] = [];
  const basePath = "/" + filename.replace(/\\/g, "/").replace(/^\/*/, "");
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // wire format: wire <from> <from_out> <to> <to_in>
    const wireMatch = trimmed.match(
      /^wire\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)/,
    );
    if (wireMatch) {
      connections.push({
        from: resolvePath(basePath, wireMatch[1]),
        fromOutput: parseInt(wireMatch[2], 10),
        to: resolvePath(basePath, wireMatch[3]),
        toInput: parseInt(wireMatch[4], 10),
      });
      continue;
    }

    // input format: input <index> <node> <output>
    const inputMatch = trimmed.match(/^input\s+(\d+)\s+(\S+)\s+(\d+)/);
    if (inputMatch) {
      connections.push({
        from: resolvePath(basePath, inputMatch[2]),
        fromOutput: parseInt(inputMatch[3], 10),
        to: basePath,
        toInput: parseInt(inputMatch[1], 10),
      });
    }
  }

  return connections;
}

// ── Helpers ────────────────────────────────────────────────

function normalizeFilename(filename: string): string {
  return filename.replace(/\\/g, "/").replace(/^\.\/*/, "").replace(/\/+$/, "");
}

function finalizeNode(
  partial: Partial<HipNode>,
  basePath: string,
): HipNode {
  return {
    path: partial.path ?? basePath,
    type: partial.type ?? "unknown",
    category: partial.category ?? "SOP",
    name: partial.name ?? basePath.split("/").pop() ?? "unknown",
    parameters: partial.parameters ?? [],
    flags: partial.flags ?? {},
  };
}

function inferCategory(nodeType: string, filePath: string): string {
  const typeLower = nodeType.toLowerCase();
  const pathLower = filePath.toLowerCase();

  // Infer from node type name
  if (
    typeLower.includes("pyro") ||
    typeLower.includes("flip") ||
    typeLower.includes("rbd") ||
    typeLower.includes("vellum") ||
    typeLower.includes("solver") ||
    typeLower.includes("gas") ||
    typeLower.includes("bullet")
  ) {
    return "DOP";
  }

  // Infer from file path
  if (pathLower.includes("/dop/") || pathLower.includes("dopnet")) return "DOP";
  if (pathLower.includes("/sop/") || pathLower.includes("sopnet")) return "SOP";
  if (pathLower.includes("/vop/") || pathLower.includes("vopnet")) return "VOP";
  if (pathLower.includes("/chop/") || pathLower.includes("chopnet")) return "CHOP";
  if (pathLower.includes("/cop/") || pathLower.includes("copnet")) return "COP";
  if (pathLower.includes("/rop/") || pathLower.includes("ropnet")) return "ROP";
  if (pathLower.includes("/lop/") || pathLower.includes("lopnet")) return "LOP";
  if (pathLower.includes("/top/") || pathLower.includes("topnet")) return "TOP";
  if (pathLower.includes("/obj/")) return "OBJ";

  return "SOP";
}

function parseFlags(
  flagStr: string,
  node: Partial<HipNode>,
): void {
  node.flags ??= {};
  const parts = flagStr.trim().split(/\s+/);
  for (const part of parts) {
    const kv = part.split("=");
    if (kv.length === 2) {
      node.flags[kv[0]] = kv[1] === "1" || kv[1] === "on" || kv[1] === "true";
    } else {
      // Single flag names are considered true
      node.flags[part] = true;
    }
  }
}

function parseParamValue(raw: string | number | number[]): string | number | number[] {
  if (typeof raw !== "string") return raw;

  const trimmed = raw.trim();

  // Try parsing as number
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") return num;

  // Try parsing as array of numbers (space-separated)
  if (trimmed.includes(" ")) {
    const parts = trimmed.split(/\s+/);
    const nums = parts.map(Number);
    if (nums.every((n) => !isNaN(n))) return nums;
  }

  return trimmed;
}

function resolvePath(basePath: string, relative: string): string {
  if (relative.startsWith("/")) return relative;
  return basePath + "/" + relative;
}

// ── Statistics Helpers ─────────────────────────────────────

/**
 * Get all non-default parameters across all nodes in a parse result.
 * These are the "interesting" parameters that were explicitly set.
 */
export function getNonDefaultParameters(
  result: HipParseResult,
): Array<{ nodePath: string; nodeType: string; param: HipParameter }> {
  const modified: Array<{
    nodePath: string;
    nodeType: string;
    param: HipParameter;
  }> = [];

  for (const node of result.nodes) {
    for (const param of node.parameters) {
      if (!param.isDefault) {
        modified.push({
          nodePath: node.path,
          nodeType: node.type,
          param,
        });
      }
    }
  }

  return modified;
}

/**
 * Group nodes by their type across a parse result.
 */
export function groupNodesByType(
  result: HipParseResult,
): Map<string, HipNode[]> {
  const groups = new Map<string, HipNode[]>();

  for (const node of result.nodes) {
    const existing = groups.get(node.type) ?? [];
    existing.push(node);
    groups.set(node.type, existing);
  }

  return groups;
}
