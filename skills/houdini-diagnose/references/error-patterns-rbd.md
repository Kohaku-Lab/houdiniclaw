# RBD Error Patterns

## RBD-001: Objects Pass Through Each Other

**Severity**: Common
**System**: RBD (Bullet Solver)

### Symptoms
- Fractured pieces fall through the ground
- Moving objects pass through collision geometry
- Interpenetration at simulation start

### Root Causes

**1. Insufficient collision passes (HIGH)**
- Bullet solver doesn't have enough iterations to resolve overlaps
- Fix: Bullet Solver > Collision Passes: 2 → 4 → 8
- Fix: Increase substeps on DOP Network

**2. Collision geometry too thin (HIGH)**
- Collision proxy is too thin relative to object speed
- Fix: Use collision padding (Bullet Solver > Collision Padding)
- Fix: Or thicken collision geometry manually

**3. Initial interpenetration (MEDIUM)**
- Pieces start overlapping at frame 1
- Fix: Enable "Allow Initial Overlaps" on constraints
- Fix: Or add a small separation gap in the fracture

**4. Wrong collision representation (MEDIUM)**
- Using convex hull when concave is needed
- Fix: RBD Packed Object > Collision Shape: Concave for hollow objects
- Note: Concave is more expensive but necessary for bowls, rooms, etc.

---

## RBD-002: Pieces Jitter or Vibrate in Place

**Severity**: Common
**System**: RBD

### Symptoms
- Pieces that should be resting vibrate or shake
- Small oscillations that don't settle
- Contact points seem unstable

### Root Causes

**1. Sleeping threshold too high (HIGH)**
- Solver keeps simulating nearly-static pieces
- Fix: Bullet Solver > Sleeping > Enable sleeping
- Fix: Adjust Linear Threshold and Angular Threshold

**2. Constraint stiffness mismatch (MEDIUM)**
- Constraints fighting against gravity or each other
- Fix: Reduce constraint stiffness
- Fix: Or increase constraint iterations

**3. Mass/density imbalance (LOW)**
- Very different mass objects in contact
- Fix: Ensure density values are physically reasonable
- Fix: Avoid extreme mass ratios (1:1000+)

---

## RBD-003: Fracture Looks Unrealistic

**Severity**: Moderate
**System**: RBD (Voronoi Fracture)

### Symptoms
- Fracture pattern looks too uniform/random
- Pieces don't break in a physically plausible way
- No radial pattern from impact point

### Root Causes

**1. Uniform scatter distribution (HIGH)**
- Scatter points are evenly distributed instead of impact-based
- Fix: Use density attribute on scatter to cluster points near impact
- Fix: Scatter more points near the impact location

**2. No clustering (MEDIUM)**
- All pieces are the same size
- Fix: Enable clustering in Voronoi Fracture
- Fix: Adjust cluster_size for material type (glass: small, concrete: large)

**3. Missing interior detail (LOW)**
- Interior faces are flat/smooth
- Fix: Add interior detail (noise displacement on interior faces)
- Fix: Assign separate material to interior group

---

## RBD-004: Constraints Break Too Early or Not At All

**Severity**: Common
**System**: RBD

### Symptoms
- Structure crumbles immediately under gravity (too weak)
- Nothing breaks even under extreme force (too strong)
- Inconsistent breaking behavior

### Root Causes

**1. Glue strength miscalibrated (HIGH)**
- Strength values don't match the forces in the simulation
- Fix for too-weak: Increase glue constraint strength (try 10x)
- Fix for too-strong: Decrease strength or apply external force
- Calibration: Run sim, observe break frame, adjust accordingly

**2. No propagation setup (MEDIUM)**
- Breaks happen uniformly instead of spreading from impact
- Fix: Enable constraint propagation
- Fix: Set propagation_rate to control crack spread speed

**3. Wrong constraint type (LOW)**
- Using glue when cone-twist or spring would be more appropriate
- Fix: Glue = break on threshold, Cone-twist = bend then break, Spring = stretch
