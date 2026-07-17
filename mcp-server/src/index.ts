import "dotenv/config";

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

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "unreal.ping",
        description: "Check connectivity with the Unreal Editor plugin.",
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
        name: "unreal.get_active_blueprint",
        description:
          "Get the Blueprint currently being edited (best-effort: if multiple are open, returns a deterministic choice).",
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
        description:
          "List assets via the Asset Registry (no direct .uasset reads).",
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
        description:
          "Inspect a UObject (or Actor by name) using Unreal reflection (no direct .uasset reads).",
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
        description:
          "Inspect a Blueprint asset (variables, graphs, SCS components; optionally CDO properties).",
        inputSchema: {
          type: "object",
          properties: {
            object_path: { type: "string", description: "Blueprint object path, e.g. /Game/Foo/BP_My.BP_My" },
            asset_path: { type: "string", description: "Blueprint asset package path, e.g. /Game/Foo/BP_My" },
            include_cdo_properties: { type: "boolean", description: "If true, also exports properties from the generated class CDO." },
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
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;

  const asToolResult = (res: unknown) => {
    // We always return JSON text so the model can reason about structured data.
    // If Unreal returns ok:false we also mark the MCP tool call as an error.
    if (typeof res === "object" && res !== null && "ok" in res && (res as any).ok === false) {
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  };

  try {
    if (name === "unreal.ping") {
      const res = await client.ping();
      return asToolResult(res);
    }

    if (name === "unreal.get_editor_status") {
      const res = await client.getEditorStatus();
      return asToolResult(res);
    }

    if (name === "unreal.get_engine_version") {
      const res = await client.getEngineVersion();
      return asToolResult(res);
    }

    if (name === "unreal.get_current_project") {
      const res = await client.getCurrentProject();
      return asToolResult(res);
    }

    if (name === "unreal.get_selected_actors") {
      const res = await client.getSelectedActors();
      return asToolResult(res);
    }

    if (name === "unreal.get_open_editors") {
      const res = await client.getOpenEditors();
      return asToolResult(res);
    }

    if (name === "unreal.get_active_blueprint") {
      const res = await client.getActiveBlueprint();
      return asToolResult(res);
    }

    if (name === "unreal.get_component_tree") {
      const args = (request.params.arguments ?? {}) as { actor_name?: string };
      const res = await client.getComponentTree({ actor_name: args.actor_name });
      return asToolResult(res);
    }

    if (name === "unreal.list_assets") {
      const args = (request.params.arguments ?? {}) as {
        path?: string;
        class?: string;
        recursive?: boolean;
        limit?: number;
        name_contains?: string;
      };
      const res = await client.listAssets(args);
      return asToolResult(res);
    }

    if (name === "unreal.inspect_object") {
      const args = (request.params.arguments ?? {}) as {
        object_path?: string;
        asset_path?: string;
        actor_name?: string;
        include_transient?: boolean;
        max_properties?: number;
        name_contains?: string;
      };
      const res = await client.inspectObject(args);
      return asToolResult(res);
    }

    if (name === "unreal.inspect_blueprint") {
      const args = (request.params.arguments ?? {}) as {
        object_path?: string;
        asset_path?: string;
        include_cdo_properties?: boolean;
        include_transient?: boolean;
        max_properties?: number;
        name_contains?: string;
        use_active_if_missing?: boolean;
      };
      const res = await client.inspectBlueprint(args);
      return asToolResult(res);
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Unknown tool" }) }],
      isError: true
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
