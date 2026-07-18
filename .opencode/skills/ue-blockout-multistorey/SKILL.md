---
name: ue-blockout-multistorey
description: Use when the user wants a UE Editor Python blockout/graybox for a multi-storey building (basement/ground/upper floors) with correct wall rotation/height, doors+windows, stairs, roof, and simple materials, especially when bugs like "basement became a ceiling" or "walls all face one way" appear. Produces a runnable build .py under ue_scripts/ plus a companion *_undo.py that deletes everything spawned by that build script.
---

# UE Multi-Storey Blockout (Python Script Generator)

## When To Use

Use ONLY when the user asks for a blockout / graybox / “quick environment build” of a multi-storey building in Unreal Editor using Python, especially when:

1. A basement/upper storey is missing because Z placement is wrong (looks like a ceiling).
1. Wall pieces are one-sided or all facing the same direction.
1. The user asks for PCG-based generation ("PCG", "PCG graph", "procedural building") or wants fast regeneration/iteration.

## Output Contract

Produce:

1. A Unreal Editor Python build script suitable for `Tools -> Execute Python Script...`, usually saved under `ue_scripts/<name>.py`.
1. A companion undo script suitable for `Tools -> Execute Python Script...`, usually saved under `ue_scripts/<name>_undo.py`.

The undo script must delete only what the build script spawned (see `RUN_ID` requirement below).

The generated script must:

1. Be parameterized at the top (dimensions, storey heights, footprint).
1. Create **storeys** (basement + ground by default) as slabs and walls.
1. Place geometry using **pivot-safe Z alignment** so floors land where expected.
1. Compute per-wall rotations so walls face outward consistently.
1. Ensure wall height is **exactly between floors** (no “too tall” walls).
1. Create openings for at least:
Doorway on the front wall and a doorway between major rooms.
Windows on at least two exterior walls.
1. Add a basic staircase between basement and ground:
Generate visible steps and also include a simple ramp-like collision path (brush ramp if available; otherwise a hidden stair collider).
1. Add a simple roof (flat slab or basic gable).
1. Apply reasonable materials/textures to slabs, walls, roof (use StarterContent if present; fall back safely).
1. Include an optional `REBUILD_CLEAN` prefix-delete mode.
1. Add a few debug markers (labels/tags) so a user can quickly locate each storey.
1. Define a `RUN_ID` constant (string) and tag every spawned actor with a run-id tag so the undo script can delete exactly what was added by this generated script.

### Undo Script Requirement (New)

Alongside the build script, generate `ue_scripts/<name>_undo.py`.

Rules:

1. The build script must define `RUN_ID = "..."` near the top.
1. The build script must tag each spawned actor with something like:
`OPENCODE_RUN_ID_<RUN_ID>` (simple tag string) or `OPENCODE_RUN_ID` plus a value-like tag.
Prefer the simple single tag string form because `Actor.tags` is an array of `Name`.
1. The undo script must contain the exact same `RUN_ID` constant and delete actors by that tag first.
1. The undo script may also support deleting by `PREFIX`/`FOLDER_ROOT` as a fallback, but the primary mode must be run-id targeted so it only removes what was added by that generated build script.
1. The undo script must also remove any World Outliner folders the build script created (typically everything under `FOLDER_ROOT`). Do this after deleting actors.
   If a direct folder-delete API is unavailable in the current UE Python surface, log a clear message that folders could not be removed automatically.
1. Both scripts should log what they did and how many actors were affected.

## PCG-First Requirement (New)

The generator must prefer PCG **when available**:

1. Detect whether the PCG plugin is available in the current editor Python environment.
Suggested check: `hasattr(unreal, "PCGGraph") and hasattr(unreal, "PCGComponent")`.
2. If PCG is available, build the blockout using a `PCGGraph` + `PCGComponent` (typically on a `PCGVolume`), and call `pcg_component.generate(True)`.
3. If PCG is not available, fall back to the explicit algorithmic spawn approach.

Minimum bar: when PCG is available, use it for at least one repeated system (stairs steps OR window placement OR floor tiling), not just a single dummy node.

