# FLIP Error Patterns

## FLIP-001: Particles Disappear or Lose Volume

**Severity**: Common
**System**: FLIP

### Symptoms
- Fluid volume visibly shrinks over time
- Particles disappear, especially at boundaries
- Surface reconstruction shows gaps

### Root Causes

**1. Reseeding disabled or misconfigured (HIGH)**
- Solver not maintaining particle density in turbulent regions
- Fix: Enable FLIP Solver > Particle Motion > Reseeding
- Fix: Set Particles Per Voxel to 8 (default)
- Fix: Check Surface Oversampling and Surface Band values

**2. Particle separation too large (HIGH)**
- Not enough particles to maintain the surface
- Fix: Decrease particle_separation
- Trade-off: More particles = more memory + slower sim

**3. Boundary conditions deleting particles (MEDIUM)**
- Open boundaries are removing particles at edges
- Fix: Check FLIP Object > Boundary Conditions
- Fix: Expand domain or use closed boundaries on needed sides

---

## FLIP-002: Fluid Explodes or Sprays Wildly

**Severity**: Common
**System**: FLIP

### Symptoms
- Particles shoot out at extreme velocities
- Fluid "explodes" at a specific frame
- Unrealistic spray behavior

### Root Causes

**1. Insufficient substeps (HIGH)**
- Fast-moving fluid can't resolve motion in one step
- Fix: Increase DOP substeps (3 → 5 → 8)
- Fix: FLIP Solver > Volume Motion > Max Substeps

**2. Collision geometry issues (HIGH)**
- Non-manifold collision or particles starting inside collision geo
- Fix: Ensure collision geometry is clean and closed
- Fix: Add padding between fluid source and collision surfaces

**3. Extreme forces (MEDIUM)**
- Gravity, viscosity, or surface tension values creating instability
- Fix: Check all force magnitudes, reduce if unreasonable
- Fix: Surface tension can cause explosions at large particle separations

---

## FLIP-003: Viscous Fluid Doesn't Behave Like Expected Material

**Severity**: Moderate
**System**: FLIP

### Symptoms
- Honey/lava should be thick but behaves like water
- Viscous fluid doesn't pile up correctly
- Viscosity has no visible effect

### Root Causes

**1. Viscosity value too low for scene scale (HIGH)**
- Viscosity is scale-dependent
- Fix for honey: viscosity = 2-10 (scene-dependent)
- Fix for lava: viscosity = 50-500
- Fix for tar: viscosity = 1000+
- Note: Start low, increase by 2-5x until desired behavior

**2. Viscosity solver settings (MEDIUM)**
- Not enough iterations to resolve viscosity
- Fix: FLIP Solver > Volume Motion > Viscosity Iterations (increase)
- Fix: Enable "Slip on Collision" for thick fluids on surfaces

**3. Grid scale mismatch (LOW)**
- Grid resolution too coarse for viscosity to resolve properly
- Fix: Decrease grid_scale (try 1.5 instead of 2.0)

---

## FLIP-004: Surface Reconstruction Artifacts

**Severity**: Moderate
**System**: FLIP (Post-Process)

### Symptoms
- Blobby/lumpy surface despite smooth fluid motion
- Holes in the reconstructed surface mesh
- Surface mesh flickers between frames

### Root Causes

**1. Particle Fluid Surface settings (HIGH)**
- Influence scale or smoothing too low
- Fix: Particle Fluid Surface SOP > Influence Scale: 2.0-3.0
- Fix: Enable smoothing, Smoothing Iterations: 2-5
- Fix: Adjust Droplet Scale for thin features

**2. Not enough particles for resolution (MEDIUM)**
- Particle density too low for the desired surface quality
- Fix: Increase particles per voxel (8 → 16)
- Fix: Decrease particle_separation

**3. Missing velocity transfer (LOW)**
- Surface mesh doesn't have velocity for motion blur
- Fix: Enable velocity transfer in Particle Fluid Surface
- Fix: Needed for proper motion blur in rendering
