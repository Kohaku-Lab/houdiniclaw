---
name: houdini-annotator
description: "Backend annotation generation pipeline for the Houdini knowledge base. Crawls SideFX official documentation, community forums, and tutorial sources, then generates structured annotations using high-reasoning AI models. Runs as a Cron skill: weekly full rebuild, daily incremental updates. Not user-invocable — triggered by the scheduler."
---

# Houdini Annotation Pipeline

Backend Cron skill that maintains the structured knowledge base.

## Schedule

- **Weekly full rebuild**: Sunday 03:00 UTC — re-crawl all sources, regenerate all annotations
- **Daily incremental**: Daily 04:00 UTC — check for new/updated docs, annotate only changes

## Pipeline Stages

### Stage 1: Crawl

Fetch raw documentation from configured sources.

```bash
scripts/houdini-crawl.ts --mode full|incremental --output /tmp/houdini-raw/
```

**Sources (by priority):**

| Priority | Source | Content | Method |
|----------|--------|---------|--------|
| P0 | SideFX Docs | Node definitions, parameter docs | HTML fetch, per-node split |
| P0 | Houdini Examples | Actual parameter values | Parse .hip JSON exports |
| P1 | SideFX Forum | High-frequency Q&A | Scrape hot threads |
| P1 | Odforce | TD experience sharing | Scrape high-vote answers |
| P2 | Tutorial transcripts | Best practices | Subtitle extraction |

### Stage 2: Annotate

Generate structured annotations from raw docs using a high-reasoning model.

```bash
scripts/houdini-annotate.ts --input /tmp/houdini-raw/ --model gpt-5.2-xhigh --thinking xhigh
```

**Annotation schema** (output per node):

```yaml
node_annotation:
  node_name: string          # e.g., "pyro_solver"
  node_category: string      # e.g., "DOP"
  houdini_version: string    # e.g., "20.5"

  semantic:
    name_zh: string          # Chinese semantic name
    name_en: string          # English semantic name
    one_line: string         # One-sentence explanation
    analogy: string          # Physical analogy

  prerequisites:
    required_nodes: string[] # Nodes that must exist upstream
    required_context: string # DOP/SOP/etc context
    typical_network: string  # Common network structure description

  parameters:
    - name: string
      path: string           # Full parameter path
      semantic_name_zh: string
      semantic_name_en: string
      intent_mapping: Record<string, string>  # user intent → adjustment direction
      safe_range: [number, number]
      expert_range: [number, number]
      danger_zone: { below: number, above: number, description: string }
      visual_effect: Record<string, string>   # value → visual description
      interactions: InteractionWarning[]

  recipes:
    - name: string
      tags: string[]
      description: string
      parameter_values: Record<string, any>
      prerequisites: string[]
      warnings: string[]
      variations: Record<string, any>

  error_patterns:
    - symptoms: string[]
      root_causes: RootCause[]
      related_patterns: string[]

  metadata:
    source_urls: string[]
    crawled_at: string
    annotated_at: string
    annotation_model: string
    human_verified: boolean
    confidence_score: number
```

### Stage 3: Validate

Run automated sanity checks on generated annotations.

```bash
scripts/houdini-validate.ts --input /tmp/houdini-annotated/
```

Checks:
- Parameter ranges are physically plausible (not negative for positive-only params)
- Referenced nodes exist in the Houdini node catalog
- No duplicate entries
- Safe ranges are subsets of expert ranges
- All required fields populated

### Stage 4: Ingest

Write validated annotations to the knowledge base and rebuild vector indices.

```bash
scripts/houdini-ingest.ts --input /tmp/houdini-annotated/ --db ~/.openclaw/houdini-claw/houdini_kb.db
```

Operations:
1. Upsert node annotations into SQLite
2. Chunk annotations for vector embedding
3. Generate embeddings for each chunk
4. Rebuild the sqlite-vec index
5. Update the coverage report

### Stage 5: Report

Generate a coverage report after each run.

```bash
scripts/houdini-report.ts --db ~/.openclaw/houdini-claw/houdini_kb.db
```

Output:
- Total nodes annotated by system (Pyro, RBD, FLIP, etc.)
- Parameters with/without human verification
- Coverage gaps (nodes referenced but not annotated)
- Confidence distribution

## Manual Override

To re-annotate a specific node:

```bash
scripts/houdini-annotate.ts --node "pyro_solver" --force
```

To mark an annotation as human-verified:

```bash
scripts/houdini-verify.ts --node "pyro_solver" --param "dissipation" --verified-by "td_name"
```

## Error Handling

- If a crawl source is unreachable, skip it and log
- If annotation generation fails for a node, keep the existing annotation
- Never delete existing annotations during incremental updates
- All operations are idempotent
