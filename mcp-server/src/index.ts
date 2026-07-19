import "dotenv/config";

import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { envSchema } from "./mcp.js";
import { UnrealClient } from "./unreal-client.js";
import { resolveUnrealConfigFromProject } from "./unreal-project-config.js";
import { fail } from "./core/errors.js";
import { loadPackPolicyFromEnv } from "./core/pack-policy.js";
import { Telemetry } from "./core/telemetry.js";
import type { ToolTelemetryRecord } from "./core/telemetry.js";
import { TOOL_DEFS, TOOL_META_BY_NAME } from "./tools/generated/tool-defs.js";

const env = envSchema.parse(process.env);
const packPolicy = loadPackPolicyFromEnv(process.env);
const telemetry = new Telemetry({
  enabled: env.UNREAL_MCP_TELEMETRY === "1" || env.UNREAL_MCP_TELEMETRY === "true",
  filePath: env.UNREAL_MCP_TELEMETRY_PATH
});

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
  | { at: string; tool: string; kind: "unreal_error"; error: unknown }
  | { at: string; tool: string; kind: "exception"; error: { message: string; name?: string; stack?: string } };

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

function enabledTools() {
  return TOOL_DEFS.filter((t) => {
    const meta = TOOL_META_BY_NAME[t.name];
    if (!meta) return false;
    if (meta.access === "write" && !packPolicy.writeEnabled) return false;
    return meta.packs.some((p) => packPolicy.enabledPacks.has(p));
  });
}

