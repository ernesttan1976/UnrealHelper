# Unreal Debugging Copilot — Build Plan

## 1. Product definition

Build a **local, read-first debugging copilot** for Unreal Engine that allows an agent in OpenCode to:

1. inspect the current Unreal Editor state;
2. inspect a selected Blueprint;
3. compile it and retrieve diagnostics;
4. start and stop Play in Editor;
5. observe runtime events and actor properties;
6. explain why expected behaviour did not occur;
7. suggest specific Blueprint changes.

The first version should **not automatically modify Blueprints**.

That keeps the system safer and considerably smaller.

### Example interaction

```text
User:
Why does my sliding door move in world Y?

Agent:
1. PIE is running.
2. BP_SlidingDoor is selected.
3. Timeline DoorMovement is producing alpha values from 0 to 1.
4. The final node calls SetActorLocation.
5. SetActorLocation uses world coordinates.
6. The door should move relative to its parent.

Recommended change:
Replace SetActorLocation with SetRelativeLocation on the sliding-door
mesh or Scene Component.
```

---

# 2. System architecture

```text
┌──────────────────────────────┐
│ OpenCode / AI agent          │
│                              │
│ Reasoning                    │
│ Tool selection               │
│ Diagnosis                    │
└──────────────┬───────────────┘
               │ MCP
┌──────────────▼───────────────┐
│ Unreal Debug MCP Server      │
│ TypeScript / Node.js         │
│                              │
│ Tool schemas                 │
│ Validation                   │
│ Response compression         │
│ Diagnostic workflows         │
└──────────────┬───────────────┘
               │ localhost JSON-RPC
┌──────────────▼───────────────┐
│ Unreal Editor Plugin         │
│ C++ Editor module            │
│                              │
│ Blueprint inspection         │
│ Compilation                  │
│ PIE control                  │
│ Runtime observation          │
│ Logs and screenshots         │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│ Unreal Editor and PIE world  │
└──────────────────────────────┘
```

MCP is suitable for the outer interface because an MCP server can expose structured tools with named inputs and outputs. The official TypeScript SDK supports local `stdio` transport, while remote servers can use Streamable HTTP. For OpenCode on the same computer, use `stdio` between OpenCode and the MCP server. ([Model Context Protocol][1])

Use a separate localhost connection between the MCP server and Unreal:

```text
OpenCode ←stdio→ MCP server ←TCP/WebSocket→ Unreal plugin
```

Do not make the Unreal plugin itself an MCP server initially. Keeping MCP logic in TypeScript will be much easier to develop, inspect and change.

---

# 3. Guiding principles

## Read first, write later

Version 1 may:

* inspect;
* compile;
* play;
* stop;
* capture;
* trace;
* diagnose.

Version 1 may not:

* create nodes;
* delete nodes;
* reconnect pins;
* modify properties;
* save assets automatically.

## Structured data, not giant logs

Bad response:

```json
{
  "logs": "12,000 lines of Unreal output"
}
```

Better response:

```json
{
  "window_seconds": 20,
  "counts": {
    "error": 1,
    "warning": 3,
    "display": 19
  },
  "events": [
    {
      "timestamp": "19:31:02.142",
      "category": "LogBlueprint",
      "severity": "Error",
      "message": "Accessed None reading DoorReference"
    }
  ]
}
```

## Evidence before diagnosis

Every diagnosis should state:

```text
Observation
Interpretation
Likely cause
Recommended test
Recommended correction
Confidence
```

## Never assume the expected behaviour

The agent must ask or infer:

```text
Expected:
Door moves 150 cm along its own local Y axis.

Observed:
Door moves along world Y.
```

A bug is the difference between those two states.

---

# 4. Development phases

## Phase 0 — Prove communication

### Goal

Make OpenCode call Unreal and receive a response.

### Unreal tools

```text
ping
get_editor_status
get_engine_version
get_current_project
```

### Example response

```json
{
  "connected": true,
  "engine_version": "5.6.x",
  "project": "TrainingPrototype",
  "editor_ready": true,
  "pie_state": "stopped"
}
```

### Build

Create an Unreal plugin containing:

```text
Source/
  UnrealDebugRuntime/
  UnrealDebugEditor/
```

Keep editor-only APIs inside `UnrealDebugEditor`.

### Acceptance test

From OpenCode:

```text
Call unreal_debug.get_editor_status
```

The agent receives valid structured JSON within a few seconds and can tell whether Unreal is running.

