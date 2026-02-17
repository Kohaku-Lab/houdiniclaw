---
name: houdini-doc-query
description: "Search the Houdini annotated knowledge base for node documentation, parameter explanations, and semantic translations. Use when a user asks about any Houdini node, parameter, or concept — including node names (e.g., pyro_solver, voronoi_fracture), parameter paths (e.g., dissipation, viscosity), VEX functions, or general Houdini workflow questions."
---

# Houdini Documentation Query

Retrieve structured annotations from the local Houdini knowledge base.

## When to Use

- User asks about a specific Houdini node or parameter
- User asks "what does X do?" for any Houdini concept
- User needs the semantic meaning of a parameter name
- User wants to understand a node's prerequisite connections
- Before answering ANY Houdini technical question (search first, then synthesize)

## Query Flow

1. Extract the node name and/or parameter name from the user's question
2. Run a semantic search against the knowledge base:

```bash
scripts/houdini-kb-query.ts --query "<user question>" --top-k 5
```

3. Parse the returned annotation chunks
4. Synthesize into a response following SOUL.md guidelines

## Query Types

### Node Lookup

```bash
scripts/houdini-kb-query.ts --node "pyro_solver" --format full
```

Returns: semantic_name, one_line, analogy, prerequisite_nodes, all parameters

### Parameter Lookup

```bash
scripts/houdini-kb-query.ts --node "pyro_solver" --param "dissipation"
```

Returns: semantic_name, intent_mapping, safe_range, expert_range, danger_zone, visual_effect, interaction_warnings

### Semantic Search

```bash
scripts/houdini-kb-query.ts --query "how to make smoke disappear faster" --top-k 5
```

Returns: top-k most relevant annotation chunks with relevance scores

## Response Format

Always structure the answer as:

1. **Direct answer** — the parameter/node and what it does, in plain language
2. **Semantic translation** — the Chinese semantic name if available
3. **Safe range** — default safe values for common scenarios
4. **Context warning** — any interaction effects or prerequisites
5. **Source** — which knowledge base entry the info came from

## Fallback

If the knowledge base returns no results:
- State clearly: "This node/parameter is not yet in the annotated knowledge base."
- Provide your best answer with a disclaimer
- Flag the gap for the annotation pipeline to prioritize
