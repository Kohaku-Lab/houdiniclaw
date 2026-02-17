# RBD System Recipes

## Glass Window Shatter

**Tags**: rbd, fracture, glass, realistic, small-scale
**Description**: Window shatters on impact with radial fracture pattern

### Prerequisites
- Flat geometry for the glass pane
- Impact source (bullet, object, or point)
- Voronoi Fracture SOP for pre-fracturing

### Parameters

```yaml
voronoi_fracture:
  num_points: 200             # Enough pieces for detail
  cluster_pieces: true
  cluster_size: 5             # Groups of small shards
  cut_plane_offset: 0.001     # Thin glass

# Impact-based scatter: more points near impact, fewer at edges
scatter:
  density_attribute: "impact_proximity"  # Custom attrib, high near hit point

bullet_solver:
  substeps: 4
  collision_passes: 2

rbd_packed_object:
  friction: 0.3               # Glass slides on surfaces
  bounce: 0.1                 # Minimal bounce
  density: 2500               # Glass density kg/m3

glue_constraint:
  strength: 500               # Breaks on impact
  propagation_rate: 0.5       # Cracks spread from impact point
```

### Warnings
- Pre-fracture must happen at SOP level before DOP
- Glue strength determines when pieces break — too low and it crumbles, too high and nothing breaks
- Interior faces need separate material for realistic glass cross-section

### Variations
- **Bulletproof glass**: strength=2000, num_points=50 (fewer, larger cracks)
- **Tempered glass**: num_points=500, cluster_size=2 (tiny uniform pieces)
- **Slow motion**: substeps=8, use time_scale on DOP network

---

## Building Collapse

**Tags**: rbd, fracture, destruction, realistic, large-scale
**Description**: Multi-story building structural failure and collapse

### Prerequisites
- Building geometry separated into structural elements (floors, walls, columns)
- Boolean fracture or Voronoi per structural element
- Constraint network connecting elements
- Ground plane collision

### Parameters

```yaml
voronoi_fracture:
  # Per structural element, different settings:
  walls: { num_points: 100, cluster_size: 8 }
  floors: { num_points: 50, cluster_size: 15 }
  columns: { num_points: 30, cluster_size: 5 }

bullet_solver:
  substeps: 6                 # Stability for heavy collisions
  collision_passes: 3
  gravity: [0, -9.81, 0]

rbd_packed_object:
  friction: 0.6               # Concrete grips
  bounce: 0.05                # Barely bounces
  density: 2400               # Concrete density

glue_constraint:
  # Different strengths for different connections
  column_to_floor: 5000       # Strongest connections
  wall_to_floor: 2000
  wall_to_wall: 1000
  within_piece: 500           # Internal fracture threshold

cone_twist_constraint:
  # For rebar/steel connections that bend before breaking
  max_angle: 15               # Degrees before breaking
  stiffness: 1000
```

### Warnings
- Constraint hierarchy is critical: break floor-wall connections before internal fractures
- Start collapse with initial constraint deletion (simulate structural failure point)
- Very memory-intensive with many pieces — use LOD or proxy geometry for far pieces

---

## Rock Crumble

**Tags**: rbd, fracture, rock, realistic, medium-scale
**Description**: Rock or cliff face crumbling under stress

### Parameters

```yaml
voronoi_fracture:
  num_points: 150
  cluster_pieces: true
  cluster_size: 10            # Chunky rock pieces

bullet_solver:
  substeps: 3

rbd_packed_object:
  friction: 0.8               # Rough rock surface
  bounce: 0.15                # Some bounce for rocks
  density: 2700               # Granite density

glue_constraint:
  strength: 1000
  propagation_rate: 0.3       # Slow crumble, not instant shatter
```
