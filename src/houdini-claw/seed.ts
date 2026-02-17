/**
 * Houdini Claw - Seed Data
 *
 * Seeds the knowledge base with hand-crafted, human-verified annotations
 * for the most critical Houdini nodes. These serve as the gold standard
 * that the annotation pipeline should aim to match.
 *
 * Usage:
 *   bun src/houdini-claw/seed.ts
 *   bun src/houdini-claw/seed.ts --db /path/to/db
 */

import { initDatabase, type KnowledgeBase } from "./db.js";

// ── Seed Data ──────────────────────────────────────────────

function seedPyroSolver(kb: KnowledgeBase): void {
  kb.upsertNodeAnnotation({
    node_name: "pyro_solver",
    node_category: "DOP",
    houdini_version: "20.5",
    semantic_name_zh: "烟火解算器",
    semantic_name_en: "Pyro Simulation Solver",
    one_line: "The core solver for all smoke, fire, and explosion simulations in Houdini DOPs",
    analogy: "Think of it as the physics engine specifically for gaseous phenomena — it handles how smoke drifts, fire burns, and explosions expand through space",
    prerequisite_nodes: ["smoke_object", "source_volume"],
    required_context: "DOP",
    typical_network: "DOP Network → Smoke Object → Pyro Solver → (optional: Gas Resize, Gas Turbulence, source_volume merges)",
    annotation_yaml: "{}",
    source_urls: ["https://www.sidefx.com/docs/houdini/nodes/dop/pyrosolver.html"],
    annotated_at: new Date().toISOString(),
    annotation_model: "human-verified-seed",
    human_verified: true,
    confidence_score: 1.0,
  });

  // Key Pyro Solver parameters
  const pyroParams = [
    {
      param_name: "dissipation",
      param_path: "pyrosolver1/flameSolver/dissipation",
      semantic_name_zh: "烟雾消散速度",
      semantic_name_en: "Smoke Dissipation Rate",
      one_line: "Controls how quickly smoke density fades over time",
      intent_mapping: {
        "smoke lingers longer": "decrease dissipation",
        "smoke disappears faster": "increase dissipation",
        "thicker smoke": "decrease dissipation + increase density",
        "thin wispy smoke": "increase dissipation",
      },
      default_value: 0.1,
      safe_range_min: 0.01,
      safe_range_max: 0.5,
      expert_range_min: 0.001,
      expert_range_max: 1.0,
      danger_below: 0.001,
      danger_above: 1.0,
      danger_description: "Below 0.001: smoke never disappears, fills entire container. Above 1.0: smoke vanishes almost instantly.",
      visual_effect: {
        "0.01": "Dense, persistent fog that barely fades",
        "0.05": "Slow, realistic indoor smoke behavior",
        "0.1": "Default — moderate fade, good for general use",
        "0.3": "Fast-fading wispy smoke",
        "0.5": "Very quick fade, smoke barely visible after source stops",
      },
      interactions: [
        { param: "cooling_rate", relationship: "Both reduce density over time; high dissipation + high cooling = very fast fade", warning: "Don't max both unless you want smoke to vanish in 2-3 frames" },
        { param: "turbulence", relationship: "Turbulence spreads smoke, making dissipation less noticeable", tip: "High turbulence + low dissipation = large persistent smoke cloud" },
        { param: "buoyancy", relationship: "Buoyancy moves smoke up; combined with dissipation, smoke may thin out before rising fully" },
      ],
      context_adjustments: {
        "indoor": "Use 0.01-0.05 (enclosed spaces trap smoke)",
        "outdoor": "Use 0.05-0.2 (wind and open air dissipate faster)",
        "large_scale": "Use 0.02-0.1 (large volumes need slower dissipation)",
        "stylized": "Use 0.2-0.5 (faster fade for cleaner look)",
      },
      human_verified: true,
      confidence_score: 1.0,
    },
    {
      param_name: "cooling_rate",
      param_path: "pyrosolver1/flameSolver/coolingRate",
      semantic_name_zh: "冷却速率",
      semantic_name_en: "Fire Cooling Rate",
      one_line: "How quickly the temperature field decreases, affecting fire visibility and buoyancy",
      intent_mapping: {
        "fire burns longer": "decrease cooling_rate",
        "fire dies quickly": "increase cooling_rate",
        "taller flames": "decrease cooling_rate + increase buoyancy",
        "short intense burst": "increase cooling_rate",
      },
      default_value: 0.3,
      safe_range_min: 0.05,
      safe_range_max: 0.5,
      expert_range_min: 0.01,
      expert_range_max: 1.0,
      danger_below: 0.01,
      danger_above: 1.0,
      danger_description: "Below 0.01: temperature never drops, eternal fire. Above 1.0: fire cools before it can render visibly.",
      visual_effect: {
        "0.05": "Long-lasting flames, fire persists far from source",
        "0.15": "Moderate flame duration, good for explosions",
        "0.3": "Default — balanced fire behavior",
        "0.5": "Quick fire, only visible near the source",
        "0.8": "Very brief flash, barely visible flames",
      },
      interactions: [
        { param: "dissipation", relationship: "Cooling removes temperature while dissipation removes density; they compound", warning: "Both high = nothing visible after a few frames" },
        { param: "buoyancy", relationship: "Buoyancy driven by temperature; faster cooling = less rise", tip: "Low cooling + high buoyancy = tall rising fire column" },
      ],
      context_adjustments: {
        "indoor": "0.1-0.2 (fire cools slower in enclosed spaces)",
        "outdoor": "0.2-0.4 (default range works well)",
        "explosion": "0.1-0.2 (let the explosion bloom before cooling)",
        "candle": "0.3-0.5 (small, steady flame)",
      },
      human_verified: true,
      confidence_score: 1.0,
    },
    {
      param_name: "turbulence",
      param_path: "pyrosolver1/flameSolver/turbulence",
      semantic_name_zh: "湍流强度",
      semantic_name_en: "Turbulence Intensity",
      one_line: "Controls the chaotic motion injected into the velocity field, creating swirling, organic smoke behavior",
      intent_mapping: {
        "more chaotic smoke": "increase turbulence",
        "smoother smoke": "decrease turbulence",
        "swirling patterns": "increase turbulence + lower dissipation",
        "calm rising smoke": "decrease turbulence to near zero",
      },
      default_value: 0.5,
      safe_range_min: 0.0,
      safe_range_max: 1.5,
      expert_range_min: 0.0,
      expert_range_max: 3.0,
      danger_below: undefined,
      danger_above: 3.0,
      danger_description: "Above 3.0: smoke becomes extremely noisy and unrealistic, may cause solver instability",
      visual_effect: {
        "0.0": "Perfectly smooth, laminar flow — unrealistic but clean",
        "0.3": "Gentle organic motion, good for calm scenes",
        "0.5": "Default — moderate turbulence",
        "0.8": "Clearly chaotic, good for explosions",
        "1.5": "Very turbulent, dramatic swirling",
      },
      interactions: [
        { param: "dissipation", relationship: "Turbulence spreads smoke, counteracting dissipation", tip: "High turbulence keeps smoke visible longer by spreading it" },
        { param: "confinement", relationship: "Confinement counteracts turbulence diffusion, keeping structures tight" },
        { param: "disturbance", relationship: "Both add variation; turbulence is velocity-based, disturbance is density-based" },
      ],
      context_adjustments: {
        "explosion": "0.6-1.2 (chaotic, energetic)",
        "campfire": "0.2-0.4 (gentle flickering)",
        "indoor smoke": "0.1-0.3 (calm drift)",
        "volcanic": "0.5-0.8 (large-scale turbulence)",
      },
      human_verified: true,
      confidence_score: 1.0,
    },
    {
      param_name: "buoyancy_lift",
      param_path: "pyrosolver1/Forces/buoyancyLift",
      semantic_name_zh: "浮力强度",
      semantic_name_en: "Buoyancy Lift Force",
      one_line: "Upward force applied to hot gas, making smoke and fire rise",
      intent_mapping: {
        "smoke rises faster": "increase buoyancy",
        "smoke stays low": "decrease buoyancy (try 0.0-0.3)",
        "mushroom cloud": "high buoyancy + burst source",
        "ground-hugging fog": "zero or negative buoyancy",
      },
      default_value: 1.0,
      safe_range_min: 0.0,
      safe_range_max: 3.0,
      expert_range_min: -1.0,
      expert_range_max: 5.0,
      danger_below: undefined,
      danger_above: 5.0,
      danger_description: "Above 5.0: smoke rockets upward unrealistically fast",
      visual_effect: {
        "0.0": "Smoke drifts only from initial velocity, no rise",
        "0.5": "Gentle upward drift",
        "1.0": "Default — natural hot gas rising behavior",
        "2.0": "Strong upward column",
        "3.0": "Very aggressive rise, good for volcanic plumes",
      },
      interactions: [
        { param: "cooling_rate", relationship: "Buoyancy is driven by temperature; fast cooling reduces buoyancy effect over time" },
        { param: "turbulence", relationship: "Turbulence disrupts the buoyancy column, creating billowing rather than straight rise" },
      ],
      context_adjustments: {
        "indoor": "0.5-1.0 (ceiling will catch the smoke anyway)",
        "outdoor": "1.0-2.0 (smoke needs to rise visibly in open air)",
        "fog": "0.0-0.1 (fog stays low)",
        "explosion": "1.0-2.0 (strong initial rise, then turbulence takes over)",
      },
      human_verified: true,
      confidence_score: 1.0,
    },
  ];

  for (const param of pyroParams) {
    kb.upsertParameterAnnotation(param);
  }

  // Seed key recipes
  kb.upsertRecipe({
    name: "Realistic Indoor Explosion",
    system: "pyro",
    tags: ["indoor", "explosion", "realistic", "medium-scale"],
    description: "Dense initial burst with slow dissipation in enclosed space",
    prerequisites: [
      "Closed collision geometry with inward-facing normals",
      "Source volume for initial fuel",
      "At least 3 substeps for stability",
    ],
    parameters: {
      pyro_solver: { dissipation: 0.02, cooling_rate: 0.15, turbulence: 0.8 },
      smoke_object: { division_size: 0.02 },
      source_volume: { fuel_amount: 1.5, temperature: 2.0 },
      dop_network: { substeps: 4 },
    },
    warnings: [
      "Low dissipation + enclosed space = very dense smoke; increase to 0.04 if too opaque",
      "Ensure collision normals point inward for containment",
      "High turbulence can push smoke through thin walls",
    ],
    variations: {
      smaller_room: { dissipation: 0.01, turbulence: 0.6 },
      more_dramatic: { turbulence: 1.2, fuel_amount: 2.0, temperature: 3.0 },
    },
  });

  kb.upsertRecipe({
    name: "Outdoor Campfire",
    system: "pyro",
    tags: ["outdoor", "fire", "realistic", "small-scale", "continuous"],
    description: "Steady burning flame with gentle smoke rising",
    prerequisites: [
      "Source geometry (logs/emitter shape)",
      "Continuous emission source",
    ],
    parameters: {
      pyro_solver: { dissipation: 0.1, cooling_rate: 0.3, turbulence: 0.3, buoyancy_lift: 1.2 },
      source_volume: { fuel_amount: 0.5, temperature: 1.5 },
    },
    warnings: [
      "Outdoor sims need larger containers — smoke rises and spreads",
    ],
  });

  kb.upsertRecipe({
    name: "Stylized Magic Smoke",
    system: "pyro",
    tags: ["stylized", "magic", "smoke", "art-directed"],
    description: "Thick swirling colorful smoke for fantasy effects",
    prerequisites: [
      "Point or curve source for directional emission",
    ],
    parameters: {
      pyro_solver: { dissipation: 0.05, cooling_rate: 0.05, turbulence: 1.2, buoyancy_lift: 0.3, confinement: 0.5 },
      smoke_object: { division_size: 0.015 },
      source_volume: { fuel_amount: 0.8, temperature: 1.0 },
    },
    warnings: [
      "Low buoyancy keeps the smoke floating rather than rising fast",
    ],
  });

  // Seed key error patterns
  kb.upsertErrorPattern({
    pattern_id: "PYRO-001",
    system: "pyro",
    severity: "common",
    symptoms: [
      "simulation explodes at a specific frame",
      "values become NaN or infinity",
      "smoke grows uncontrollably then disappears",
    ],
    root_causes: [
      {
        cause: "Insufficient substeps for the simulation speed",
        probability: "high",
        explanation: "When forces are strong relative to voxel size, the solver can't resolve motion in a single step",
        fix: [
          "Increase substeps on the DOP network: 2 → 4 or higher",
          "Or reduce force magnitudes (buoyancy, turbulence)",
          "Check: pyrosolver > Advanced > Min/Max Substeps",
        ],
        verify: "Sim should stabilize at the previously exploding frame",
      },
      {
        cause: "Source emission too aggressive",
        probability: "medium",
        explanation: "A sudden burst of fuel/temperature creates forces the solver can't handle",
        fix: [
          "Reduce source temperature: try 1.0 instead of 5.0",
          "Smooth the source emission curve over multiple frames",
        ],
        verify: "First few frames should no longer spike",
      },
    ],
  });

  kb.upsertErrorPattern({
    pattern_id: "PYRO-002",
    system: "pyro",
    severity: "common",
    symptoms: [
      "smoke passes through walls",
      "smoke leaks through collision geometry",
      "collision works partially but not completely",
    ],
    root_causes: [
      {
        cause: "Collision geometry resolution too low",
        probability: "high",
        explanation: "Collision SDF resolution doesn't match sim voxel size",
        fix: [
          "Match collision division size to smoke division size or finer",
          "Static Object > Division Size ≤ Smoke Object > Division Size",
        ],
        verify: "Smoke should be properly contained by the collision surface",
      },
      {
        cause: "Collision normals incorrect",
        probability: "high",
        explanation: "Normals point the wrong direction for containment",
        fix: [
          "Check and fix normals (Reverse SOP if needed)",
          "For enclosed spaces, normals must point inward",
        ],
        verify: "Visualize normals on the collision geo to confirm direction",
      },
    ],
  });
}