### Difficulty

Low.

---

## Phase 1 — Editor and selection observation

### Goal

Allow the agent to understand what the user is currently working on.

### Tools

```text
get_editor_status
get_selected_actors
get_selected_assets
get_open_editors
get_active_blueprint
get_selected_blueprint_node
get_current_level
```

Unreal’s editor APIs expose editor selections and Blueprint/editor structures. `TSelectionIterator` is one of the documented UnrealEd selection mechanisms. ([Epic Games Developers][2])

### `get_selected_actors`

Return:

```json
{
  "actors": [
    {
      "name": "BP_SlidingDoor_C_0",
      "class": "BP_SlidingDoor_C",
      "location": [200, 410, 0],
      "rotation": [0, 90, 0],
      "scale": [1, 1, 1],
      "hidden": false,
      "pending_kill": false
    }
  ]
}
```

### `get_active_blueprint`

Return:

```json
{
  "asset_path": "/Game/Doors/BP_SlidingDoor",
  "parent_class": "Actor",
  "compile_status": "up_to_date",
  "graphs": [
    "EventGraph",
    "ConstructionScript",
    "OpenDoor"
  ],
  "variables": [
    {
      "name": "ClosedLocation",
      "type": "Vector"
    },
    {
      "name": "OpenDistance",
      "type": "Float"
    }
  ]
}
```

### Acceptance test

The agent can answer:

```text
Which Blueprint am I editing?
Which actor is selected?
What components belong to it?
What are its current transform values?
```

### Difficulty

Low to moderate.

---

## Phase 2 — Blueprint graph inspection

### Goal

Convert Blueprint graphs into a representation an LLM can reason about.

Blueprint nodes derive through Unreal’s graph structures; `UK2Node` is the abstract base for Blueprint graph nodes and itself derives from `UEdGraphNode`. Unreal also exposes Blueprint graph and Kismet editor APIs for graph-related operations. ([Epic Games Developers][3])

### Tools

```text
get_blueprint_summary
get_blueprint_graph
get_blueprint_node
find_blueprint_nodes
get_node_connections
get_blueprint_variables
get_blueprint_functions
```

### Graph serialization

Do not initially return node positions, colours and every editor field.

Return semantic information:

```json
{
  "graph": "EventGraph",
  "nodes": [
    {
      "id": "node-17",
      "type": "Event",
      "class": "UK2Node_ComponentBoundEvent",
      "title": "OnComponentBeginOverlap (Trigger)",
      "outputs": [
        {
          "name": "exec",
          "kind": "exec",
          "connected_to": ["node-23.exec_in"]
        },
        {
          "name": "Other Actor",
          "kind": "object",
          "type": "Actor",
          "connected_to": ["node-20.object"]
        }
      ]
    },
    {
      "id": "node-23",
      "type": "Timeline",
      "title": "DoorTimeline",
      "inputs": [
        {
          "name": "Play",
          "kind": "exec",
          "connected_from": ["node-17.exec"]
        }
      ]
    }
  ]
}
```

### Add compact modes

```text
summary
execution_only
data_flow
full
```

For most debugging, `execution_only` should be the default.

### Graph validation rules

Implement deterministic checks before asking the LLM to reason:

```text
Unconnected required input
Unconnected execution input
Dead execution branch
Variable read before assignment
Object reference used without validity check
Timeline has no Play connection
Timeline Update output unused
Branch condition constant
Cast failure output unused
Component event bound to missing component
World transform used on child component
```

These checks are not complete proofs of bugs, but they create useful evidence.

### Acceptance test

Given a sliding-door Blueprint, the agent can identify:

* what starts the Timeline;
* whether `Update` is connected;
* what Lerp is used;
* what location-setting node is called;
* whether the operation uses actor, world or relative coordinates.

### Difficulty

Moderate.

---

## Phase 3 — Compilation diagnostics

### Goal

Compile the current Blueprint and return useful messages.

Unreal exposes Blueprint compilation infrastructure through classes such as `FBlueprintCompilationManager`; `FBlueprintEditorUtils` provides editor-side Blueprint utilities. ([Epic Games Developers][4])

### Tools

```text
compile_blueprint
get_blueprint_compile_status
get_compile_messages
compile_and_diagnose
```

### `compile_blueprint`

Input:

```json
{
  "asset_path": "/Game/Doors/BP_SlidingDoor",
  "save_after_compile": false
}
```

Output:

