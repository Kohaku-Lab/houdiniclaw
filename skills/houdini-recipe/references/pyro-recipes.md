# Pyro System Recipes

## Realistic Indoor Explosion

**Tags**: indoor, explosion, realistic, medium-scale
**Description**: Dense initial burst with slow dissipation in enclosed space

### Prerequisites
- Closed collision geometry with **inward-facing normals**
- Source volume (sphere or custom geo) for initial fuel
- At least 3 substeps for stability
- DOP network with Pyro Solver + Smoke Object

### Parameters

```yaml
pyro_solver:
  dissipation: 0.02          # Very low — smoke lingers indoors
  cooling_rate: 0.15          # Moderate — fire cools but visible
  turbulence: 0.8             # High — explosion is chaotic
  buoyancy_dir_y: 1.0         # Default upward
  buoyancy_lift: 1.0          # Standard
  disturbance: 0.3            # Some variation in density
  sharpening: 0.05            # Slight edge definition

smoke_object:
  division_size: 0.02         # Fine detail (adjust for perf)
  initial_density: 0

source_volume:
  fuel_amount: 1.5            # Strong initial fuel
  temperature: 2.0            # Hot start
  activation_frame: 1-3       # Short burst

dop_network:
  substeps: 4                 # Stability for strong forces
```

### Warnings
- Low dissipation + enclosed space = very dense smoke after ~50 frames; increase to 0.04 if too opaque
- Ensure collision geometry normals point **inward** for containment
- High turbulence can push smoke through thin collision walls — increase collision substeps if leaking

### Variations
- **Smaller room**: dissipation=0.01, turbulence=0.6
- **More dramatic**: turbulence=1.2, fuel_amount=2.0, temperature=3.0
- **Slow motion**: substeps=8, time_scale=0.25

---

## Outdoor Campfire

**Tags**: outdoor, fire, realistic, small-scale, continuous
**Description**: Steady burning flame with gentle smoke rising

### Prerequisites
- Source geometry (logs/emitter shape)
- No enclosing collision needed
- Continuous emission (not burst)

### Parameters

```yaml
pyro_solver:
  dissipation: 0.1            # Default — outdoor smoke fades naturally
  cooling_rate: 0.3           # Fire cools quickly in open air
  turbulence: 0.3             # Gentle flickering
  buoyancy_lift: 1.2          # Slightly stronger lift for visible rise
  disturbance: 0.2
  flame_height_scale: 1.0

source_volume:
  fuel_amount: 0.5            # Moderate continuous emission
  temperature: 1.5
  emission_type: continuous
```

### Warnings
- Outdoor sims need larger containers — smoke rises and spreads
- Wind can be added via a uniform force in the DOP network

---

## Stylized Magic Smoke

**Tags**: stylized, magic, smoke, medium-scale, art-directed
**Description**: Thick, swirling, colorful smoke for fantasy/magic effects

### Prerequisites
- Point source or curve source for directional emission
- Custom velocity field for swirl motion (optional)

### Parameters

```yaml
pyro_solver:
  dissipation: 0.05           # Lingers for visual impact
  cooling_rate: 0.05          # Stays hot-colored longer
  turbulence: 1.2             # Very swirly
  buoyancy_lift: 0.3          # Floats rather than rises fast
  disturbance: 0.5            # Lots of organic variation
  confinement: 0.5            # Keeps structure, prevents blob

smoke_object:
  division_size: 0.015        # Fine detail for swirls

source_volume:
  fuel_amount: 0.8
  temperature: 1.0
  emission_type: continuous
```

### Variations
- **Trailing magic**: Add velocity along a curve path
- **Dissipating spell**: dissipation=0.2 after source stops
- **Dense fog spell**: dissipation=0.01, turbulence=0.1, buoyancy=0.0

---

## Large Scale Volcanic Eruption

**Tags**: outdoor, explosion, realistic, massive-scale
**Description**: Towering ash column with pyroclastic flow

### Prerequisites
- Large domain (scale container to scene)
- Source at ground level with strong upward velocity
- Collision geometry for the mountain/terrain

### Parameters

```yaml
pyro_solver:
  dissipation: 0.005          # Ash lingers for very long
  cooling_rate: 0.05          # Slow cooling
  turbulence: 0.6             # Large-scale turbulent structures
  buoyancy_lift: 2.0          # Strong upward force for column
  disturbance: 0.4
  time_scale: 1.0

smoke_object:
  division_size: 0.5          # Coarse for massive scale (meters)

source_volume:
  fuel_amount: 3.0            # Massive emission
  temperature: 5.0            # Very hot
  velocity_y: 20.0            # Strong initial upward velocity

dop_network:
  substeps: 6                 # Stability for extreme forces
```

### Warnings
- Massive scale requires proportionally adjusted division size
- Memory usage will be very high — consider using sparse volumes
- Substeps must be high due to extreme velocities
