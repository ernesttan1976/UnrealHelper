# Scalable Unreal MCP Plan (v0.1 Hardening)

Treat Priorities 0-4 as the first stable product slice. Pause new feature work and harden the foundation so adding Priority 5+ tools is cheap, safe, and testable.

## Goals (Before Priority 5)

1. All Priority 0-4 tools are registered from one machine-readable metadata system (no hand-edited tool lists).
2. Capability packs exist, with read and write separated and a conservative default.
3. Three skills exist and enforce safe workflows.
4. Workflow-level integration tests exist for success and failure paths.
5. Transactions + rollback primitives are verified (write workflows must leave Unreal valid on failure).
6. Structured errors are consistent across tools.
7. Local-only tool usage telemetry exists (no project content by default).
8. No arbitrary execution tools exposed.

## Non-Goals (For Now)

1. Implementing Priority 5+ tools (beyond tiny primitives required by skills/tests).
2. Broad "do anything" tools (console commands, arbitrary Python, filesystem access via Unreal).
3. Perfect coverage of all Unreal/plugin edge cases.

## Target Deliverable: v0.1

* Priorities 0-4 fully supported.
* Tool registry + pack gating is the only way tools are surfaced.
* Skills:
  1. `unreal-project-inspection`
  2. `blueprint-inspection`
  3. `blueprint-edit-and-validate` (even if actual edits are minimal initially, it must enforce transaction + compile + validate + save-gating)
* Integration tests cover the main workflows and the failure paths.
* Telemetry measures tool usage and latency locally.

## Repo Reorg (Target Layout)

This is a target shape; we can migrate incrementally without breaking existing commands.

```text
docs/
  architecture.md
  errors.md
  packs.md
  registry.md
  skills.md

MCP/
  tools/
    registry.schema.json
    registry.json
  packs/
    packs.schema.json
    unreal.core.json
    unreal.editor.read.json
    unreal.editor.write.json
    unreal.blueprint.read.json
    unreal.blueprint.write.json
    unreal.diagnostics.json
    default.json

mcp-server/
  src/
    core/
      errors.ts
      telemetry.ts
      tool-registry.ts
      pack-policy.ts
    tools/
      implementations/
        core.ts
        editor.ts
        blueprint.ts
        diagnostics.ts
      generated/
        tool-defs.ts
    index.ts
  tests/
    integration/
      workflows.spec.ts
    fixtures/
      registry.min.json

.opencode/skills/
  unreal-project-inspection/SKILL.md
  blueprint-inspection/SKILL.md
  blueprint-edit-and-validate/SKILL.md
```

Notes:

* Keep Unreal plugin code where it is for now (`unreal-plugin/`). Reorg focus is MCP surface stability.
* Skills should live under `.opencode/skills/` so OpenCode can load them reliably.

## Tool Registry (Single Source of Truth)

### Registry requirements

Each tool must have one canonical metadata entry.

Minimum fields (example):

```json
{
  "name": "unreal.compile_blueprint",
  "domain": "blueprint",
  "priority": 4,
  "access": "write",
  "risk": "medium",
  "requires_editor": true,
  "requires_pie": false,
  "packs": ["unreal.blueprint.write", "unreal.diagnostics"],
  "skill": "blueprint-edit-and-validate",
  "schema": "#/schemas/compile_blueprint"
}
```

Additional strongly recommended fields:

* `summary`: one-liner intent.
* `stability`: `experimental | stable | deprecated`.
* `feature_flag`: optional gate.
* `owner`: `mcp | plugin` (where the real implementation lives).
* `test_tags`: `unit`, `integration`, and workflow names.

### Schema strategy

Keep schemas deterministic and centralized:

1. `registry.json` references input schemas by `$ref` into `registry.schema.json` (or a `schemas.json` file colocated in `MCP/tools/`).
2. Output is always JSON text, but must conform to a shared envelope:

