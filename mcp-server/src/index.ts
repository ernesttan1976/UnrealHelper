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
