# UnrealHelper

Local Unreal Engine (UE 5.6) debugging copilot components.

This repo contains:

* `mcp-server/`: an MCP server (Node/TypeScript) that exposes tools to an agent.
* `unreal-plugin/`: an Unreal Editor plugin that provides a localhost-only JSON-RPC endpoint.

Key idea: the MCP tool surface is policy-driven.

* Tool metadata source of truth: `MCP/tools/registry.json`
* Capability packs and defaults: `MCP/packs/*.json` and `MCP/packs/default.json`
* Pack policy enforcement: `mcp-server/src/core/pack-policy.ts`
* Skills (workflow guardrails): `.opencode/skills/`

Roadmap and backlog:

* v0.1 hardening direction: `scalable_unreal_mcp_plan.md` (Priorities 0-4 first)
* Feature backlog (park Priority 5+ behind non-default packs): `feature-plan.md`

## Default Safety Model

The default MCP surface is conservative:

* Only tools in enabled packs are listed/callable.
* Default enabled packs are read-first: `unreal.core`, `unreal.editor.read`, `unreal.blueprint.read`, `unreal.diagnostics`.
* Write packs are disabled by default and additionally gated by `UNREAL_MCP_WRITE_ENABLED=1`.

You can override enabled packs via env:

* `UNREAL_MCP_PACKS=unreal.core,unreal.editor.read,...`
* `UNREAL_MCP_WRITE_ENABLED=1`

Tool definitions used by the server are generated from the registry:

* Generator: `mcp-server/scripts/generate-tools.mjs`
* Output: `mcp-server/src/tools/generated/tool-defs.ts`

## Quickstart

### 1) Install Plugin Into a Project

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-plugin.ps1 -ProjectDir <ProjectDir>
```

Enable `Unreal Debug Copilot` in UE (Edit -> Plugins) and restart. The Output Log prints a port/token.

Optional: sync plugin and build the Editor target (Unreal Editor should be closed):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync.ps1 <path-to-.uproject-or-project-dir> -EngineRoot "C:/Program Files/Epic Games/UE_5.6"
```

### 2) Build and Run The MCP Server

From `mcp-server/`:

```bash
npm install
npm run build
```

Mock mode:

```bash
UNREAL_MOCK=1 node dist/index.js
```

Real Unreal:

```bash
UNREAL_HOST=127.0.0.1 UNREAL_PORT=17777 UNREAL_TOKEN=<token> node dist/index.js
```

Option: set `UNREAL_PROJECT_DIR=<ProjectDir>` to auto-load token/port from `EditorPerProjectUserSettings.ini`.

## Future Direction

v0.1 focuses on making Priorities 0-4 boring and reliable:

* registry-driven tool metadata (no hand-maintained tool lists)
* pack gating + conservative defaults
* skills that enforce safe workflows (`unreal-project-inspection`, `blueprint-inspection`, `blueprint-edit-and-validate`)
* workflow-level integration tests (success and failure paths)
* transaction/rollback discipline for any write workflow
* consistent structured errors + local-only telemetry

After that, Priority 5+ capabilities (PIE control, logs, runtime inspection, linting, tracing/capture, automation) are added only as opt-in packs.
