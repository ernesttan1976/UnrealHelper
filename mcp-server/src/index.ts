import "dotenv/config";

import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { envSchema } from "./mcp.js";
import { UnrealClient } from "./unreal-client.js";
import { resolveUnrealConfigFromProject } from "./unreal-project-config.js";

const env = envSchema.parse(process.env);

const resolved = resolveUnrealConfigFromProject({
  token: env.UNREAL_TOKEN,
  port: env.UNREAL_PORT,
  projectDir: env.UNREAL_PROJECT_DIR,
  tokenIni: env.UNREAL_TOKEN_INI,
  envPortProvided: typeof process.env.UNREAL_PORT === "string" && process.env.UNREAL_PORT.length > 0
});

const client = new UnrealClient({
  host: env.UNREAL_HOST,
  port: resolved.port,
  token: resolved.token,
  timeoutMs: env.UNREAL_TIMEOUT_MS,
  mock: env.UNREAL_MOCK === "1" || env.UNREAL_MOCK === "true"
});

type LastToolError =
  | {
      at: string;
      tool: string;
      kind: "unreal_error";
      error: unknown;
    }
  | {
      at: string;
      tool: string;
      kind: "exception";
      error: { message: string; name?: string; stack?: string };
    };

let lastToolError: LastToolError | null = null;

type DebugSession = {
  session_id: string;
  label?: string;
  started_at: string;
  ended_at?: string;
  sequence: number;
  tool_calls: Array<{
    seq: number;
    at: string;
    tool: string;
    arguments: unknown;
    elapsed_ms: number;
    ok: boolean;
    unreal_request_id?: string;
    error?: unknown;
  }>;
};

let activeDebugSession: DebugSession | null = null;

function nowIso() {
  return new Date().toISOString();
}

