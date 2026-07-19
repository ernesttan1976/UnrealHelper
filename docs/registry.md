# Tool Registry

Single source of truth: `MCP/tools/registry.json`.

Build step:
* `mcp-server/scripts/generate-tools.mjs` generates `mcp-server/src/tools/generated/tool-defs.ts`

Server behavior:
* `ListTools` is derived from generated tool defs.
* Pack policy is enforced for every tool call.