```json
{
  "ok": true,
  "result": {}
}
```

Failure envelope:

```json
{
  "ok": false,
  "error": {
    "code": "...",
    "message": "...",
    "details": {}
  }
}
```

### Generation pipeline

Stop maintaining `TOOL_DEFS` by hand.

1. Create `MCP/tools/registry.json` (source of truth).
2. Add a build step in `mcp-server`:
   1. Validate registry against `registry.schema.json`.
   2. Generate `mcp-server/src/tools/generated/tool-defs.ts`.
   3. Server `ListTools` uses the generated defs.
3. Tool dispatcher uses generated metadata to:
   1. apply pack policy and permissions
   2. enforce editor/PIE preconditions consistently
   3. attach telemetry

This makes new tools cheap: add one registry entry and one implementation mapping.

## Capability Packs (Read/Write Separation)

### Initial packs (based on implemented Priority 0-4)

* `unreal.core`: ping/status/version/protocol/session health
* `unreal.editor.read`: selection, open editors, current level, etc.
* `unreal.editor.write`: (likely empty in v0.1; reserved)
* `unreal.blueprint.read`: blueprint inspection + graph queries
* `unreal.blueprint.write`: compile/refresh/reconstruct/reinstance (treat as write)
* `unreal.diagnostics`: compile messages, mapping, compare results, validation

### Default policy

Default enabled packs:

```text
unreal.core
unreal.editor.read
unreal.blueprint.read
unreal.diagnostics
```

Write packs must be explicitly enabled (config/env).

### Pack policy enforcement

Rules enforced in `mcp-server` for every call:

1. Tool is in an enabled pack.
2. If `access=write`, a write-enabled configuration is present.
3. If `requires_editor=true`, ensure editor is ready.
4. If `requires_pie=true/false`, enforce PIE state constraints.

## Skills (First Three)

Create the three skills now and use them to drive missing primitives.

### Skill 1: `unreal-project-inspection`

Outcome: reliably answer "what project/editor state am I in".

Mandatory flow:

1. `unreal.get_connection_status` (probe optional)
2. `unreal.get_editor_status`
3. `unreal.get_engine_version`
4. `unreal.get_current_project`
5. `unreal.get_message_log_summary` (if present)

### Skill 2: `blueprint-inspection`

Outcome: locate and inspect the relevant Blueprint and graph with bounded output.

Mandatory flow:

1. `unreal.get_open_editors` and/or `unreal.get_active_blueprint`
2. If no active Blueprint: `unreal.list_assets` to find candidates
3. `unreal.get_blueprint_summary`
4. `unreal.get_blueprint_graphs`
5. `unreal.get_blueprint_graph` (bounded mode)
6. If needed: `unreal.find_blueprint_nodes`

### Skill 3: `blueprint-edit-and-validate`

Outcome: smallest safe mutation loop. If mutation primitives are not ready yet, the skill still must enforce the safety envelope and stop.

Mandatory flow (write path):

1. Inspect target (`unreal.inspect_blueprint` or `unreal.get_blueprint_summary`).
2. Confirm graph exists (`unreal.get_blueprint_graphs`).
3. Begin transaction (requires plugin primitive; add if missing).
4. Apply smallest change.
5. Compile (`unreal.compile_blueprint` or `unreal.compile_selected_blueprint`).
6. Check diagnostics (`unreal.get_compile_messages` or `unreal.compile_and_capture_messages`).
7. Validate (`unreal.validate_blueprint_asset`, dependencies optional).
8. Save only after success (requires separate explicit save tool; if missing, the skill must not "pretend" to save).
9. Roll back on failure (transaction cancel/undo).

## Integration Tests (Workflow-Level)

Do not only test single tools.

### Test harness strategy

1. Keep unit tests for registry validation + pack policy.
2. Add integration tests that run the MCP server and exercise workflows.
3. Use two execution modes:
   1. `UNREAL_MOCK=1` for deterministic CI and schema stability.
   2. Optional local "live Unreal" mode for manual runs.

