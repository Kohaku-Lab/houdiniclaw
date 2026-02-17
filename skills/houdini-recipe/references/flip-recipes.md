# FLIP System Recipes

## Ocean Wave Crash

**Tags**: flip, ocean, wave, realistic, large-scale
**Description**: Ocean wave hitting a shore or structure with splash and foam

### Prerequisites
- Ocean Spectrum SOP for initial wave field
- Shore/structure collision geometry
- Whitewater solver for foam/spray (post-sim)

### Parameters

```yaml
flip_solver:
  particle_separation: 0.03   # Balance detail vs. performance
  grid_scale: 2.0             # Voxel size relative to particle sep
  substeps: 3
  viscosity: 0.0              # Water has negligible viscosity
  surface_tension: 0.0        # Not relevant at this scale
  velocity_smoothing: 0.1     # Reduce noise

flip_object:
  particle_separation: 0.03
  closed_boundaries: false    # Open ocean surface

ocean_source:
  wave_height: 1.5            # Meters
  wave_speed: 3.0
  chop: 0.5                   # Surface roughness

whitewater_solver:
  emission_threshold: 2.0     # Curvature/acceleration triggers
  lifespan: 1.5               # Seconds
  foam_density: 0.5
  spray_density: 0.3
```

### Warnings
- Large ocean sims are extremely memory-intensive — consider narrow band FLIP
- Whitewater is a separate post-process step, not part of the main FLIP solve
- Boundary conditions matter: open vs. closed changes behavior dramatically

### Variations
- **Calm lake splash**: wave_height=0.1, chop=0.0, particle_separation=0.02
- **Storm waves**: wave_height=3.0, chop=1.0, substeps=5
- **Slow motion**: substeps=8, time_scale=0.1

---

## Pouring Liquid into Glass

**Tags**: flip, liquid, pour, realistic, small-scale
**Description**: Liquid poured from a container into a glass with splashing

### Prerequisites
- Glass collision geometry (concave interior)
- Pour source (animated emitter or fluid body)
- Small-scale setup (centimeters)

### Parameters

```yaml
flip_solver:
  particle_separation: 0.002  # Very fine for small scale
  grid_scale: 1.5
  substeps: 4                 # Small scale needs precision
  viscosity: 0.0              # Water
  surface_tension: 0.01       # Visible at small scale
  velocity_smoothing: 0.05

source:
  emission_rate: 5000         # Particles per frame
  velocity: [0, -0.5, 0]     # Downward pour

collision:
  glass_friction: 0.1
  glass_bounce: 0.0           # No splash off glass walls
```

### Warnings
- Surface tension matters at small scale — don't set to 0
- Glass interior must be proper collision with clean normals
- Particle separation must be proportional to scene scale

### Variations
- **Honey**: viscosity=50.0, surface_tension=0.05
- **Milk**: viscosity=0.01, surface_tension=0.02, use white shader
- **Beer with foam**: Add whitewater solver for head foam

---

## Water Breaking Through Dam

**Tags**: flip, water, destruction, realistic, large-scale
**Description**: Massive water volume breaking through and flooding terrain

### Prerequisites
- Dam geometry (animated fracture with RBD for breaking)
- Terrain collision geometry
- Large initial water volume behind dam

### Parameters

```yaml
flip_solver:
  particle_separation: 0.1   # Coarse for massive volume
  grid_scale: 2.0
  substeps: 5                 # High velocity needs more substeps
  viscosity: 0.0
  reseeding: true             # Maintain particle density in turbulent areas

flip_object:
  initial_fill: true          # Fill behind dam at frame 1
  closed_boundaries: true     # Walls on sides

collision:
  terrain_friction: 0.5
  dam_pieces_friction: 0.3    # RBD dam debris in water
```

### Warnings
- Two-way coupling with RBD dam pieces is expensive but looks much better
- Narrow band FLIP essential at this scale for memory
- Consider upres pass for final render detail
