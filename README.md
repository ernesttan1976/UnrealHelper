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
