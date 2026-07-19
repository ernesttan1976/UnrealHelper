# mcp-server

MCP server exposing a small set of Unreal Editor debugging tools.

Current tools:

* `unreal.ping`
* `unreal.get_connection_status`
* `unreal.get_last_tool_error`
* `unreal.cancel_current_operation`
* `unreal.get_protocol_capabilities`
* `unreal.get_plugin_version`
* `unreal.get_active_debug_session`
* `unreal.start_debug_session`
* `unreal.end_debug_session`
* `unreal.clear_debug_session`
* `unreal.get_editor_status`
* `unreal.get_engine_version`
* `unreal.get_current_project`
* `unreal.get_project_info`
* `unreal.get_selected_actors`
* `unreal.get_component_tree`
* `unreal.list_assets`
* `unreal.inspect_object`
* `unreal.inspect_blueprint`

Blueprint static inspection (Priority 2):

* `unreal.get_blueprint_summary`
* `unreal.get_blueprint_metadata`
* `unreal.get_blueprint_graph`
* `unreal.get_blueprint_dependencies`
* `unreal.get_blueprint_dependents`

Compilation and diagnostics (Priority 4):

* `unreal.compile_blueprint`
* `unreal.compile_selected_blueprint`
* `unreal.compile_blueprints`
* `unreal.compile_all_dirty_blueprints`
* `unreal.get_compile_messages`
* `unreal.get_compile_message_details`
* `unreal.get_compile_error_nodes`
* `unreal.get_compile_warning_nodes`
* `unreal.compile_and_capture_messages`
* `unreal.get_generated_class_status`
* `unreal.get_skeleton_class_status`
* `unreal.get_blueprint_bytecode_summary`
* `unreal.get_last_successful_compile`
* `unreal.compare_compile_results`
* `unreal.reinstance_blueprint`
* `unreal.refresh_blueprint_nodes`
* `unreal.reconstruct_blueprint_node`
* `unreal.validate_blueprint_asset`
* `unreal.validate_blueprint_dependencies`

## Build

From `mcp-server/`:

```bash
npm install
npm run build
```

## Run (mock)

```bash
UNREAL_MOCK=1 node dist/index.js
```

## Run (real Unreal)

1. Install/enable the plugin from `unreal-plugin/UnrealDebugCopilot` in your UE 5.6 project.
2. Restart the editor.
3. Copy the token printed to the Output Log.
4. Run:

```bash
UNREAL_HOST=127.0.0.1 UNREAL_PORT=17777 UNREAL_TOKEN=<token> node dist/index.js
```

### Option: auto-load token from project dir

If you set `UNREAL_PROJECT_DIR` to your Unreal project directory, the server will try to read
`[UnrealDebugCopilot] Token` (and `Port` if `UNREAL_PORT` is not explicitly set) from the project's
`EditorPerProjectUserSettings.ini`.

Example:

```bash
UNREAL_PROJECT_DIR="D:/UEProjects/MyGame" node dist/probe.js
```

## Using a .env file

From `mcp-server/`, create `.env` (see `.env.example`) and then run:

```bash
node dist/index.js
```

## Probe (recommended)

Runs a small sequence of direct TCP calls (bypassing MCP) so you can validate connectivity quickly.

```bash
UNREAL_HOST=127.0.0.1 UNREAL_PORT=17777 UNREAL_TOKEN=<token> node dist/probe.js
```

## Test Each Set of Features
```
cd mcp-server
npm run build
npm run test:priority -- --priority 4
```


## Copy to Project Folder and Compile
```
./sync.ps1
```
