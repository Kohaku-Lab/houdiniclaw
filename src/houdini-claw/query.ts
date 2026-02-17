/**
 * Houdini Claw - Knowledge Base Query CLI
 *
 * Used by frontend skills (houdini-doc-query, houdini-recipe, etc.)
 * to retrieve information from the knowledge base.
 *
 * Usage:
 *   bun src/houdini-claw/query.ts --node pyro_solver --format full
 *   bun src/houdini-claw/query.ts --node pyro_solver --param dissipation
 *   bun src/houdini-claw/query.ts --query "how to make smoke disappear faster" --top-k 5
 *   bun src/houdini-claw/query.ts --recipe --system pyro --tags "indoor,explosion"
 *   bun src/houdini-claw/query.ts --diagnose --symptoms "sim explodes" --system pyro
 *   bun src/houdini-claw/query.ts --param-advice --node pyro_solver --param dissipation --context "indoor explosion"
 *   bun src/houdini-claw/query.ts --coverage
 */

import { initDatabase, type KnowledgeBase } from "./db.js";
import { semanticSearch, type SearchResult } from "./vector-search.js";

// ── Query Functions ────────────────────────────────────────

/**
 * Look up a node's full annotation.
 */
function queryNode(kb: KnowledgeBase, nodeName: string, format: "full" | "summary"): void {
  const node = kb.getNodeAnnotation(nodeName);
  if (!node) {
    console.log(JSON.stringify({ error: `Node "${nodeName}" not found in knowledge base` }));
    return;
  }

  if (format === "summary") {
    console.log(
      JSON.stringify({
        node_name: node.node_name,
        category: node.node_category,
        semantic_name_zh: node.semantic_name_zh,
        semantic_name_en: node.semantic_name_en,
        one_line: node.one_line,
        analogy: node.analogy,
        human_verified: node.human_verified === 1,
      }),
    );
    return;
  }

  // Full format: include parameters
  const params = kb.getParametersForNode(nodeName);
  console.log(
    JSON.stringify({
      ...node,
      prerequisite_nodes: node.prerequisite_nodes ? JSON.parse(node.prerequisite_nodes as string) : [],
      source_urls: node.source_urls ? JSON.parse(node.source_urls as string) : [],
      parameters: params.map((p) => ({
        ...p,
        intent_mapping: p.intent_mapping ? JSON.parse(p.intent_mapping as string) : {},
        visual_effect: p.visual_effect ? JSON.parse(p.visual_effect as string) : {},
        interactions: p.interactions ? JSON.parse(p.interactions as string) : [],
        context_adjustments: p.context_adjustments ? JSON.parse(p.context_adjustments as string) : {},
      })),
    }),
  );
}

/**
 * Look up a specific parameter on a node.
 */
function queryParam(kb: KnowledgeBase, nodeName: string, paramName: string): void {
  const param = kb.getParameterAnnotation(nodeName, paramName);
  if (!param) {
    console.log(
      JSON.stringify({
        error: `Parameter "${paramName}" on node "${nodeName}" not found in knowledge base`,
      }),
    );
    return;
  }

  console.log(
    JSON.stringify({
      ...param,
      intent_mapping: param.intent_mapping ? JSON.parse(param.intent_mapping as string) : {},
      visual_effect: param.visual_effect ? JSON.parse(param.visual_effect as string) : {},
      interactions: param.interactions ? JSON.parse(param.interactions as string) : [],
      context_adjustments: param.context_adjustments ? JSON.parse(param.context_adjustments as string) : {},
    }),
  );
}

/**
 * Semantic search across the knowledge base.
 */
async function querySemanticSearch(
  kb: KnowledgeBase,
  query: string,
  topK: number,
  system?: string,
): Promise<void> {
  try {
    const results = await semanticSearch(kb, query, {
      topK,
      system,
    });

    console.log(
      JSON.stringify({
        query,
        results: results.map((r) => ({
          score: r.score.toFixed(4),
          type: r.chunkType,
          node: r.nodeName,
          system: r.system,
          text: r.text,
        })),
      }),
    );
  } catch (err) {
    // If vector search is unavailable, fall back to text search
    console.log(
      JSON.stringify({
        query,
        error: "Vector search unavailable, showing text search fallback",
        fallback: true,
        results: fallbackTextSearch(kb, query, topK, system),
      }),
    );
  }
}

/**
 * Fallback text search when vector search is unavailable.
 */