Why: users want quick iterative regeneration without hand-maintaining hundreds of spawned actors.

### PCG Python API Evidence (UE 5.6)

The Unreal Python API includes PCG classes (plugin: PCG), including:

1. `unreal.PCGGraph` (can `add_node_of_type`, `add_edge`).
Doc: `https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PCGGraph?application_version=5.6`
2. `unreal.PCGComponent` (can `set_graph`, `generate`).
Doc: `https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PCGComponent?application_version=5.6`
3. `unreal.PCGVolume` (owns a `pcg_component`).
Doc: `https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PCGVolume?application_version=5.6`
4. Common node settings:
`unreal.PCGCreatePointsGridSettings`, `unreal.PCGTransformPointsSettings`, `unreal.PCGStaticMeshSpawnerSettings`.

### PCG Graph Building Rules (Do Not Guess Pin Names)

Pin labels differ across nodes and versions. Do not hardcode strings like "In"/"Out".

Instead:

1. Use `PCGNode.input_pins` / `PCGNode.output_pins`.
Doc: `https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PCGNode?application_version=5.6`
2. Read `pin.properties.label` from each `PCGPin`.
Doc: `https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PCGPinProperties?application_version=5.6`
3. Wire edges using the discovered labels.

### PCG Strategy For Buildings (Pragmatic)

Use PCG to generate the high-count/repeated elements and keep the few “hero” primitives explicit.

Recommended split:

1. Slabs (basement/ground/roof): explicit cube slabs (few actors) OR PCG spawner with 1 point.
2. Walls: explicit algorithmic segments OR PCG spawner fed by a point set.
3. Windows: PCG grid/spacing on exterior edges, filtered by edge selection.
4. Stairs: PCG step generator (points along a ramp line) + one simplified collision ramp/volume.

If feeding custom points into PCG is needed:

1. Create `unreal.PCGPoint` structs and store them in `unreal.PCGPointData.set_points(...)`.
Doc: `https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PCGPointData?application_version=5.6`
2. Package them in a `unreal.PCGDataCollection` via `add_to_collection(...)`.
Doc: `https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PCGDataCollection?application_version=5.6`
3. Prefer nodes that can consume point data directly; if too brittle, fall back to explicit spawning.

## First Questions (Ask These, Then Generate)

Ask the minimum required to avoid guessing:

1. Target level name (for `_ensure_level_open`).
1. Footprint: rectangle (width/depth) or an explicit polygon (list of XY points in cm).
1. Storeys: which storeys exist and their heights.
1. Mesh strategy:
`SM_Cube` (recommended for correct “two-sided” blockout walls) or StarterContent `Architecture/*` pieces.
1. Wall thickness and slab thickness (even for cube-based blockout).
1. Do they want a roof slab/ceiling?
1. Openings: where is the front door; how many windows (or “auto-place evenly”).
1. Stair location (preferred wall/room) and direction (up along +X/+Y is fine).

If the user gives partial info, default to:

1. Units: cm, Z-up.
1. Basement (floor at `-FLOOR_TO_FLOOR`) + Ground (floor at `0`).
1. `SM_Cube` for slabs/walls.
1. Auto-place one front door on the “front” edge and 2-4 windows on other exterior edges.
1. Place stairs near the divider wall or a corner that doesn’t intersect the front door.

## Geometry Rules That Prevent The Two Reported Bugs

### 1) Basement vs Ceiling: pivot-safe Z

The most common reason a basement “doesn’t appear” is that meshes are placed using their pivot incorrectly (e.g., pivot at center, but you treat it as bottom), so the slab/walls end up intersecting the ground floor or reading as a ceiling.

In the generated script, do **not** hardcode “z = storey_floor_z” unless you explicitly account for the mesh’s bounds.

Preferred approach for blockout reliability:

1. Use `Engine/BasicShapes/Cube.Cube` for slabs and walls.
1. Scale it to the required dimensions.
1. Place it so the slab’s **top** is exactly at the intended elevation (or bottom, but be consistent).