```json
{
  "success": false,
  "status": "error",
  "errors": [
    {
      "message": "This blueprint is not a SceneComponent...",
      "node_id": "node-41",
      "graph": "EventGraph"
    }
  ],
  "warnings": [],
  "dirty": true,
  "saved": false
}
```

### Important policy

Compilation may be automatic.

Saving must require a separate explicit tool:

```text
save_asset
```

Do not bundle compile and save.

### Acceptance test

The agent can:

1. compile the active Blueprint;
2. map errors to graph nodes;
3. retrieve the offending node;
4. explain the message in beginner-friendly language.

### Difficulty

Moderate.

---

## Phase 4 — Logs and PIE control

### Goal

Let the agent run the game and observe what happens.

### Tools

```text
get_pie_state
start_pie
stop_pie
pause_pie
resume_pie
get_recent_logs
clear_debug_session
start_debug_session
end_debug_session
```

### PIE states

Use an explicit enum:

```text
stopped
starting
running
paused
simulating
stopping
unknown
```

### Scoped log sessions

Avoid giving the agent the entire Unreal log.

Workflow:

```text
start_debug_session
start_pie
perform test
get_recent_logs
stop_pie
end_debug_session
```

### Log filters

```json
{
  "since_session_start": true,
  "categories": [
    "LogBlueprint",
    "LogTemp",
    "LogScript"
  ],
  "minimum_severity": "warning",
  "limit": 200
}
```

### Acceptance test

The agent can distinguish:

```text
Blueprint compiled successfully,
but the overlap event never appeared in the runtime log.
```

from:

```text
Overlap fired,
but DoorReference was null.
```

### Difficulty

Moderate.

---

## Phase 5 — Purpose-built runtime events

### Goal

Stop relying only on textual logs.

Create a small runtime Blueprint function library:

```text
DebugEvent
DebugValue
DebugActor
DebugCheckpoint
DebugExpectation
```

A user can insert these nodes while learning:

```text
DebugEvent("DoorOverlap")
DebugValue("TimelineAlpha", Alpha)
DebugActor("OverlappingActor", OtherActor)
```

### Runtime event format

```json
{
  "sequence": 48,
  "time": 3.412,
  "event": "TimelineUpdate",
  "source_actor": "BP_SlidingDoor_C_0",
  "source_blueprint": "/Game/Doors/BP_SlidingDoor",
  "graph": "EventGraph",
  "values": {
    "Alpha": 0.42,
    "RelativeY": 63.0
  }
}
```

### Tools

```text
get_runtime_events
get_runtime_event_summary
find_runtime_event
get_last_event_for_actor
```

### Circular buffer

Keep events in memory:

```text
Maximum: 5,000 events
Drop oldest events
Sequence-number every event
Filter before serialization
```

Do not write continuously to disk by default.

### Acceptance test

The agent can reconstruct:

```text
Overlap → Timeline Play → Timeline Update × 64 → Completed
```

and detect:

```text
Overlap occurred, but Timeline Play did not.
```

### Difficulty

Moderate.

---

## Phase 6 — Actor and component state

### Goal

Inspect runtime objects directly.

### Tools

```text
get_actor_state
get_component_tree
get_component_state
get_property_value
watch_property
get_actor_relationships
find_runtime_actor
```

### `get_component_tree`

```json
{
  "actor": "BP_SlidingDoor_C_0",
  "components": [
    {
      "name": "DefaultSceneRoot",
      "class": "SceneComponent",
      "parent": null,
      "relative_location": [0, 0, 0],
      "world_location": [200, 410, 0]
    },
    {
      "name": "SlideRoot",
      "class": "SceneComponent",
      "parent": "DefaultSceneRoot",
      "relative_location": [0, 0, 0],
      "world_location": [200, 410, 0]
    },
    {
      "name": "DoorMesh",
      "class": "StaticMeshComponent",
      "parent": "SlideRoot",
      "relative_location": [0, 0, 0],
      "mobility": "Movable"
    }
  ]
}
```

### Property safety

Initial property support:

* Boolean
* Integer
* Float
* String
* Name
* Vector
* Rotator
* Transform
* Enum
* object name/path
* arrays of simple values

Avoid arbitrary recursive object serialization. It will produce enormous and cyclic responses.

### Acceptance test

The agent can diagnose:

```text
DoorMesh is a child of SlideRoot.
Its relative Y changed by 150.
Its world direction appears different because SlideRoot is rotated.
```

### Difficulty

