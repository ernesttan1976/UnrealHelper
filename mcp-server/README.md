# mcp-server

MCP server exposing a small set of Unreal Editor debugging tools.

Current tools:

* `unreal.ping`
* `unreal.get_editor_status`
* `unreal.get_engine_version`
* `unreal.get_current_project`
* `unreal.get_selected_actors`
* `unreal.get_component_tree`

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
