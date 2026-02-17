# TOOLS.md - Houdini Claw Local Configuration

## Knowledge Base

- **Storage**: Local SQLite database at `~/.openclaw/houdini-claw/houdini_kb.db`
- **Vector index**: sqlite-vec for semantic search, stored alongside the main DB
- **Embedding model**: Configurable via `HOUDINI_CLAW_EMBEDDING_MODEL` env var

## Skills Available

### Query Skills (Frontend)

| Skill | Trigger | What It Does |
|-------|---------|--------------|
| `houdini-doc-query` | Any Houdini node/parameter question | Semantic search over annotated documentation |
| `houdini-recipe` | "How do I set up X effect?" | Match scene description to parameter presets |
| `houdini-diagnose` | "My sim does X weird thing" | Match symptoms to known error patterns |
| `houdini-param-advisor` | "What should X parameter be?" | Parameter range + interaction warnings |

### Backend Skills (Cron)

| Skill | Schedule | What It Does |
|-------|----------|--------------|
| `houdini-annotator` | Weekly full / daily incremental | Crawl SideFX docs, generate structured annotations |

## Data Sources

Priority order for annotation pipeline:

1. **SideFX Official Docs** — `https://www.sidefx.com/docs/houdini/` (HTML, per-node pages)
2. **SideFX Forum** — `https://www.sidefx.com/forum/` (high-frequency Q&A threads)
3. **Odforce Community** — `https://forums.odforce.net/` (TD experience sharing)
4. **Entagma Tutorials** — Best practices and creative techniques
5. **Houdini Example Files** — `.hip` parameter snapshots from SideFX examples

## Environment Variables

```
HOUDINI_CLAW_DB_PATH=~/.openclaw/houdini-claw/houdini_kb.db
HOUDINI_CLAW_EMBEDDING_MODEL=text-embedding-3-small
HOUDINI_CLAW_ANNOTATION_MODEL=gpt-5.2-xhigh
HOUDINI_CLAW_ANNOTATION_THINKING=xhigh
```

## Node Coverage Status

Track annotation progress by system:

- **Pyro**: Target ~40 nodes (pyro_solver, smoke_solver, fire, combustion, etc.)
- **RBD**: Target ~35 nodes (voronoi_fracture, bullet_solver, constraints, etc.)
- **FLIP**: Target ~30 nodes (flip_solver, particle_fluid, viscosity, etc.)
- **Vellum**: Target ~25 nodes (cloth, hair, grains, softbody, etc.)
- **CHOP**: Target ~20 core nodes (noise, math, channel operators)
- **SOP**: Target ~50 core nodes (most frequently asked about SOPs)
