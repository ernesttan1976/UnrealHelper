# unreal-project-inspection

Outcome: reliably answer "what project/editor state am I in".

Safety:
* Requires only read packs: `unreal.core`, `unreal.editor.read`.
* Do not attempt any write operations.

Mandatory flow:
1. Call `unreal.get_connection_status` (use `probe: true` when debugging connectivity).
2. Call `unreal.get_editor_status`.
3. Call `unreal.get_engine_version`.
4. Call `unreal.get_current_project`.
5. Call `unreal.get_message_log_summary` if available.

Failure behavior:
* If any call returns `ok:false`, stop and report the structured error.
