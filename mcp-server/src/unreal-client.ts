import net from "node:net";
import { randomUUID } from "node:crypto";
import type { UnrealJsonRpcRequest, UnrealJsonRpcResponse } from "./protocol.js";

type UnrealClientOptions = {
  host: string;
  port: number;
  token: string;
  timeoutMs: number;
  mock?: boolean;
};

export class UnrealClient {
  #opts: UnrealClientOptions;
  #inFlight = new Map<
    string,
    {
      method: string;
      startedAtMs: number;
      socket: net.Socket;
      timeout: NodeJS.Timeout;
      reject: (err: unknown) => void;
    }
  >();
  #lastIssuedRequestId: string | null = null;

  constructor(opts: UnrealClientOptions) {
    this.#opts = opts;
  }

  async request(method: string, params?: Record<string, unknown>): Promise<UnrealJsonRpcResponse> {
    if (this.#opts.mock) {
      return this.#mock(method, params);
    }

    if (!this.#opts.token) {
      throw new Error(
        "UNREAL_TOKEN is required (set it to the token printed in the Unreal Output Log, or set UNREAL_MOCK=1 to run without Unreal)."
      );
    }

    const requestId = randomUUID();
    this.#lastIssuedRequestId = requestId;
    const payload: UnrealJsonRpcRequest = {
      protocol_version: 1,
      request_id: requestId,
      token: this.#opts.token,
      method,
      params
    };

    const socket = new net.Socket();
    socket.setNoDelay(true);

    const line = JSON.stringify(payload) + "\n";

    return await new Promise<UnrealJsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#inFlight.delete(requestId);
        socket.destroy();
        reject(new Error(`Unreal request timed out after ${this.#opts.timeoutMs}ms`));
      }, this.#opts.timeoutMs);

      this.#inFlight.set(requestId, {
        method,
        startedAtMs: Date.now(),
        socket,
        timeout,
        reject
      });

      let buffer = "";

      const cleanup = () => {
        const entry = this.#inFlight.get(requestId);
        if (entry) {
          clearTimeout(entry.timeout);
          this.#inFlight.delete(requestId);
        }
      };

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const idx = buffer.indexOf("\n");
        if (idx === -1) return;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        cleanup();
        socket.destroy();
        try {
          resolve(JSON.parse(line) as UnrealJsonRpcResponse);
        } catch (e) {
          reject(e);
        }
      });

      socket.on("error", (err) => {
        cleanup();
        reject(err);
      });

      socket.connect(this.#opts.port, this.#opts.host, () => {
        socket.write(line);
      });
    });
  }

  async ping(): Promise<UnrealJsonRpcResponse> {
    return this.request("ping");
  }

  async getEditorStatus(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_editor_status");
  }

  async getEngineVersion(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_engine_version");
  }

  async getCurrentProject(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_current_project");
  }

  async getPluginVersion(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_plugin_version");
  }

  async getProtocolCapabilities(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_protocol_capabilities");
  }

  async getSelectedActors(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_selected_actors");
  }

  async getOpenEditors(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_open_editors");
  }

  async getActiveBlueprint(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_active_blueprint");
  }

  async getComponentTree(params?: { actor_name?: string }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_component_tree", params);
  }

  async listAssets(params?: {
    path?: string;
    class?: string;
    recursive?: boolean;
    limit?: number;
    name_contains?: string;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("list_assets", params);
  }

  async inspectObject(params?: {
    object_path?: string;
    asset_path?: string;
    actor_name?: string;
    include_transient?: boolean;
    max_properties?: number;
    name_contains?: string;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("inspect_object", params);
  }

  async inspectBlueprint(params?: {
    object_path?: string;
    asset_path?: string;
    include_cdo_properties?: boolean;
    include_transient?: boolean;
    max_properties?: number;
    name_contains?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("inspect_blueprint", params);
  }

  cancelCurrentOperation(params?: { request_id?: string }): {
    cancelled: string[];
  } {
    const toCancel: string[] = [];

    if (params?.request_id) {
      if (this.#inFlight.has(params.request_id)) {
        toCancel.push(params.request_id);
      }
    } else if (this.#lastIssuedRequestId && this.#inFlight.has(this.#lastIssuedRequestId)) {
      toCancel.push(this.#lastIssuedRequestId);
    } else {
      // As a fallback, cancel the oldest in-flight request.
      let oldest: { id: string; startedAtMs: number } | null = null;
      for (const [id, entry] of this.#inFlight.entries()) {
        if (!oldest || entry.startedAtMs < oldest.startedAtMs) {
          oldest = { id, startedAtMs: entry.startedAtMs };
        }
      }
      if (oldest) toCancel.push(oldest.id);
    }

    for (const id of toCancel) {
      const entry = this.#inFlight.get(id);
      if (!entry) continue;
      clearTimeout(entry.timeout);
      this.#inFlight.delete(id);
      entry.socket.destroy();
      entry.reject(new Error("Cancelled"));
    }

    return { cancelled: toCancel };
  }

  getInFlightSummary(): Array<{ request_id: string; method: string; started_at_ms: number }> {
    const out: Array<{ request_id: string; method: string; started_at_ms: number }> = [];
    for (const [request_id, entry] of this.#inFlight.entries()) {
      out.push({ request_id, method: entry.method, started_at_ms: entry.startedAtMs });
    }
    out.sort((a, b) => a.started_at_ms - b.started_at_ms);
    return out;
  }

  #mock(method: string, _params?: Record<string, unknown>): UnrealJsonRpcResponse {
    const request_id = randomUUID();
    if (method === "ping") {
      return { protocol_version: 1, request_id, ok: true, result: { pong: true } };
    }
    if (method === "get_plugin_version") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: {
          plugin_name: "UnrealDebugCopilot",
          plugin_version: "0.0.1",
          protocol_version: 1
        }
      };
    }
    if (method === "get_protocol_capabilities") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: {
          protocol_version: 1,
          supported_methods: [
            "ping",
            "get_editor_status",
            "get_engine_version",
            "get_current_project",
            "get_plugin_version",
            "get_protocol_capabilities"
          ]
        }
      };
    }
    if (method === "get_engine_version") {
      return { protocol_version: 1, request_id, ok: true, result: { engine_version: "5.6.x" } };
    }
    if (method === "get_current_project") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { project_name: "MockProject", project_dir: "C:/MockProject" }
      };
    }
    if (method === "get_editor_status") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { editor_ready: true, pie_state: "stopped" }
      };
    }
    if (method === "get_selected_actors") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { actors: [] }
      };
    }
    if (method === "get_component_tree") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { actor: "", components: [] }
      };
    }
    if (method === "get_open_editors") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { editors: [] }
      };
    }
    if (method === "get_active_blueprint") {
      return {
        protocol_version: 1,
        request_id,
        ok: false,
        error: { code: "BLUEPRINT_NOT_FOUND", message: "No Blueprint asset editor is open" }
      };
    }
    if (method === "list_assets") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { assets: [], returned: 0, matched: 0 }
      };
    }
    if (method === "inspect_object") {
      return {
        protocol_version: 1,
        request_id,
        ok: false,
        error: { code: "OBJECT_NOT_FOUND", message: "Object not found (mock)" }
      };
    }
    if (method === "inspect_blueprint") {
      return {
        protocol_version: 1,
        request_id,
        ok: false,
        error: { code: "BLUEPRINT_NOT_FOUND", message: "No Blueprint asset editor is open (mock)" }
      };
    }
    return {
      protocol_version: 1,
      request_id,
      ok: false,
      error: { code: "INVALID_REQUEST", message: `Unknown method: ${method}` }
    };
  }
}