Moderate to high.

---

## Phase 7 — Time-series property watching

### Goal

Observe changing values without polling the whole actor.

### Tools

```text
start_property_watch
get_property_samples
stop_property_watch
list_property_watches
```

### Example

```json
{
  "actor": "BP_SlidingDoor_C_0",
  "property": "SlideRoot.RelativeLocation",
  "interval_ms": 50,
  "duration_seconds": 5
}
```

Response:

```json
{
  "samples": [
    {"t": 0.00, "value": [0, 0, 0]},
    {"t": 0.05, "value": [0, 4.5, 0]},
    {"t": 0.10, "value": [0, 11.3, 0]}
  ],
  "summary": {
    "changed": true,
    "minimum": [0, 0, 0],
    "maximum": [0, 150, 0]
  }
}
```

### Guardrails

Limit:

```text
Maximum watches: 10
Minimum interval: 33 ms
Maximum default duration: 30 seconds
Simple properties only
```

### Acceptance test

The agent can prove that a value is:

* never changing;
* changing in the wrong range;
* changing in the wrong coordinate system;
* resetting unexpectedly;
* changing before the expected event.

### Difficulty

High.

---

## Phase 8 — Viewport evidence

### Goal

Let the agent compare structured state with visible behaviour.

### Tools

```text
capture_editor_viewport
capture_pie_viewport
capture_blueprint_graph
```

### Use cases

* actor is below the floor;
* collision volume is misplaced;
* door visually travels in the wrong direction;
* the wrong object is selected;
* a component is unexpectedly scaled;
* graph wiring needs visual verification.

Screenshots should supplement structured inspection, not replace it.

### Acceptance test

The agent can combine:

```text
Actor transform
Component hierarchy
Blueprint graph
Runtime events
Viewport capture
```

into a single diagnosis.

### Difficulty

Moderate.

---

# 5. The first useful MVP

Do not build every phase before using it.

The first genuinely useful release should contain these **12 tools**:

```text
1.  get_editor_status
2.  get_selected_actors
3.  get_active_blueprint
4.  get_blueprint_summary
5.  get_blueprint_graph
6.  compile_blueprint
7.  get_compile_messages
8.  get_pie_state
9.  start_pie
10. stop_pie
11. get_recent_logs
12. get_component_tree
```

This MVP can already answer:

* Why does this Blueprint not compile?
* Is PIE actually running?
* Is the correct Blueprint selected?
* Is my event connected?
* Is the Timeline being started?
* Am I moving the actor or its child component?
* Is the component movable?
* Am I using world or relative coordinates?
* Did an Unreal runtime error occur?

---

# 6. Recommended repository layout

```text
unreal-debug-copilot/
├── unreal-plugin/
│   └── UnrealDebugCopilot/
│       ├── UnrealDebugCopilot.uplugin
│       ├── Source/
│       │   ├── UnrealDebugRuntime/
│       │   │   ├── Public/
│       │   │   │   ├── DebugEventSubsystem.h
│       │   │   │   └── DebugBlueprintLibrary.h
│       │   │   └── Private/
│       │   └── UnrealDebugEditor/
│       │       ├── Public/
│       │       │   ├── DebugServer.h
│       │       │   ├── BlueprintInspector.h
│       │       │   ├── PieController.h
│       │       │   └── LogCollector.h
│       │       └── Private/
│       └── Resources/
│
├── mcp-server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── unreal-client.ts
│   │   ├── schemas/
│   │   ├── tools/
│   │   │   ├── editor.ts
│   │   │   ├── blueprints.ts
│   │   │   ├── pie.ts
│   │   │   ├── logs.ts
│   │   │   └── runtime.ts
│   │   └── workflows/
│   │       ├── diagnose-blueprint.ts
│   │       ├── diagnose-event-not-fired.ts
│   │       └── diagnose-movement.ts
│   ├── tests/
│   └── package.json
│
├── skill/
│   └── SKILL.md
│
├── examples/
│   ├── SlidingDoor/
│   ├── TriggerLight/
│   ├── InvalidReference/
│   └── BrokenTimeline/
│
└── docs/
    ├── protocol.md
    ├── tool-contracts.md
    ├── architecture.md
    └── troubleshooting.md
```

---

# 7. Protocol design

Use request IDs and explicit error types.

## Request

```json
{
  "protocol_version": 1,
  "request_id": "req-102",
  "method": "blueprint.get_graph",
  "params": {
    "asset_path": "/Game/Doors/BP_SlidingDoor",
    "graph": "EventGraph",
    "mode": "execution_only"
  }
}
```

