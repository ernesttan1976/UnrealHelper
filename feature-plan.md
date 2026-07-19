# Unreal MCP Feature Plan (Policy-First)

This document is a **feature backlog** organized by priority, but it is not the tool surface of record.

Source of truth:

* Tools: `MCP/tools/registry.json` (generated tool defs; no hand-maintained lists)
* Policies: `MCP/packs/*.json` + server pack policy (`mcp-server/src/core/pack-policy.ts`)
* Default exposure: `MCP/packs/default.json`
* Workflows: `.opencode/skills/*` (must enforce safe ordering and refusal rules)

Naming:

* In the codebase, canonical tool names are `unreal.<tool>` (e.g. `unreal.get_editor_status`).
* In the tables below, the `unreal.` prefix is omitted for readability unless otherwise noted.

Guiding rule (from `scalable_unreal_mcp_plan.md`): treat Priorities **0-4** as the first stable product slice. Priority **5+** tools remain proposed and must be parked behind **non-default packs** (and often additional gates) so the default MCP surface stays conservative.

---

# Policies and packs

The pack system is the primary policy mechanism. A tool must belong to an enabled pack to be listed or called.

Current packs (v0.1):

| Pack | Access | Default | Notes |
| --- | --- | --- | --- |
| `unreal.core` | read | enabled | connectivity, protocol, session health |
| `unreal.editor.read` | read | enabled | editor context, selection, assets list, bounded object inspection |
| `unreal.blueprint.read` | read | enabled | blueprint inspection + bounded graph queries |
| `unreal.diagnostics` | mixed | enabled | diagnostics, validation, compile message capture |
| `unreal.blueprint.write` | write | disabled | compile/refresh/reconstruct style primitives |
| `unreal.editor.write` | write | disabled | transactions, save gating, editor mutations |

Write gate:

* Any tool with `access=write` requires `UNREAL_MCP_WRITE_ENABLED=1` in addition to its pack being enabled.

Planned additional policy buckets (Priority 5+), to keep sensitive/heavy/stateful features off by default:

| Bucket | Proposed pack name(s) | Why separate policy? |
| --- | --- | --- |
| Blueprint lint | `unreal.blueprint.lint.read` | deterministic checks; may be expensive; should be opt-in |
| PIE control | `unreal.pie.write` | changes runtime/editor state; safer behind explicit enable |
| Logs | `unreal.logs.read` | privacy + volume controls; opt-in by default |
| Runtime inspection | `unreal.runtime.read` | requires live world/PIE; potentially noisy |
| Reflection/deep properties | `unreal.reflect.read` | high cardinality/size; needs strict bounds |
| Tracing/events | `unreal.trace.write` | starts/stops capture; stateful; storage/PII concerns |
| Watches/samplers | `unreal.watch.write` | background sampling; resource impact |
| Capture (screenshots) | `unreal.capture.read` | privacy sensitive; large payloads |
| Profiling | `unreal.profiling.read` | heavy operations; can stall editor |
| Automation tests | `unreal.automation.write` | executes tests; changes runtime state |
| Workflow orchestration | `unreal.workflows.mixed` | high-level composite tools; must be tightly curated |
| Asset edits | `unreal.assets.write` | destructive potential; require extra approvals |
| Blueprint edits | `unreal.blueprint.edit.write` | asset mutation; requires transactions + rollback |
| Editor automation | `unreal.editor.automation.write` | destructive/large-scope editor actions |

# Priority 0 — Connection and session health

Policy:

* Pack: `unreal.core` (default enabled)
* Access: read
* Requires `UNREAL_MCP_WRITE_ENABLED`: no

Build these first. Without them, the agent cannot know whether its other observations are valid.

| MCP tool                    | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `ping`                      | Verify that Unreal is responding                     |
| `get_connection_status`     | Return plugin, MCP and transport status              |
| `get_editor_status`         | Editor ready, loading, compiling, closing or blocked |
| `get_engine_version`        | Return exact Unreal version                          |
| `get_project_info`          | Project name, path, target and configuration         |
| `get_plugin_version`        | Debug-copilot plugin and protocol version            |
| `get_protocol_capabilities` | List supported tools and feature flags               |
| `get_active_debug_session`  | Return the current observation session               |
| `start_debug_session`       | Begin scoped logs, events and traces                 |
| `end_debug_session`         | End the session and return a summary                 |
| `clear_debug_session`       | Remove accumulated session evidence                  |
| `cancel_current_operation`  | Cancel a long compile, scan or capture               |
| `get_last_tool_error`       | Retrieve the last bridge/plugin failure              |

A debug session should assign a stable ID and sequence number to every captured event. Otherwise logs, PIE events and actor samples become difficult to correlate.

---

# Priority 1 — Current editor context

Policy:

* Pack: `unreal.editor.read` (default enabled)
* Access: read
* Requires editor: yes
* Requires `UNREAL_MCP_WRITE_ENABLED`: no

These give the agent the answer to:

> What is the user currently looking at?

| MCP tool                           | Purpose                                            |
| ---------------------------------- | -------------------------------------------------- |
| `get_current_level`                | Active editor world and map                        |
| `get_open_levels`                  | Persistent and streamed levels                     |
| `get_selected_actors`              | Actors selected in the Outliner or viewport        |
| `get_selected_assets`              | Assets selected in the Content Browser             |
| `get_selected_components`          | Currently selected components                      |
| `get_active_asset_editor`          | Blueprint, material, animation or other editor     |
| `get_open_asset_editors`           | All currently open asset editors                   |
| `get_active_blueprint`             | Blueprint currently being edited                   |
| `get_active_blueprint_graph`       | Event Graph, function, macro or construction graph |
| `get_selected_blueprint_nodes`     | Nodes selected in the graph editor                 |
| `get_focused_blueprint_node`       | Most relevant selected/focused node                |
| `get_editor_viewport_state`        | Camera transform, view mode and selected viewport  |
| `get_world_outliner_selection`     | Exact Outliner selection                           |
| `get_content_browser_path`         | Current Content Browser folder                     |
| `get_editor_mode`                  | Select, Landscape, Foliage, Modeling and so on     |
| `get_dirty_assets`                 | Assets modified but not saved                      |
| `get_pending_editor_notifications` | Toasts, warnings and modal notifications           |
| `get_message_log_summary`          | Counts across Unreal Message Log categories        |

## Essential subset

Implement these immediately:

```text
get_editor_status
get_current_level
get_selected_actors
get_selected_assets
get_active_blueprint
get_active_blueprint_graph
get_selected_blueprint_nodes
get_dirty_assets
```

---

# Priority 2 — Blueprint summary and static inspection

Policy:

* Pack: `unreal.blueprint.read` (default enabled)
* Access: read
* Requires editor: yes
* Requires `UNREAL_MCP_WRITE_ENABLED`: no

This is the core of a Blueprint debugging copilot.

Unreal’s editor-side Blueprint structures include `UBlueprint`, `UEdGraph`, `UEdGraphNode`, `UEdGraphPin` and specialized `UK2Node` types. `FBlueprintEditorUtils` provides many editor utilities around Blueprint graphs and metadata. ([Epic Games Developers][2])