const server = new Server(
  {
    name: "unreal-debug-copilot",
    version: "0.0.1"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

const TOOL_DEFS = [
  {
    name: "unreal.ping",
    description: "Check connectivity with the Unreal Editor plugin.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_connection_status",
    description: "Return MCP server + Unreal transport status (optionally probes the Unreal plugin).",
    inputSchema: {
      type: "object",
      properties: {
        probe: { type: "boolean", description: "If true, performs a ping/capabilities probe (default false)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_last_tool_error",
    description: "Retrieve the last bridge/plugin failure observed by this MCP server.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.cancel_current_operation",
    description: "Cancel an in-flight Unreal TCP request (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "Optional Unreal request_id to cancel." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_protocol_capabilities",
    description: "List supported MCP tools and Unreal plugin methods (if available).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_plugin_version",
    description: "Get UnrealDebugCopilot plugin version (and bridge protocol version).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_active_debug_session",
    description: "Return the current debug session (if any).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.start_debug_session",
    description: "Begin a scoped debug session for correlating tool calls and evidence.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Optional label for the session." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.end_debug_session",
    description: "End the current debug session and return a summary.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.clear_debug_session",
    description: "Clear the current debug session (drops accumulated evidence).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_editor_status",
    description: "Get Unreal Editor readiness and PIE state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_engine_version",
    description: "Get Unreal Engine version string.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_current_project",
    description: "Get current project name and directory.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_project_info",
    description: "Alias for unreal.get_current_project.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_selected_actors",
    description: "Get currently selected actors in the editor.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_open_editors",
    description: "List assets that currently have an editor open (asset editors).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_open_asset_editors",
    description: "Alias for unreal.get_open_editors.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_active_blueprint",
    description:
      "Get the Blueprint currently being edited (best-effort: if multiple are open, returns a deterministic choice).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_current_level",
    description: "Get the active editor world and map.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_open_levels",
    description: "Get the persistent and streamed levels for the active editor world.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_selected_assets",
    description: "Get assets selected in the Content Browser.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_selected_components",
    description: "Get components currently selected in the editor.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_active_asset_editor",
    description: "Best-effort: get the currently active/focused asset editor.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_active_blueprint_graph",
    description: "Best-effort: get the currently active/focused Blueprint graph.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_selected_blueprint_nodes",
    description: "Best-effort: get selected nodes in the active Blueprint graph editor.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_focused_blueprint_node",
    description: "Best-effort: get the most relevant selected/focused Blueprint node.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_editor_viewport_state",
    description: "Get editor viewport camera transform and view mode (best-effort).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_world_outliner_selection",
    description: "Alias for unreal.get_selected_actors (Outliner selection).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_content_browser_path",
    description: "Get the current Content Browser path/folder (best-effort).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_editor_mode",
    description: "Get active editor mode(s) (Select, Landscape, etc).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_dirty_assets",
    description: "Get modified but unsaved packages/assets (best-effort).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_pending_editor_notifications",
    description: "Get pending editor notifications/modals (best-effort).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_message_log_summary",
    description: "Get a summary of Unreal Message Log categories (best-effort).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "unreal.get_component_tree",
    description:
      "Get the component tree for an actor (default: first selected actor; if actor_name is provided, will also search the current editor world).",
    inputSchema: {
      type: "object",
      properties: {
        actor_name: { type: "string", description: "Optional actor name; if omitted uses first selected actor." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.list_assets",
    description: "List assets via the Asset Registry (no direct .uasset reads).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Package path, e.g. /Game or /Game/ThirdPerson" },
        class: { type: "string", description: "Optional UClass name filter, e.g. Blueprint, StaticMesh" },
        recursive: { type: "boolean", description: "Whether to recurse into subpaths (default true)." },
        limit: { type: "number", description: "Max number of results returned (default 200, max 2000)." },
        name_contains: { type: "string", description: "Optional substring filter on asset name." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.inspect_object",
    description: "Inspect a UObject (or Actor by name) using Unreal reflection (no direct .uasset reads).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string", description: "Object path, e.g. /Game/Foo/Bar.Bar" },
        asset_path: { type: "string", description: "Asset package path, e.g. /Game/Foo/Bar" },
        actor_name: { type: "string", description: "Actor name in the editor world (best-effort search)." },
        include_transient: { type: "boolean", description: "Include transient properties (default false)." },
        max_properties: { type: "number", description: "Max properties exported (default 200, max 2000)." },
        name_contains: { type: "string", description: "Only include properties whose name contains this substring." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.inspect_blueprint",
    description: "Inspect a Blueprint asset (variables, graphs, SCS components; optionally CDO properties).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string", description: "Blueprint object path, e.g. /Game/Foo/BP_My.BP_My" },
        asset_path: { type: "string", description: "Blueprint asset package path, e.g. /Game/Foo/BP_My" },
        include_cdo_properties: {
          type: "boolean",
          description: "If true, also exports properties from the generated class CDO."
        },
        include_transient: { type: "boolean", description: "Include transient properties (default false)." },
        max_properties: { type: "number", description: "Max CDO properties exported (default 200, max 2000)." },
        name_contains: { type: "string", description: "Only include CDO properties whose name contains this substring." },
        use_active_if_missing: {
          type: "boolean",
          description: "If no path is provided, uses the first open Blueprint editor asset if available (default true)."
        }
      },
      additionalProperties: false
    }
  },

  // Priority 2 — Blueprint summary and static inspection
  {
    name: "unreal.get_blueprint_summary",
    description: "Compact overview of the Blueprint (best-effort; returns blueprint_found=false if none is available).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_metadata",
    description: "Type, parent class, interfaces and status (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_parent_class",
    description: "Parent Blueprint or native class (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_interfaces",
    description: "Implemented interfaces (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_components",
    description: "Simple Construction Script components (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_component_tree",
    description: "Parent-child component hierarchy derived from SCS (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_variables",
    description: "Variables, types, defaults and flags (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_local_variables",
    description: "Locals belonging to a function (best-effort; currently returns empty).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        function: { type: "string", description: "Function graph name." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_functions",
    description: "Function names, inputs, outputs and flags (best-effort; signatures may be partial).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_macros",
    description: "Macro definitions (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_event_dispatchers",
    description: "Dispatchers and signatures (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_timelines",
    description: "Timelines, tracks, lengths and settings (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_graphs",
    description: "All Event, function, macro and construction graphs (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_graph",
    description: "Structured nodes and connections for one graph (bounded; mode controls verbosity).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        mode: { type: "string" },
        node_id: { type: "string" },
        max_depth: { type: "number" },
        max_nodes: { type: "number" },
        max_edges: { type: "number" },
        include_pins: { type: "boolean" },
        include_edges: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_node",
    description: "Full information about one node (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        node_id: { type: "string" },
        graph: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_nodes",
    description: "Filtered list of graph nodes (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        title_contains: { type: "string" },
        class_contains: { type: "string" },
        limit: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_node_pins",
    description: "Input/output pins and types for one node (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        node_id: { type: "string" },
        graph: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_node_connections",
    description: "Connections for one node (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        node_id: { type: "string" },
        graph: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_execution_flow",
    description: "Execution-pin graph only (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        max_depth: { type: "number" },
        max_nodes: { type: "number" },
        max_edges: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_data_flow",
    description: "Data-pin graph only (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        max_depth: { type: "number" },
        max_nodes: { type: "number" },
        max_edges: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_node_defaults",
    description: "Literal/default pin values (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        node_id: { type: "string" },
        graph: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_references",
    description: "Assets, classes and objects referenced (best-effort; currently returns empty).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_dependencies",
    description: "Assets required by this Blueprint (AssetRegistry; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_dependents",
    description: "Assets that depend on this Blueprint (AssetRegistry; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_debug_object",
    description: "Current runtime instance being debugged (best-effort; currently returns null).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_breakpoints",
    description: "Existing Blueprint breakpoints (best-effort; currently returns empty).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_watches",
    description: "Watched pins and variables (best-effort; currently returns empty).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_bookmarks",
    description: "Graph bookmarks (best-effort; currently returns empty).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_compile_status",
    description: "Dirty, up-to-date, warning or error (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_class_defaults",
    description: "Class Default Object values (bounded; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        include_transient: { type: "boolean" },
        max_properties: { type: "number" },
        name_contains: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_node_comment",
    description: "Comment associated with a node (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        node_id: { type: "string" },
        graph: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_blueprint_graph_comments",
    description: "Comment boxes and contained nodes (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        max_nodes: { type: "number" }
      },
      additionalProperties: false
    }
  },

  // Priority 3 — Blueprint search and navigation
  {
    name: "unreal.find_blueprint_nodes",
    description: "Search Blueprint graph nodes by title/class (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string", description: "Graph name; if omitted uses the Blueprint's default graph." },
        query: { type: "string", description: "Substring match against node title (case-insensitive)." },
        title_contains: { type: "string" },
        class_contains: { type: "string" },
        all_graphs: { type: "boolean", description: "If true, scans all graphs in the Blueprint (bounded)." },
        limit: { type: "number", description: "Max nodes returned (default 50, max 500)." },
        max_graphs: { type: "number", description: "Max graphs scanned when all_graphs=true (default 25, max 100)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.find_blueprint_events",
    description: "Locate overlap, input, tick and custom events (heuristic; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        query: { type: "string", description: "Substring match against node title (case-insensitive)." },
        all_graphs: { type: "boolean" },
        limit: { type: "number" },
        max_graphs: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.find_blueprint_function_calls",
    description: "Find calls to a particular function (heuristic; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        function_name: { type: "string", description: "Substring match against node title." },
        query: { type: "string" },
        all_graphs: { type: "boolean" },
        limit: { type: "number" },
        max_graphs: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.find_blueprint_variable_reads",
    description: "Locate reads of a variable (heuristic; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        variable_name: { type: "string" },
        query: { type: "string" },
        all_graphs: { type: "boolean" },
        limit: { type: "number" },
        max_graphs: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.find_blueprint_variable_writes",
    description: "Locate assignments to a variable (heuristic; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        variable_name: { type: "string" },
        query: { type: "string" },
        all_graphs: { type: "boolean" },
        limit: { type: "number" },
        max_graphs: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.find_blueprint_component_references",
    description: "Find nodes targeting a component (heuristic; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        component_name: { type: "string" },
        query: { type: "string" },
        all_graphs: { type: "boolean" },
        limit: { type: "number" },
        max_graphs: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.find_blueprint_asset_references",
    description: "Find references to an asset (heuristic; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        asset_query: { type: "string", description: "Substring match against pin default values and node title." },
        query: { type: "string" },
        all_graphs: { type: "boolean" },
        limit: { type: "number" },
        max_graphs: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.find_blueprint_class_references",
    description: "Find usages of a class (heuristic; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        class_query: { type: "string", description: "Substring match against pin types/defaults and node title." },
        query: { type: "string" },
        all_graphs: { type: "boolean" },
        limit: { type: "number" },
        max_graphs: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.find_blueprint_unconnected_pins",
    description: "Locate unconnected pins (bounded; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        exec_only: { type: "boolean", description: "If true, only consider exec pins." },
        data_only: { type: "boolean", description: "If true, only consider non-exec pins." },
        limit: { type: "number", description: "Max pins returned (default 200, max 2000)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.find_blueprint_dead_ends",
    description: "Execution paths with no continuation (heuristic; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        limit: { type: "number", description: "Max nodes returned (default 50, max 500)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.find_blueprint_entry_points",
    description: "Events and externally called functions (heuristic; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        limit: { type: "number", description: "Max nodes returned (default 50, max 500)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.find_blueprint_callers",
    description: "Find callers of a function or event (alias of find_blueprint_function_calls; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        function_name: { type: "string" },
        query: { type: "string" },
        all_graphs: { type: "boolean" },
        limit: { type: "number" },
        max_graphs: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.find_blueprint_implementations",
    description: "Find implementations of interface calls (best-effort; may be unimplemented).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        interface_name: { type: "string" },
        function_name: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.trace_blueprint_path",
    description: "Find a graph path between two nodes (bounded; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        from_node_id: { type: "string" },
        to_node_id: { type: "string" },
        max_steps: { type: "number", description: "Max edges in the returned path (default 32, max 256)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_upstream_nodes",
    description: "Nodes that contribute to a pin/value (heuristic graph traversal; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        node_id: { type: "string" },
        max_depth: { type: "number", description: "Traversal depth (default 3, max 20)." },
        max_nodes: { type: "number", description: "Max nodes returned (default 200, max 2000)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_downstream_nodes",
    description: "Nodes affected by a node/output (heuristic graph traversal; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        node_id: { type: "string" },
        max_depth: { type: "number", description: "Traversal depth (default 3, max 20)." },
        max_nodes: { type: "number", description: "Max nodes returned (default 200, max 2000)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.get_node_neighbourhood",
    description: "Small graph around one node (bounded; best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        node_id: { type: "string" },
        max_depth: { type: "number", description: "Traversal depth (default 1, max 10)." },
        max_nodes: { type: "number", description: "Max nodes returned (default 200, max 2000)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.focus_blueprint_node",
    description: "Navigate the editor to a node (not yet implemented; placeholder tool).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        node_id: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.open_blueprint_graph",
    description: "Open and focus a graph (not yet implemented; placeholder tool).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "unreal.select_blueprint_nodes",
    description: "Select nodes for the user to inspect (not yet implemented; placeholder tool).",
    inputSchema: {
      type: "object",
      properties: {
        object_path: { type: "string" },
        asset_path: { type: "string" },
        use_active_if_missing: { type: "boolean" },
        graph: { type: "string" },
        node_ids: { type: "array", items: { type: "string" } }
      },
      additionalProperties: false
    }
  }
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [...TOOL_DEFS]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  const asToolResult = (res: unknown) => {
    // We always return JSON text so the model can reason about structured data.
    // If Unreal returns ok:false we also mark the MCP tool call as an error.
    if (typeof res === "object" && res !== null && "ok" in res && (res as any).ok === false) {
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  };

  const recordLastErrorFromResult = (tool: string, res: unknown) => {
    if (typeof res === "object" && res !== null && "ok" in res && (res as any).ok === false) {
      lastToolError = {
        at: nowIso(),
        tool,
        kind: "unreal_error",
        error: (res as any).error
      };
    }
  };

  const run = async <T>(tool: string, fn: () => Promise<T>) => {
    const startedAt = Date.now();
    try {
      const res = await fn();
      const elapsed = Date.now() - startedAt;

      recordLastErrorFromResult(tool, res);

      if (activeDebugSession) {
        activeDebugSession.sequence += 1;
        const unreal_request_id =
          typeof res === "object" && res !== null && "request_id" in res ? String((res as any).request_id) : undefined;
        activeDebugSession.tool_calls.push({
          seq: activeDebugSession.sequence,
          at: nowIso(),
          tool,
          arguments: args,
          elapsed_ms: elapsed,
          ok: !(typeof res === "object" && res !== null && "ok" in res && (res as any).ok === false),
          unreal_request_id
        });
      }

      return res;
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      const e = err instanceof Error ? err : new Error(String(err));
      lastToolError = {
        at: nowIso(),
        tool,
        kind: "exception",
        error: { message: e.message, name: e.name, stack: e.stack }
      };

      if (activeDebugSession) {
        activeDebugSession.sequence += 1;
        activeDebugSession.tool_calls.push({
          seq: activeDebugSession.sequence,
          at: nowIso(),
          tool,
          arguments: args,
          elapsed_ms: elapsed,
          ok: false,
          error: { message: e.message, name: e.name }
        });
      }

      throw err;
    }
  };

  try {
    if (name === "unreal.ping") {
      const res = await run(name, () => client.ping());
      return asToolResult(res);
    }

    if (name === "unreal.get_connection_status") {
      const probe = Boolean(args.probe);
      const status: Record<string, unknown> = {
        ok: true,
        mcp: {
          name: "unreal-debug-copilot",
          version: "0.0.1",
          node: process.version
        },
        unreal: {
          host: env.UNREAL_HOST,
          port: resolved.port,
          token_set: Boolean(resolved.token),
          mock: env.UNREAL_MOCK === "1" || env.UNREAL_MOCK === "true"
        },
        in_flight_requests: client.getInFlightSummary(),
        last_tool_error: lastToolError
      };

      if (probe) {
        const pingRes = await run("unreal.ping", () => client.ping());
        status.plugin_ping = pingRes;
        const capRes = await run("unreal.get_protocol_capabilities", () => client.getProtocolCapabilities());
        status.plugin_capabilities = capRes;
        const verRes = await run("unreal.get_plugin_version", () => client.getPluginVersion());
        status.plugin_version = verRes;
      }

      return asToolResult(status);
    }

    if (name === "unreal.get_last_tool_error") {
      return asToolResult({ ok: true, last_tool_error: lastToolError });
    }

    if (name === "unreal.cancel_current_operation") {
      const res = client.cancelCurrentOperation({ request_id: typeof args.request_id === "string" ? args.request_id : undefined });
      return asToolResult({ ok: true, ...res, in_flight_requests: client.getInFlightSummary() });
    }

    if (name === "unreal.get_protocol_capabilities") {
      const mcpTools = TOOL_DEFS.map((t) => t.name);
      const plugin = await run(name, () => client.getProtocolCapabilities());
      return asToolResult({
        ok: true,
        mcp: { tools: mcpTools },
        unreal_plugin: plugin
      });
    }

    if (name === "unreal.get_plugin_version") {
      const res = await run(name, () => client.getPluginVersion());
      return asToolResult(res);
    }

    if (name === "unreal.get_active_debug_session") {
      return asToolResult({ ok: true, session: activeDebugSession });
    }

    if (name === "unreal.start_debug_session") {
      if (activeDebugSession && !activeDebugSession.ended_at) {
        return asToolResult({
          ok: false,
          error: {
            code: "SESSION_ALREADY_ACTIVE",
            message: "A debug session is already active",
            details: { session_id: activeDebugSession.session_id }
          }
        });
      }

      const session_id = randomUUID();
      activeDebugSession = {
        session_id,
        label: typeof args.label === "string" ? args.label : undefined,
        started_at: nowIso(),
        sequence: 0,
        tool_calls: []
      };
      return asToolResult({ ok: true, session: activeDebugSession });
    }

    if (name === "unreal.end_debug_session") {
      if (!activeDebugSession || activeDebugSession.ended_at) {
        return asToolResult({
          ok: false,
          error: { code: "SESSION_NOT_ACTIVE", message: "No debug session is active" }
        });
      }

      activeDebugSession.ended_at = nowIso();
      const ended = activeDebugSession;
      activeDebugSession = null;

      const errorCalls = ended.tool_calls.filter((c) => !c.ok).length;
      return asToolResult({
        ok: true,
        summary: {
          session_id: ended.session_id,
          label: ended.label,
          started_at: ended.started_at,
          ended_at: ended.ended_at,
          tool_calls: ended.tool_calls.length,
          tool_errors: errorCalls,
          last_tool_error: lastToolError
        },
        session: ended
      });
    }

    if (name === "unreal.clear_debug_session") {
      activeDebugSession = null;
      return asToolResult({ ok: true, cleared: true });
    }

    if (name === "unreal.get_editor_status") {
      const res = await run(name, () => client.getEditorStatus());
      return asToolResult(res);
    }

    if (name === "unreal.get_engine_version") {
      const res = await run(name, () => client.getEngineVersion());
      return asToolResult(res);
    }

    if (name === "unreal.get_current_project") {
      const res = await run(name, () => client.getCurrentProject());
      return asToolResult(res);
    }

    if (name === "unreal.get_project_info") {
      const res = await run("unreal.get_current_project", () => client.getCurrentProject());
      return asToolResult(res);
    }

    if (name === "unreal.get_selected_actors") {
      const res = await run(name, () => client.getSelectedActors());
      return asToolResult(res);
    }

    if (name === "unreal.get_open_editors") {
      const res = await run(name, () => client.getOpenEditors());
      return asToolResult(res);
    }

    if (name === "unreal.get_open_asset_editors") {
      const res = await run("unreal.get_open_editors", () => client.getOpenEditors());
      return asToolResult(res);
    }

    if (name === "unreal.get_active_blueprint") {
      const res = await run(name, () => client.getActiveBlueprint());
      return asToolResult(res);
    }

    if (name === "unreal.get_current_level") {
      const res = await run(name, () => client.getCurrentLevel());
      return asToolResult(res);
    }

    if (name === "unreal.get_open_levels") {
      const res = await run(name, () => client.getOpenLevels());
      return asToolResult(res);
    }

    if (name === "unreal.get_selected_assets") {
      const res = await run(name, () => client.getSelectedAssets());
      return asToolResult(res);
    }

    if (name === "unreal.get_selected_components") {
      const res = await run(name, () => client.getSelectedComponents());
      return asToolResult(res);
    }

    if (name === "unreal.get_active_asset_editor") {
      const res = await run(name, () => client.getActiveAssetEditor());
      return asToolResult(res);
    }

    if (name === "unreal.get_active_blueprint_graph") {
      const res = await run(name, () => client.getActiveBlueprintGraph());
      return asToolResult(res);
    }

    if (name === "unreal.get_selected_blueprint_nodes") {
      const res = await run(name, () => client.getSelectedBlueprintNodes());
      return asToolResult(res);
    }

    if (name === "unreal.get_focused_blueprint_node") {
      const res = await run(name, () => client.getFocusedBlueprintNode());
      return asToolResult(res);
    }

    if (name === "unreal.get_editor_viewport_state") {
      const res = await run(name, () => client.getEditorViewportState());
      return asToolResult(res);
    }

    if (name === "unreal.get_world_outliner_selection") {
      const res = await run("unreal.get_selected_actors", () => client.getSelectedActors());
      return asToolResult(res);
    }

    if (name === "unreal.get_content_browser_path") {
      const res = await run(name, () => client.getContentBrowserPath());
      return asToolResult(res);
    }

    if (name === "unreal.get_editor_mode") {
      const res = await run(name, () => client.getEditorMode());
      return asToolResult(res);
    }

    if (name === "unreal.get_dirty_assets") {
      const res = await run(name, () => client.getDirtyAssets());
      return asToolResult(res);
    }

    if (name === "unreal.get_pending_editor_notifications") {
      const res = await run(name, () => client.getPendingEditorNotifications());
      return asToolResult(res);
    }

    if (name === "unreal.get_message_log_summary") {
      const res = await run(name, () => client.getMessageLogSummary());
      return asToolResult(res);
    }

    if (name === "unreal.get_component_tree") {
      const res = await run(name, () =>
        client.getComponentTree({ actor_name: typeof args.actor_name === "string" ? args.actor_name : undefined })
      );
      return asToolResult(res);
    }

    if (name === "unreal.list_assets") {
      const res = await run(name, () =>
        client.listAssets({
          path: typeof args.path === "string" ? args.path : undefined,
          class: typeof args.class === "string" ? args.class : undefined,
          recursive: typeof args.recursive === "boolean" ? args.recursive : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
          name_contains: typeof args.name_contains === "string" ? args.name_contains : undefined
        })
      );
      return asToolResult(res);
    }

    if (name === "unreal.inspect_object") {
      const res = await run(name, () =>
        client.inspectObject({
          object_path: typeof args.object_path === "string" ? args.object_path : undefined,
          asset_path: typeof args.asset_path === "string" ? args.asset_path : undefined,
          actor_name: typeof args.actor_name === "string" ? args.actor_name : undefined,
          include_transient: typeof args.include_transient === "boolean" ? args.include_transient : undefined,
          max_properties: typeof args.max_properties === "number" ? args.max_properties : undefined,
          name_contains: typeof args.name_contains === "string" ? args.name_contains : undefined
        })
      );
      return asToolResult(res);
    }

    if (name === "unreal.inspect_blueprint") {
      const res = await run(name, () =>
        client.inspectBlueprint({
          object_path: typeof args.object_path === "string" ? args.object_path : undefined,
          asset_path: typeof args.asset_path === "string" ? args.asset_path : undefined,
          include_cdo_properties:
            typeof args.include_cdo_properties === "boolean" ? args.include_cdo_properties : undefined,
          include_transient: typeof args.include_transient === "boolean" ? args.include_transient : undefined,
          max_properties: typeof args.max_properties === "number" ? args.max_properties : undefined,
          name_contains: typeof args.name_contains === "string" ? args.name_contains : undefined,
          use_active_if_missing:
            typeof args.use_active_if_missing === "boolean" ? args.use_active_if_missing : undefined
        })
      );
      return asToolResult(res);
    }

    const bpRef = () => ({
      object_path: typeof args.object_path === "string" ? args.object_path : undefined,
      asset_path: typeof args.asset_path === "string" ? args.asset_path : undefined,
      use_active_if_missing: typeof args.use_active_if_missing === "boolean" ? args.use_active_if_missing : true
    });

    const safeInspectBlueprint = async () => {
      const res = await run("unreal.inspect_blueprint", () => client.inspectBlueprint({ ...bpRef(), use_active_if_missing: true }));
      if (typeof res === "object" && res !== null && (res as any).ok === true) {
        return (res as any).result as any;
      }
      const msg =
        typeof res === "object" && res !== null && (res as any).error?.message
          ? String((res as any).error.message)
          : "Blueprint not available";
      return { __missing: true, __note: msg };
    };

    const containsCI = (hay: unknown, needle: unknown) => {
      if (typeof hay !== "string" || typeof needle !== "string" || needle.length === 0) return true;
      return hay.toLowerCase().includes(needle.toLowerCase());
    };

    if (name === "unreal.get_blueprint_summary") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, note: (bp as any).__note });
      }
      return asToolResult({
        ok: true,
        blueprint_found: true,
        object_path: bp.object_path,
        asset_path: bp.asset_path,
        parent_class: bp.parent_class,
        generated_class: bp.generated_class,
        blueprint_type: bp.blueprint_type,
        status: bp.status ?? "unknown",
        counts: {
          variables: Array.isArray(bp.variables) ? bp.variables.length : 0,
          function_graphs: Array.isArray(bp.function_graphs) ? bp.function_graphs.length : 0,
          macro_graphs: Array.isArray(bp.macro_graphs) ? bp.macro_graphs.length : 0,
          ubergraph_pages: Array.isArray(bp.ubergraph_pages) ? bp.ubergraph_pages.length : 0,
          components: Array.isArray(bp.components) ? bp.components.length : 0
        }
      });
    }

    if (name === "unreal.get_blueprint_metadata") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, note: (bp as any).__note });
      }
      return asToolResult({
        ok: true,
        blueprint_found: true,
        name: bp.name,
        object_path: bp.object_path,
        asset_path: bp.asset_path,
        parent_class: bp.parent_class,
        generated_class: bp.generated_class,
        blueprint_type: bp.blueprint_type,
        status: bp.status ?? "unknown",
        interfaces: Array.isArray(bp.interfaces) ? bp.interfaces : []
      });
    }

    if (name === "unreal.get_blueprint_parent_class") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, parent_class: "", note: (bp as any).__note });
      }
      return asToolResult({ ok: true, blueprint_found: true, parent_class: bp.parent_class ?? "" });
    }

    if (name === "unreal.get_blueprint_interfaces") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, interfaces: [], note: (bp as any).__note });
      }
      return asToolResult({ ok: true, blueprint_found: true, interfaces: Array.isArray(bp.interfaces) ? bp.interfaces : [] });
    }

    if (name === "unreal.get_blueprint_components") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, components: [], note: (bp as any).__note });
      }
      return asToolResult({ ok: true, blueprint_found: true, components: Array.isArray(bp.components) ? bp.components : [] });
    }

    if (name === "unreal.get_blueprint_component_tree") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, roots: [], nodes: [], note: (bp as any).__note });
      }
      const comps: Array<{ name: string; parent?: string; component_class?: string; attach_socket?: string }> = Array.isArray(bp.components)
        ? bp.components
        : [];
      const byName = new Map<string, any>();
      for (const c of comps) {
        if (!c || typeof c.name !== "string") continue;
        byName.set(c.name, { ...c, children: [] as string[] });
      }
      for (const c of byName.values()) {
        const p = typeof c.parent === "string" ? c.parent : "";
        if (p && byName.has(p)) {
          byName.get(p).children.push(c.name);
        }
      }
      const nodes = [...byName.values()].map((n) => ({
        name: n.name,
        component_class: n.component_class ?? "",
        parent: n.parent ?? "",
        attach_socket: n.attach_socket ?? "",
        children: n.children
      }));
      const roots = nodes.filter((n) => !n.parent || !byName.has(n.parent)).map((n) => n.name);
      return asToolResult({ ok: true, blueprint_found: true, roots, nodes });
    }

    if (name === "unreal.get_blueprint_variables") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, variables: [], note: (bp as any).__note });
      }
      return asToolResult({ ok: true, blueprint_found: true, variables: Array.isArray(bp.variables) ? bp.variables : [] });
    }

    if (name === "unreal.get_blueprint_local_variables") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, locals: [], note: (bp as any).__note });
      }
      return asToolResult({ ok: true, blueprint_found: true, function: typeof args.function === "string" ? args.function : "", locals: [], note: "Not implemented yet" });
    }

    if (name === "unreal.get_blueprint_functions") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, functions: [], note: (bp as any).__note });
      }
      const fns = Array.isArray(bp.function_graphs) ? bp.function_graphs : [];
      return asToolResult({ ok: true, blueprint_found: true, functions: fns.map((n: any) => ({ name: String(n) })) });
    }

    if (name === "unreal.get_blueprint_macros") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, macros: [], note: (bp as any).__note });
      }
      const macros = Array.isArray(bp.macro_graphs) ? bp.macro_graphs : [];
      return asToolResult({ ok: true, blueprint_found: true, macros: macros.map((n: any) => ({ name: String(n) })) });
    }

    if (name === "unreal.get_blueprint_event_dispatchers") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, event_dispatchers: [], note: (bp as any).__note });
      }
      return asToolResult({ ok: true, blueprint_found: true, event_dispatchers: Array.isArray(bp.event_dispatchers) ? bp.event_dispatchers : [] });
    }

    if (name === "unreal.get_blueprint_timelines") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, timelines: [], note: (bp as any).__note });
      }
      return asToolResult({ ok: true, blueprint_found: true, timelines: Array.isArray(bp.timelines) ? bp.timelines : [] });
    }

    if (name === "unreal.get_blueprint_graphs") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, graphs: [], note: (bp as any).__note });
      }
      const graphs: Array<{ name: string; type: string }> = [];
      for (const g of Array.isArray(bp.ubergraph_pages) ? bp.ubergraph_pages : []) graphs.push({ name: String(g), type: "ubergraph" });
      for (const g of Array.isArray(bp.function_graphs) ? bp.function_graphs : []) graphs.push({ name: String(g), type: "function" });
      for (const g of Array.isArray(bp.macro_graphs) ? bp.macro_graphs : []) graphs.push({ name: String(g), type: "macro" });
      return asToolResult({ ok: true, blueprint_found: true, graphs });
    }

    if (name === "unreal.get_blueprint_graph") {
      const res = await run(name, () =>
        client.getBlueprintGraph({
          ...bpRef(),
          graph: typeof args.graph === "string" ? args.graph : undefined,
          mode: typeof args.mode === "string" ? args.mode : undefined,
          node_id: typeof args.node_id === "string" ? args.node_id : undefined,
          max_depth: typeof args.max_depth === "number" ? args.max_depth : undefined,
          max_nodes: typeof args.max_nodes === "number" ? args.max_nodes : undefined,
          max_edges: typeof args.max_edges === "number" ? args.max_edges : undefined,
          include_pins: typeof args.include_pins === "boolean" ? args.include_pins : undefined,
          include_edges: typeof args.include_edges === "boolean" ? args.include_edges : undefined
        })
      );
      return asToolResult(res);
    }

    if (name === "unreal.get_blueprint_node") {
      const node_id = typeof args.node_id === "string" ? args.node_id : undefined;
      if (!node_id || node_id.length === 0) {
        return asToolResult({ ok: true, node: null, note: "node_id is required" });
      }
      const res = await run("unreal.get_blueprint_graph", () =>
        client.getBlueprintGraph({
          ...bpRef(),
          graph: typeof args.graph === "string" ? args.graph : undefined,
          node_id,
          mode: "full",
          include_pins: true,
          include_edges: true,
          max_nodes: 50,
          max_edges: 200
        })
      );
      if (typeof res === "object" && res !== null && (res as any).ok === true) {
        const r = (res as any).result ?? {};
        const node = Array.isArray(r.nodes) && r.nodes.length > 0 ? r.nodes[0] : null;
        return asToolResult({ ok: true, node, graph_name: r.graph_name ?? "", blueprint_object_path: r.blueprint_object_path ?? "" });
      }
      return asToolResult({ ok: true, node: null, note: "Node not available" });
    }

    if (name === "unreal.get_blueprint_nodes") {
      const limit = typeof args.limit === "number" ? Math.max(0, Math.min(2000, Math.floor(args.limit))) : 200;
      const res = await run("unreal.get_blueprint_graph", () =>
        client.getBlueprintGraph({
          ...bpRef(),
          graph: typeof args.graph === "string" ? args.graph : undefined,
          mode: "full",
          include_pins: false,
          include_edges: false,
          max_nodes: Math.max(50, Math.min(2000, limit))
        })
      );
      if (typeof res === "object" && res !== null && (res as any).ok === true) {
        const r = (res as any).result ?? {};
        const nodes: any[] = Array.isArray(r.nodes) ? r.nodes : [];
        const filtered = nodes
          .filter((n) => containsCI(n?.title, args.title_contains) && containsCI(n?.class, args.class_contains))
          .slice(0, limit)
          .map((n) => ({ id: n.id, title: n.title, class: n.class, pos_x: n.pos_x, pos_y: n.pos_y }));
        return asToolResult({ ok: true, graph_name: r.graph_name ?? "", returned: filtered.length, nodes: filtered });
      }
      return asToolResult({ ok: true, returned: 0, nodes: [], note: "Blueprint graph not available" });
    }

    if (name === "unreal.get_blueprint_node_pins") {
      const node_id = typeof args.node_id === "string" ? args.node_id : undefined;
      if (!node_id || node_id.length === 0) {
        return asToolResult({ ok: true, pins: [], note: "node_id is required" });
      }
      const res = await run("unreal.get_blueprint_graph", () =>
        client.getBlueprintGraph({
          ...bpRef(),
          graph: typeof args.graph === "string" ? args.graph : undefined,
          node_id,
          mode: "full",
          include_pins: true,
          include_edges: false,
          max_nodes: 25
        })
      );
      if (typeof res === "object" && res !== null && (res as any).ok === true) {
        const r = (res as any).result ?? {};
        const node = Array.isArray(r.nodes) && r.nodes.length > 0 ? r.nodes[0] : null;
        return asToolResult({ ok: true, node_id, pins: node?.pins ?? [], note: node ? undefined : "Node not found" });
      }
      return asToolResult({ ok: true, pins: [], note: "Blueprint graph not available" });
    }

    if (name === "unreal.get_blueprint_node_connections") {
      const node_id = typeof args.node_id === "string" ? args.node_id : undefined;
      if (!node_id || node_id.length === 0) {
        return asToolResult({ ok: true, connections: [], note: "node_id is required" });
      }
      const res = await run("unreal.get_blueprint_graph", () =>
        client.getBlueprintGraph({
          ...bpRef(),
          graph: typeof args.graph === "string" ? args.graph : undefined,
          node_id,
          mode: "full",
          include_pins: false,
          include_edges: true,
          max_nodes: 50,
          max_edges: 500
        })
      );
      if (typeof res === "object" && res !== null && (res as any).ok === true) {
        const r = (res as any).result ?? {};
        const edges: any[] = Array.isArray(r.edges) ? r.edges : [];
        const relevant = edges.filter((e) => e?.from_node_id === node_id || e?.to_node_id === node_id);
        return asToolResult({ ok: true, node_id, connections: relevant });
      }
      return asToolResult({ ok: true, connections: [], note: "Blueprint graph not available" });
    }

    if (name === "unreal.get_blueprint_execution_flow") {
      const res = await run("unreal.get_blueprint_graph", () =>
        client.getBlueprintGraph({
          ...bpRef(),
          graph: typeof args.graph === "string" ? args.graph : undefined,
          mode: "execution_only",
          max_depth: typeof args.max_depth === "number" ? args.max_depth : undefined,
          max_nodes: typeof args.max_nodes === "number" ? args.max_nodes : undefined,
          max_edges: typeof args.max_edges === "number" ? args.max_edges : undefined,
          include_edges: true
        })
      );
      return asToolResult(res);
    }

    if (name === "unreal.get_blueprint_data_flow") {
      const res = await run("unreal.get_blueprint_graph", () =>
        client.getBlueprintGraph({
          ...bpRef(),
          graph: typeof args.graph === "string" ? args.graph : undefined,
          mode: "data_flow",
          max_depth: typeof args.max_depth === "number" ? args.max_depth : undefined,
          max_nodes: typeof args.max_nodes === "number" ? args.max_nodes : undefined,
          max_edges: typeof args.max_edges === "number" ? args.max_edges : undefined,
          include_edges: true
        })
      );
      return asToolResult(res);
    }

    if (name === "unreal.get_blueprint_node_defaults") {
      const node_id = typeof args.node_id === "string" ? args.node_id : undefined;
      if (!node_id || node_id.length === 0) {
        return asToolResult({ ok: true, defaults: [], note: "node_id is required" });
      }
      const res = await run("unreal.get_blueprint_graph", () =>
        client.getBlueprintGraph({
          ...bpRef(),
          graph: typeof args.graph === "string" ? args.graph : undefined,
          node_id,
          mode: "full",
          include_pins: true,
          include_edges: false,
          max_nodes: 25
        })
      );
      if (typeof res === "object" && res !== null && (res as any).ok === true) {
        const r = (res as any).result ?? {};
        const node = Array.isArray(r.nodes) && r.nodes.length > 0 ? r.nodes[0] : null;
        const pins: any[] = Array.isArray(node?.pins) ? node.pins : [];
        const defaults = pins.map((p) => ({ pin: p?.name ?? "", default_value: p?.default_value ?? "" }));
        return asToolResult({ ok: true, node_id, defaults });
      }
      return asToolResult({ ok: true, defaults: [], note: "Blueprint graph not available" });
    }

    if (name === "unreal.get_blueprint_references") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, references: [], note: (bp as any).__note });
      }
      return asToolResult({ ok: true, blueprint_found: true, references: [], note: "Not implemented yet" });
    }

    if (name === "unreal.get_blueprint_dependencies") {
      const res = await run(name, () => client.getBlueprintDependencies(bpRef()));
      return asToolResult(res);
    }

    if (name === "unreal.get_blueprint_dependents") {
      const res = await run(name, () => client.getBlueprintDependents(bpRef()));
      return asToolResult(res);
    }

    if (name === "unreal.get_blueprint_debug_object") {
      return asToolResult({ ok: true, debug_object: null, note: "Not implemented yet" });
    }

    if (name === "unreal.get_blueprint_breakpoints") {
      return asToolResult({ ok: true, breakpoints: [], note: "Not implemented yet" });
    }

    if (name === "unreal.get_blueprint_watches") {
      return asToolResult({ ok: true, watches: [], note: "Not implemented yet" });
    }

    if (name === "unreal.get_blueprint_bookmarks") {
      return asToolResult({ ok: true, bookmarks: [], note: "Not implemented yet" });
    }

    if (name === "unreal.get_blueprint_compile_status") {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) {
        return asToolResult({ ok: true, blueprint_found: false, status: "unknown", note: (bp as any).__note });
      }
      return asToolResult({ ok: true, blueprint_found: true, status: bp.status ?? "unknown" });
    }

    if (name === "unreal.get_blueprint_class_defaults") {
      const res = await run("unreal.inspect_blueprint", () =>
        client.inspectBlueprint({
          ...bpRef(),
          include_cdo_properties: true,
          include_transient: typeof args.include_transient === "boolean" ? args.include_transient : undefined,
          max_properties: typeof args.max_properties === "number" ? args.max_properties : undefined,
          name_contains: typeof args.name_contains === "string" ? args.name_contains : undefined
        })
      );
      if (typeof res === "object" && res !== null && (res as any).ok === true) {
        const r = (res as any).result ?? {};
        return asToolResult({
          ok: true,
          blueprint_object_path: r.object_path ?? "",
          cdo_object_path: r.cdo_object_path ?? "",
          cdo_properties: Array.isArray(r.cdo_properties) ? r.cdo_properties : []
        });
      }
      return asToolResult({ ok: true, cdo_properties: [], note: "Blueprint not available" });
    }

    if (name === "unreal.get_blueprint_node_comment") {
      const node_id = typeof args.node_id === "string" ? args.node_id : undefined;
      if (!node_id || node_id.length === 0) {
        return asToolResult({ ok: true, node_id: "", comment: "", note: "node_id is required" });
      }
      const res = await run("unreal.get_blueprint_graph", () =>
        client.getBlueprintGraph({
          ...bpRef(),
          graph: typeof args.graph === "string" ? args.graph : undefined,
          node_id,
          mode: "full",
          include_pins: false,
          include_edges: false,
          max_nodes: 25
        })
      );
      if (typeof res === "object" && res !== null && (res as any).ok === true) {
        const r = (res as any).result ?? {};
        const node = Array.isArray(r.nodes) && r.nodes.length > 0 ? r.nodes[0] : null;
        return asToolResult({ ok: true, node_id, comment: node?.node_comment ?? node?.comment ?? "" });
      }
      return asToolResult({ ok: true, node_id, comment: "", note: "Blueprint graph not available" });
    }

    if (name === "unreal.get_blueprint_graph_comments") {
      const res = await run("unreal.get_blueprint_graph", () =>
        client.getBlueprintGraph({
          ...bpRef(),
          graph: typeof args.graph === "string" ? args.graph : undefined,
          mode: "summary",
          max_nodes: typeof args.max_nodes === "number" ? args.max_nodes : undefined
        })
      );
      if (typeof res === "object" && res !== null && (res as any).ok === true) {
        const r = (res as any).result ?? {};
        return asToolResult({ ok: true, graph_name: r.graph_name ?? "", comments: Array.isArray(r.comment_boxes) ? r.comment_boxes : [] });
      }
      return asToolResult({ ok: true, comments: [], note: "Blueprint graph not available" });
    }

    const clampInt = (v: unknown, def: number, min: number, max: number) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return def;
      const n = Math.floor(v);
      return Math.max(min, Math.min(max, n));
    };

    const listGraphsBestEffort = async () => {
      const bp = await safeInspectBlueprint();
      if ((bp as any).__missing) return [] as string[];
      const out: string[] = [];
      for (const g of Array.isArray((bp as any).ubergraph_pages) ? (bp as any).ubergraph_pages : []) out.push(String(g));
      for (const g of Array.isArray((bp as any).function_graphs) ? (bp as any).function_graphs : []) out.push(String(g));
      for (const g of Array.isArray((bp as any).macro_graphs) ? (bp as any).macro_graphs : []) out.push(String(g));
      return [...new Set(out.filter((s) => typeof s === "string" && s.length > 0))];
    };

    const fetchGraph = async (graphName: string | undefined, opts: Record<string, unknown>) => {
      const res = await run("unreal.get_blueprint_graph", () =>
        client.getBlueprintGraph({
          ...bpRef(),
          graph: graphName,
          ...opts
        })
      );
      if (typeof res === "object" && res !== null && (res as any).ok === true) {
        return (res as any).result ?? null;
      }
      return null;
    };

    const summarizeNode = (n: any, graph_name: string) => ({
      graph: graph_name,
      id: n?.id ?? "",
      title: n?.title ?? "",
      class: n?.class ?? "",
      pos_x: n?.pos_x ?? 0,
      pos_y: n?.pos_y ?? 0
    });

    const findAcrossGraphs = async (opts: {
      graph?: string;
      all_graphs?: boolean;
      max_graphs?: number;
      limit?: number;
      mode?: string;
      include_pins?: boolean;
      include_edges?: boolean;
      predicate: (node: any, graphName: string, graphExport: any) => boolean;
      extraPerMatch?: (node: any, graphName: string, graphExport: any) => Record<string, unknown>;
    }) => {
      const limit = clampInt(opts.limit, 50, 0, 500);
      const maxGraphs = clampInt(opts.max_graphs, 25, 1, 100);

      let graphs: Array<string | undefined> = [typeof opts.graph === "string" && opts.graph.length > 0 ? opts.graph : undefined];
      if (opts.all_graphs) {
        const gs = await listGraphsBestEffort();
        graphs = gs.slice(0, maxGraphs);
        if (graphs.length === 0) graphs = [undefined];
      }

      const matches: any[] = [];
      let scannedGraphs = 0;
      for (const g of graphs) {
        if (matches.length >= limit) break;
        const exportRes = await fetchGraph(typeof g === "string" ? g : undefined, {
          mode: opts.mode ?? "full",
          include_pins: Boolean(opts.include_pins),
          include_edges: Boolean(opts.include_edges),
          max_nodes: 2000,
          max_edges: 20000
        });
        if (!exportRes) continue;
        scannedGraphs += 1;

        const graph_name = String(exportRes.graph_name ?? g ?? "");
        const nodes: any[] = Array.isArray(exportRes.nodes) ? exportRes.nodes : [];
        for (const n of nodes) {
          if (matches.length >= limit) break;
          if (!opts.predicate(n, graph_name, exportRes)) continue;
          const base = summarizeNode(n, graph_name);
          matches.push({
            ...base,
            ...(opts.extraPerMatch ? opts.extraPerMatch(n, graph_name, exportRes) : {})
          });
        }
      }

      return { limit, scanned_graphs: scannedGraphs, returned: matches.length, matches };
    };

    if (name === "unreal.find_blueprint_nodes") {
      const query = typeof args.query === "string" ? args.query : typeof args.title_contains === "string" ? args.title_contains : "";
      const class_contains = typeof args.class_contains === "string" ? args.class_contains : "";
      const all_graphs = typeof args.all_graphs === "boolean" ? args.all_graphs : false;
      const max_graphs = typeof args.max_graphs === "number" ? args.max_graphs : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;

      const res = await findAcrossGraphs({
        graph: typeof args.graph === "string" ? args.graph : undefined,
        all_graphs,
        max_graphs,
        limit,
        predicate: (n) => containsCI(n?.title, query) && containsCI(n?.class, class_contains)
      });
      return asToolResult({ ok: true, ...res, query, class_contains, all_graphs });
    }

    if (name === "unreal.find_blueprint_events") {
      const query = typeof args.query === "string" ? args.query : "";
      const all_graphs = typeof args.all_graphs === "boolean" ? args.all_graphs : false;
      const max_graphs = typeof args.max_graphs === "number" ? args.max_graphs : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;

      const res = await findAcrossGraphs({
        graph: typeof args.graph === "string" ? args.graph : undefined,
        all_graphs,
        max_graphs,
        limit,
        predicate: (n) => {
          const cls = String(n?.class ?? "");
          const title = String(n?.title ?? "");
          const looksEvent =
            cls.includes("UK2Node_Event") ||
            cls.includes("UK2Node_CustomEvent") ||
            cls.includes("UK2Node_ComponentBoundEvent") ||
            title.toLowerCase().startsWith("event ");
          return looksEvent && containsCI(title, query);
        }
      });
      return asToolResult({ ok: true, ...res, query, all_graphs, note: "Heuristic match: checks node class/title." });
    }

    const findCallsLike = async (toolName: string) => {
      const query =
        typeof args.function_name === "string"
          ? args.function_name
          : typeof args.query === "string"
            ? args.query
            : "";
      const all_graphs = typeof args.all_graphs === "boolean" ? args.all_graphs : false;
      const max_graphs = typeof args.max_graphs === "number" ? args.max_graphs : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;

      const res = await findAcrossGraphs({
        graph: typeof args.graph === "string" ? args.graph : undefined,
        all_graphs,
        max_graphs,
        limit,
        predicate: (n) => {
          const cls = String(n?.class ?? "");
          if (!cls.includes("UK2Node_CallFunction")) return false;
          return containsCI(n?.title, query);
        }
      });
      return asToolResult({ ok: true, tool: toolName, ...res, query, all_graphs, note: "Heuristic: CallFunction nodes filtered by title substring." });
    };

    if (name === "unreal.find_blueprint_function_calls") {
      return await findCallsLike(name);
    }

    if (name === "unreal.find_blueprint_callers") {
      return await findCallsLike(name);
    }

    if (name === "unreal.find_blueprint_variable_reads") {
      const query =
        typeof args.variable_name === "string" ? args.variable_name : typeof args.query === "string" ? args.query : "";
      const all_graphs = typeof args.all_graphs === "boolean" ? args.all_graphs : false;
      const max_graphs = typeof args.max_graphs === "number" ? args.max_graphs : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      const res = await findAcrossGraphs({
        graph: typeof args.graph === "string" ? args.graph : undefined,
        all_graphs,
        max_graphs,
        limit,
        predicate: (n) => {
          const cls = String(n?.class ?? "");
          if (cls.includes("UK2Node_VariableGet")) return containsCI(n?.title, query);
          // Fallback: title contains variable name.
          return query.length > 0 && containsCI(String(n?.title ?? ""), query) && String(n?.title ?? "").toLowerCase().includes("get");
        }
      });
      return asToolResult({ ok: true, ...res, query, all_graphs, note: "Heuristic match: VariableGet nodes and title substring." });
    }

    if (name === "unreal.find_blueprint_variable_writes") {
      const query =
        typeof args.variable_name === "string" ? args.variable_name : typeof args.query === "string" ? args.query : "";
      const all_graphs = typeof args.all_graphs === "boolean" ? args.all_graphs : false;
      const max_graphs = typeof args.max_graphs === "number" ? args.max_graphs : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      const res = await findAcrossGraphs({
        graph: typeof args.graph === "string" ? args.graph : undefined,
        all_graphs,
        max_graphs,
        limit,
        predicate: (n) => {
          const cls = String(n?.class ?? "");
          if (cls.includes("UK2Node_VariableSet")) return containsCI(n?.title, query);
          return query.length > 0 && containsCI(String(n?.title ?? ""), query) && String(n?.title ?? "").toLowerCase().includes("set");
        }
      });
      return asToolResult({ ok: true, ...res, query, all_graphs, note: "Heuristic match: VariableSet nodes and title substring." });
    }

    if (name === "unreal.find_blueprint_component_references") {
      const query =
        typeof args.component_name === "string" ? args.component_name : typeof args.query === "string" ? args.query : "";
      const all_graphs = typeof args.all_graphs === "boolean" ? args.all_graphs : false;
      const max_graphs = typeof args.max_graphs === "number" ? args.max_graphs : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      const res = await findAcrossGraphs({
        graph: typeof args.graph === "string" ? args.graph : undefined,
        all_graphs,
        max_graphs,
        limit,
        include_pins: true,
        predicate: (n) => {
          if (query.length === 0) return false;
          if (containsCI(n?.title, query) || containsCI(n?.node_comment, query) || containsCI(n?.comment, query)) return true;
          const pins: any[] = Array.isArray(n?.pins) ? n.pins : [];
          return pins.some((p) => containsCI(p?.default_value, query) || containsCI(p?.type, query) || containsCI(p?.name, query));
        }
      });
      return asToolResult({ ok: true, ...res, query, all_graphs, note: "Heuristic match: title/comment/pin default/type/name substring." });
    }

    if (name === "unreal.find_blueprint_asset_references") {
      const query =
        typeof args.asset_query === "string" ? args.asset_query : typeof args.query === "string" ? args.query : "";
      const all_graphs = typeof args.all_graphs === "boolean" ? args.all_graphs : false;
      const max_graphs = typeof args.max_graphs === "number" ? args.max_graphs : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      const res = await findAcrossGraphs({
        graph: typeof args.graph === "string" ? args.graph : undefined,
        all_graphs,
        max_graphs,
        limit,
        include_pins: true,
        predicate: (n) => {
          if (query.length === 0) return false;
          if (containsCI(n?.title, query) || containsCI(n?.node_comment, query) || containsCI(n?.comment, query)) return true;
          const pins: any[] = Array.isArray(n?.pins) ? n.pins : [];
          return pins.some((p) => containsCI(p?.default_value, query));
        }
      });
      return asToolResult({ ok: true, ...res, query, all_graphs, note: "Heuristic match: node title/comment and pin default_value substring." });
    }

    if (name === "unreal.find_blueprint_class_references") {
      const query =
        typeof args.class_query === "string" ? args.class_query : typeof args.query === "string" ? args.query : "";
      const all_graphs = typeof args.all_graphs === "boolean" ? args.all_graphs : false;
      const max_graphs = typeof args.max_graphs === "number" ? args.max_graphs : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      const res = await findAcrossGraphs({
        graph: typeof args.graph === "string" ? args.graph : undefined,
        all_graphs,
        max_graphs,
        limit,
        include_pins: true,
        predicate: (n) => {
          if (query.length === 0) return false;
          if (containsCI(n?.title, query) || containsCI(n?.class, query)) return true;
          const pins: any[] = Array.isArray(n?.pins) ? n.pins : [];
          return pins.some((p) => containsCI(p?.type, query) || containsCI(p?.default_value, query));
        }
      });
      return asToolResult({ ok: true, ...res, query, all_graphs, note: "Heuristic match: title/class/pin type/default substring." });
    }

    if (name === "unreal.find_blueprint_unconnected_pins") {
      const graph = typeof args.graph === "string" ? args.graph : undefined;
      const exec_only = typeof args.exec_only === "boolean" ? args.exec_only : false;
      const data_only = typeof args.data_only === "boolean" ? args.data_only : false;
      const limit = clampInt(args.limit, 200, 0, 2000);

      const exportRes = await fetchGraph(graph, {
        mode: "full",
        include_pins: true,
        include_edges: true,
        max_nodes: 2000,
        max_edges: 20000
      });
      if (!exportRes) {
        return asToolResult({ ok: true, returned: 0, pins: [], note: "Blueprint graph not available" });
      }

      const edges: any[] = Array.isArray(exportRes.edges) ? exportRes.edges : [];
      const nodes: any[] = Array.isArray(exportRes.nodes) ? exportRes.nodes : [];
      const out: any[] = [];

      for (const n of nodes) {
        if (out.length >= limit) break;
        const nodeId = String(n?.id ?? "");
        const pins: any[] = Array.isArray(n?.pins) ? n.pins : [];
        for (const p of pins) {
          if (out.length >= limit) break;
          const isExec = Boolean(p?.is_exec);
          if (exec_only && !isExec) continue;
          if (data_only && isExec) continue;

          const pinName = String(p?.name ?? "");
          if (!pinName) continue;

          const connected = edges.some(
            (e) =>
              (e?.from_node_id === nodeId && e?.from_pin === pinName) || (e?.to_node_id === nodeId && e?.to_pin === pinName)
          );
          if (connected) continue;

          out.push({
            graph: String(exportRes.graph_name ?? graph ?? ""),
            node_id: nodeId,
            node_title: String(n?.title ?? ""),
            node_class: String(n?.class ?? ""),
            pin: {
              name: pinName,
              direction: String(p?.direction ?? ""),
              type: String(p?.type ?? ""),
              is_exec: isExec,
              default_value: String(p?.default_value ?? "")
            }
          });
        }
      }

      return asToolResult({
        ok: true,
        graph_name: String(exportRes.graph_name ?? graph ?? ""),
        returned: out.length,
        pins: out,
        exec_only,
        data_only,
        note: "Unconnected means no edges reference the pin (from_pin/to_pin)."
      });
    }

    const execGraphDegrees = async (graph: string | undefined) => {
      const exportRes = await fetchGraph(graph, {
        mode: "execution_only",
        include_edges: true,
        include_pins: false,
        max_nodes: 2000,
        max_edges: 20000
      });
      if (!exportRes) return null;
      const nodes: any[] = Array.isArray(exportRes.nodes) ? exportRes.nodes : [];
      const edges: any[] = Array.isArray(exportRes.edges) ? exportRes.edges : [];
      const indeg = new Map<string, number>();
      const outdeg = new Map<string, number>();
      for (const n of nodes) {
        const id = String(n?.id ?? "");
        if (!id) continue;
        indeg.set(id, 0);
        outdeg.set(id, 0);
      }
      for (const e of edges) {
        const f = String(e?.from_node_id ?? "");
        const t = String(e?.to_node_id ?? "");
        if (f && outdeg.has(f)) outdeg.set(f, (outdeg.get(f) ?? 0) + 1);
        if (t && indeg.has(t)) indeg.set(t, (indeg.get(t) ?? 0) + 1);
      }
      return { exportRes, nodes, edges, indeg, outdeg };
    };

    if (name === "unreal.find_blueprint_dead_ends") {
      const graph = typeof args.graph === "string" ? args.graph : undefined;
      const limit = clampInt(args.limit, 50, 0, 500);
      const r = await execGraphDegrees(graph);
      if (!r) return asToolResult({ ok: true, returned: 0, nodes: [], note: "Blueprint graph not available" });

      const leaves = r.nodes
        .filter((n) => (r.outdeg.get(String(n?.id ?? "")) ?? 0) === 0)
        .slice(0, limit)
        .map((n) => ({
          ...summarizeNode(n, String(r.exportRes.graph_name ?? graph ?? "")),
          indegree: r.indeg.get(String(n?.id ?? "")) ?? 0,
          outdegree: 0
        }));

      return asToolResult({
        ok: true,
        graph_name: String(r.exportRes.graph_name ?? graph ?? ""),
        returned: leaves.length,
        nodes: leaves,
        note: "Heuristic: nodes with outdegree=0 in execution_only graph. This does not prove reachability from entry points."
      });
    }

    if (name === "unreal.find_blueprint_entry_points") {
      const graph = typeof args.graph === "string" ? args.graph : undefined;
      const limit = clampInt(args.limit, 50, 0, 500);
      const r = await execGraphDegrees(graph);
      if (!r) return asToolResult({ ok: true, returned: 0, nodes: [], note: "Blueprint graph not available" });

      const entries = r.nodes
        .filter((n) => (r.indeg.get(String(n?.id ?? "")) ?? 0) === 0)
        .slice(0, limit)
        .map((n) => ({
          ...summarizeNode(n, String(r.exportRes.graph_name ?? graph ?? "")),
          indegree: 0,
          outdegree: r.outdeg.get(String(n?.id ?? "")) ?? 0
        }));

      return asToolResult({
        ok: true,
        graph_name: String(r.exportRes.graph_name ?? graph ?? ""),
        returned: entries.length,
        nodes: entries,
        note: "Heuristic: nodes with indegree=0 in execution_only graph." 
      });
    }

    if (name === "unreal.find_blueprint_implementations") {
      return asToolResult({ ok: true, implementations: [], note: "Not implemented yet" });
    }

    const buildGraphIndex = (exportRes: any) => {
      const nodes: any[] = Array.isArray(exportRes?.nodes) ? exportRes.nodes : [];
      const edges: any[] = Array.isArray(exportRes?.edges) ? exportRes.edges : [];
      const byId = new Map<string, any>();
      for (const n of nodes) {
        const id = String(n?.id ?? "");
        if (!id) continue;
        byId.set(id, n);
      }
      const next = new Map<string, string[]>();
      const prev = new Map<string, string[]>();
      for (const id of byId.keys()) {
        next.set(id, []);
        prev.set(id, []);
      }
      for (const e of edges) {
        const f = String(e?.from_node_id ?? "");
        const t = String(e?.to_node_id ?? "");
        if (!f || !t) continue;
        if (!byId.has(f) || !byId.has(t)) continue;
        next.get(f)!.push(t);
        prev.get(t)!.push(f);
      }
      return { byId, edges, next, prev };
    };

    const bfsPath = (next: Map<string, string[]>, start: string, goal: string, maxSteps: number) => {
      if (start === goal) return [start];
      const q: string[] = [start];
      const parent = new Map<string, string | null>();
      parent.set(start, null);
      let steps = 0;
      while (q.length > 0 && steps < 200000) {
        const cur = q.shift()!;
        const neigh = next.get(cur) ?? [];
        for (const n of neigh) {
          if (parent.has(n)) continue;
          parent.set(n, cur);
          if (n === goal) {
            const path: string[] = [];
            let x: string | null = goal;
            while (x) {
              path.push(x);
              x = parent.get(x) ?? null;
            }
            path.reverse();
            if (path.length - 1 > maxSteps) return null;
            return path;
          }
          q.push(n);
        }
        steps += 1;
      }
      return null;
    };

    if (name === "unreal.trace_blueprint_path") {
      const graph = typeof args.graph === "string" ? args.graph : undefined;
      const from_node_id = typeof args.from_node_id === "string" ? args.from_node_id : "";
      const to_node_id = typeof args.to_node_id === "string" ? args.to_node_id : "";
      const max_steps = clampInt(args.max_steps, 32, 0, 256);
      if (!from_node_id || !to_node_id) {
        return asToolResult({ ok: true, path: [], note: "from_node_id and to_node_id are required" });
      }
      const exportRes = await fetchGraph(graph, {
        mode: "full",
        include_edges: true,
        include_pins: false,
        max_nodes: 2000,
        max_edges: 20000
      });
      if (!exportRes) return asToolResult({ ok: true, path: [], note: "Blueprint graph not available" });

      const idx = buildGraphIndex(exportRes);
      if (!idx.byId.has(from_node_id) || !idx.byId.has(to_node_id)) {
        return asToolResult({ ok: true, path: [], note: "from_node_id/to_node_id not found in exported graph (increase bounds or check graph)" });
      }
      const pathIds = bfsPath(idx.next, from_node_id, to_node_id, max_steps);
      if (!pathIds) {
        return asToolResult({ ok: true, path: [], note: "No path found (or exceeded max_steps)" });
      }
      const graph_name = String(exportRes.graph_name ?? graph ?? "");
      const nodes = pathIds.map((id) => summarizeNode(idx.byId.get(id), graph_name));
      return asToolResult({ ok: true, graph_name, from_node_id, to_node_id, steps: pathIds.length - 1, path: nodes });
    }

    const bfsSubgraph = (start: string, next: Map<string, string[]>, maxDepth: number, maxNodes: number) => {
      const seen = new Set<string>();
      const depth = new Map<string, number>();
      const q: string[] = [];
      seen.add(start);
      depth.set(start, 0);
      q.push(start);
      while (q.length > 0 && seen.size < maxNodes) {
        const cur = q.shift()!;
        const d = depth.get(cur) ?? 0;
        if (d >= maxDepth) continue;
        for (const n of next.get(cur) ?? []) {
          if (seen.has(n)) continue;
          seen.add(n);
          depth.set(n, d + 1);
          if (seen.size >= maxNodes) break;
          q.push(n);
        }
      }
      return seen;
    };

    const upstreamDownstreamCommon = async (direction: "up" | "down" | "both") => {
      const graph = typeof args.graph === "string" ? args.graph : undefined;
      const node_id = typeof args.node_id === "string" ? args.node_id : "";
      const max_depth = clampInt(args.max_depth, direction === "both" ? 1 : 3, 0, 20);
      const max_nodes = clampInt(args.max_nodes, 200, 1, 2000);
      if (!node_id) {
        return asToolResult({ ok: true, nodes: [], edges: [], note: "node_id is required" });
      }
      const exportRes = await fetchGraph(graph, {
        mode: "full",
        include_edges: true,
        include_pins: false,
        max_nodes: 2000,
        max_edges: 20000
      });
      if (!exportRes) return asToolResult({ ok: true, nodes: [], edges: [], note: "Blueprint graph not available" });

      const idx = buildGraphIndex(exportRes);
      if (!idx.byId.has(node_id)) {
        return asToolResult({ ok: true, nodes: [], edges: [], note: "node_id not found in exported graph (increase bounds or check graph)" });
      }

      const graph_name = String(exportRes.graph_name ?? graph ?? "");
      const picked = new Set<string>();
      if (direction === "up" || direction === "both") {
        for (const id of bfsSubgraph(node_id, idx.prev, max_depth, max_nodes)) picked.add(id);
      }
      if (direction === "down" || direction === "both") {
        for (const id of bfsSubgraph(node_id, idx.next, max_depth, max_nodes)) picked.add(id);
      }

      const nodes = [...picked].map((id) => summarizeNode(idx.byId.get(id), graph_name));
      const edges = idx.edges
        .filter((e) => picked.has(String(e?.from_node_id ?? "")) && picked.has(String(e?.to_node_id ?? "")))
        .slice(0, 5000);

      return asToolResult({ ok: true, graph_name, node_id, returned_nodes: nodes.length, returned_edges: edges.length, nodes, edges });
    };

    if (name === "unreal.get_upstream_nodes") {
      return await upstreamDownstreamCommon("up");
    }

    if (name === "unreal.get_downstream_nodes") {
      return await upstreamDownstreamCommon("down");
    }

    if (name === "unreal.get_node_neighbourhood") {
      return await upstreamDownstreamCommon("both");
    }

    if (name === "unreal.focus_blueprint_node") {
      return asToolResult({ ok: true, supported: false, note: "Not implemented yet (requires Blueprint editor UI integration)." });
    }

    if (name === "unreal.open_blueprint_graph") {
      return asToolResult({ ok: true, supported: false, note: "Not implemented yet (requires Blueprint editor UI integration)." });
    }

    if (name === "unreal.select_blueprint_nodes") {
      return asToolResult({ ok: true, supported: false, note: "Not implemented yet (requires Blueprint editor UI integration)." });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` }
          })
        }
      ],
      isError: true
    };
  } catch (err) {
    lastToolError = {
      at: nowIso(),
      tool: name,
      kind: "exception",
      error: {
        message: String(err instanceof Error ? err.message : err),
        name: err instanceof Error ? err.name : undefined,
        stack: err instanceof Error ? err.stack : undefined
      }
    };
    return {
      content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
