"""Scenario01Fire: regenerate the environment blockout (UE 5.6 Editor Python).

Source of truth:
- D:/UnrealHelper/story/Scenario01Fire/scene_plan.md

Run in Unreal Editor:
1. Open level: /Game/Scenario01Fire
2. Tools -> Execute Python Script... -> select this file

Goals from the scene plan:
- One-storey house with living room sitting over a basement fire pocket.
- Sound-first: basement roar is muffled pre-collapse ("acoustic baffle"), then opens up on collapse.
- "Mismatch" cues: visible kitchen fire, but the living room is hotter; water has little effect.
- Instability cues: mild rumble/prop jitter, then a distinct floor give, then collapse payoff.

Notes:
 - This script builds reliable, pivot-safe blockout geometry using Engine Cube meshes.
 - It spawns tagged markers/placeholder actors for later Sequencer, audio occlusion,
   shake/jitter, and the custom floor-failure system.
 - Undo: run `ue_scripts/scenario01_fire_build_env_undo.py` (deletes all actors with prefix `S01_`).
"""

import math
import unreal


# -----------------------
# Parameters (cm, Z-up)
# -----------------------

EXPECTED_LEVEL_NAME = "Scenario01Fire"

PREFIX = "S01_"
FOLDER_ROOT = "Scenario01Fire/Env"

REBUILD_CLEAN = True

# Footprint polygon (XY points, cm). Define CCW for sanity.
# Default: 16m x 12m rectangle centered at origin.
FOOTPRINT_XY = [
    (-800.0, -600.0),
    (800.0, -600.0),
    (800.0, 600.0),
    (-800.0, 600.0),
]

# Storey heights
GROUND_FLOOR_Z = 0.0
BASEMENT_FLOOR_Z = -350.0
GROUND_WALL_HEIGHT = 320.0
BASEMENT_WALL_HEIGHT = 320.0

# Construction thicknesses
SLAB_THICKNESS = 20.0
WALL_THICKNESS = 20.0

# Openings (simple: one front door opening and one interior opening)
FRONT_DOOR_WIDTH = 120.0
BACK_DOOR_WIDTH = 120.0
INTERIOR_OPENING_WIDTH = 140.0

# Living room zone: front half (min X to mid X). This drives collapse-floor tiling.
LIVING_ROOM_X_MAX = 0.0
FLOOR_TILE = 200.0  # tile size for collapse labeling

# Room centers (relative offsets from footprint center). "Front" is -X.
LIVING_ROOM_CENTER_OFFSET = (-350.0, 0.0)
KITCHEN_CENTER_OFFSET = (350.0, 0.0)

# Beat marker offsets (cm)
EXTERIOR_APPROACH_OFFSET = (-1050.0, 0.0)
FRONT_DOOR_OFFSET = (-800.0, 0.0)
THRESHOLD_OFFSET = (-740.0, 0.0)
EXTERIOR_AFTERMATH_OFFSET = (-1200.0, 150.0)
BACK_DOOR_OFFSET = (800.0, 0.0)

# Visual options
SPAWN_ROOF_SLAB = True
ROOF_OVERHANG = 20.0


# Assets
CUBE = "/Engine/BasicShapes/Cube.Cube"
FIRE_BP = "/Game/StarterContent/Blueprints/Blueprint_Effect_Fire"
FIRE_CUE = "/Game/StarterContent/Audio/Fire01_Cue.Fire01_Cue"
SMOKE_PS = "/Game/StarterContent/Particles/P_Smoke.P_Smoke"

# Optional StarterContent materials (best-effort; if missing we keep default).
M_WALL = "/Game/StarterContent/Materials/M_Brick_Clay_New.M_Brick_Clay_New"
M_FLOOR = "/Game/StarterContent/Materials/M_Wood_Oak.M_Wood_Oak"
M_ROOF = "/Game/StarterContent/Materials/M_Roof_Shingle.M_Roof_Shingle"


def _log(msg: str) -> None:
    unreal.log(f"[Scenario01Fire] {msg}")


def _editor_subsystems():
    editor = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    if not editor or not actors:
        raise RuntimeError("Missing required Unreal editor subsystems (UnrealEditorSubsystem / EditorActorSubsystem).")
    return editor, actors


def _world_name() -> str:
    editor, _actors = _editor_subsystems()
    world = editor.get_editor_world()
    return world.get_name() if world else "<no-world>"


