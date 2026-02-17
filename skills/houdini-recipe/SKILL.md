---
name: houdini-recipe
description: "Match user scene descriptions to pre-built Houdini parameter recipes and presets. Use when a user describes a specific visual effect goal (e.g., 'indoor explosion', 'ocean waves', 'building collapse') and needs a complete parameter setup or starting point. Also use when a user asks 'how do I set up X in Houdini?' for simulation-type effects."
---

# Houdini Recipe Lookup

Match user intent to curated parameter presets from the knowledge base.

## When to Use

- User describes a specific effect they want to achieve
- User asks "how do I set up X?"
- User wants a starting point for a simulation type
- User asks for "a recipe" or "a preset" or "parameter values for X"

## Query Flow

1. Parse the user's description into tags:
   - **System**: pyro / rbd / flip / vellum / mixed
   - **Scale**: small / medium / large / massive
   - **Style**: realistic / stylized / cartoon
   - **Environment**: indoor / outdoor / space / underwater
   - **Specific effect**: explosion / fire / smoke / fracture / splash / cloth / hair

2. Search for matching recipes:

```bash
scripts/houdini-kb-query.ts --recipe --system "pyro" --tags "indoor,explosion,realistic" --top-k 3
```

3. Return the best-matching recipe with full parameter breakdown

## Recipe Structure

Each recipe contains:

```yaml
recipe:
  name: "Realistic Indoor Explosion"
  system: pyro
  tags: [indoor, explosion, realistic, medium-scale]
  description: "Dense initial burst with slow dissipation in enclosed space"

  prerequisites:
    - "Closed collision geometry with inward-facing normals"
    - "Source volume (sphere or custom geo) for initial fuel"
    - "At least 3 substeps for stability"

  nodes:
    - pyro_solver:
        dissipation: 0.02
        cooling_rate: 0.15
        turbulence: 0.8
        # ... all relevant parameters
    - source_volume:
        fuel_amount: 1.5
        temperature: 2.0

  warnings:
    - "Low dissipation + enclosed space = very dense smoke; increase if too opaque"
    - "Ensure collision geometry normals point inward for containment"

  variations:
    smaller_room: { dissipation: 0.01, note: "Even slower fade in tight spaces" }
    more_dramatic: { turbulence: 1.2, fuel_amount: 2.0, note: "Bigger, more chaotic" }
```

## Response Format

1. **Recipe name and match confidence**
2. **Prerequisites** — what the user needs set up before applying
3. **Node-by-node parameters** — organized by DOP network order
4. **Key warnings** — common mistakes with this recipe
5. **Variations** — how to adjust for different needs
6. **"Want me to walk through the setup step by step?"**

## Cross-System Recipes

Some effects require multiple simulation systems:

- **Explosion with debris**: Pyro + RBD (fire/smoke + fracture pieces)
- **Splash with foam**: FLIP + whitewater
- **Cloth tearing**: Vellum + RBD (cloth sim + rigid pieces)

For these, provide the setup order and data flow between systems.

## Reference Files

- See [references/pyro-recipes.md](references/pyro-recipes.md) for all Pyro system recipes
- See [references/rbd-recipes.md](references/rbd-recipes.md) for RBD recipes
- See [references/flip-recipes.md](references/flip-recipes.md) for FLIP recipes