| MCP tool                          | Purpose                                            |
| --------------------------------- | -------------------------------------------------- |
| `get_blueprint_summary`           | Compact overview of the Blueprint                  |
| `get_blueprint_metadata`          | Type, parent class, interfaces and status          |
| `get_blueprint_parent_class`      | Parent Blueprint or native class                   |
| `get_blueprint_interfaces`        | Implemented interfaces                             |
| `get_blueprint_components`        | Simple Construction Script components              |
| `get_blueprint_component_tree`    | Parent-child component hierarchy                   |
| `get_blueprint_variables`         | Variables, types, defaults and flags               |
| `get_blueprint_local_variables`   | Locals belonging to a function                     |
| `get_blueprint_functions`         | Function names, inputs, outputs and flags          |
| `get_blueprint_macros`            | Macro definitions                                  |
| `get_blueprint_event_dispatchers` | Dispatchers and signatures                         |
| `get_blueprint_timelines`         | Timelines, tracks, lengths and settings            |
| `get_blueprint_graphs`            | All Event, function, macro and construction graphs |
| `get_blueprint_graph`             | Structured nodes and connections for one graph     |
| `get_blueprint_node`              | Full information about one node                    |
| `get_blueprint_nodes`             | Filtered list of graph nodes                       |
| `get_blueprint_node_pins`         | Input/output pins and types                        |
| `get_blueprint_node_connections`  | Connections for one node                           |
| `get_blueprint_execution_flow`    | Execution-pin graph only                           |
| `get_blueprint_data_flow`         | Data-pin graph only                                |
| `get_blueprint_node_defaults`     | Literal/default pin values                         |
| `get_blueprint_references`        | Assets, classes and objects referenced             |
| `get_blueprint_dependencies`      | Assets required by this Blueprint                  |
| `get_blueprint_dependents`        | Assets that depend on this Blueprint               |
| `get_blueprint_debug_object`      | Current runtime instance being debugged            |
| `get_blueprint_breakpoints`       | Existing Blueprint breakpoints                     |
| `get_blueprint_watches`           | Watched pins and variables                         |
| `get_blueprint_bookmarks`         | Graph bookmarks                                    |
| `get_blueprint_compile_status`    | Dirty, up-to-date, warning or error                |
| `get_blueprint_class_defaults`    | Class Default Object values                        |
| `get_blueprint_node_comment`      | Comment associated with a node                     |
| `get_blueprint_graph_comments`    | Comment boxes and contained nodes                  |

## Recommended `get_blueprint_graph` modes

One tool should support several output modes:

```text
summary
execution_only
data_flow
selected_neighbourhood
function_calls
events_only
full
```

Do not send the full graph by default. Large Blueprints can overwhelm the agent with irrelevant node layout and metadata.

### Example request

```json
{
  "asset_path": "/Game/Doors/BP_SlidingDoor",
  "graph": "EventGraph",
  "mode": "execution_only",
  "max_depth": 12
}
```

---

# Priority 3 — Blueprint search and navigation

Policy:

* Pack: `unreal.blueprint.read` (default enabled) for pure search/query tools
* Pack: `unreal.blueprint.write` (default disabled) for editor-navigation/mutation helpers (e.g. selecting nodes)
* Access: read for search, write for selection/navigation helpers
* Requires `UNREAL_MCP_WRITE_ENABLED`: only for write helpers

Inspection is ineffective if the agent cannot locate relevant nodes.

| MCP tool                              | Purpose                                       |
| ------------------------------------- | --------------------------------------------- |
| `find_blueprint_nodes`                | Search nodes by title, class or function      |
| `find_blueprint_events`               | Locate overlap, input, tick and custom events |
| `find_blueprint_function_calls`       | Find calls to a particular function           |
| `find_blueprint_variable_reads`       | Locate reads of a variable                    |
| `find_blueprint_variable_writes`      | Locate assignments to a variable              |
| `find_blueprint_component_references` | Find nodes targeting a component              |
| `find_blueprint_asset_references`     | Find references to an asset                   |
| `find_blueprint_class_references`     | Find usages of a class                        |
| `find_blueprint_unconnected_pins`     | Locate unconnected pins                       |
| `find_blueprint_dead_ends`            | Execution paths with no continuation          |
| `find_blueprint_entry_points`         | Events and externally called functions        |
| `find_blueprint_callers`              | Find callers of a function or event           |
| `find_blueprint_implementations`      | Find implementations of interface calls       |
| `trace_blueprint_path`                | Find a graph path between two nodes           |
| `get_upstream_nodes`                  | Nodes that contribute to a pin/value          |
| `get_downstream_nodes`                | Nodes affected by a node/output               |
| `get_node_neighbourhood`              | Small graph around one node                   |
| `focus_blueprint_node`                | Navigate the editor to a node                 |
| `open_blueprint_graph`                | Open and focus a graph                        |
| `select_blueprint_nodes`              | Select nodes for the user to inspect          |

## High-value query

```text
find_blueprint_nodes(
  query="Set Relative Location",
  graph="EventGraph"
)
```

This is much better than making the agent inspect every node manually.

---

# Priority 4 — Compilation and diagnostics

Policy:

* Pack: `unreal.diagnostics` (default enabled) for diagnostics/validation reads
* Pack: `unreal.blueprint.write` (default disabled) for compile/refresh/reconstruct primitives
* Access: mixed (reads are default; writes require explicit enable)
* Requires `UNREAL_MCP_WRITE_ENABLED`: yes for compile/write primitives

| MCP tool                          | Purpose                                            |
| --------------------------------- | -------------------------------------------------- |
| `compile_blueprint`               | Compile one Blueprint without automatically saving |
| `compile_selected_blueprint`      | Compile the active Blueprint                       |
| `compile_blueprints`              | Compile several named Blueprints                   |
| `compile_all_dirty_blueprints`    | Compile modified Blueprint assets                  |
| `get_compile_messages`            | Errors, warnings and notes                         |
| `get_compile_message_details`     | Full details for one diagnostic                    |
| `get_compile_error_nodes`         | Map errors back to nodes                           |
| `get_compile_warning_nodes`       | Map warnings back to nodes                         |
| `compile_and_capture_messages`    | Compile and return normalized diagnostics          |
| `get_generated_class_status`      | Check generated class availability                 |
| `get_skeleton_class_status`       | Inspect Blueprint skeleton class                   |
| `get_blueprint_bytecode_summary`  | Optional compiled execution summary                |
| `get_last_successful_compile`     | Last known clean compile                           |
| `compare_compile_results`         | Compare before and after diagnostics               |
| `reinstance_blueprint`            | Advanced recovery after recompilation              |
| `refresh_blueprint_nodes`         | Refresh stale nodes                                |
| `reconstruct_blueprint_node`      | Reconstruct a specific node                        |
| `validate_blueprint_asset`        | Run asset validation                               |
| `validate_blueprint_dependencies` | Detect missing or broken dependencies              |

