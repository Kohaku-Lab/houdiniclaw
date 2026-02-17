# Annotation Schema Reference

This document defines the canonical structure for Houdini node annotations in the knowledge base.

## Node Annotation

Each Houdini node gets one annotation record:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| node_name | string | yes | Houdini node identifier (e.g., `pyro_solver`) |
| node_category | string | yes | Context: SOP, DOP, VOP, CHOP, COP, ROP, OBJ, LOP, TOP |
| houdini_version | string | yes | Version when documented (e.g., `20.5`) |
| semantic_name_zh | string | no | Chinese semantic name |
| semantic_name_en | string | no | English human-readable name |
| one_line | string | yes | One-sentence explanation |
| analogy | string | no | Physical analogy for understanding |
| prerequisite_nodes | string[] | no | Nodes that must exist upstream |
| required_context | string | no | Which context (DOP/SOP/etc) |
| typical_network | string | no | Common network setup description |

## Parameter Annotation

Each important parameter on a node gets one annotation:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| node_name | string | yes | Parent node |
| param_name | string | yes | Parameter code name |
| param_path | string | yes | Full Houdini parameter path |
| semantic_name_zh | string | no | Chinese name |
| semantic_name_en | string | no | English name |
| one_line | string | no | What this parameter controls |
| intent_mapping | object | no | `{ "user intent": "adjustment direction" }` |
| default_value | number | no | Factory default |
| safe_range | [min, max] | no | Safe for most scenarios |
| expert_range | [min, max] | no | Extended range for experts |
| danger_zone | object | no | `{ below, above, description }` |
| visual_effect | object | no | `{ "value": "visual description" }` |
| interactions | array | no | Parameter interaction warnings |
| context_adjustments | object | no | `{ "context": "recommended range" }` |

## Recipe

A recipe is a curated parameter preset for a specific scenario:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | yes | Human-readable recipe name |
| system | string | yes | pyro / rbd / flip / vellum / mixed |
| tags | string[] | yes | Searchable tags |
| description | string | yes | When and why to use this recipe |
| prerequisites | string[] | no | Setup requirements |
| parameters | object | yes | `{ node: { param: value } }` |
| warnings | string[] | no | Common mistakes |
| variations | object | no | `{ name: { param: value, note } }` |

## Error Pattern

Known error patterns with diagnostic information:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| pattern_id | string | yes | Unique ID (e.g., `PYRO-001`) |
| system | string | yes | Which sim system |
| severity | string | yes | common / moderate / rare |
| symptoms | string[] | yes | What the user observes |
| root_causes | array | yes | Ranked possible causes with fixes |
| related_patterns | string[] | no | Links to related errors |

### Root Cause Structure

```json
{
  "cause": "Description of the root cause",
  "probability": "high | medium | low",
  "explanation": "Technical explanation for TDs",
  "fix": ["Step 1", "Step 2", "..."],
  "verify": "How to confirm the fix worked"
}
```