## Success

```json
{
  "protocol_version": 1,
  "request_id": "req-102",
  "ok": true,
  "result": {}
}
```

## Failure

```json
{
  "protocol_version": 1,
  "request_id": "req-102",
  "ok": false,
  "error": {
    "code": "BLUEPRINT_NOT_FOUND",
    "message": "Blueprint asset could not be found.",
    "details": {
      "asset_path": "/Game/Doors/BP_SlidingDoor"
    }
  }
}
```

## Important error codes

```text
UNREAL_NOT_CONNECTED
EDITOR_NOT_READY
PIE_NOT_RUNNING
PIE_ALREADY_RUNNING
ASSET_NOT_FOUND
BLUEPRINT_NOT_FOUND
GRAPH_NOT_FOUND
NODE_NOT_FOUND
ACTOR_NOT_FOUND
COMPONENT_NOT_FOUND
PROPERTY_NOT_FOUND
UNSUPPORTED_PROPERTY_TYPE
COMPILE_FAILED
REQUEST_TIMEOUT
INVALID_REQUEST
INTERNAL_UNREAL_ERROR
```

---

# 8. Copilot workflows

Individual tools are not enough. Give the agent standard workflows.

## Workflow A — Blueprint does not compile

```text
1. get_active_blueprint
2. compile_blueprint
3. get_compile_messages
4. get_blueprint_node for each reported node
5. explain error
6. recommend smallest correction
```

## Workflow B — Event does not fire

```text
1. get_blueprint_graph
2. confirm event node exists
3. inspect event source component
4. get_component_state
5. start_debug_session
6. start_pie
7. collect runtime events and logs
8. determine whether event occurred
9. inspect collision/input prerequisites
10. recommend one isolating test
```

## Workflow C — Object does not move

```text
1. inspect movement graph
2. find Timeline or interpolation source
3. inspect execution connections
4. inspect start/end values
5. inspect target actor/component
6. inspect mobility
7. run PIE
8. watch transform
9. compare expected and observed movement
```

## Workflow D — Accessed None

```text
1. collect exact runtime error
2. map the error to Blueprint and node
3. identify the referenced variable
4. determine where it should be assigned
5. inspect whether assignment path ran
6. recommend initialization or validity checking
```

---

# 9. Diagnostic report format

Make OpenCode always produce a consistent report.

```text
## Expected behaviour

Door should slide 150 cm along its local Y axis when the player enters
the trigger.

## Observed behaviour

The Timeline runs, but the door moves along world Y.

## Evidence

- OnComponentBeginOverlap fired.
- DoorTimeline played from 0 to 1.
- Lerp output changed correctly.
- The final movement node is SetActorLocation.
- DoorMesh is attached below a rotated Scene Component.

## Likely cause

SetActorLocation applies a world-space position to the entire actor.

## Recommended correction

Move SlideRoot using SetRelativeLocation.

## Verification

Run PIE and confirm:

- Relative Y changes from 0 to 150.
- Relative X and Z remain unchanged.
- Closing returns to the recorded closed location.

## Confidence

High
```

This makes the agent useful even when its conclusion is uncertain.

---

# 10. Testing strategy

Create deliberately broken Blueprint fixtures.

## Fixture 1 — Unconnected Timeline

Expected diagnosis:

```text
Overlap event fires, but Timeline Play is not connected.
```

## Fixture 2 — Static mobility

Expected diagnosis:

```text
Movement executes, but the target component is Static.
```

## Fixture 3 — World/local confusion

Expected diagnosis:

```text
SetActorLocation is applying world-space movement.
```

## Fixture 4 — Invalid reference

Expected diagnosis:

```text
DoorReference is read before it is assigned.
```

## Fixture 5 — Wrong collision settings

Expected diagnosis:

```text
Trigger ignores Pawn, so BeginOverlap cannot occur.
```

## Fixture 6 — Timeline range error

Expected diagnosis:

```text
Timeline outputs 0–100, but the Lerp expects an alpha between 0 and 1.
```

## Fixture 7 — Wrong graph

Expected diagnosis:

```text
The logic exists in a function that is never called.
```

## Fixture 8 — Input not enabled

Expected diagnosis:

```text
The actor contains an input event but does not receive player input.
```

For every fixture, store:

