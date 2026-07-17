import "dotenv/config";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { envSchema } from "./mcp.js";
import { UnrealClient } from "./unreal-client.js";

const env = envSchema.parse(process.env);

const client = new UnrealClient({
  host: env.UNREAL_HOST,
  port: env.UNREAL_PORT,
  token: env.UNREAL_TOKEN,
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

    if (name === "unreal.get_component_tree") {
      const args = (request.params.arguments ?? {}) as { actor_name?: string };
      const res = await client.getComponentTree({ actor_name: args.actor_name });
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