Unreal exposes Blueprint compilation infrastructure and editor utilities, but implementation may require internal editor modules rather than relying only on the experimental Python API. ([Epic Games Developers][3])

## Compile response should include

```json
{
  "success": false,
  "errors": 1,
  "warnings": 2,
  "messages": [
    {
      "severity": "error",
      "graph": "EventGraph",
      "node_id": "4A9...",
      "node_title": "Set Relative Location",
      "message": "Target is not a Scene Component"
    }
  ]
}
```

---

# Priority 5 — Deterministic Blueprint linting

Policy (parked behind non-default pack):

* Pack: `unreal.blueprint.lint.read` (proposed; default disabled)
* Access: read
* Requires `UNREAL_MCP_WRITE_ENABLED`: no

These tools do not merely retrieve data. They perform known checks before the LLM reasons about the result.

| MCP tool                                 | Purpose                                      |
| ---------------------------------------- | -------------------------------------------- |
| `lint_blueprint`                         | Run all enabled static checks                |
| `check_unconnected_exec_pins`            | Detect incomplete execution paths            |
| `check_unconnected_required_inputs`      | Detect required values that are absent       |
| `check_dead_execution_paths`             | Find unreachable or dead branches            |
| `check_unused_variables`                 | Variables never read                         |
| `check_never_assigned_variables`         | Variables read but never assigned            |
| `check_null_reference_risks`             | Object use without validity protection       |
| `check_unhandled_cast_failures`          | Ignored failed-cast paths                    |
| `check_unhandled_async_failures`         | Ignored async failure callbacks              |
| `check_timeline_wiring`                  | Missing Play, Update or Completed wiring     |
| `check_timeline_ranges`                  | Suspicious alpha or time ranges              |
| `check_component_mobility`               | Movement applied to Static components        |
| `check_world_relative_transform_usage`   | World/local transform mismatches             |
| `check_collision_event_prerequisites`    | Collision settings versus events             |
| `check_input_event_prerequisites`        | Input mode, ownership and enablement         |
| `check_tick_usage`                       | Expensive or unnecessary Event Tick logic    |
| `check_latent_action_context`            | Delay/timeline use in invalid contexts       |
| `check_recursive_calls`                  | Accidental Blueprint recursion               |
| `check_event_dispatcher_bindings`        | Missing or duplicate bindings                |
| `check_interface_calls`                  | Interface calls against incompatible objects |
| `check_replication_configuration`        | Replicated variables/RPC mismatches          |
| `check_authority_paths`                  | Missing client/server authority handling     |
| `check_construction_script_side_effects` | Suspicious runtime logic in construction     |
| `check_expensive_graph_patterns`         | Repeated searches, casts and allocations     |
| `explain_lint_finding`                   | Beginner-friendly explanation                |
| `suppress_lint_rule`                     | Disable a rule for a Blueprint/session       |

These checks are particularly important because they ground the agent in deterministic evidence rather than leaving every diagnosis to language-model intuition.

---

# Priority 6 — PIE and simulation control

Policy (parked behind non-default pack):

* Pack: `unreal.pie.write` (proposed; default disabled)
* Access: write (state-changing)
* Requires `UNREAL_MCP_WRITE_ENABLED`: yes

| MCP tool                   | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `get_pie_state`            | Stopped, starting, running, paused or stopping |
| `get_pie_configuration`    | Selected viewport, players, net mode and map   |
| `start_pie`                | Play in the editor                             |
| `start_pie_in_viewport`    | PIE in the active viewport                     |
| `start_pie_in_new_window`  | PIE in a separate window                       |
| `start_simulate`           | Start Simulate in Editor                       |
| `stop_pie`                 | Stop the current session                       |
| `pause_pie`                | Pause gameplay                                 |
| `resume_pie`               | Resume gameplay                                |
| `single_step_pie`          | Advance a paused session                       |
| `restart_pie`              | Stop and restart                               |
| `eject_from_pawn`          | Switch to editor/spectator control             |
| `possess_pawn`             | Possess a specified runtime pawn               |
| `get_pie_worlds`           | Server and client PIE worlds                   |
| `get_pie_players`          | Players, controllers and pawns                 |
| `get_pie_net_mode`         | Standalone, listen server, client or dedicated |
| `set_pie_fixed_frame_rate` | Deterministic testing                          |
| `set_pie_time_dilation`    | Slow or accelerate gameplay                    |
| `wait_for_pie_state`       | Wait until running/stopped                     |
| `wait_for_actor_spawn`     | Wait for a runtime object                      |
| `wait_for_condition`       | Poll a constrained property condition          |
| `run_pie_for_duration`     | Run for a bounded period                       |
| `run_pie_test_sequence`    | Execute a predefined debug sequence            |

## Essential subset

```text
get_pie_state
start_pie
stop_pie
pause_pie
resume_pie
get_pie_worlds
get_pie_players
```

---

# Priority 7 — Logs and Unreal messages

Policy (parked behind non-default pack):

* Pack: `unreal.logs.read` (proposed; default disabled)
* Access: read
* Notes: privacy and volume bounded; require strict filters/limits

| MCP tool                       | Purpose                              |
| ------------------------------ | ------------------------------------ |
| `get_recent_logs`              | Retrieve filtered recent output      |
| `get_logs_since`               | Logs since timestamp or sequence     |
| `get_logs_for_debug_session`   | Logs scoped to the current test      |
| `search_logs`                  | Search message text or category      |
| `get_log_categories`           | Available log categories             |
| `get_log_summary`              | Counts grouped by severity/category  |
| `get_log_errors`               | Errors only                          |
| `get_log_warnings`             | Warnings only                        |
| `get_blueprint_runtime_errors` | Blueprint-related runtime failures   |
| `get_accessed_none_errors`     | Extract `Accessed None` failures     |
| `get_ensure_failures`          | Captured ensure messages             |
| `get_assertion_failures`       | Assertion details where available    |
| `get_crash_context`            | Last crash report/context            |
| `get_message_log_entries`      | Entries from Unreal Message Log      |
| `get_map_check_results`        | Map validation messages              |
| `get_asset_check_results`      | Asset validation messages            |
| `clear_captured_logs`          | Clear the plugin’s own buffer        |
| `set_log_capture_filters`      | Categories and severity              |
| `start_log_capture`            | Begin scoped capture                 |
| `stop_log_capture`             | Stop and summarize capture           |
| `export_debug_log_bundle`      | Structured bundle for later analysis |

Do not return unrestricted log history. Support category, severity, time window, session and result limits.

---

# Priority 8 — Runtime actor inspection

Policy (parked behind non-default pack):

* Pack: `unreal.runtime.read` (proposed; default disabled)
* Access: read
* Notes: typically requires PIE or an editor world; must be bounded