const server = new Server(
  { name: "unreal-debug-copilot", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: enabledTools().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  const startedAt = Date.now();
  let editorReady: boolean | undefined;
  let pieState: string | undefined;
  let responseForTelemetry: unknown = null;

  const asToolResult = (res: unknown) => {
    const isErr = Boolean(res && typeof res === "object" && "ok" in (res as any) && (res as any).ok === false);
    return {
      content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      ...(isErr ? { isError: true } : {})
    };
  };

  const run = async <T>(tool: string, fn: () => Promise<T>) => {
    const started = Date.now();
    try {
      const res = await fn();
      const elapsed = Date.now() - started;

      if (typeof res === "object" && res !== null && "ok" in res && (res as any).ok === false) {
        lastToolError = { at: nowIso(), tool, kind: "unreal_error", error: (res as any).error };
      }

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
      const elapsed = Date.now() - started;
      const e = err instanceof Error ? err : new Error(String(err));
      lastToolError = { at: nowIso(), tool, kind: "exception", error: { message: e.message, name: e.name, stack: e.stack } };

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
    const meta = TOOL_META_BY_NAME[name];
    if (!meta) {
      responseForTelemetry = fail("TOOL_NOT_REGISTERED", `Tool is not registered: ${name}`);
      return asToolResult(responseForTelemetry);
    }
    if (!meta.packs.some((p) => packPolicy.enabledPacks.has(p))) {
      responseForTelemetry = fail("POLICY_PACK_DISABLED", `Tool is not enabled by current packs: ${name}`, {
        enabled_packs: [...packPolicy.enabledPacks],
        tool_packs: meta.packs
      });
      return asToolResult(responseForTelemetry);
    }
    if (meta.access === "write" && !packPolicy.writeEnabled) {
      responseForTelemetry = fail("POLICY_WRITE_DISABLED", `Write tools are disabled: ${name}`);
      return asToolResult(responseForTelemetry);
    }

    if (meta.requires_editor && name !== "unreal.get_editor_status") {
      const status = await run("unreal.get_editor_status", () => client.request("get_editor_status"));
      if (typeof status === "object" && status !== null && "ok" in status && (status as any).ok === true) {
        const r = (status as any).result;
        editorReady = Boolean(r?.editor_ready);
        pieState = typeof r?.pie_state === "string" ? r.pie_state : undefined;
        if (!editorReady) {
          responseForTelemetry = fail("PRECONDITION_EDITOR_NOT_READY", "Unreal editor is not ready");
          return asToolResult(responseForTelemetry);
        }
        if (meta.pie === "stopped" && pieState && pieState !== "stopped") {
          responseForTelemetry = fail("PRECONDITION_PIE_STATE", `PIE must be stopped for ${name}`, { pie_state: pieState });
          return asToolResult(responseForTelemetry);
        }
        if (meta.pie === "running" && pieState && pieState !== "running") {
          responseForTelemetry = fail("PRECONDITION_PIE_STATE", `PIE must be running for ${name}`, { pie_state: pieState });
          return asToolResult(responseForTelemetry);
        }
      } else {
        responseForTelemetry = fail("PRECONDITION_EDITOR_STATUS_FAILED", "Failed to query editor status");
        return asToolResult(responseForTelemetry);
      }
    }

    // MCP-only tools
    if (name === "unreal.get_connection_status") {
      const probe = Boolean(args.probe);
      const status: Record<string, unknown> = {
        ok: true,
        mcp: {
          name: "unreal-debug-copilot",
          version: "0.0.1",
          node: process.version,
          packs: [...packPolicy.enabledPacks],
          write_enabled: packPolicy.writeEnabled
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
        status.plugin_ping = await run("unreal.ping", () => client.request("ping"));
        status.plugin_capabilities = await run("unreal.get_protocol_capabilities", () => client.request("get_protocol_capabilities"));
        status.plugin_version = await run("unreal.get_plugin_version", () => client.request("get_plugin_version"));
      }

      responseForTelemetry = status;
      return asToolResult(status);
    }

    if (name === "unreal.get_last_tool_error") {
      responseForTelemetry = { ok: true, last_tool_error: lastToolError };
      return asToolResult(responseForTelemetry);
    }

    if (name === "unreal.get_project_info") {
      responseForTelemetry = await run(name, () => client.request("get_current_project"));
      return asToolResult(responseForTelemetry);
    }

    if (name === "unreal.cancel_current_operation") {
      const res = client.cancelCurrentOperation({ request_id: typeof args.request_id === "string" ? args.request_id : undefined });
      responseForTelemetry = { ok: true, ...res, in_flight_requests: client.getInFlightSummary() };
      return asToolResult(responseForTelemetry);
    }

    if (name === "unreal.get_protocol_capabilities") {
      const plugin = await run(name, () => client.request("get_protocol_capabilities"));
      responseForTelemetry = {
        ok: true,
        mcp: { tools: enabledTools().map((t) => t.name), packs: [...packPolicy.enabledPacks], write_enabled: packPolicy.writeEnabled },
        unreal_plugin: plugin
      };
      return asToolResult(responseForTelemetry);
    }

    if (name === "unreal.get_active_debug_session") {
      responseForTelemetry = { ok: true, session: activeDebugSession };
      return asToolResult(responseForTelemetry);
    }

    if (name === "unreal.start_debug_session") {
      if (activeDebugSession && !activeDebugSession.ended_at) {
        responseForTelemetry = fail("SESSION_ALREADY_ACTIVE", "A debug session is already active", { session_id: activeDebugSession.session_id });
        return asToolResult(responseForTelemetry);
      }
      const session_id = randomUUID();
      activeDebugSession = {
        session_id,
        label: typeof args.label === "string" ? args.label : undefined,
        started_at: nowIso(),
        sequence: 0,
        tool_calls: []
      };
      responseForTelemetry = { ok: true, session: activeDebugSession };
      return asToolResult(responseForTelemetry);
    }

    if (name === "unreal.end_debug_session") {
      if (!activeDebugSession || activeDebugSession.ended_at) {
        responseForTelemetry = fail("SESSION_NOT_ACTIVE", "No debug session is active");
        return asToolResult(responseForTelemetry);
      }
      activeDebugSession.ended_at = nowIso();
      const ended = activeDebugSession;
      activeDebugSession = null;
      const errorCalls = ended.tool_calls.filter((c) => !c.ok).length;
      responseForTelemetry = {
        ok: true,
        summary: {
          session_id: ended.session_id,
          label: ended.label,
          started_at: ended.started_at,
          ended_at: ended.ended_at,
          tool_calls: ended.tool_calls.length,
          error_calls: errorCalls
        },
        session: ended
      };
      return asToolResult(responseForTelemetry);
    }

    if (name === "unreal.clear_debug_session") {
      activeDebugSession = null;
      responseForTelemetry = { ok: true };
      return asToolResult(responseForTelemetry);
    }

    if (name === "unreal.compare_compile_results") {
      const before = typeof args.before === "object" && args.before !== null ? (args.before as any) : null;
      const after = typeof args.after === "object" && args.after !== null ? (args.after as any) : null;

      const msgs = (x: any) => {
        const arr = Array.isArray(x?.messages) ? x.messages : Array.isArray(x?.result?.messages) ? x.result.messages : [];
        return arr
          .filter((m: any) => m && typeof m === "object")
          .map((m: any) => ({
            severity: String(m.severity ?? ""),
            message: String(m.message ?? ""),
            graph: String(m.graph ?? ""),
            node_id: String(m.node_id ?? ""),
            node_title: String(m.node_title ?? "")
          }));
      };

      const normKey = (m: any) => `${m.severity}|${m.graph}|${m.node_id}|${m.message}`;
      const b = msgs(before);
      const a = msgs(after);
      const bSet = new Map<string, any>();
      for (const m of b) bSet.set(normKey(m), m);
      const aSet = new Map<string, any>();
      for (const m of a) aSet.set(normKey(m), m);

      const added: any[] = [];
      const removed: any[] = [];
      for (const [k, m] of aSet) if (!bSet.has(k)) added.push(m);
      for (const [k, m] of bSet) if (!aSet.has(k)) removed.push(m);

      const countBySev = (arr: any[]) =>
        arr.reduce(
          (acc, m) => {
            const s = String(m?.severity ?? "note") || "note";
            acc[s] = (acc[s] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );

      responseForTelemetry = {
        ok: true,
        before_messages: b.length,
        after_messages: a.length,
        added: { total: added.length, by_severity: countBySev(added), messages: added.slice(0, 200) },
        removed: { total: removed.length, by_severity: countBySev(removed), messages: removed.slice(0, 200) },
        note: "Diff key: severity|graph|node_id|message. Truncated to 200 messages each side."
      };
      return asToolResult(responseForTelemetry);
    }

    // Default: forward to Unreal plugin (tool name minus unreal.)
    const method = name.startsWith("unreal.") ? name.slice("unreal.".length) : name;
    responseForTelemetry = await run(name, () => client.request(method, args));
    return asToolResult(responseForTelemetry);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    responseForTelemetry = fail("INTERNAL_MCP_ERROR", e.message);
    return asToolResult(responseForTelemetry);
  } finally {
    const durationMs = Date.now() - startedAt;
    const reqBytes = Buffer.byteLength(JSON.stringify(args));
    const resBytes = Buffer.byteLength(JSON.stringify(responseForTelemetry ?? null));
    const ok = !(responseForTelemetry && typeof responseForTelemetry === "object" && "ok" in (responseForTelemetry as any) && (responseForTelemetry as any).ok === false);

    let error_category: ToolTelemetryRecord["error_category"];
    if (!ok) {
      const code = String((responseForTelemetry as any)?.error?.code ?? "");
      error_category = code.startsWith("POLICY_") || code.startsWith("PRECONDITION_") ? "policy_denied" : "unreal_error";
    }

    await telemetry.emit({
      at: nowIso(),
      tool: name,
      duration_ms: durationMs,
      ok,
      error_category,
      request_bytes: reqBytes,
      response_bytes: resBytes,
      packs: [...packPolicy.enabledPacks],
      write_enabled: packPolicy.writeEnabled,
      editor_ready: editorReady,
      pie_state: pieState
    });
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
