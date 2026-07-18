"""Scenario01Fire: undo/delete the environment blockout created by scenario01_fire_build_env.py.

Run in Unreal Editor:
1. Open level: /Game/Scenario01Fire
2. Tools -> Execute Python Script... -> select this file

This deletes all actors whose label starts with `S01_` and then best-effort
removes any now-empty World Outliner folders it created under FOLDER_ROOT.
"""

import unreal


EXPECTED_LEVEL_NAME = "Scenario01Fire"
PREFIX = "S01_"
FOLDER_ROOT = "Scenario01Fire/Env"


def _log(msg: str) -> None:
    unreal.log(f"[Scenario01Fire:UNDO] {msg}")


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


def _actor_folder_path(actor) -> str:
    # World Outliner folder path is editor-only; keep this best-effort.
    try:
        p = actor.get_folder_path()
        return str(p) if p else ""
    except Exception:
        pass

    try:
        p = actor.get_editor_property("folder_path")
        return str(p) if p else ""
    except Exception:
        return ""


def _folder_parents(path: str):
    # "A/B/C" -> ["A/B/C", "A/B", "A"] (deepest-first)
    p = (path or "").strip("/")
    out = []
    while p:
        out.append(p)
        if "/" not in p:
            break
        p = p.rsplit("/", 1)[0]
    return out


def _delete_actor_folders_best_effort(folder_paths) -> int:
    # Unreal's Python surface for actor folder deletion varies; try a few known-ish
    # method names on subsystems/libraries. If none exist, we at least log.
    _editor, actors = _editor_subsystems()

    # Deepest-first so children are removed before parents.
    unique = []
    seen = set()
    for p in folder_paths:
        if p and p not in seen:
            unique.append(p)
            seen.add(p)
    unique.sort(key=lambda s: (s.count("/"), s), reverse=True)

    targets = [
        (actors, name)
        for name in (
            "delete_actor_folder",
            "delete_actor_folder_path",
            "delete_folder",
            "delete_folder_path",
            "remove_actor_folder",
            "remove_folder",
            "remove_folder_path",
        )
        if hasattr(actors, name)
    ]

    # Some projects still have Editor Scripting Utilities enabled.
    lib_targets = []
    for lib in (getattr(unreal, "EditorLevelLibrary", None), getattr(unreal, "EditorLevelUtils", None)):
        if not lib:
            continue
        for name in (
            "delete_actor_folder",
            "delete_actor_folder_path",
            "delete_folder",
            "delete_folder_path",
        ):
            if hasattr(lib, name):
                lib_targets.append((lib, name))

    deleted = 0
    for obj, method_name in (targets + lib_targets):
        fn = getattr(obj, method_name, None)
        if not fn:
            continue
        for p in unique:
            try:
                fn(p)
                deleted += 1
                continue
            except Exception:
                pass
            try:
                fn(unreal.Name(p))
                deleted += 1
            except Exception:
                pass

    if deleted == 0 and unique:
        _log(
            "No folder-deletion API was available via Python; "
            "Outliner folders may remain (manual delete folder may be required)."
        )

    return deleted


def delete_s01_actors(prefix: str = PREFIX) -> int:
    _ensure_level_open(EXPECTED_LEVEL_NAME)
    _editor, actors = _editor_subsystems()
    all_actors = actors.get_all_level_actors()
    to_delete = []
    folders = set()
    for a in all_actors:
        try:
            if a.get_actor_label().startswith(prefix):
                to_delete.append(a)
                fp = _actor_folder_path(a)
                if fp and (fp == FOLDER_ROOT or fp.startswith(FOLDER_ROOT + "/")):
                    for parent in _folder_parents(fp):
                        if parent == FOLDER_ROOT or parent.startswith(FOLDER_ROOT + "/"):
                            folders.add(parent)
        except Exception:
            continue

    for a in to_delete:
        try:
            actors.destroy_actor(a)
        except Exception:
            pass

    # Remove any now-empty actor folders created under FOLDER_ROOT.
    folders_deleted = _delete_actor_folders_best_effort(sorted(folders))

    _log(f"Deleted {len(to_delete)} actors with prefix '{prefix}'.")
    if folders:
        _log(f"Attempted to delete {len(folders)} folders under '{FOLDER_ROOT}' (best-effort).")
    if folders_deleted:
        _log(f"Folder delete calls made: {folders_deleted}.")
    return len(to_delete)


if __name__ == "__main__":
    delete_s01_actors()