| MCP tool                      | Purpose                                      |
| ----------------------------- | -------------------------------------------- |
| `find_runtime_actors`         | Find actors by name, class, tag or interface |
| `get_runtime_actor`           | Summary of one actor                         |
| `get_actor_state`             | Transform, class, owner, role and flags      |
| `get_actor_transform`         | World transform                              |
| `get_actor_velocity`          | Linear and angular velocity                  |
| `get_actor_bounds`            | Runtime bounding box                         |
| `get_actor_owner`             | Ownership                                    |
| `get_actor_instigator`        | Instigator                                   |
| `get_actor_parent`            | Attached parent                              |
| `get_actor_children`          | Attached actors                              |
| `get_actor_tags`              | Gameplay and actor tags                      |
| `get_actor_lifespan`          | Remaining lifespan                           |
| `get_actor_tick_state`        | Tick enabled, interval and group             |
| `get_actor_replication_state` | Role, authority and replication flags        |
| `get_actor_controller`        | Controller of a pawn                         |
| `get_actor_collision_summary` | Actor/component collision summary            |
| `get_actor_overlaps`          | Current overlapping actors/components        |
| `get_actor_last_hit`          | Last captured hit evidence                   |
| `get_actor_last_damage`       | Last captured damage event                   |
| `get_actor_components`        | All runtime components                       |
| `get_actor_component_tree`    | Runtime attachment hierarchy                 |
| `get_actor_interfaces`        | Implemented interfaces                       |
| `get_actor_class_defaults`    | Relevant defaults for comparison             |
| `compare_actor_instances`     | Compare two actor instances                  |
| `compare_actor_to_defaults`   | Show overridden runtime values               |
| `get_spawned_actors_since`    | Actors spawned during a session              |
| `get_destroyed_actors_since`  | Actors destroyed during a session            |

---

# Priority 9 — Runtime component inspection

Policy (parked behind non-default pack):

* Pack: `unreal.runtime.read` (proposed; default disabled)
* Access: read
* Notes: bounded output required

| MCP tool                            | Purpose                                |
| ----------------------------------- | -------------------------------------- |
| `find_runtime_components`           | Find by name, class or owner           |
| `get_component_state`               | Core component information             |
| `get_component_transform`           | Relative and world transform           |
| `get_component_attachment`          | Parent, socket and children            |
| `get_component_mobility`            | Static, Stationary or Movable          |
| `get_component_visibility`          | Visible, hidden and owner visibility   |
| `get_component_activation_state`    | Active and tick state                  |
| `get_component_collision_state`     | Enabled mode and object type           |
| `get_component_collision_responses` | Per-channel responses                  |
| `get_component_overlap_settings`    | Generate-overlap configuration         |
| `get_component_overlaps`            | Current overlaps                       |
| `get_component_physics_state`       | Simulating, mass, gravity and velocity |
| `get_component_render_state`        | Render visibility and bounds           |
| `get_scene_component_children`      | Child scene components                 |
| `get_static_mesh_component_state`   | Mesh, material and mobility            |
| `get_skeletal_mesh_component_state` | Mesh, animation and pose information   |
| `get_camera_component_state`        | FOV, projection and active camera      |
| `get_audio_component_state`         | Playing state and sound                |
| `get_niagara_component_state`       | System state and parameters            |
| `get_widget_component_state`        | Widget class and visibility            |
| `compare_component_transforms`      | Local versus world difference          |

For your sliding-door work, these are especially important:

```text
get_component_transform
get_component_attachment
get_component_mobility
get_component_collision_state
compare_component_transforms
```

---

# Priority 10 — Reflection and property inspection

Policy (parked behind non-default pack):

* Pack: `unreal.reflect.read` (proposed; default disabled)
* Access: read
* Notes: strict depth/size bounds; avoid recursive dumps

Unreal’s reflection system makes generic property inspection possible, but recursive object serialization must be tightly bounded to avoid huge or cyclic responses.

| MCP tool                      | Purpose                                           |
| ----------------------------- | ------------------------------------------------- |
| `list_object_properties`      | List inspectable properties                       |
| `get_property_value`          | Read one property                                 |
| `get_property_values`         | Read a bounded set                                |
| `get_nested_property_value`   | Follow a safe property path                       |
| `get_property_metadata`       | Type, category, flags and tooltip                 |
| `get_property_default_value`  | Class default value                               |
| `compare_property_to_default` | Detect runtime override                           |
| `find_properties`             | Search property names                             |
| `get_array_property`          | Read a bounded array                              |
| `get_map_property`            | Read a bounded map                                |
| `get_set_property`            | Read a bounded set                                |
| `get_object_reference`        | Resolve referenced object safely                  |
| `get_soft_object_reference`   | Soft object path                                  |
| `get_class_reference`         | Class or soft-class reference                     |
| `get_enum_definition`         | Enum members                                      |
| `get_struct_value`            | Bounded struct serialization                      |
| `get_function_signature`      | Inputs, outputs and flags                         |
| `list_callable_functions`     | Functions callable on an object                   |
| `get_delegate_bindings`       | Bound delegate functions                          |
| `get_object_flags`            | Transient, pending kill, default object and so on |
| `get_object_outer_chain`      | Ownership/package hierarchy                       |
| `is_object_valid`             | Validity and destruction state                    |

## Safe initial property types

```text
Boolean
Integer
Float
Double
Name
String
Text
Enum
Vector
Rotator
Transform
Color
Object reference
Class reference
Small arrays of those types
```

Postpone arbitrary nested struct and recursive object dumping.

---

# Priority 11 — Runtime event tracing

Policy (parked behind non-default pack):

* Pack: `unreal.trace.write` (proposed; default disabled)
* Access: write (start/stop capture) + read (query)
* Requires `UNREAL_MCP_WRITE_ENABLED`: yes

This is the layer that tells the agent **what happened**, not merely what exists.

| MCP tool                        | Purpose                                 |
| ------------------------------- | --------------------------------------- |
| `start_runtime_event_capture`   | Begin capturing structured events       |
| `stop_runtime_event_capture`    | Stop and summarize                      |
| `get_runtime_events`            | Retrieve captured events                |
| `get_runtime_event_summary`     | Counts and sequence overview            |
| `search_runtime_events`         | Search by actor, event or value         |
| `get_last_runtime_event`        | Most recent matching event              |
| `get_actor_event_history`       | Events associated with an actor         |
| `get_component_event_history`   | Events for a component                  |
| `get_event_sequence`            | Ordered causal sequence                 |
| `get_events_between`            | Events between two sequence numbers     |
| `record_debug_event`            | Record a named event from Blueprint/C++ |
| `record_debug_value`            | Record a named runtime value            |
| `record_debug_checkpoint`       | Mark a logical checkpoint               |
| `record_debug_expectation`      | Record expected state                   |
| `record_debug_failure`          | Record explicit failure evidence        |
| `get_event_rate`                | Frequency of an event                   |
| `detect_missing_expected_event` | Expected event did not occur            |
| `detect_unexpected_event_order` | Events occurred out of order            |
| `compare_event_sequences`       | Compare successful and failed runs      |
| `clear_runtime_events`          | Clear the event ring buffer             |

## Recommended Blueprint helper nodes

Expose a Blueprint function library containing:

```text
Debug Event
Debug Value
Debug Actor
Debug Component
Debug Checkpoint
Debug Expectation
```

This is more reliable than attempting full Blueprint VM execution tracing immediately.

