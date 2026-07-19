# blueprint-edit-and-validate

Outcome: smallest safe mutation loop.

Safety envelope:
* This skill MUST refuse to perform writes unless:
  1. write packs are enabled (pack includes `unreal.blueprint.write` and `unreal.editor.write` as needed)
  2. `UNREAL_MCP_WRITE_ENABLED=1` (server-side gate)
* Save is not permitted unless an explicit save tool exists.

Mandatory flow (write path):
1. Inspect target (`unreal.inspect_blueprint` or `unreal.get_blueprint_summary`).
2. Confirm graph exists (`unreal.get_blueprint_graphs`).
3. Begin transaction (`unreal.begin_transaction`). If unavailable/denied: stop.
4. Apply the smallest change. If no safe edit primitive exists yet: stop and cancel transaction.
5. Compile (`unreal.compile_blueprint` or `unreal.compile_selected_blueprint`).
6. Check diagnostics (`unreal.get_compile_messages` or `unreal.compile_and_capture_messages`).
7. Validate (`unreal.validate_blueprint_asset`, dependencies optional).
8. Save only after success (requires a dedicated save tool; if missing: do not claim success-of-save).
9. Roll back on failure (`unreal.cancel_transaction`).

Failure behavior:
* Any `ok:false` after transaction start MUST result in a rollback attempt.