def _ensure_level_open(expected_world_name: str) -> None:
    if _world_name() != expected_world_name:
        raise RuntimeError(
            f"Expected level '{expected_world_name}' to be open, but active world is '{_world_name()}'."
        )


def _load(asset_path: str):
    asset = unreal.load_asset(asset_path)
    if not asset:
        raise RuntimeError(f"Failed to load asset: {asset_path}")
    return asset


def _try_load(asset_path: str):
    try:
        return unreal.load_asset(asset_path)
    except Exception:
        return None


def _deg_atan2(y: float, x: float) -> float:
    return math.degrees(math.atan2(y, x))


def _poly_signed_area_xy(pts):
    # Shoelace; sign indicates winding (CCW positive).
    area2 = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        area2 += (x1 * y2) - (x2 * y1)
    return area2 * 0.5


def _poly_center_xy(pts):
    sx = 0.0
    sy = 0.0
    for x, y in pts:
        sx += x
        sy += y
    n = max(1, len(pts))
    return (sx / n, sy / n)


def _edges(pts):
    for i in range(len(pts)):
        yield pts[i], pts[(i + 1) % len(pts)]


def _normalize2(x: float, y: float):
    l = math.sqrt((x * x) + (y * y))
    if l <= 1e-6:
        return (0.0, 0.0)
    return (x / l, y / l)


def _spawn_static_mesh_actor(label: str, mesh_path: str, loc, rot=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0), tags=None, folder=FOLDER_ROOT):
    mesh = _load(mesh_path)
    _editor, actors = _editor_subsystems()
    actor = actors.spawn_actor_from_object(
        mesh,
        unreal.Vector(*loc),
        unreal.Rotator(*rot),
    )
    if not actor:
        raise RuntimeError(f"Failed to spawn mesh actor: {label}")

    actor.set_actor_label(label, mark_dirty=True)
    actor.set_actor_scale3d(unreal.Vector(*scale))
    try:
        actor.set_folder_path(folder)
    except Exception:
        pass
    if tags:
        actor.set_editor_property("tags", [unreal.Name(t) for t in tags])
    return actor


def _try_set_material(actor, material_path: str, slot_index: int = 0) -> None:
    if not actor or not material_path:
        return
    mat = _try_load(material_path)
    if not mat:
        return
    try:
        smc = actor.get_component_by_class(unreal.StaticMeshComponent)
        if smc:
            smc.set_material(slot_index, mat)
    except Exception:
        pass


def _spawn_class(label: str, cls, loc, rot=(0.0, 0.0, 0.0), tags=None, folder=FOLDER_ROOT):
    _editor, actors = _editor_subsystems()
    actor = actors.spawn_actor_from_class(
        cls,
        unreal.Vector(*loc),
        unreal.Rotator(*rot),
    )
    if not actor:
        raise RuntimeError(f"Failed to spawn actor: {label}")
    actor.set_actor_label(label, mark_dirty=True)
    try:
        actor.set_folder_path(folder)
    except Exception:
        pass
    if tags:
        actor.set_editor_property("tags", [unreal.Name(t) for t in tags])
    return actor


def _spawn_marker(label: str, loc, tags=None, folder=FOLDER_ROOT):
    return _spawn_class(label, unreal.TargetPoint, loc, tags=tags, folder=folder)


def _delete_existing_with_prefix(prefix: str) -> None:
    _editor, actors = _editor_subsystems()
    all_actors = actors.get_all_level_actors()
    to_delete = []
    for a in all_actors:
        try:
            if a.get_actor_label().startswith(prefix):
                to_delete.append(a)
        except Exception:
            continue
    if to_delete:
        # Destroy one-by-one for compatibility.
        for a in to_delete:
            try:
                actors.destroy_actor(a)
            except Exception:
                pass
        _log(f"Deleted {len(to_delete)} existing actors with prefix '{prefix}'.")


def _spawn_slab(label: str, pts_xy, top_z: float, thickness: float, overhang: float = 0.0, tags=None, folder=FOLDER_ROOT):
    xs = [p[0] for p in pts_xy]
    ys = [p[1] for p in pts_xy]
    xmin, xmax = min(xs) - overhang, max(xs) + overhang
    ymin, ymax = min(ys) - overhang, max(ys) + overhang

    w = max(1.0, xmax - xmin)
    d = max(1.0, ymax - ymin)
    cx = (xmin + xmax) * 0.5
    cy = (ymin + ymax) * 0.5

    # Engine Cube is 100cm. Place so slab top is exactly at top_z.
    loc_z = top_z - (thickness * 0.5)
    scale = (w / 100.0, d / 100.0, thickness / 100.0)
    return _spawn_static_mesh_actor(label, CUBE, (cx, cy, loc_z), scale=scale, tags=tags, folder=folder)


