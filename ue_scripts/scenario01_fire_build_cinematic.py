"""Scenario01Fire: add a cinematic/photoreal pass on top of the env blockout.

Run in Unreal Editor:
1. Open level: /Game/Scenario01Fire
2. Tools -> Execute Python Script... -> select this file

This script is intentionally best-effort and project-agnostic:
- Adds a PostProcessVolume tuned for smoky interiors and filmic exposure.
- Adds a few practical lights (kitchen/living) to match the storyboard mood.
- Spawns storyboard-aligned CineCameras you can render from.

It does NOT import assets (Megascans/Marketplace) and won’t guarantee “true”
photorealism without proper props/materials/VFX, but it gets you to a
cinematic baseline quickly.
"""

import math
import unreal


EXPECTED_LEVEL_NAME = "Scenario01Fire"

PREFIX = "S01Cine_"
FOLDER_ROOT = "Scenario01Fire/Cine"

REBUILD_CLEAN = True


def _log(msg: str) -> None:
    unreal.log(f"[Scenario01Fire:CINE] {msg}")


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
        raise RuntimeError(f"Expected level '{expected_world_name}' to be open, but active world is '{_world_name()}'.")


def _spawn_class(label: str, cls, loc, rot=(0.0, 0.0, 0.0), folder=FOLDER_ROOT, tags=None):
    _editor, actors = _editor_subsystems()
    a = actors.spawn_actor_from_class(cls, unreal.Vector(*loc), unreal.Rotator(*rot))
    if not a:
        raise RuntimeError(f"Failed to spawn actor: {label}")
    a.set_actor_label(label, mark_dirty=True)
    try:
        a.set_folder_path(folder)
    except Exception:
        pass
    if tags:
        try:
            a.set_editor_property("tags", [unreal.Name(t) for t in tags])
        except Exception:
            pass
    return a


def _delete_existing_with_prefix(prefix: str) -> None:
    _editor, actors = _editor_subsystems()
    to_delete = []
    for a in actors.get_all_level_actors():
        try:
            if a.get_actor_label().startswith(prefix):
                to_delete.append(a)
        except Exception:
            continue
    for a in to_delete:
        try:
            actors.destroy_actor(a)
        except Exception:
            pass
    if to_delete:
        _log(f"Deleted {len(to_delete)} existing actors with prefix '{prefix}'.")


def _find_by_label(label: str):
    _editor, actors = _editor_subsystems()
    for a in actors.get_all_level_actors():
        try:
            if a.get_actor_label() == label:
                return a
        except Exception:
            pass
    return None


def _loc_of(label: str, fallback=(0.0, 0.0, 0.0)):
    a = _find_by_label(label)
    if not a:
        return fallback
    try:
        v = a.get_actor_location()
        return (float(v.x), float(v.y), float(v.z))
    except Exception:
        return fallback


def _look_at_rotation(from_loc, to_loc) -> tuple[float, float, float]:
    fx, fy, fz = from_loc
    tx, ty, tz = to_loc
    dx = tx - fx
    dy = ty - fy
    dz = tz - fz
    yaw = math.degrees(math.atan2(dy, dx))
    dist_xy = math.sqrt(dx * dx + dy * dy)
    pitch = math.degrees(math.atan2(dz, dist_xy))
    return (pitch, yaw, 0.0)


def _configure_post_process(ppv) -> None:
    # Unbound PPV with manual exposure and a smoky, contrasty interior baseline.
    try:
        # Property name differs across versions.
        for prop in ("unbound", "b_unbound"):
            if ppv.has_editor_property(prop):
                ppv.set_editor_property(prop, True)
                break
    except Exception:
        pass

    try:
        ppv.set_editor_property("priority", 100)
        ppv.set_editor_property("blend_weight", 1.0)
    except Exception:
        pass

    try:
        settings = ppv.get_editor_property("settings")
        # Exposure
        if hasattr(unreal, "AutoExposureMethod"):
            settings.auto_exposure_method = unreal.AutoExposureMethod.AEM_MANUAL
        settings.manual_exposure_bias = 0.0
        settings.b_override_auto_exposure_method = True
        settings.b_override_manual_exposure_bias = True

        # Bloom / vignette / grain (subtle)
        settings.b_override_bloom_intensity = True
        settings.bloom_intensity = 0.25
        settings.b_override_vignette_intensity = True
        settings.vignette_intensity = 0.35
        settings.b_override_film_grain_intensity = True
        settings.film_grain_intensity = 0.2

        # Slightly warmer mids to complement firelight
        settings.b_override_color_saturation = True
        settings.color_saturation = unreal.Vector4(1.02, 1.0, 0.98, 1.0)

        ppv.set_editor_property("settings", settings)
    except Exception:
        _log("PostProcess settings could not be fully applied (engine/project differences).")


def _configure_cine_camera(cam, focal_mm: float, fstop: float) -> None:
    try:
        c = cam.get_cine_camera_component()
        c.set_editor_property("current_focal_length", float(focal_mm))
        c.set_editor_property("current_aperture", float(fstop))
        c.set_editor_property("focus_settings", c.get_editor_property("focus_settings"))
    except Exception:
        pass


