# blueprint-inspection

Outcome: locate and inspect the relevant Blueprint and graph with bounded output.

Safety:
* Requires only read packs: `unreal.core`, `unreal.editor.read`, `unreal.blueprint.read`.
* Prefer bounded graph exports (`mode` + max limits).

Mandatory flow:
1. Call `unreal.get_open_editors` and/or `unreal.get_active_blueprint`.
2. If no active Blueprint: call `unreal.list_assets` to find candidates.
3. Call `unreal.get_blueprint_summary`.
4. Call `unreal.get_blueprint_graphs`.
5. Call `unreal.get_blueprint_graph` with bounded params (`mode`, `max_nodes`, `max_edges`, `max_depth`).
6. If needed: call `unreal.find_blueprint_nodes` with `limit`.

Failure behavior:
* If any call returns `ok:false`, stop and report the structured error.
