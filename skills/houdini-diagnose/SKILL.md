---
name: houdini-diagnose
description: "Diagnose Houdini simulation errors, unexpected behaviors, and visual artifacts. Use when a user reports problems like 'my sim explodes', 'smoke passes through walls', 'particles disappear', 'sim is too slow', crashes, or any unexpected behavior in their Houdini setup. Also triggers on Houdini error messages or cook errors."
---

# Houdini Error Diagnosis

Match user-reported symptoms to known error patterns in the knowledge base.

## When to Use

- User reports unexpected simulation behavior
- User shares a Houdini error message or cook error
- User says something "looks wrong" or "doesn't work"
- User describes performance issues with a simulation
- User mentions a crash during simulation

## Diagnosis Flow

1. Extract symptoms from user description:
   - **What happens**: explodes, disappears, passes through, too slow, crashes
   - **When it happens**: specific frame, gradually, immediately, randomly
   - **What system**: pyro, rbd, flip, vellum, sop
   - **What they've tried**: any parameter changes already attempted

2. Search the error pattern database:

```bash
scripts/houdini-kb-query.ts --diagnose --symptoms "sim explodes frame 12" --system "pyro" --top-k 5
```

3. Present ranked diagnoses with fix procedures

## Error Pattern Structure

```yaml
error_pattern:
  id: "pyro-explosion-substeps"
  symptoms:
    - "simulation explodes at a specific frame"
    - "values suddenly become NaN or infinity"
    - "smoke/fire grows uncontrollably then disappears"

  system: pyro
  severity: common

  root_causes:
    - cause: "Insufficient substeps for the simulation speed"
      probability: high
      explanation: "When forces are strong relative to voxel size, the solver can't resolve motion in a single step"
      fix:
        - "Increase substeps on the DOP network: 2 → 4 or higher"
        - "Or reduce force magnitudes (buoyancy, turbulence)"
        - "Check: pyrosolver > Advanced > Min/Max Substeps"
      verify: "Sim should stabilize. If still exploding, double substeps again."

    - cause: "Source emission too aggressive"
      probability: medium
      explanation: "Initial fuel/temperature values create forces the solver can't handle"
      fix:
        - "Reduce source temperature: try 1.0 instead of default"
        - "Reduce fuel amount on the source volume"
      verify: "First few frames should no longer spike."

  related_patterns:
    - "pyro-nan-values"
    - "pyro-velocity-explosion"
```

## Response Format

1. **Most likely diagnosis** with confidence level
2. **Why this happens** — one-sentence technical explanation
3. **Fix steps** — ordered from most likely to work to least
4. **Verification** — how to confirm the fix worked
5. **Alternative diagnoses** — if the first fix doesn't work
6. **Prevention** — how to avoid this in the future

## Common Error Categories

### Stability Errors
- Simulation explodes / NaN values
- Jittering or oscillating behavior
- Solver divergence warnings

### Collision Errors
- Objects pass through each other
- Smoke/fluid leaks through walls
- Collision geometry not detected

### Visual Artifacts
- Stepping / staircase patterns
- Banding in smoke density
- Flickering between frames

### Performance Issues
- Simulation extremely slow
- Memory usage growing unboundedly
- Cooking takes forever on specific nodes

### Crash Patterns
- Out of memory during simulation
- Crash at specific frame numbers
- Crash when enabling specific features

## Reference Files

- See [references/error-patterns-pyro.md](references/error-patterns-pyro.md) for Pyro-specific errors
- See [references/error-patterns-rbd.md](references/error-patterns-rbd.md) for RBD errors
- See [references/error-patterns-flip.md](references/error-patterns-flip.md) for FLIP errors
