---
name: unreal-mcp
description: Use ONLY when the user mentions Unreal MCP, Unreal Editor state, PIE, selected actors, component trees, open editors, or active Blueprints. Provides the exact tool calls and a safe workflow (ping/status first).
---

# Unreal MCP

Use this skill to interact with the Unreal Editor via the Unreal MCP tools exposed in this workspace.

## Tools Available

- `functions.unreal_unreal_ping`: Verify the MCP plugin is reachable.
- `functions.unreal_unreal_get_editor_status`: Check whether the editor is ready and whether PIE is running.
- `functions.unreal_unreal_get_engine_version`: Get the engine version string.
- `functions.unreal_unreal_get_current_project`: Get current project name and directory.
- `functions.unreal_unreal_get_selected_actors`: List currently selected actors in the editor.
- `functions.unreal_unreal_get_component_tree`: Get the component tree for an actor (defaults to first selected actor; or pass `actor_name`).
- `functions.unreal_unreal_get_open_editors`: List assets currently open in editor tabs.
- `functions.unreal_unreal_get_active_blueprint`: Get the Blueprint currently being edited (best effort if multiple are open).

## Default Workflow (Safe Order)

1. Connectivity: call `unreal_unreal_ping`.
2. Readiness: call `unreal_unreal_get_editor_status`.
3. Context: call `unreal_unreal_get_current_project`.
4. Selection-driven actions:
   - call `unreal_unreal_get_selected_actors`.
   - if at least one actor is selected, call `unreal_unreal_get_component_tree` with no args.
   - otherwise, ask the user to select the actor in the viewport/World Outliner, or provide an exact `actor_name`.
5. Blueprint context (if relevant): call `unreal_unreal_get_open_editors` then `unreal_unreal_get_active_blueprint`.

## Recipes

### Get the selected actor's component tree

Call in order:

1. `unreal_unreal_get_selected_actors`
2. `unreal_unreal_get_component_tree`

If nothing is selected, ask the user to select an actor, or use:

- `unreal_unreal_get_component_tree({"actor_name": "ExactActorName"})`

### Diagnose "nothing happens" / no data

1. `unreal_unreal_ping` (if this fails: the Unreal Editor plugin/server is not connected)
2. `unreal_unreal_get_editor_status` (if not ready: ask user to open the project and wait for load to finish)
3. For selection-based queries: confirm selection with `unreal_unreal_get_selected_actors`

## Interaction Rules

- Prefer non-destructive queries first (ping/status/project/selection) before deeper inspection.
- If PIE state matters, always check `unreal_unreal_get_editor_status` before assuming runtime behavior.
- When results depend on editor state (selection, open tabs), explicitly tell the user what to click/select in the editor.
