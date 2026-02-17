# Pyro Error Patterns

## PYRO-001: Simulation Explodes at Specific Frame

**Severity**: Common
**System**: Pyro (Smoke Solver, Pyro Solver)

### Symptoms
- Simulation looks normal for N frames, then suddenly explodes
- Density/temperature values become NaN or infinity
- Smoke/fire grows uncontrollably then may disappear entirely
- Console may show "NaN detected in field" warnings

### Root Causes (by probability)

**1. Insufficient substeps (HIGH)**
- Forces exceed what the solver can resolve in a single step
- Fix: Increase DOP Network > Substeps (2 → 4 → 8)
- Fix: Pyro Solver > Advanced > Min Substeps = 2, Max Substeps = 4
- Verify: Frame where explosion occurred should now sim normally

**2. Source emission spike (MEDIUM)**
- A sudden burst of fuel/temperature creates forces the solver can't handle
- Fix: Smooth the source emission curve, avoid frame-1 spikes
- Fix: Reduce source temperature from 5+ down to 1.5-2.0
- Verify: Check source volume density over time — should be smooth

**3. Collision geometry issues (MEDIUM)**
- Non-manifold or intersecting collision geometry creates pressure spikes
- Fix: Clean collision geometry (Fuse, Clean SOP)
- Fix: Increase collision padding
- Verify: Disable collision temporarily — if explosion stops, collision is the cause

**4. Container too small (LOW)**
- Smoke hitting container boundaries creates pressure buildup
- Fix: Increase container size or use open boundaries
- Verify: Check if explosion happens near container edges

---

## PYRO-002: Smoke Passes Through Collision Geometry

**Severity**: Common
**System**: Pyro

### Symptoms
- Smoke/fire visibly leaks through walls, floors, or objects
- Collision seems to work partially but not completely
- Effect is worse with fast-moving smoke

### Root Causes

**1. Collision geometry resolution too low (HIGH)**
- Collision SDF resolution doesn't match sim voxel size
- Fix: Match collision division size to smoke division size or finer
- Fix: Static Object > Division Size ≤ Smoke Object > Division Size

**2. Collision normals incorrect (HIGH)**
- Normals point the wrong direction
- Fix: Check and fix normals (Reverse SOP if needed)
- Fix: For enclosed spaces, normals must point **inward**

**3. Thin geometry (MEDIUM)**
- Collision walls thinner than voxel size
- Fix: Thicken geometry to at least 2-3x the voxel division size
- Fix: Or decrease division_size (more expensive)

**4. Insufficient substeps (LOW)**
- Fast smoke moves through collision between substeps
- Fix: Increase substeps on the DOP network

---

## PYRO-003: Simulation Is Extremely Slow

**Severity**: Common
**System**: Pyro

### Symptoms
- Frames take minutes or hours to cook
- Memory usage keeps growing
- CPU usage stays at 100% during cook

### Root Causes

**1. Division size too small (HIGH)**
- Voxel resolution too fine for the scene scale
- Fix: Increase Smoke Object > Division Size
- Rule of thumb: start with 0.05 for room-scale, 0.5 for outdoor
- Impact: Doubling division size reduces memory ~8x and cook time ~8x

**2. Container too large (HIGH)**
- Simulation domain much larger than needed
- Fix: Use tighter initial bounds
- Fix: Enable auto-resize with padding controls

**3. Too many substeps (MEDIUM)**
- More substeps than necessary
- Fix: Start with 1-2, only increase if instability occurs

**4. Gas Resize too aggressive (LOW)**
- Auto-resize expanding container every frame
- Fix: Set Gas Resize > Tolerance to a reasonable value (0.1-0.5)

---

## PYRO-004: Banding/Stepping in Smoke Density

**Severity**: Moderate
**System**: Pyro

### Symptoms
- Visible horizontal or vertical bands in smoke
- Staircase pattern in density field
- More visible in areas with gradual density changes

### Root Causes

**1. Low voxel resolution (HIGH)**
- Division size too coarse for the detail level needed
- Fix: Decrease division size (increase resolution)
- Trade-off: More expensive but smoother result

**2. Insufficient upres (MEDIUM)**
- Base sim lacks detail for final render quality
- Fix: Use an upres pass (Pyro Post-Process or separate upres sim)
- Fix: Add noise in shading instead of in the sim

**3. Dissipation artifacts (LOW)**
- Very high dissipation can create banding in sparse areas
- Fix: Lower dissipation, use smoother falloff

---

## PYRO-005: Fire Has No Visible Flames

**Severity**: Moderate
**System**: Pyro

### Symptoms
- Simulation cooks but only smoke is visible, no fire/flames
- Temperature field exists but flames don't render

### Root Causes

**1. No fuel source (HIGH)**
- Source volume isn't emitting fuel, only density
- Fix: Ensure source emits both `fuel` and `temperature` fields
- Fix: Check Volume Source > Fuel Volume is connected

**2. Shader temperature range mismatch (HIGH)**
- Renderer's fire shader expects different temperature range
- Fix: Adjust shader fire temperature range to match sim values
- Fix: In Mantra: fire_intensity, fire_temperature_range
- Fix: In Karma: check the pyro shader's emission temperature ramp

**3. Cooling rate too high (MEDIUM)**
- Fire cools to below visible temperature before it can render
- Fix: Reduce cooling_rate (try 0.1 instead of 0.5)