function seedSmokeSolver(kb: KnowledgeBase): void {
  kb.upsertNodeAnnotation({
    node_name: "smoke_solver",
    node_category: "DOP",
    houdini_version: "20.5",
    semantic_name_zh: "烟雾解算器",
    semantic_name_en: "Smoke Simulation Solver",
    one_line: "Legacy smoke solver for pure smoke simulations without fire/combustion",
    analogy: "A simpler version of the Pyro Solver — handles only smoke (no fire). Like a fog machine simulator.",
    prerequisite_nodes: ["smoke_object"],
    required_context: "DOP",
    typical_network: "DOP Network → Smoke Object → Smoke Solver → Source merges",
    annotation_yaml: "{}",
    source_urls: ["https://www.sidefx.com/docs/houdini/nodes/dop/smokesolver.html"],
    annotated_at: new Date().toISOString(),
    annotation_model: "human-verified-seed",
    human_verified: true,
    confidence_score: 0.9,
  });
}

function seedVoronoiFracture(kb: KnowledgeBase): void {
  kb.upsertNodeAnnotation({
    node_name: "voronoi_fracture",
    node_category: "SOP",
    houdini_version: "20.5",
    semantic_name_zh: "泰森多边形碎裂",
    semantic_name_en: "Voronoi Fracture (Pre-Fracture Tool)",
    one_line: "Breaks geometry into pieces using Voronoi cell division, typically used before RBD simulation",
    analogy: "Like dropping a plate — the fracture pattern depends on where and how hard it's hit. Voronoi controls the 'crack pattern' before the physics simulation runs.",
    prerequisite_nodes: ["scatter"],
    required_context: "SOP",
    typical_network: "Geometry → Scatter (fracture points) → Voronoi Fracture → Assemble → DOP Import",
    annotation_yaml: "{}",
    source_urls: ["https://www.sidefx.com/docs/houdini/nodes/sop/voronoifracture.html"],
    annotated_at: new Date().toISOString(),
    annotation_model: "human-verified-seed",
    human_verified: true,
    confidence_score: 0.95,
  });

  kb.upsertParameterAnnotation({
    param_name: "num_points",
    param_path: "voronoifracture1/numPoints",
    node_name: "voronoi_fracture",
    semantic_name_zh: "碎片数量",
    semantic_name_en: "Number of Fracture Pieces",
    one_line: "Controls how many pieces the object breaks into",
    intent_mapping: {
      "more pieces": "increase num_points",
      "fewer larger chunks": "decrease num_points",
      "fine shatter (glass)": "200-500 points",
      "chunky break (concrete)": "20-50 points",
    },
    default_value: 10,
    safe_range_min: 5,
    safe_range_max: 500,
    expert_range_min: 1,
    expert_range_max: 5000,
    danger_below: undefined,
    danger_above: 5000,
    danger_description: "Above 5000: extremely slow to compute and simulate, massive memory usage",
    visual_effect: {
      "10": "Very coarse breakup, large pieces",
      "50": "Medium breakup, good for concrete/stone",
      "200": "Fine breakup, good for glass",
      "500": "Very fine shatter, tiny pieces",
    },
    interactions: [
      { param: "cluster_size", relationship: "Clustering groups small pieces into larger chunks", tip: "High num_points + clustering = detail where needed, efficiency elsewhere" },
    ],
    context_adjustments: {
      "glass": "200-500 (fine shatter pattern)",
      "concrete": "30-80 (chunky pieces)",
      "rock": "20-50 (irregular large chunks)",
      "wood": "10-30 (long splinters, use directional noise)",
    },
    human_verified: true,
    confidence_score: 1.0,
  });
}

