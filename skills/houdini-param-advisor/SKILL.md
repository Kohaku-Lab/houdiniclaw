---
name: houdini-param-advisor
description: "Provide parameter range recommendations with interaction warnings for Houdini simulation parameters. Use when a user asks 'what should X be set to?', 'what's a good value for X?', or needs to understand the relationship between multiple parameters. Also use when a user is tuning parameters and wants to know safe boundaries."
---

# Houdini Parameter Advisor

Provide contextual parameter recommendations with safety ranges and interaction analysis.

## When to Use

- User asks for recommended values for a specific parameter
- User is tuning parameters and wants guidance on ranges
- User asks about parameter interactions ("if I change X, what happens to Y?")
- User wants to understand what a parameter controls visually

## Advisory Flow

1. Identify the parameter and its context (node, system, scene description)
2. Retrieve the parameter annotation from the knowledge base:

```bash
scripts/houdini-kb-query.ts --param-advice --node "pyro_solver" --param "dissipation" --context "indoor explosion"
```

3. Build contextual recommendation considering the user's scene

## Parameter Annotation Structure

Each annotated parameter includes:

```yaml
parameter:
  node: pyro_solver
  name: dissipation
  path: pyrosolver1/flameSolver/dissipation

  semantic:
    name_zh: "烟雾消散速度"
    name_en: "Smoke Dissipation Rate"
    one_line: "Controls how quickly the smoke density fades over time"
    analogy: "Like the half-life of smoke — lower values mean smoke lingers longer"

  ranges:
    default: 0.1
    safe_range: [0.01, 0.5]
    expert_range: [0.001, 1.0]
    danger_zone:
      below: 0.001   # "Smoke never disappears, fills entire container"
      above: 1.0      # "Smoke vanishes almost instantly, invisible simulation"

  intent_mapping:
    "smoke lingers longer": "decrease dissipation"
    "smoke disappears faster": "increase dissipation"
    "thicker smoke": "decrease dissipation + increase density"
    "smoke fades at edges": "use dissipation with a gradient mask"

  context_adjustments:
    indoor: "Use 0.01-0.05 (enclosed spaces trap smoke)"
    outdoor: "Use 0.05-0.2 (wind and open air dissipate faster)"
    large_scale: "Use 0.02-0.1 (large volumes need slower dissipation)"
    stylized: "Use 0.2-0.5 (faster fade for cleaner look)"

  interactions:
    - param: "cooling_rate"
      relationship: "Both reduce density over time; high dissipation + high cooling = very fast fade"
      warning: "Don't max both unless you want smoke to vanish in 2-3 frames"
    - param: "turbulence"
      relationship: "Turbulence spreads smoke, making dissipation less noticeable"
      tip: "High turbulence + low dissipation = large persistent smoke cloud"
    - param: "buoyancy"
      relationship: "Buoyancy moves smoke up; combined with dissipation, smoke may thin out before rising fully"

  visual_effect:
    0.01: "Dense, persistent fog that barely fades"
    0.05: "Slow, realistic indoor smoke behavior"
    0.1: "Default — moderate fade, good for general use"
    0.3: "Fast-fading wispy smoke"
    0.5: "Very quick fade, smoke barely visible after source stops"
```

## Response Format

1. **Recommended value** for the user's specific context
2. **Safe range** — the guardrails
3. **Visual description** — what the user will see at this value
4. **Interaction warnings** — which other parameters to watch
5. **Intent mapping** — "if you want X, adjust Y"

## Multi-Parameter Advice

When users are tuning multiple parameters simultaneously, provide a coordination table:

```
For "realistic indoor explosion":
  dissipation:  0.02  (low — smoke lingers in enclosed space)
  cooling_rate: 0.15  (moderate — fire cools but doesn't vanish)
  turbulence:   0.8   (high — explosion creates chaotic motion)
  buoyancy:     1.0   (default — hot gas rises normally)

  Key interaction: turbulence(0.8) + dissipation(0.02) = very dense, chaotic cloud
  Adjust: if too dense after 50 frames, raise dissipation to 0.04
```