```text
Expected evidence
Expected diagnosis
Allowed alternative diagnosis
Disallowed hallucinations
```

---

# 11. Security and reliability

Bind the Unreal server only to:

```text
127.0.0.1
```

Add:

* random session token;
* maximum request size;
* timeout per request;
* tool allowlist;
* no arbitrary C++ execution;
* no arbitrary console command tool;
* no arbitrary Python execution;
* no filesystem access through the Unreal endpoint;
* separate read and write permissions.

MCP tools allow models to invoke external actions, so tool descriptions and schemas should be narrow and explicit rather than exposing a general-purpose `execute_command` endpoint. ([Model Context Protocol][5])

---

# 12. What to postpone

Do not build these until the observation system works well:

```text
create_blueprint
add_node
delete_node
connect_pins
change_component_hierarchy
modify_collision
edit_material
edit_animation_blueprint
edit_niagara
generate_level
execute_python
execute_console_command
```

Blueprint editing introduces:

* transactions;
* undo/redo;
* graph schema validation;
* pin compatibility;
* asset dirtiness;
* recompilation;
* saving;
* editor crashes;
* destructive agent mistakes.

The initial product should help you **understand and fix** Blueprints manually.

---

# 13. Practical build sequence

## Milestone 1 — Connection

Deliver:

```text
Unreal plugin loads
Local server starts
MCP connects
get_editor_status works
```

## Milestone 2 — Context

Deliver:

```text
Selected actor
Selected asset
Active Blueprint
Component hierarchy
```

## Milestone 3 — Static Blueprint diagnosis

Deliver:

```text
Graph serialization
Node connections
Variables
Functions
Compile messages
```

At this point, it becomes useful for everyday Blueprint questions.

## Milestone 4 — Runtime diagnosis

Deliver:

```text
PIE control
Scoped logs
Runtime debug events
Actor state
```

## Milestone 5 — Behaviour tracing

Deliver:

```text
Property watching
Execution sequence
Expected-versus-observed comparison
```

## Milestone 6 — Guided corrections

Deliver:

```text
Exact node-level recommendations
Verification procedures
Confidence and evidence
```

## Milestone 7 — Optional safe editing

Start with only tightly constrained actions:

```text
set_simple_property
connect_existing_compatible_pins
disconnect_pin
```

Every edit should:

1. show a proposed patch;
2. require approval;
3. create an Unreal transaction;
4. compile;
5. report diagnostics;
6. avoid saving automatically;
7. support Undo.

---

# 14. Recommended first sprint

Build only this vertical slice:

```text
get_editor_status
get_active_blueprint
get_blueprint_graph
compile_blueprint
get_compile_messages
get_selected_actors
get_component_tree
get_pie_state
start_pie
stop_pie
get_recent_logs
```

Use your two-sided sliding door as the first test project.

The first target scenario should be:

```text
“Inspect my selected sliding-door Blueprint and explain why it either
does not open or moves in the wrong direction.”
```

That one scenario exercises:

* Blueprint selection;
* graph inspection;
* event flow;
* Timeline wiring;
* Lerp inputs;
* component hierarchy;
* relative versus world transform;
* PIE state;
* logs;
* compile diagnostics.

Once it solves that scenario reliably, expand to lights, buttons, elevators, pickups and AI actors.

## Final scope recommendation

Your project should initially be positioned as:

> **An evidence-driven Blueprint debugging and learning copilot for Unreal Engine.**

Not:

> An autonomous Unreal development agent.

That narrower product is achievable, useful during your own learning, and differentiated from expensive systems whose main purpose is generating or editing large amounts of Unreal content.

[1]: https://modelcontextprotocol.io/docs/sdk?utm_source=chatgpt.com "SDKs"
[2]: https://dev.epicgames.com/documentation/unreal-engine/API/Editor/UnrealEd?utm_source=chatgpt.com "UnrealEd | Unreal Engine 5.7 Documentation"
[3]: https://dev.epicgames.com/documentation/unreal-engine/API/Editor/BlueprintGraph/UK2Node?utm_source=chatgpt.com "UK2Node | Unreal Engine 5.7 Documentation"
[4]: https://dev.epicgames.com/documentation/unreal-engine/API/Editor/Kismet/FBlueprintCompilationManager?utm_source=chatgpt.com "FBlueprintCompilationManager | Unreal Engine 5.7 ..."
[5]: https://modelcontextprotocol.io/specification/2025-06-18/server/tools?utm_source=chatgpt.com "Tools"