function seedFlipSolver(kb: KnowledgeBase): void {
  kb.upsertNodeAnnotation({
    node_name: "flip_solver",
    node_category: "DOP",
    houdini_version: "20.5",
    semantic_name_zh: "FLIP流体解算器",
    semantic_name_en: "FLIP Fluid Solver",
    one_line: "Particle-based fluid solver for realistic water, lava, honey, and other liquid simulations",
    analogy: "Simulates fluid by tracking millions of tiny particles that carry velocity through a grid — like tracking individual water droplets to simulate a whole ocean wave",
    prerequisite_nodes: ["flip_object"],
    required_context: "DOP",
    typical_network: "DOP Network → FLIP Object → FLIP Solver → (optional: Whitewater, Volume Source)",
    annotation_yaml: "{}",
    source_urls: ["https://www.sidefx.com/docs/houdini/nodes/dop/flipsolver.html"],
    annotated_at: new Date().toISOString(),
    annotation_model: "human-verified-seed",
    human_verified: true,
    confidence_score: 0.95,
  });

  kb.upsertParameterAnnotation({
    param_name: "particle_separation",
    param_path: "flipsolver1/particleSeparation",
    node_name: "flip_solver",
    semantic_name_zh: "粒子间距",
    semantic_name_en: "Particle Separation Distance",
    one_line: "The spacing between fluid particles — smaller = more detail but exponentially more expensive",
    intent_mapping: {
      "more detail": "decrease particle_separation",
      "faster sim": "increase particle_separation",
      "smoother surface": "decrease particle_separation",
      "test resolution": "use 2-3x final value for preview",
    },
    default_value: 0.05,
    safe_range_min: 0.01,
    safe_range_max: 0.2,
    expert_range_min: 0.002,
    expert_range_max: 0.5,
    danger_below: 0.002,
    danger_above: 0.5,
    danger_description: "Below 0.002: billions of particles, memory exhaustion. Above 0.5: fluid looks blobby and unrealistic.",
    visual_effect: {
      "0.01": "Very fine detail, splashes and thin sheets visible",
      "0.03": "Good production quality for close-up shots",
      "0.05": "Default — reasonable detail for medium shots",
      "0.1": "Coarse preview, fast iteration",
      "0.2": "Very coarse, only for blocking and layout",
    },
    interactions: [
      { param: "grid_scale", relationship: "Grid resolution = particle_separation × grid_scale", tip: "grid_scale of 2.0 is standard; lower for more accurate pressure solve" },
      { param: "substeps", relationship: "Finer particles with fast motion need more substeps", warning: "Reducing particle_separation without increasing substeps can cause instability" },
    ],
    context_adjustments: {
      "ocean": "0.05-0.2 (large scale, coarser is fine)",
      "pouring liquid": "0.002-0.01 (small scale needs fine detail)",
      "destruction flood": "0.05-0.1 (balance detail vs. volume)",
      "test/preview": "2-3x final value (iterate fast, refine later)",
    },
    human_verified: true,
    confidence_score: 1.0,
  });
}

// ── Main ───────────────────────────────────────────────────

export async function seedDatabase(dbPath?: string): Promise<void> {
  const kb = await initDatabase(dbPath);

  console.log("[seed] Seeding Pyro Solver...");
  seedPyroSolver(kb);

  console.log("[seed] Seeding Smoke Solver...");
  seedSmokeSolver(kb);

  console.log("[seed] Seeding Voronoi Fracture...");
  seedVoronoiFracture(kb);

  console.log("[seed] Seeding FLIP Solver...");
  seedFlipSolver(kb);

  console.log("[seed] Done. Seeded core nodes with human-verified annotations.");

  // Print coverage
  const report = kb.getCoverageReport();
  for (const row of report) {
    console.log(
      `  ${row.system}: ${row.annotated_nodes} nodes, ${row.annotated_params} params, ${row.verified_nodes} verified`,
    );
  }

  kb.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf("--db");
  const dbPath = dbIdx !== -1 ? args[dbIdx + 1] : undefined;

  seedDatabase(dbPath).catch((err) => {
    console.error("[seed] Fatal:", (err as Error).message);
    process.exit(1);
  });
}
