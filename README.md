# UnrealHelper

Local Unreal Engine (UE 5.6) debugging copilot components.

This repo contains:

* `mcp-server/`: an MCP server (Node/TypeScript) that exposes tools to an agent.
* `unreal-plugin/`: an Unreal Editor plugin that provides a localhost-only JSON-RPC endpoint.

## Intended First Vertical Slice

Prove end-to-end connectivity and basic editor status:

* `ping`
* `get_editor_status`
* `get_engine_version`
* `get_current_project`

See `plan.md` for the broader roadmap.

## Phase 0 Acceptance Test (manual)

1. Install plugin into a UE 5.6 project: `powershell -ExecutionPolicy Bypass -File scripts/install-plugin.ps1 -ProjectDir <ProjectDir>`
2. Enable `Unreal Debug Copilot` in UE (Edit -> Plugins) and restart.
3. From `mcp-server/` run: `UNREAL_PROJECT_DIR=<ProjectDir> node dist/probe.js`
