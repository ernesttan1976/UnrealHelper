# Capability Packs

Packs are the only way tools are surfaced.

Default enabled packs:
* `unreal.core`
* `unreal.editor.read`
* `unreal.blueprint.read`
* `unreal.diagnostics`

Write packs must be explicitly enabled:
* Add packs via `UNREAL_MCP_PACKS` (comma-separated)
* Enable write gate via `UNREAL_MCP_WRITE_ENABLED=1`