def _spawn_wall_segment(label: str, p0, p1, z0: float, height: float, thickness: float, outward_sign: float, tags=None, folder=FOLDER_ROOT):
    x0, y0 = p0
    x1, y1 = p1
    dx = x1 - x0
    dy = y1 - y0
    length = math.sqrt((dx * dx) + (dy * dy))
    if length <= 1e-3:
        return None

    ux, uy = _normalize2(dx, dy)

    # For CCW polygon, outward is right-of-edge => normal (uy, -ux)
    nx = uy * outward_sign
    ny = -ux * outward_sign

    mx = (x0 + x1) * 0.5
    my = (y0 + y1) * 0.5
    mz = z0 + (height * 0.5)

    # Offset so wall sits outside the footprint.
    mx += nx * (thickness * 0.5)
    my += ny * (thickness * 0.5)

    yaw = _deg_atan2(dy, dx)
    scale = (length / 100.0, thickness / 100.0, height / 100.0)
    return _spawn_static_mesh_actor(label, CUBE, (mx, my, mz), rot=(0.0, yaw, 0.0), scale=scale, tags=tags, folder=folder)


def _split_edge_for_opening(p0, p1, opening_center_t: float, opening_width: float):
    # Returns 0-2 segments along the edge, skipping the opening.
    x0, y0 = p0
    x1, y1 = p1
    dx = x1 - x0
    dy = y1 - y0
    length = math.sqrt((dx * dx) + (dy * dy))
    if length <= 1e-3:
        return []

    half = opening_width * 0.5
    t_center = max(0.0, min(1.0, opening_center_t))
    t0 = (t_center * length - half) / length
    t1 = (t_center * length + half) / length
    t0 = max(0.0, min(1.0, t0))
    t1 = max(0.0, min(1.0, t1))

    def lerp(t):
        return (x0 + dx * t, y0 + dy * t)

    segs = []
    if t0 > 0.02:
        segs.append((p0, lerp(t0)))
    if t1 < 0.98:
        segs.append((lerp(t1), p1))
    return segs


def _spawn_perimeter_walls(
    storey_name: str,
    pts_xy,
    z0: float,
    height: float,
    thickness: float,
    tags,
    folder,
    front_opening_width: float = 0.0,
    back_opening_width: float = 0.0,
):
    area = _poly_signed_area_xy(pts_xy)
    winding = "CCW" if area > 0.0 else "CW"
    outward_sign = 1.0 if winding == "CCW" else -1.0

    # Identify "front" edge as the one with smallest X at its midpoint.
    front_edge_idx = -1
    best_x = None

    # Identify "back" edge as the one with largest X at its midpoint.
    back_edge_idx = -1
    best_back_x = None
    edges_list = list(_edges(pts_xy))
    for idx, (p0, p1) in enumerate(edges_list):
        mx = (p0[0] + p1[0]) * 0.5
        if best_x is None or mx < best_x:
            best_x = mx
            front_edge_idx = idx
        if best_back_x is None or mx > best_back_x:
            best_back_x = mx
            back_edge_idx = idx

    for idx, (p0, p1) in enumerate(edges_list):
        segs = [(p0, p1)]
        if idx == front_edge_idx and front_opening_width > 0.0:
            segs = _split_edge_for_opening(p0, p1, opening_center_t=0.5, opening_width=front_opening_width)
        if idx == back_edge_idx and back_opening_width > 0.0:
            segs = _split_edge_for_opening(p0, p1, opening_center_t=0.5, opening_width=back_opening_width)

        for si, (a, b) in enumerate(segs):
            _spawn_wall_segment(
                f"{PREFIX}{storey_name}_Wall_{idx}_{si}",
                a,
                b,
                z0,
                height,
                thickness,
                outward_sign,
                tags=tags,
                folder=folder,
            )

    return winding