def build_cinematic_pass():
    _ensure_level_open(EXPECTED_LEVEL_NAME)
    if REBUILD_CLEAN:
        _delete_existing_with_prefix(PREFIX)

    # Anchors from the env builder, if present.
    approach = _loc_of("S01_Beat_Approach_Exterior", fallback=(-1050.0, 0.0, 5.0))
    entry_back = _loc_of("S01_Beat_Entry_BackDoor", fallback=(800.0, 0.0, 5.0))
    kitchen = _loc_of("S01_Beat_Kitchen_FirstWater", fallback=(350.0, 120.0, 5.0))
    living = _loc_of("S01_Beat_LivingRoom_HeatCheck", fallback=(-350.0, 0.0, 5.0))
    regroup = _loc_of("S01_Beat_Regroup_FloorGive", fallback=(-430.0, 0.0, 5.0))
    evac = _loc_of("S01_Beat_Evac_Command", fallback=(-570.0, 0.0, 5.0))
    basement_center = _loc_of("S01_Debug_BasementCenter", fallback=(0.0, 0.0, -300.0))

    # --- Post process ---
    ppv = _spawn_class(
        f"{PREFIX}PPV_Unbound",
        unreal.PostProcessVolume,
        (0.0, 0.0, 0.0),
        folder=f"{FOLDER_ROOT}/Post",
        tags=["S01", "Cine", "PostProcess"],
    )
    _configure_post_process(ppv)

    # --- Practical lights ---
    # Kitchen: warm rect light overhead, helps read faces through smoke.
    rect = _spawn_class(
        f"{PREFIX}RectLight_Kitchen",
        unreal.RectLight,
        (kitchen[0], kitchen[1] - 80.0, kitchen[2] + 260.0),
        rot=(-55.0, 180.0, 0.0),
        folder=f"{FOLDER_ROOT}/Lighting",
        tags=["S01", "Cine", "Light", "Kitchen"],
    )
    try:
        rlc = rect.get_component_by_class(unreal.RectLightComponent)
        rlc.set_editor_property("intensity", 12000.0)
        rlc.set_editor_property("light_color", unreal.LinearColor(1.0, 0.78, 0.55, 1.0))
        rlc.set_editor_property("source_width", 120.0)
        rlc.set_editor_property("source_height", 40.0)
        rlc.set_editor_property("attenuation_radius", 900.0)
        rlc.set_editor_property("cast_shadows", True)
    except Exception:
        pass

    # Living room: slightly dim, warm-ish fill to sell “hot but quiet”.
    p = _spawn_class(
        f"{PREFIX}PointLight_LivingFill",
        unreal.PointLight,
        (living[0] + 60.0, living[1] - 120.0, living[2] + 170.0),
        folder=f"{FOLDER_ROOT}/Lighting",
        tags=["S01", "Cine", "Light", "Living"],
    )
    try:
        plc = p.get_component_by_class(unreal.PointLightComponent)
        plc.set_editor_property("intensity", 4500.0)
        plc.set_editor_property("light_color", unreal.LinearColor(1.0, 0.62, 0.42, 1.0))
        plc.set_editor_property("attenuation_radius", 600.0)
        plc.set_editor_property("cast_shadows", True)
    except Exception:
        pass

    # --- Cameras (storyboard-aligned) ---
    cams = []

    def add_cam(name: str, loc, target, focal, fstop):
        rot = _look_at_rotation(loc, target)
        cam = _spawn_class(
            f"{PREFIX}{name}",
            unreal.CineCameraActor,
            loc,
            rot=rot,
            folder=f"{FOLDER_ROOT}/Cameras",
            tags=["S01", "Cine", "Camera"],
        )
        _configure_cine_camera(cam, focal_mm=focal, fstop=fstop)
        cams.append(cam)

    add_cam("Cam_01_Approach", (approach[0] - 220.0, approach[1] + 120.0, approach[2] + 160.0), (approach[0] + 200.0, approach[1], approach[2] + 90.0), 28.0, 4.0)
    add_cam("Cam_02_Entry_BackDoor", (entry_back[0] + 240.0, entry_back[1] + 80.0, entry_back[2] + 160.0), (entry_back[0] - 120.0, entry_back[1], entry_back[2] + 110.0), 24.0, 3.5)
    add_cam("Cam_03_InitialAttack_Kitchen", (kitchen[0] - 220.0, kitchen[1] + 120.0, kitchen[2] + 160.0), (kitchen[0] + 120.0, kitchen[1] + 40.0, kitchen[2] + 110.0), 35.0, 2.8)
    add_cam("Cam_04_Regroup", (regroup[0] - 200.0, regroup[1] + 160.0, regroup[2] + 160.0), (regroup[0] + 40.0, regroup[1], regroup[2] + 110.0), 35.0, 2.8)
    add_cam("Cam_05_SixthSense", (living[0] - 120.0, living[1] + 210.0, living[2] + 165.0), (living[0] + 10.0, living[1], living[2] + 120.0), 50.0, 2.0)
    add_cam("Cam_06_Evac_Order", (evac[0] - 180.0, evac[1] + 180.0, evac[2] + 160.0), (evac[0] + 30.0, evac[1], evac[2] + 120.0), 50.0, 2.2)
    add_cam("Cam_07_Collapse_Wide", (living[0] - 520.0, living[1] + 420.0, living[2] + 340.0), (living[0], living[1], living[2] + 40.0), 24.0, 4.0)
    add_cam("Cam_08_Basement_Reveal", (basement_center[0] - 140.0, basement_center[1] + 240.0, basement_center[2] + 120.0), (basement_center[0] + 40.0, basement_center[1], basement_center[2] + 60.0), 28.0, 2.8)

    _log(f"Spawned {len(cams)} cinematic cameras under '{FOLDER_ROOT}/Cameras'.")
    _log("Cinematic pass complete.")


if __name__ == "__main__":
    build_cinematic_pass()