---

# Priority 12 — Property and transform watches

Policy (parked behind non-default pack):

* Pack: `unreal.watch.write` (proposed; default disabled)
* Access: write (start/stop) + read (query)
* Requires `UNREAL_MCP_WRITE_ENABLED`: yes

| MCP tool                      | Purpose                                |
| ----------------------------- | -------------------------------------- |
| `start_property_watch`        | Sample a property over time            |
| `stop_property_watch`         | Stop one watch                         |
| `stop_all_property_watches`   | Stop all watches                       |
| `list_property_watches`       | Active watches                         |
| `get_property_samples`        | Raw bounded samples                    |
| `get_property_watch_summary`  | Min, max, first, last and changes      |
| `wait_for_property_change`    | Return when a property changes         |
| `wait_for_property_value`     | Return when a condition is met         |
| `start_transform_watch`       | Track actor/component transforms       |
| `get_transform_samples`       | Transform time series                  |
| `detect_property_reset`       | Detect unexpected reset                |
| `detect_property_stall`       | Value remains unchanged                |
| `detect_property_oscillation` | Suspicious repeated switching          |
| `compare_property_runs`       | Compare successful and failed sessions |
| `sample_actor_state`          | Repeated actor-state sampling          |
| `sample_component_state`      | Repeated component-state sampling      |

Guardrails:

```text
Maximum simultaneous watches: 10
Minimum interval: 33–50 ms
Default duration: 10 seconds
Maximum default duration: 30 seconds
Bounded sample count
```

---

# Priority 13 — Collision and overlap debugging

Policy (parked behind non-default pack):

* Pack: `unreal.physics.debug.mixed` (proposed; default disabled)
* Access: mixed
* Notes: traces/draw-debug are stateful; keep strict bounds

This deserves a dedicated interface because collision failures are extremely common in Unreal.

| MCP tool                        | Purpose                                      |
| ------------------------------- | -------------------------------------------- |
| `get_collision_profile`         | Named collision profile                      |
| `get_collision_enabled`         | No collision, query, physics or both         |
| `get_collision_object_type`     | Object channel                               |
| `get_collision_responses`       | Block, overlap or ignore by channel          |
| `get_generate_overlap_events`   | Overlap event setting                        |
| `get_current_overlaps`          | Existing overlaps                            |
| `get_recent_overlap_events`     | Begin/end overlap history                    |
| `get_recent_hit_events`         | Hit event history                            |
| `check_overlap_compatibility`   | Determine whether two components can overlap |
| `check_blocking_compatibility`  | Determine whether they should block          |
| `check_hit_event_prerequisites` | Physics/hit notification requirements        |
| `explain_collision_pair`        | Explain interaction between two components   |
| `run_line_trace`                | Controlled diagnostic line trace             |
| `run_sphere_trace`              | Controlled diagnostic sphere trace           |
| `run_box_trace`                 | Controlled diagnostic box trace              |
| `get_trace_results`             | Structured hit results                       |
| `draw_debug_trace`              | Optional visible diagnostic trace            |
| `get_collision_shape`           | Primitive collision geometry                 |
| `get_collision_bounds`          | Bounds and offsets                           |
| `detect_collision_mismatch`     | Static check against expected event          |
| `get_physics_asset_summary`     | Skeletal collision bodies                    |
| `get_nav_collision_summary`     | Navigation collision information             |

### Example diagnosis

```text
TriggerBox generates overlap events.
Its Pawn response is Ignore.
The player capsule has object type Pawn.
Therefore BeginOverlap cannot fire.
```

---

# Priority 14 — Input debugging

Policy (parked behind non-default pack):

* Pack: `unreal.input.debug.mixed` (proposed; default disabled)
* Access: mixed
* Notes: input simulation is stateful; keep behind explicit enable

| MCP tool                           | Purpose                               |
| ---------------------------------- | ------------------------------------- |
| `get_input_system_type`            | Legacy or Enhanced Input              |
| `get_input_mode`                   | Game, UI or combined                  |
| `get_input_focus`                  | Focused widget or viewport            |
| `get_player_input_state`           | Active controller and input subsystem |
| `get_enabled_input_actors`         | Actors receiving input                |
| `get_input_mapping_contexts`       | Active Enhanced Input contexts        |
| `get_input_actions`                | Actions in active contexts            |
| `get_input_action_bindings`        | Runtime action bindings               |
| `get_input_action_value`           | Current action value                  |
| `get_recent_input_events`          | Captured input events                 |
| `get_key_bindings`                 | Key-to-action mappings                |
| `check_input_action_prerequisites` | Context, controller and focus checks  |
| `check_actor_input_prerequisites`  | Auto Receive Input/Enable Input       |
| `simulate_input_action`            | Controlled diagnostic input           |
| `simulate_key_press`               | Controlled test key input             |
| `clear_input_capture`              | Clear captured events                 |
| `explain_missing_input_event`      | Evidence-based diagnosis              |

---

# Priority 15 — Timelines, timers and latent actions

Policy (parked behind non-default pack):

* Pack: `unreal.latent.debug.read` (proposed; default disabled)
* Access: read

| MCP tool                     | Purpose                                   |
| ---------------------------- | ----------------------------------------- |
| `get_runtime_timelines`      | Timeline instances on an actor            |
| `get_timeline_state`         | Playing, reversed, position and rate      |
| `get_timeline_tracks`        | Float, vector, colour and event tracks    |
| `get_timeline_values`        | Current track outputs                     |
| `get_timeline_length`        | Length and mode                           |
| `get_timeline_play_rate`     | Playback rate                             |
| `get_timeline_looping`       | Loop configuration                        |
| `get_timeline_event_history` | Play, Update and Completed events         |
| `get_active_timers`          | Timers associated with an object/world    |
| `get_timer_state`            | Remaining time and looping                |
| `get_latent_actions`         | Delays, moves and async latent operations |
| `check_timeline_alpha_range` | Verify expected 0–1 alpha                 |
| `check_timeline_execution`   | Verify Play and Update paths              |
| `explain_timeline_failure`   | Consolidated timeline diagnosis           |

---

# Priority 16 — AI, navigation and behaviour trees

Policy (parked behind non-default pack):

* Pack: `unreal.ai.debug.read` (proposed; default disabled)
* Access: read

| MCP tool                         | Purpose                             |
| -------------------------------- | ----------------------------------- |
| `get_ai_controller_state`        | Controller, pawn, target and focus  |
| `get_blackboard_values`          | Blackboard key values               |
| `get_blackboard_schema`          | Keys and types                      |
| `get_behavior_tree_state`        | Active tree and execution state     |
| `get_active_behavior_tree_nodes` | Current tasks/services/decorators   |
| `get_behavior_tree_history`      | Recent transitions                  |
| `get_ai_perception_state`        | Perceived actors and stimuli        |
| `get_ai_perception_config`       | Sight, hearing and other senses     |
| `get_navigation_path`            | Current calculated path             |
| `get_navmesh_status`             | Availability and build status       |
| `project_point_to_navigation`    | Diagnostic nav projection           |
| `find_path_to_location`          | Diagnostic path query               |
| `get_move_request_state`         | Pending, success, failed or aborted |
| `get_path_following_state`       | Movement state                      |
| `explain_move_to_failure`        | Consolidated movement diagnosis     |
| `get_environment_query_state`    | EQS execution and result            |
| `get_smart_object_state`         | Smart Object slots and claims       |
| `get_mass_entity_summary`        | Optional Mass framework state       |