### 1b) Wall Height: stop at the next floor

The most common “walls are too long” failure is mixing storey heights with slab thickness.

In the generated script, define explicit per-storey Zs:

1. `FLOOR_TOP_Z["Basement"]`, `FLOOR_TOP_Z["Ground"]`, ...
1. `WALL_HEIGHT["Basement"] = FLOOR_TOP_Z["Ground"] - FLOOR_TOP_Z["Basement"]`

Then place walls with pivot-safe Z:

1. `wall_center_z = floor_top_z + (wall_height * 0.5)`

If you also place slabs, ensure the slab’s top is at `floor_top_z`.

If you must use modular StarterContent pieces, add a small helper that can offset Z based on `EditorStaticMeshLibrary.get_bounding_box(mesh)` so you can align bottom/top deterministically.

### 2) Wall facing: compute rotation per segment, and handle outward normal

If wall meshes are one-sided (or have a “front” direction), you need consistent facing.

Generate walls from a footprint polyline:

1. Build edges: `[(p0,p1), (p1,p2), ...]` and close the loop.
1. Compute polygon winding in XY:
`signed_area = sum((x2-x1)*(y2+y1))` or any standard shoelace-based sign.
1. For each edge, compute direction `d = (p1 - p0)`.
1. Compute yaw from direction: `yaw = degrees(atan2(d.y, d.x))`.
1. Decide “outward” side based on winding:
For a CCW polygon, interior is left-of-edge, outward is right-of-edge.
For a CW polygon, interior is right-of-edge, outward is left-of-edge.
1. Apply a consistent axis convention:
Assume the wall mesh’s **length axis** is +X, and its “front face” points +Y (common for plane-like pieces). If that’s wrong for the chosen mesh, add a single `WALL_YAW_OFFSET_DEG` and possibly a `WALL_FLIP_180` boolean.

The generated script must expose these as top-level constants so the user can correct mesh-specific conventions without rewriting logic.

### 3) Openings: doors and windows (cube-based, robust)

If using cubes, do not “boolean” cut meshes. Instead, generate openings by spawning multiple wall pieces around voids.

Recommended data model:

1. `DOORS = [{"edge": "front", "t": 0.5, "width": 120, "height": 210}]`
1. `WINDOWS = [{"edge": "left", "t": 0.33, "width": 120, "sill": 90, "height": 120}, ...]`

Implementation rule:

1. Split the edge into segments left/right of the opening width.
1. For a door: spawn side pieces (full height) and a lintel piece above `door_height`.
1. For a window: spawn lower wall (floor -> sill), upper wall (sill+height -> ceiling), and side jambs.

If using StarterContent modular walls, prefer:

1. `Wall_Door_400x300` for doors.
1. `Wall_Window_400x300` for windows.

But keep rotation conventions adjustable via offsets.

### 4) Stairs: visible steps + simple collision path

Stairs are required in the blockout.

Preferred (when available in Python): use brush builders for reliability:

1. `LinearStairBuilder` (for visible steps) and optionally a ramp-like `BlockingVolume` if a ramp builder exists.

Fallback (always works): generate steps from cubes:

1. `N_STEPS = floor_to_floor / step_rise`.
1. Each step is a cube scaled to `step_run x stair_width x step_rise`.

For the “ramp collision volume” requirement:

1. If you cannot create a real ramp brush, spawn a hidden simplified collider (e.g. a single stair-shaped stack or low-res steps) and set it to BlockAll.

## Script Structure (What To Generate)

Generate a script with:

1. `PREFIX`, `FOLDER_ROOT`, `REBUILD_CLEAN`.
1. `RUN_ID` and `RUN_TAG` (derived from `RUN_ID`).
1. `_ensure_level_open`, `_load`, `_spawn_static_mesh_actor`, `_delete_existing_with_prefix`.
1. A small helper like `_tag_spawned(actor)` that adds `RUN_TAG` and any other useful tags.
1. Math helpers:
`_deg_atan2`, `_poly_signed_area_xy`, `_wall_rot_for_edge`.
1. Build functions:
`spawn_slab(storey_name, ...)`, `spawn_walls_for_storey(storey_name, z0, height, ...)`.
1. Opening helpers:
`split_edge_for_opening(...)`, `spawn_door_opening(...)`, `spawn_window_opening(...)`.
1. Stairs helpers:
`spawn_stairs_steps(...)` (and `spawn_stairs_ramp_collider(...)` if possible).
1. `build_blockout()` entry point.

