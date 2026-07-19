# Architecture

* `MCP/tools/registry.json`: tool metadata + input schemas.
* `MCP/packs/*.json`: pack definitions and default policy.
* `mcp-server/`: MCP server that enforces pack policy, preconditions, structured errors, and optional telemetry.
* `unreal-plugin/`: Unreal Editor plugin implementing the JSON-RPC methods.