---

# Priority 17 — Animation inspection

Policy (parked behind non-default pack):

* Pack: `unreal.animation.debug.read` (proposed; default disabled)
* Access: read

| MCP tool                                | Purpose                              |
| --------------------------------------- | ------------------------------------ |
| `get_skeletal_mesh_state`               | Mesh, skeleton and pose status       |
| `get_animation_instance`                | Current AnimInstance                 |
| `get_animation_blueprint`               | Anim Blueprint asset                 |
| `get_animation_state_machine`           | State machines and states            |
| `get_active_animation_state`            | Current state and elapsed time       |
| `get_animation_transitions`             | Available and recent transitions     |
| `get_animation_variables`               | Runtime Anim BP variables            |
| `get_active_montages`                   | Montage, section, position and blend |
| `get_animation_notifies`                | Recent notify events                 |
| `get_slot_weights`                      | Animation slot weights               |
| `get_blendspace_inputs`                 | Current blend parameters             |
| `get_root_motion_state`                 | Root motion status                   |
| `get_pose_summary`                      | Compact bone/pose information        |
| `get_bone_transform`                    | Selected bone transform              |
| `check_animation_transition_conditions` | Why a state transition failed        |
| `explain_animation_not_playing`         | Consolidated diagnosis               |

---

# Priority 18 — Networking and replication

Policy (parked behind non-default pack):

* Pack: `unreal.network.debug.read` (proposed; default disabled)
* Access: read

| MCP tool                         | Purpose                         |
| -------------------------------- | ------------------------------- |
| `get_network_mode`               | Standalone, server or client    |
| `get_network_connections`        | Connected clients               |
| `get_network_actor_roles`        | Local and remote roles          |
| `get_replicated_properties`      | Replicated property definitions |
| `get_replication_state`          | Actor replication runtime state |
| `get_recent_rpc_calls`           | Captured RPCs                   |
| `get_rpc_definition`             | Server, client or multicast     |
| `get_actor_owner_chain`          | Ownership required for RPCs     |
| `check_rpc_prerequisites`        | Ownership and role checks       |
| `get_dormancy_state`             | Network dormancy                |
| `get_net_update_frequency`       | Update frequencies              |
| `get_relevancy_state`            | Relevance to a connection       |
| `compare_server_client_actor`    | Server/client state differences |
| `compare_server_client_property` | Property divergence             |
| `get_replication_graph_summary`  | Replication Graph state         |
| `explain_replication_failure`    | Consolidated diagnosis          |

---

# Priority 19 — Assets and references

Policy:

* Pack: `unreal.editor.read` (default enabled) for Asset Registry listing (already part of v0.1)
* Pack: `unreal.assets.read` (proposed; default disabled) for broader asset analysis
* Pack: `unreal.assets.write` (proposed; default disabled) for destructive mutations

Unreal’s editor libraries can load, inspect and manipulate assets; keep initial MCP tools read-only even when the underlying APIs support modifications. ([Epic Games Developers][4])

| MCP tool                         | Purpose                         |
| -------------------------------- | ------------------------------- |
| `find_assets`                    | Search Asset Registry           |
| `get_asset_metadata`             | Class, package, tags and status |
| `get_asset_dependencies`         | Assets this asset requires      |
| `get_asset_referencers`          | Assets referencing it           |
| `get_asset_registry_tags`        | Registry metadata               |
| `get_asset_validation_results`   | Validation issues               |
| `get_missing_asset_references`   | Broken references               |
| `get_redirectors`                | Redirectors in a path           |
| `get_asset_disk_size`            | Approximate resource size       |
| `get_asset_memory_size`          | Loaded memory estimate          |
| `get_asset_load_state`           | Loaded/unloaded                 |
| `get_asset_package_state`        | Dirty, saved or read-only       |
| `get_asset_source_file`          | Source filename metadata        |
| `get_assets_in_folder`           | Folder inventory                |
| `get_assets_by_class`            | Filter by asset class           |
| `get_unused_assets_candidates`   | Possible unused assets          |
| `open_asset`                     | Open an asset editor            |
| `focus_asset_in_content_browser` | Navigate user to asset          |
| `load_asset_for_inspection`      | Controlled editor-only load     |

---

# Priority 20 — Level and world inspection

Policy (parked behind non-default pack):

* Pack: `unreal.world.read` (proposed; default disabled)
* Access: read

| MCP tool                      | Purpose                                 |
| ----------------------------- | --------------------------------------- |
| `get_world_summary`           | World type, actor counts and settings   |
| `get_level_actors`            | Bounded list of actors                  |
| `find_level_actors`           | Search by class, tag or name            |
| `get_level_streaming_state`   | Loaded and visible levels               |
| `get_world_partition_state`   | World Partition information             |
| `get_data_layer_state`        | Data Layer visibility and runtime state |
| `get_level_blueprint_summary` | Level Blueprint information             |
| `get_world_settings`          | Gravity, game mode and defaults         |
| `get_game_mode_state`         | GameMode, GameState and defaults        |
| `get_game_instance_state`     | Active GameInstance                     |
| `get_player_start_state`      | Player starts                           |
| `get_spawn_failures`          | Recent spawn failures                   |
| `get_actor_count_by_class`    | World composition summary               |
| `get_duplicate_actor_names`   | Suspicious duplicates                   |
| `get_out_of_bounds_actors`    | Actors outside expected bounds          |
| `get_hidden_actors`           | Hidden in editor/game                   |
| `run_map_check`               | Execute map validation                  |
| `get_map_check_results`       | Retrieve results                        |

---

# Priority 21 — Rendering and visual capture

Policy (parked behind non-default pack):

* Pack: `unreal.capture.read` (proposed; default disabled)
* Access: read
* Notes: privacy sensitive; payload sizes must be bounded

| MCP tool                        | Purpose                           |
| ------------------------------- | --------------------------------- |
| `capture_editor_viewport`       | Screenshot active editor viewport |
| `capture_pie_viewport`          | Screenshot gameplay               |
| `capture_blueprint_graph`       | Screenshot a Blueprint graph      |
| `capture_asset_editor`          | Screenshot current asset editor   |
| `capture_actor_thumbnail`       | Controlled actor view             |
| `get_active_camera`             | Current camera actor/component    |
| `get_camera_transform`          | Position and orientation          |
| `get_viewport_resolution`       | Current dimensions                |
| `get_view_mode`                 | Lit, Unlit, Wireframe and so on   |
| `get_show_flags`                | Viewport visualization flags      |
| `get_rendering_warnings`        | Shader/render errors              |
| `get_shader_compilation_status` | Pending shader work               |
| `get_materials_on_component`    | Applied materials                 |
| `get_material_parameter_values` | Runtime parameter values          |
| `get_visibility_chain`          | Why an object may not be visible  |
| `explain_actor_not_visible`     | Consolidated visibility diagnosis |