def _spawn_interior_divider(storey_name: str, pts_xy, z0: float, height: float, thickness: float, tags, folder):
    # A simple divider at X = (minX + maxX)/2, leaving a centered opening.
    xs = [p[0] for p in pts_xy]
    ys = [p[1] for p in pts_xy]
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)
    x_div = (xmin + xmax) * 0.5
    p0 = (x_div, ymin)
    p1 = (x_div, ymax)
    segs = _split_edge_for_opening(p0, p1, opening_center_t=0.5, opening_width=INTERIOR_OPENING_WIDTH)
    for si, (a, b) in enumerate(segs):
        # Use outward_sign=0 (no offset) for interior walls.
        _spawn_wall_segment(
            f"{PREFIX}{storey_name}_Interior_{si}",
            a,
            b,
            z0,
            height,
            thickness,
            outward_sign=0.0,
            tags=tags,
            folder=folder,
        )


def _try_set_audio_muffle(audio_component, enabled: bool, cutoff_hz: float) -> None:
    # Property names can differ between engine versions/projects; keep this best-effort.
    try:
        audio_component.set_editor_property("low_pass_filter_enabled", enabled)
        audio_component.set_editor_property("low_pass_filter_frequency", float(cutoff_hz))
    except Exception:
        pass


def _spawn_ambient_sound(label: str, loc, cue_path: str, volume: float, pitch: float = 1.0, muffled: bool = False, cutoff_hz: float = 1200.0, tags=None, folder=FOLDER_ROOT):
    cue = _try_load(cue_path)
    a = _spawn_class(label, unreal.AmbientSound, loc, tags=tags, folder=folder)
    try:
        ac = a.get_editor_property("audio_component")
        if cue:
            ac.set_editor_property("sound", cue)
        ac.set_editor_property("volume_multiplier", float(volume))
        ac.set_editor_property("pitch_multiplier", float(pitch))
        _try_set_audio_muffle(ac, enabled=muffled, cutoff_hz=cutoff_hz)
    except Exception:
        pass
    return a


def _try_set_audio_auto_activate(ambient_actor, enabled: bool) -> None:
    # AmbientSound owns an AudioComponent; keep best-effort across versions.
    try:
        ac = ambient_actor.get_editor_property("audio_component")
        ac.set_editor_property("auto_activate", bool(enabled))
    except Exception:
        pass


def _spawn_living_room_tiles(pts_xy, z_top: float, thickness: float):
    xs = [p[0] for p in pts_xy]
    ys = [p[1] for p in pts_xy]
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)

    # Living room is the front half in X.
    x0 = xmin
    x1 = min(xmax, LIVING_ROOM_X_MAX)
    if x1 <= x0 + 1.0:
        return

    tile = max(50.0, FLOOR_TILE)
    cx0 = x0 + tile * 0.5
    cy0 = ymin + tile * 0.5

    ix = 0
    x = cx0
    while x < x1 - 1.0:
        y = cy0
        iy = 0
        while y < ymax - 1.0:
            label = f"{PREFIX}CollapseTile_{ix}_{iy}"
            loc_z = z_top - (thickness * 0.5)
            scale = (tile / 100.0, tile / 100.0, thickness / 100.0)
            _spawn_static_mesh_actor(
                label,
                CUBE,
                (x, y, loc_z),
                scale=scale,
                tags=["S01", "Env", "LivingRoom", "CollapseFloor"],
                folder=f"{FOLDER_ROOT}/LivingRoom/FloorTiles",
            )
            iy += 1
            y += tile
        ix += 1
        x += tile