### First workflow scenarios

Success path:

```text
Open project
-> list assets
-> inspect blueprint
-> inspect graph
-> compile
-> read messages
```

Failure paths:

```text
Invalid asset path
Editor not ready
PIE already running (when a tool requires stopped)
Compile failure
Timeout/cancellation
```

Write workflow failure requirement:

* After a failed write, Unreal must remain usable and the target asset must be in a known state (transaction rolled back or explicitly left dirty with a clear error).

## Telemetry (Local-Only)

Add lightweight telemetry in `mcp-server` (off by default, or on by default but local-only and content-free):

* tool name
* duration
* ok/fail
* error category (`unreal_error | exception | policy_denied | validation_failed | timeout | cancelled`)
* request payload size
* response size
* editor state and PIE state
* pack set and write-enabled flag

Output format: NDJSON to a local file (for example `mcp-server/.telemetry/tool_calls.ndjson`).

Never record:

* asset content
* graph node bodies
* raw logs

Provide an explicit opt-in flag if deeper capture is ever needed.

## Structured Errors (Consistency)

Unify three sources into one envelope:

1. Unreal plugin errors (`ok:false, error:{code,...}`).
2. MCP-side policy errors (packs/permissions/preconditions).
3. MCP-side exceptions (wrap into `INTERNAL_MCP_ERROR` with safe details).

Add a single "error catalog" doc (`docs/errors.md`) listing all codes and when they occur.

## Execution Plan (Parallel Workstreams)

This is designed so we can do "reorg" and "skills" in parallel without waiting for a big-bang refactor.

### Workstream A: Reorg + Registry + Packs (Foundation)

1. Add `MCP/tools/registry.schema.json` and `MCP/tools/registry.json`.
2. Add generator/loader in `mcp-server` and remove the hand-maintained `TOOL_DEFS` list.
3. Add `MCP/packs/*.json` and enforce pack policy at runtime.
4. Mark every existing Priority 0-4 tool with `access`, `risk`, `requires_editor`, `requires_pie`, and `packs`.
5. Add server-side precondition checks so every tool gets the same guardrails.

Acceptance:

* `npm run build` produces generated tool defs.
* `listTools` output is entirely derived from registry.
* Default packs expose no write tools.

### Workstream B: Skills (In Parallel)

1. Add the three skills under `.opencode/skills/`.
2. Each skill references only packs it needs.
3. Each skill documents the required safe ordering and failure behavior.

Acceptance:

* Each skill can be loaded and executed without relying on undocumented behavior.
* `blueprint-edit-and-validate` refuses to proceed if write packs are not enabled.

### Workstream C: Workflow Integration Tests (In Parallel)

1. Add integration harness that runs the server and executes the workflow sequences.
2. Add failure tests for invalid inputs and policy denial.
3. Add at least one write-workflow test that intentionally fails and asserts rollback behavior (may require adding a minimal transaction primitive to the plugin).

Acceptance:

* Tests pass in mock mode.
* Tests can be run locally against a live Unreal project.

### Workstream D: Telemetry + Error Catalog

1. Add telemetry capture + sampling limits.
2. Add `docs/errors.md` and enforce a stable error code set.

Acceptance:

* Every tool call emits one telemetry record (when enabled).
* Error codes are consistent across tools and tests.

## "Skills + Priorities" Rule Going Forward

For any new tool (Priority 5+ later), Definition of Done includes:

1. Registry entry exists.
2. Tool is assigned to at least one pack.
3. Tool has a skill association (or explicitly `skill: null` with justification).
4. Tool has at least one integration test scenario that uses it as part of a workflow.
5. Structured errors are documented and stable.
6. Telemetry categorizes failures correctly.

This is the mechanism that keeps the surface scalable as the tool count grows.