Screenshots should supplement structured state, not replace it.

---

# Priority 22 — Performance and profiling

Policy (parked behind non-default pack):

* Pack: `unreal.profiling.read` (proposed; default disabled)
* Access: read
* Notes: potentially editor-stalling; require strict limits and cancellation

| MCP tool                         | Purpose                            |
| -------------------------------- | ---------------------------------- |
| `get_frame_time`                 | Current and average frame duration |
| `get_fps`                        | Current/average FPS                |
| `get_game_thread_time`           | Game-thread time                   |
| `get_render_thread_time`         | Render-thread time                 |
| `get_gpu_frame_time`             | GPU frame time                     |
| `get_memory_summary`             | High-level memory use              |
| `get_actor_tick_costs`           | Expensive actor ticks              |
| `get_blueprint_tick_costs`       | Expensive Blueprint execution      |
| `get_object_counts`              | Object counts by class             |
| `get_spawn_rate`                 | Actor spawn frequency              |
| `get_gc_state`                   | Garbage collection information     |
| `start_cpu_trace`                | Begin bounded CPU trace            |
| `stop_cpu_trace`                 | Stop and save/summarize            |
| `start_unreal_insights_trace`    | Start Insights-compatible capture  |
| `stop_unreal_insights_trace`     | Stop capture                       |
| `get_trace_summary`              | Agent-readable findings            |
| `detect_performance_spike`       | Detect frame spikes                |
| `compare_performance_runs`       | Before/after comparison            |
| `explain_performance_bottleneck` | Evidence-based summary             |

---

# Priority 23 — Automated test execution

Policy (parked behind non-default pack):

* Pack: `unreal.automation.write` (proposed; default disabled)
* Access: write (runs tests) + read (results)
* Requires `UNREAL_MCP_WRITE_ENABLED`: yes

| MCP tool                      | Purpose                            |
| ----------------------------- | ---------------------------------- |
| `list_automation_tests`       | Available Unreal automation tests  |
| `run_automation_test`         | Run one test                       |
| `run_automation_tests`        | Run a filtered set                 |
| `get_automation_test_status`  | Running/completed state            |
| `get_automation_test_results` | Structured results                 |
| `cancel_automation_tests`     | Stop test execution                |
| `list_functional_tests`       | Functional Test actors             |
| `run_functional_test`         | Run a map functional test          |
| `get_functional_test_results` | Results and evidence               |
| `run_debug_scenario`          | Execute a predefined gameplay test |
| `record_successful_scenario`  | Store expected event sequence      |
| `compare_scenario_run`        | Compare expected versus actual     |
| `get_test_artifacts`          | Logs, captures and traces          |
| `rerun_failed_test`           | Repeat a failed test               |
| `generate_debug_report`       | Consolidated test report           |

---

# Priority 24 — Agent-level diagnostic workflows

Policy (parked behind non-default pack):

* Pack: `unreal.workflows.mixed` (proposed; default disabled)
* Access: mixed
* Notes: these are orchestrators over lower-level tools; should be curated and heavily tested

These should be MCP tools even though they orchestrate several lower-level tools.

| MCP tool                               | Purpose                                           |
| -------------------------------------- | ------------------------------------------------- |
| `diagnose_active_blueprint`            | General static and compile diagnosis              |
| `diagnose_compile_failure`             | Explain compilation failure                       |
| `diagnose_event_not_firing`            | Inspect graph, prerequisites and runtime evidence |
| `diagnose_accessed_none`               | Locate and explain null object access             |
| `diagnose_actor_not_moving`            | Inspect execution, target and transforms          |
| `diagnose_wrong_movement_direction`    | Local/world/parent transform diagnosis            |
| `diagnose_timeline_not_playing`        | Timeline wiring and runtime state                 |
| `diagnose_overlap_not_firing`          | Collision pair and event capture                  |
| `diagnose_hit_not_firing`              | Physics and collision prerequisites               |
| `diagnose_input_not_firing`            | Mapping context, focus and ownership              |
| `diagnose_actor_not_visible`           | Visibility, hidden flags and camera               |
| `diagnose_actor_not_spawning`          | Class, authority and spawn collision              |
| `diagnose_ai_not_moving`               | Navmesh, controller, path and MoveTo              |
| `diagnose_animation_not_transitioning` | State-machine conditions                          |
| `diagnose_replication_failure`         | Ownership, role and replication                   |
| `diagnose_performance_problem`         | Profiling and likely cause                        |
| `compare_expected_observed`            | Explicit behavioural comparison                   |
| `suggest_next_debug_test`              | Smallest useful isolating experiment              |
| `generate_debug_report`                | Evidence, cause, fix and verification             |
| `verify_fix`                           | Re-run checks after a manual correction           |

## Most valuable tool

```text
diagnose_event_not_firing
```

It should internally perform:

```text
1. Locate the event node.
2. Identify the source component/object.
3. Inspect the event prerequisites.
4. Inspect downstream execution.
5. Start a scoped debug session.
6. Run or observe PIE.
7. Search for the event.
8. Determine the first missing checkpoint.
9. Recommend one isolating test.
```

---

# Priority 25 — Safe control operations

Policy:

* Pack: `unreal.editor.write` (default disabled)
* Access: write (state-changing, intended non-destructive)
* Requires `UNREAL_MCP_WRITE_ENABLED`: yes

These change transient editor or runtime state but usually do not modify assets.

| MCP tool                       | Purpose                        |
| ------------------------------ | ------------------------------ |
| `select_actor`                 | Select an actor                |
| `select_asset`                 | Select an asset                |
| `focus_actor_in_viewport`      | Frame actor                    |
| `focus_blueprint_node`         | Navigate to node               |
| `open_asset`                   | Open asset editor              |
| `set_blueprint_debug_object`   | Choose runtime debug instance  |
| `add_blueprint_breakpoint`     | Add breakpoint                 |
| `remove_blueprint_breakpoint`  | Remove breakpoint              |
| `enable_blueprint_breakpoint`  | Enable breakpoint              |
| `disable_blueprint_breakpoint` | Disable breakpoint             |
| `continue_blueprint_debugging` | Continue after breakpoint      |
| `step_into_blueprint`          | Blueprint debugging step       |
| `step_over_blueprint`          | Step over                      |
| `step_out_blueprint`           | Step out                       |
| `add_blueprint_watch`          | Watch pin or property          |
| `remove_blueprint_watch`       | Remove watch                   |
| `set_runtime_time_dilation`    | Slow a debug session           |
| `teleport_debug_actor`         | Move a designated test actor   |
| `possess_debug_pawn`           | Possess a pawn                 |
| `trigger_debug_checkpoint`     | Invoke a predefined test event |

These should be marked as state-changing but non-destructive.

---

# Priority 26 — Optional Blueprint editing

Policy:

