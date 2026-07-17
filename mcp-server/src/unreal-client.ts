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

  constructor(opts: UnrealClientOptions) {
    this.#opts = opts;
  }

  async request(method: string, params?: Record<string, unknown>): Promise<UnrealJsonRpcResponse> {
    if (this.#opts.mock) {
      return this.#mock(method, params);
    }

    const requestId = randomUUID();
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

    const response = await new Promise<UnrealJsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Unreal request timed out after ${this.#opts.timeoutMs}ms`));
      }, this.#opts.timeoutMs);

      let buffer = "";

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const idx = buffer.indexOf("\n");
        if (idx === -1) return;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        clearTimeout(timeout);
        socket.destroy();
        try {
          resolve(JSON.parse(line) as UnrealJsonRpcResponse);
        } catch (e) {
          reject(e);
        }
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      socket.connect(this.#opts.port, this.#opts.host, () => {
        socket.write(line);
      });
    });

    return response;
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

  async getSelectedActors(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_selected_actors");
  }

  async getComponentTree(params?: { actor_name?: string }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_component_tree", params);
  }

  #mock(method: string, _params?: Record<string, unknown>): UnrealJsonRpcResponse {
    const request_id = randomUUID();
    if (method === "ping") {
      return { protocol_version: 1, request_id, ok: true, result: { pong: true } };
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
    return {
      protocol_version: 1,
      request_id,
      ok: false,
      error: { code: "INVALID_REQUEST", message: `Unknown method: ${method}` }
    };
  }
}