Also generate a separate undo script with:

1. The same `RUN_ID`, `RUN_TAG`, `PREFIX`, `FOLDER_ROOT` constants.
1. `_delete_existing_with_run_tag()` that finds actors with `RUN_TAG` and deletes them via `EditorActorSubsystem`.
1. `_delete_created_folders()` that best-effort removes empty World Outliner folders under `FOLDER_ROOT` after actor deletion.
1. An `undo()` entry point that logs a count and can be run standalone.

### PCG Script Additions (When PCG Is Available)

If PCG is available, the script should also include:

1. `_pcg_available()` and `_ensure_pcg_plugin_enabled_or_fallback()`.
2. `create_or_update_pcg_graph(asset_path, params)`:
Create a `PCGGraph` asset (or reuse if already exists).
Add nodes (grid/transform/spawner) and edges using pin introspection.
3. `spawn_pcg_volume(bounds, graph_asset)`:
Spawn a `PCGVolume`, assign the graph to its `pcg_component`, set generation trigger to OnDemand, then `generate(True)`.
4. A fallback path: if any PCG step fails (missing classes/settings, graph edge wiring fails), log and use explicit spawning.

### Recommended mesh choices (robust)

Use these paths by default:

1. `CUBE = "/Engine/BasicShapes/Cube.Cube"`

Optional: allow switching to StarterContent if requested.

### Recommended subsystems (UE 5.6+)

Avoid deprecated `EditorLevelLibrary` and use Editor subsystems:

1. `unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()`
1. `unreal.get_editor_subsystem(unreal.EditorActorSubsystem)` for spawning/destroying actors.

### Materials / textures

Apply materials by default so the blockout reads:

1. Floor slab: a neutral concrete/tiles.
1. Walls: a plaster/concrete.
1. Roof: darker material.

If StarterContent is present, try common materials first (and fall back to `DefaultMaterial` if missing). Keep this robust with `try/except` and do not crash if a material path is absent.

## Minimal Verification Checklist (Include In The Script As Logs)

At the end of `build_blockout()` log:

1. Storey Z values used.
1. Footprint winding detected (CW/CCW).
1. A hint on how to locate basement: “Search Outliner for `<PREFIX>Debug_BasementCenter`”.
1. Wall height per storey and the computed “next floor” Z (to prove walls stop correctly).
1. Stair start/end Z and step count.

Also spawn an `EmptyActor` marker at each storey center:

1. `<PREFIX>Debug_BasementCenter` at `(center_x, center_y, basement_floor_z + 50)`
1. `<PREFIX>Debug_GroundCenter` at `(center_x, center_y, ground_floor_z + 50)`

Note: In UE Python, `unreal.EmptyActor` may not be exposed. Prefer `unreal.TargetPoint` (or another simple Actor class) for debug markers.

## Example Prompt The Assistant Should Follow

When this skill is loaded, the assistant should behave like:

1. Ask the “First Questions” (only what’s missing).
1. Generate/update the build script and the companion undo script under `ue_scripts/` with the contract above.
1. Keep it runnable and self-contained.

## Notes For The Two Specific Failures Mentioned By Users

If the user reports:

1. “I get ground floor and ceiling, not basement.”
Treat it as a placement/pivot visibility problem first:
Ensure basement Z is negative enough (e.g. `-300` is only 3m), add debug marker, and align slabs by top/bottom using bounds.

1. “Walls face one way.”
Treat it as an orientation convention issue:
Fix per-edge yaw and expose `WALL_YAW_OFFSET_DEG` / `WALL_FLIP_180` so the mesh’s front face can be corrected quickly.