* Pack: `unreal.blueprint.edit.write` (proposed; default disabled)
* Requires pack: `unreal.editor.write` for transactions/rollback primitives
* Access: write
* Requires `UNREAL_MCP_WRITE_ENABLED`: yes
* Notes: must be transaction-wrapped and rollback-safe; save must be explicit

Build this only after inspection and diagnosis are reliable.

| MCP tool                         | Purpose                        |
| -------------------------------- | ------------------------------ |
| `begin_blueprint_transaction`    | Start an undoable change       |
| `preview_blueprint_patch`        | Show proposed changes          |
| `set_blueprint_variable_default` | Change a simple default        |
| `set_component_property`         | Change a component default     |
| `add_blueprint_node`             | Add a narrowly supported node  |
| `delete_blueprint_node`          | Remove node                    |
| `move_blueprint_node`            | Reposition node                |
| `connect_blueprint_pins`         | Connect compatible pins        |
| `disconnect_blueprint_pin`       | Remove connection              |
| `set_blueprint_pin_default`      | Set literal value              |
| `add_blueprint_variable`         | Add variable                   |
| `rename_blueprint_variable`      | Rename variable                |
| `add_blueprint_function`         | Create function graph          |
| `add_blueprint_event`            | Add supported event            |
| `add_blueprint_component`        | Add component                  |
| `rename_blueprint_component`     | Rename component               |
| `compile_blueprint_patch`        | Compile after a patch          |
| `commit_blueprint_transaction`   | Retain changes                 |
| `rollback_blueprint_transaction` | Undo changes                   |
| `save_blueprint`                 | Explicitly save after approval |

`FBlueprintEditorUtils` exposes substantial graph and Blueprint manipulation capability, including creating and working with graphs, but correct editing also requires graph schemas, transactions, reconstruction, compilation and asset dirtiness handling. ([Epic Games Developers][2])

## Required editing safeguards

Every editing workflow should:

1. generate a preview;
2. require explicit approval;
3. start an Unreal transaction;
4. make the smallest possible change;
5. compile;
6. report new warnings and errors;
7. leave the asset unsaved by default;
8. support rollback.

---

# Priority 27 — Advanced editor automation

Policy:

* Pack: `unreal.editor.automation.write` (proposed; default disabled)
* Access: write
* Requires `UNREAL_MCP_WRITE_ENABLED`: yes
* Notes: destructive operations (delete/rename) should require additional per-tool approvals/feature flags

Useful eventually, but not required for the debugging copilot.

| MCP tool                        | Purpose                         |
| ------------------------------- | ------------------------------- |
| `save_asset`                    | Explicit save                   |
| `save_all_dirty_assets`         | Save multiple assets            |
| `duplicate_asset`               | Create a safe working copy      |
| `rename_asset`                  | Rename/move                     |
| `delete_asset`                  | Destructive; heavily restricted |
| `create_level`                  | Create a test level             |
| `spawn_editor_actor`            | Place actor in editor world     |
| `delete_editor_actor`           | Remove editor actor             |
| `set_editor_actor_transform`    | Modify placement                |
| `set_editor_component_property` | Modify editor instance          |
| `create_debug_fixture`          | Create controlled test setup    |
| `restore_debug_fixture`         | Reset fixture                   |
| `undo_editor_transaction`       | Undo                            |
| `redo_editor_transaction`       | Redo                            |

---

# Tools you should **not** expose

Avoid generic, unrestricted tools such as:

```text
execute_console_command
execute_unreal_python
execute_cpp
execute_editor_command
read_arbitrary_file
write_arbitrary_file
load_arbitrary_module
call_arbitrary_uobject_function
set_arbitrary_property
```

MCP tools are directly model-invokable external actions, so narrowly scoped schemas and risk annotations are important. The MCP specification defines tools as named operations with declared input schemas; modern MCP guidance also distinguishes read-only, destructive and idempotent behaviour. ([Model Context Protocol][5])

Instead of:

```text
execute_console_command("DestroyAll BP_Enemy")
```

provide:

```text
get_runtime_actor
destroy_debug_fixture_actor
```

with strict target restrictions.

---

# Implementation order (aligned to `scalable_unreal_mcp_plan.md`)

## v0.1 hardening slice

Priorities 0-4 are the product slice. Do not expand the surface until the foundation is stable.

Acceptance criteria:

* Tool registry (`MCP/tools/registry.json`) is the only source of tool metadata.
* Pack policy is enforced for every tool call.
* Default packs expose no write tools.
* Skills exist and refuse unsafe operations: `unreal-project-inspection`, `blueprint-inspection`, `blueprint-edit-and-validate`.
* Integration tests cover success and failure paths (policy denied, invalid input, editor not ready, compile failure).
* Transaction + rollback primitives are verified for any write workflow.
* Structured error envelope is consistent.
* Local-only telemetry exists.

## v0.2+ (feature expansion)

Only after v0.1 is hardened, add Priority 5+ tools by creating the appropriate non-default pack(s) first, then adding registry entries + skills/tests.

---

# The highest-value final tool set

For your specific goal—an agent that helps you understand why a Blueprint does not behave correctly—I would prioritize these **40 tools** above everything else:

```text
# Connection and context
ping
get_editor_status
start_debug_session
end_debug_session
get_selected_actors
get_active_blueprint
get_active_blueprint_graph
get_selected_blueprint_nodes

# Blueprint inspection
get_blueprint_summary
get_blueprint_component_tree
get_blueprint_variables
get_blueprint_functions
get_blueprint_timelines
get_blueprint_graph
get_blueprint_node
get_node_neighbourhood
get_blueprint_execution_flow
find_blueprint_nodes
find_blueprint_variable_reads
find_blueprint_variable_writes

# Compilation and linting
compile_blueprint
get_compile_messages
lint_blueprint
check_null_reference_risks
check_timeline_wiring
check_component_mobility
check_world_relative_transform_usage
check_collision_event_prerequisites

# PIE and runtime
get_pie_state
start_pie
stop_pie
get_recent_logs
find_runtime_actors
get_actor_state
get_actor_component_tree
get_component_state
get_component_transform
get_runtime_events
start_property_watch
get_property_samples

# Agent workflow
diagnose_event_not_firing
diagnose_actor_not_moving
diagnose_accessed_none
suggest_next_debug_test
verify_fix
```

That set is already capable of diagnosing a large proportion of beginner and intermediate Blueprint failures without attempting to become a full autonomous Unreal editor.

[1]: https://dev.epicgames.com/documentation/unreal-engine/BlueprintAPI "Unreal Engine Blueprint API Reference"
[2]: https://dev.epicgames.com/documentation/unreal-engine/API/Editor/UnrealEd/FBlueprintEditorUtils "FBlueprintEditorUtils | Unreal Engine Documentation"
[3]: https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/?application_version=5.6 "Unreal Python API Documentation"
[4]: https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/EditorLevelLibrary?application_version=5.6 "unreal.EditorLevelLibrary — Unreal Python (Experimental)"
[5]: https://modelcontextprotocol.io/specification/2025-06-18/server/tools "MCP Tools Specification"