def build_blockout():
    _ensure_level_open(EXPECTED_LEVEL_NAME)
    if REBUILD_CLEAN:
        _delete_existing_with_prefix(PREFIX)

    area = _poly_signed_area_xy(FOOTPRINT_XY)
    winding = "CCW" if area > 0.0 else "CW"
    center_x, center_y = _poly_center_xy(FOOTPRINT_XY)

    living_x = center_x + LIVING_ROOM_CENTER_OFFSET[0]
    living_y = center_y + LIVING_ROOM_CENTER_OFFSET[1]
    kitchen_x = center_x + KITCHEN_CENTER_OFFSET[0]
    kitchen_y = center_y + KITCHEN_CENTER_OFFSET[1]

    # --- Debug markers ---
    _spawn_marker(
        f"{PREFIX}Debug_BasementCenter",
        (center_x, center_y, BASEMENT_FLOOR_Z + 50.0),
        tags=["S01", "Debug", "Basement"],
        folder=f"{FOLDER_ROOT}/Debug",
    )
    _spawn_marker(
        f"{PREFIX}Debug_GroundCenter",
        (center_x, center_y, GROUND_FLOOR_Z + 50.0),
        tags=["S01", "Debug", "Ground"],
        folder=f"{FOLDER_ROOT}/Debug",
    )
    _spawn_marker(
        f"{PREFIX}Debug_LivingRoomCenter",
        (living_x, living_y, GROUND_FLOOR_Z + 50.0),
        tags=["S01", "Debug", "LivingRoom"],
        folder=f"{FOLDER_ROOT}/Debug",
    )
    _spawn_marker(
        f"{PREFIX}Debug_KitchenCenter",
        (kitchen_x, kitchen_y, GROUND_FLOOR_Z + 50.0),
        tags=["S01", "Debug", "Kitchen"],
        folder=f"{FOLDER_ROOT}/Debug",
    )

    # --- Slabs ---
    # Basement floor slab: top at BASEMENT_FLOOR_Z
    basement_slab = _spawn_slab(
        f"{PREFIX}Basement_Slab",
        FOOTPRINT_XY,
        top_z=BASEMENT_FLOOR_Z,
        thickness=SLAB_THICKNESS,
        tags=["S01", "Env", "Basement", "Slab"],
        folder=f"{FOLDER_ROOT}/Basement",
    )
    _try_set_material(basement_slab, M_FLOOR)

    # Ground floor slab: top at GROUND_FLOOR_Z
    ground_slab = _spawn_slab(
        f"{PREFIX}Ground_Slab",
        FOOTPRINT_XY,
        top_z=GROUND_FLOOR_Z,
        thickness=SLAB_THICKNESS,
        tags=["S01", "Env", "Ground", "Slab"],
        folder=f"{FOLDER_ROOT}/Ground",
    )
    _try_set_material(ground_slab, M_FLOOR)

    if SPAWN_ROOF_SLAB:
        roof_slab = _spawn_slab(
            f"{PREFIX}Roof_Slab",
            FOOTPRINT_XY,
            top_z=GROUND_FLOOR_Z + GROUND_WALL_HEIGHT,
            thickness=SLAB_THICKNESS,
            overhang=ROOF_OVERHANG,
            tags=["S01", "Env", "Roof", "Slab"],
            folder=f"{FOLDER_ROOT}/Roof",
        )
        _try_set_material(roof_slab, M_ROOF)

    # Living room collapse tiles (sit exactly on top of ground slab)
    _spawn_living_room_tiles(FOOTPRINT_XY, z_top=GROUND_FLOOR_Z + 0.1, thickness=3.0)

    # --- Walls ---
    winding_ground = _spawn_perimeter_walls(
        "Ground",
        FOOTPRINT_XY,
        z0=GROUND_FLOOR_Z,
        height=GROUND_WALL_HEIGHT,
        thickness=WALL_THICKNESS,
        tags=["S01", "Env", "Ground", "Wall"],
        folder=f"{FOLDER_ROOT}/Ground/Walls",
        front_opening_width=FRONT_DOOR_WIDTH,
        back_opening_width=BACK_DOOR_WIDTH,
    )

    # Best-effort wall material assignment (iterate over the spawned wall labels).
    # We keep this cheap and resilient: set material on any static mesh actor matching the prefix.
    try:
        _editor, actors = _editor_subsystems()
        for a in actors.get_all_level_actors():
            if a.get_actor_label().startswith(f"{PREFIX}Ground_Wall_"):
                _try_set_material(a, M_WALL)
            if a.get_actor_label().startswith(f"{PREFIX}Basement_Wall_"):
                _try_set_material(a, M_WALL)
            if a.get_actor_label().startswith(f"{PREFIX}Ground_Interior_"):
                _try_set_material(a, M_WALL)
    except Exception:
        pass

    _spawn_interior_divider(
        "Ground",
        FOOTPRINT_XY,
        z0=GROUND_FLOOR_Z,
        height=GROUND_WALL_HEIGHT,
        thickness=WALL_THICKNESS,
        tags=["S01", "Env", "Ground", "Wall", "Interior"],
        folder=f"{FOLDER_ROOT}/Ground/Walls",
    )

    winding_basement = _spawn_perimeter_walls(
        "Basement",
        FOOTPRINT_XY,
        z0=BASEMENT_FLOOR_Z,
        height=BASEMENT_WALL_HEIGHT,
        thickness=WALL_THICKNESS,
        tags=["S01", "Env", "Basement", "Wall"],
        folder=f"{FOLDER_ROOT}/Basement/Walls",
        front_opening_width=0.0,
        back_opening_width=0.0,
    )

    # --- Lighting / atmosphere (keep light and neutral) ---
    _spawn_class(f"{PREFIX}SkyAtmosphere", unreal.SkyAtmosphere, (0.0, 0.0, 0.0), folder=f"{FOLDER_ROOT}/Lighting")
    sky = _spawn_class(f"{PREFIX}SkyLight", unreal.SkyLight, (0.0, 0.0, 200.0), folder=f"{FOLDER_ROOT}/Lighting")
    try:
        sky.get_component_by_class(unreal.SkyLightComponent).set_editor_property("intensity", 0.35)
    except Exception:
        pass

    sun = _spawn_class(
        f"{PREFIX}DirectionalLight",
        unreal.DirectionalLight,
        (0.0, 0.0, 500.0),
        rot=(-35.0, 35.0, 0.0),
        folder=f"{FOLDER_ROOT}/Lighting",
    )
    try:
        sun.get_component_by_class(unreal.DirectionalLightComponent).set_editor_property("intensity", 2.5)
    except Exception:
        pass

    fog = _spawn_class(f"{PREFIX}HeightFog", unreal.ExponentialHeightFog, (0.0, 0.0, 0.0), folder=f"{FOLDER_ROOT}/Lighting")
    try:
        fog_comp = fog.get_component_by_class(unreal.ExponentialHeightFogComponent)
        fog_comp.set_editor_property("fog_density", 0.015)
        fog_comp.set_editor_property("fog_height_falloff", 0.25)
    except Exception:
        pass

    # --- Fire pocket (basement) + mismatch cues (kitchen visible, living room hotter) ---
    fire_bp_class = None
    try:
        fire_bp_class = unreal.EditorAssetLibrary.load_blueprint_class(FIRE_BP)
    except Exception:
        fire_bp_class = None

    if fire_bp_class:
        _spawn_class(
            f"{PREFIX}BasementFirePocket",
            fire_bp_class,
            (living_x, living_y, BASEMENT_FLOOR_Z + 60.0),
            folder=f"{FOLDER_ROOT}/Basement",
            tags=["S01", "Env", "Basement", "Fire", "Pocket"],
        )

        # Visible kitchen fire on ground floor (but not the hottest zone).
        _spawn_class(
            f"{PREFIX}KitchenFire_Visible",
            fire_bp_class,
            (kitchen_x, kitchen_y + 150.0, GROUND_FLOOR_Z + 30.0),
            folder=f"{FOLDER_ROOT}/Ground/Kitchen",
            tags=["S01", "Env", "Ground", "Kitchen", "Fire", "Visible"],
        )

        # Exterior rear smoke hint (concept beat 1). Best-effort using StarterContent particles.
        # If missing, we still place a marker for a smoke Niagara/VFX replacement later.
        try:
            ps = _try_load(SMOKE_PS)
            if ps:
                smoke = _spawn_class(
                    f"{PREFIX}ExteriorSmoke_Back",
                    unreal.Emitter,
                    (center_x + 780.0, center_y, GROUND_FLOOR_Z + 220.0),
                    folder=f"{FOLDER_ROOT}/Exterior/VFX",
                    tags=["S01", "Env", "Exterior", "Smoke", "Back"],
                )
                try:
                    psc = smoke.get_component_by_class(unreal.ParticleSystemComponent)
                    if psc:
                        psc.set_editor_property("template", ps)
                except Exception:
                    pass
            else:
                _spawn_marker(
                    f"{PREFIX}Marker_ExteriorSmoke_Back",
                    (center_x + 780.0, center_y, GROUND_FLOOR_Z + 220.0),
                    folder=f"{FOLDER_ROOT}/Exterior/VFX",
                    tags=["S01", "Marker", "Exterior", "Smoke", "Back"],
                )
        except Exception:
            pass
    else:
        _log(f"Fire blueprint missing/unloadable: {FIRE_BP} (skipping fire actors)")

    heat_light = _spawn_class(
        f"{PREFIX}HeatLight_LivingRoom",
        unreal.PointLight,
        (living_x, living_y, GROUND_FLOOR_Z + 140.0),
        folder=f"{FOLDER_ROOT}/LivingRoom",
        tags=["S01", "Env", "Heat", "LivingRoom", "HotZone"],
    )
    try:
        plc = heat_light.get_component_by_class(unreal.PointLightComponent)
        plc.set_editor_property("intensity", 35000.0)
        plc.set_editor_property("light_color", unreal.LinearColor(1.0, 0.5, 0.2, 1.0))
        plc.set_editor_property("attenuation_radius", 900.0)
        plc.set_editor_property("cast_shadows", True)
    except Exception:
        pass

    # Audio placeholders for the "too quiet" interior and the collapse payoff.
    # Keep post-collapse sources NOT auto-activated to avoid both playing at once.
    amb_muffled = _spawn_ambient_sound(
        f"{PREFIX}Amb_Basement_Muffled",
        (living_x, living_y, BASEMENT_FLOOR_Z + 80.0),
        FIRE_CUE,
        volume=0.35,
        muffled=True,
        cutoff_hz=900.0,
        tags=["S01", "Env", "Audio", "Basement", "Muffled", "PreCollapse"],
        folder=f"{FOLDER_ROOT}/Basement/Audio",
    )
    _try_set_audio_auto_activate(amb_muffled, True)

    amb_roar = _spawn_ambient_sound(
        f"{PREFIX}Amb_Basement_Roar",
        (living_x, living_y, BASEMENT_FLOOR_Z + 80.0),
        FIRE_CUE,
        volume=0.85,
        muffled=False,
        tags=["S01", "Env", "Audio", "Basement", "Roar", "PostCollapse"],
        folder=f"{FOLDER_ROOT}/Basement/Audio",
    )
    _try_set_audio_auto_activate(amb_roar, False)

    # Low-frequency instability bed (very subtle; give sound designers an anchor point).
    amb_rumble = _spawn_ambient_sound(
        f"{PREFIX}Amb_Rumble_Subtle",
        (living_x, living_y, GROUND_FLOOR_Z + 40.0),
        FIRE_CUE,
        volume=0.10,
        muffled=True,
        cutoff_hz=350.0,
        tags=["S01", "Env", "Audio", "Rumble", "Instability"],
        folder=f"{FOLDER_ROOT}/LivingRoom/Audio",
    )
    _try_set_audio_auto_activate(amb_rumble, True)

    # Acoustic baffle / occlusion tuning anchor (designer-facing marker).
    _spawn_marker(
        f"{PREFIX}Marker_AcousticBaffle_Floor",
        (living_x, living_y, GROUND_FLOOR_Z + 5.0),
        folder=f"{FOLDER_ROOT}/LivingRoom/Markers",
        tags=["S01", "Marker", "Audio", "AcousticBaffle", "PreCollapse"],
    )

    # Basement fire pocket volume marker (for VFX, heat, and audio routing).
    _spawn_static_mesh_actor(
        f"{PREFIX}BasementFirePocket_Volume",
        CUBE,
        (living_x, living_y, BASEMENT_FLOOR_Z + 90.0),
        scale=(3.0, 3.0, 1.5),
        tags=["S01", "Marker", "Basement", "FirePocket", "Volume"],
        folder=f"{FOLDER_ROOT}/Basement/Markers",
    )

    # --- Story beat marker ---
    _spawn_marker(
        f"{PREFIX}Marker_FloorGive",
        (living_x, living_y, GROUND_FLOOR_Z + 5.0),
        folder=f"{FOLDER_ROOT}/LivingRoom/Markers",
        tags=["S01", "Marker", "FloorGive", "Regroup"],
    )

    _spawn_marker(
        f"{PREFIX}Marker_CollapsePayoff",
        (living_x, living_y, GROUND_FLOOR_Z + 5.0),
        folder=f"{FOLDER_ROOT}/LivingRoom/Markers",
        tags=["S01", "Marker", "Collapse", "Payoff"],
    )

    _spawn_marker(
        f"{PREFIX}Marker_DustBlast_Outward",
        (center_x - 740.0, center_y, GROUND_FLOOR_Z + 10.0),
        folder=f"{FOLDER_ROOT}/Beats",
        tags=["S01", "Marker", "Dust", "Collapse", "Threshold"],
    )

    # Beat-by-beat navigation markers (for blocking and camera/VO timing).
    _spawn_marker(
        f"{PREFIX}Beat_Approach_Exterior",
        (center_x + EXTERIOR_APPROACH_OFFSET[0], center_y + EXTERIOR_APPROACH_OFFSET[1], GROUND_FLOOR_Z + 5.0),
        tags=["S01", "Beat", "Approach", "Exterior"],
        folder=f"{FOLDER_ROOT}/Beats",
    )
    _spawn_marker(
        f"{PREFIX}Beat_Entry_FrontDoor",
        (center_x + FRONT_DOOR_OFFSET[0], center_y + FRONT_DOOR_OFFSET[1], GROUND_FLOOR_Z + 5.0),
        tags=["S01", "Beat", "Entry"],
        folder=f"{FOLDER_ROOT}/Beats",
    )

    # Scene-plan aligned back door entry toward the kitchen.
    _spawn_marker(
        f"{PREFIX}Beat_Entry_BackDoor",
        (center_x + BACK_DOOR_OFFSET[0], center_y + BACK_DOOR_OFFSET[1], GROUND_FLOOR_Z + 5.0),
        tags=["S01", "Beat", "Entry", "BackDoor"],
        folder=f"{FOLDER_ROOT}/Beats",
    )
    _spawn_marker(
        f"{PREFIX}Beat_Threshold_Clear",
        (center_x + THRESHOLD_OFFSET[0], center_y + THRESHOLD_OFFSET[1], GROUND_FLOOR_Z + 5.0),
        tags=["S01", "Beat", "ThresholdClear"],
        folder=f"{FOLDER_ROOT}/Beats",
    )
    _spawn_marker(
        f"{PREFIX}Beat_Kitchen_FirstWater",
        (kitchen_x, kitchen_y + 120.0, GROUND_FLOOR_Z + 5.0),
        tags=["S01", "Beat", "Kitchen", "Water1"],
        folder=f"{FOLDER_ROOT}/Beats",
    )
    _spawn_marker(
        f"{PREFIX}Beat_LivingRoom_HeatCheck",
        (living_x, living_y, GROUND_FLOOR_Z + 5.0),
        tags=["S01", "Beat", "LivingRoom", "HeatCheck"],
        folder=f"{FOLDER_ROOT}/Beats",
    )
    _spawn_marker(
        f"{PREFIX}Beat_Regroup_FloorGive",
        (living_x - 80.0, living_y, GROUND_FLOOR_Z + 5.0),
        tags=["S01", "Beat", "Regroup", "FloorGive"],
        folder=f"{FOLDER_ROOT}/Beats",
    )
    _spawn_marker(
        f"{PREFIX}Beat_Evac_Command",
        (living_x - 220.0, living_y, GROUND_FLOOR_Z + 5.0),
        tags=["S01", "Beat", "Evac"],
        folder=f"{FOLDER_ROOT}/Beats",
    )
    _spawn_marker(
        f"{PREFIX}Beat_Aftermath_Exterior",
        (center_x + EXTERIOR_AFTERMATH_OFFSET[0], center_y + EXTERIOR_AFTERMATH_OFFSET[1], GROUND_FLOOR_Z + 5.0),
        tags=["S01", "Beat", "Aftermath", "Exterior"],
        folder=f"{FOLDER_ROOT}/Beats",
    )

    # Simple prop placeholders to drive subtle jitter/sway (animation/shake system later).
    # Keep them cheap: thin cube "lamp" + a couple of small props in the living room.
    _spawn_static_mesh_actor(
        f"{PREFIX}Prop_Lamp_Hanging",
        CUBE,
        (living_x + 60.0, living_y - 120.0, GROUND_FLOOR_Z + 240.0),
        scale=(0.10, 0.10, 0.50),
        tags=["S01", "Prop", "Jitter", "Sway", "LivingRoom"],
        folder=f"{FOLDER_ROOT}/LivingRoom/Props",
    )
    _spawn_static_mesh_actor(
        f"{PREFIX}Prop_Small_01",
        CUBE,
        (living_x - 120.0, living_y + 80.0, GROUND_FLOOR_Z + 25.0),
        scale=(0.30, 0.30, 0.30),
        tags=["S01", "Prop", "Jitter", "LivingRoom"],
        folder=f"{FOLDER_ROOT}/LivingRoom/Props",
    )
    _spawn_static_mesh_actor(
        f"{PREFIX}Prop_Small_02",
        CUBE,
        (kitchen_x + 80.0, kitchen_y - 60.0, GROUND_FLOOR_Z + 25.0),
        scale=(0.25, 0.25, 0.25),
        tags=["S01", "Prop", "Jitter", "Kitchen"],
        folder=f"{FOLDER_ROOT}/Ground/Kitchen/Props",
    )

    _log("Blockout build complete.")
    _log(f"Storey Z: basement_top={BASEMENT_FLOOR_Z} ground_top={GROUND_FLOOR_Z} roof_top={GROUND_FLOOR_Z + GROUND_WALL_HEIGHT}")
    _log(f"Footprint winding detected: {winding} (ground={winding_ground}, basement={winding_basement})")
    _log(f"Find basement marker in Outliner: {PREFIX}Debug_BasementCenter")


if __name__ == "__main__":
    build_blockout()