function fallbackTextSearch(
  kb: KnowledgeBase,
  query: string,
  topK: number,
  system?: string,
): unknown[] {
  // Simple keyword matching against node annotations
  const keywords = query.toLowerCase().split(/\s+/);
  const nodes = kb.listNodes();

  const scored = nodes
    .map((node) => {
      const text = [
        node.node_name,
        node.one_line,
        node.node_category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      let score = 0;
      for (const kw of keywords) {
        if (text.includes(kw)) score++;
      }
      return { node, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map((item) => ({
    score: item.score,
    type: "node",
    node: item.node.node_name,
    text: item.node.one_line,
  }));
}

/**
 * Search for matching recipes.
 */
function queryRecipe(kb: KnowledgeBase, system?: string, tags?: string[]): void {
  const recipes = kb.searchRecipes(system, tags);

  if (recipes.length === 0) {
    console.log(
      JSON.stringify({
        error: "No matching recipes found",
        system,
        tags,
      }),
    );
    return;
  }

  console.log(
    JSON.stringify({
      count: recipes.length,
      recipes: recipes.map((r) => ({
        ...r,
        tags: r.tags ? JSON.parse(r.tags as string) : [],
        prerequisites: r.prerequisites ? JSON.parse(r.prerequisites as string) : [],
        parameters: r.parameters ? JSON.parse(r.parameters as string) : {},
        warnings: r.warnings ? JSON.parse(r.warnings as string) : [],
        variations: r.variations ? JSON.parse(r.variations as string) : {},
      })),
    }),
  );
}

/**
 * Search for matching error patterns.
 */
function queryDiagnose(kb: KnowledgeBase, system?: string, symptoms?: string): void {
  const patterns = kb.searchErrorPatterns(system, symptoms);

  if (patterns.length === 0) {
    console.log(
      JSON.stringify({
        error: "No matching error patterns found",
        system,
        symptoms,
      }),
    );
    return;
  }

  console.log(
    JSON.stringify({
      count: patterns.length,
      patterns: patterns.map((p) => ({
        ...p,
        symptoms: p.symptoms ? JSON.parse(p.symptoms as string) : [],
        root_causes: p.root_causes ? JSON.parse(p.root_causes as string) : [],
        related_patterns: p.related_patterns ? JSON.parse(p.related_patterns as string) : [],
      })),
    }),
  );
}

/**
 * Print coverage report.
 */
function queryCoverage(kb: KnowledgeBase): void {
  const report = kb.getCoverageReport();
  console.log(JSON.stringify({ coverage: report }));
}

// ── CLI Entry Point ────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const kb = await initDatabase();

  try {
    if (args.includes("--coverage")) {
      queryCoverage(kb);
      return;
    }

    if (args.includes("--recipe")) {
      const systemIdx = args.indexOf("--system");
      const tagsIdx = args.indexOf("--tags");
      const system = systemIdx !== -1 ? args[systemIdx + 1] : undefined;
      const tags = tagsIdx !== -1 ? args[tagsIdx + 1].split(",") : undefined;
      queryRecipe(kb, system, tags);
      return;
    }

    if (args.includes("--diagnose")) {
      const systemIdx = args.indexOf("--system");
      const symptomsIdx = args.indexOf("--symptoms");
      const system = systemIdx !== -1 ? args[systemIdx + 1] : undefined;
      const symptoms = symptomsIdx !== -1 ? args[symptomsIdx + 1] : undefined;
      queryDiagnose(kb, system, symptoms);
      return;
    }

    const nodeIdx = args.indexOf("--node");
    const paramIdx = args.indexOf("--param");
    const queryIdx = args.indexOf("--query");
    const topKIdx = args.indexOf("--top-k");
    const formatIdx = args.indexOf("--format");
    const systemIdx = args.indexOf("--system");

    if (nodeIdx !== -1 && paramIdx !== -1) {
      // Parameter lookup
      queryParam(kb, args[nodeIdx + 1], args[paramIdx + 1]);
    } else if (nodeIdx !== -1) {
      // Node lookup
      const format = (formatIdx !== -1 ? args[formatIdx + 1] : "full") as "full" | "summary";
      queryNode(kb, args[nodeIdx + 1], format);
    } else if (queryIdx !== -1) {
      // Semantic search
      const topK = topKIdx !== -1 ? parseInt(args[topKIdx + 1], 10) : 5;
      const system = systemIdx !== -1 ? args[systemIdx + 1] : undefined;
      await querySemanticSearch(kb, args[queryIdx + 1], topK, system);
    } else if (args.includes("--param-advice")) {
      // Parameter advice (combines param lookup with context)
      if (nodeIdx !== -1 && paramIdx !== -1) {
        queryParam(kb, args[nodeIdx + 1], args[paramIdx + 1]);
      }
    } else {
      console.log(
        JSON.stringify({
          error: "No query specified. Use --node, --query, --recipe, --diagnose, or --coverage",
        }),
      );
    }
  } finally {
    kb.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[query] Fatal:", (err as Error).message);
    process.exit(1);
  });
}

export { queryNode, queryParam, querySemanticSearch, queryRecipe, queryDiagnose, queryCoverage };
