---
name: houdini-annotator
description: "Backend annotation generation pipeline for the Houdini knowledge base. Crawls SideFX official documentation, example pages, Content Library, and parses .hip files for actual parameter values. Generates structured annotations using high-reasoning AI models. Runs as a Cron skill: weekly full rebuild, daily incremental updates. Not user-invocable — triggered by the scheduler."
---

# Houdini Annotation Pipeline

Backend Cron skill that maintains the structured knowledge base.

## Schedule

- **Weekly full rebuild**: Sunday 03:00 UTC — re-crawl all sources, regenerate all annotations
- **Daily incremental**: Daily 04:00 UTC — check for new/updated docs, annotate only changes

## Pipeline Stages

### Stage 1: Crawl

Fetch raw documentation from configured sources, including example pages.

```bash
bun skills/houdini-annotator/scripts/run-pipeline.ts --mode full
```

**Sources (by priority):**

| Priority | Source | Content | Method | Status |
|----------|--------|---------|--------|--------|
| P0 | SideFX Docs | Node definitions, parameter docs | HTML fetch, per-node split | Implemented |
| P0 | SideFX Examples | Example page descriptions, HIP file refs | HTML fetch per-node examples | Implemented |
| P0 | Content Library | HIP/HDA files, metadata | Content Library crawler | Implemented |
| P0 | HIP Files | Actual parameter values, network topology | CPIO parser (no license needed) | Implemented |
| P1 | Local Houdini Install | Example .hip files bundled with Houdini | Filesystem scan | Implemented |
| P1 | SideFX Forum | High-frequency Q&A | Scrape hot threads | Planned |
| P1 | Odforce | TD experience sharing | Scrape high-vote answers | Planned |
| P2 | Tutorial transcripts | Best practices | Subtitle extraction | Planned |

### Stage 1.5: Download HIP Files

Download .hip files from discovered sources and manage local cache.

```bash
bun src/houdini-claw/hip-downloader.ts --url <url> --output /tmp/hip-cache/
bun src/houdini-claw/hip-downloader.ts --scan-local --houdini-path /opt/hfs20.5/
```

Features:
- SHA-256 integrity verification
- Incremental updates (skip unchanged files)
- Rate limiting
- LRU cache with configurable size limit (default 2 GB)
- Local Houdini installation auto-discovery

### Stage 1.6: Parse HIP Files

Parse .hip files into structured data without requiring a Houdini license.

```bash
bun src/houdini-claw/hip-extractor.ts --hip /path/to/scene.hip
```

The parser:
1. Decompresses gzip-wrapped CPIO archives
2. Extracts ASCII node definitions and parameter values
3. Builds a node graph with connections
4. Identifies non-default (explicitly adjusted) parameters
5. Records parameter snapshots into the knowledge base

**Output per HIP file:**
- Node count, types, and hierarchy
- Parameter name → value mappings
- Default vs. modified parameter flags
- VEX/HScript expressions
- Network topology (connections between nodes)

### Stage 2: Annotate

Generate structured annotations from raw docs + HIP data using a high-reasoning model.

```bash
scripts/houdini-annotate.ts --input /tmp/houdini-raw/ --model gpt-5.2-xhigh --thinking xhigh
```

The annotation prompt now includes real-world parameter data from HIP files:
- Actual usage ranges from official examples calibrate safe_range/expert_range
- Non-default parameter frequencies inform which parameters matter most
- Expression patterns provide VEX/HScript usage examples

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
- HIP file coverage (files parsed, parameter snapshots collected)

## Pipeline CLI Options

```bash
# Full pipeline
bun skills/houdini-annotator/scripts/run-pipeline.ts --mode full

# Incremental (skip unchanged)
bun skills/houdini-annotator/scripts/run-pipeline.ts --mode incremental

# Specific system only
bun skills/houdini-annotator/scripts/run-pipeline.ts --mode full --system pyro

# Seed database with hand-verified data only
bun skills/houdini-annotator/scripts/run-pipeline.ts --seed-only

# HIP-only mode (scan + parse + extract, no crawl/annotate)
bun skills/houdini-annotator/scripts/run-pipeline.ts --hip-only --scan-local

# Skip specific stages
bun skills/houdini-annotator/scripts/run-pipeline.ts --mode full --skip-crawl
bun skills/houdini-annotator/scripts/run-pipeline.ts --mode full --skip-hip
bun skills/houdini-annotator/scripts/run-pipeline.ts --mode full --skip-annotate

# Scan local Houdini installation
bun skills/houdini-annotator/scripts/run-pipeline.ts --mode full --scan-local --houdini-path /opt/hfs20.5/
```

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
- If a HIP file fails to parse, record the error and continue with remaining files
- Never delete existing annotations during incremental updates
- All operations are idempotent
