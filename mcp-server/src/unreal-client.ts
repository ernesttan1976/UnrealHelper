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
  #mockTransactionId: string | null = null;

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

  async getOpenAssetEditors(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_open_asset_editors");
  }

  async getActiveBlueprint(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_active_blueprint");
  }

  async getCurrentLevel(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_current_level");
  }

  async getOpenLevels(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_open_levels");
  }

  async getSelectedAssets(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_selected_assets");
  }

  async getSelectedComponents(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_selected_components");
  }

  async getActiveAssetEditor(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_active_asset_editor");
  }

  async getActiveBlueprintGraph(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_active_blueprint_graph");
  }

  async getSelectedBlueprintNodes(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_selected_blueprint_nodes");
  }

  async getFocusedBlueprintNode(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_focused_blueprint_node");
  }

  async getEditorViewportState(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_editor_viewport_state");
  }

  async getContentBrowserPath(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_content_browser_path");
  }

  async getEditorMode(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_editor_mode");
  }

  async getDirtyAssets(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_dirty_assets");
  }

  async getPendingEditorNotifications(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_pending_editor_notifications");
  }

  async getMessageLogSummary(): Promise<UnrealJsonRpcResponse> {
    return this.request("get_message_log_summary");
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

  async getBlueprintGraph(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
    graph?: string;
    mode?: string;
    node_id?: string;
    max_depth?: number;
    max_nodes?: number;
    max_edges?: number;
    include_pins?: boolean;
    include_edges?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_blueprint_graph", params);
  }

  async getBlueprintDependencies(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_blueprint_dependencies", params);
  }

  async getBlueprintDependents(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_blueprint_dependents", params);
  }

  // Priority 4 — Compilation and diagnostics
  async compileBlueprint(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("compile_blueprint", params);
  }

  async compileSelectedBlueprint(): Promise<UnrealJsonRpcResponse> {
    return this.request("compile_selected_blueprint");
  }

  async compileBlueprints(params?: { asset_paths?: string[] }): Promise<UnrealJsonRpcResponse> {
    return this.request("compile_blueprints", params);
  }

  async compileAllDirtyBlueprints(): Promise<UnrealJsonRpcResponse> {
    return this.request("compile_all_dirty_blueprints");
  }

  async getCompileMessages(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_compile_messages", params);
  }

  async getCompileMessageDetails(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
    message_id?: string;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_compile_message_details", params);
  }

  async getCompileErrorNodes(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_compile_error_nodes", params);
  }

  async getCompileWarningNodes(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_compile_warning_nodes", params);
  }

  async compileAndCaptureMessages(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("compile_and_capture_messages", params);
  }

  async getGeneratedClassStatus(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_generated_class_status", params);
  }

  async getSkeletonClassStatus(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_skeleton_class_status", params);
  }

  async getBlueprintBytecodeSummary(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_blueprint_bytecode_summary", params);
  }

  async getLastSuccessfulCompile(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("get_last_successful_compile", params);
  }

  async refreshBlueprintNodes(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("refresh_blueprint_nodes", params);
  }

  async reconstructBlueprintNode(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
    node_id?: string;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("reconstruct_blueprint_node", params);
  }

  async reinstanceBlueprint(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("reinstance_blueprint", params);
  }

  async validateBlueprintAsset(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("validate_blueprint_asset", params);
  }

  async validateBlueprintDependencies(params?: {
    object_path?: string;
    asset_path?: string;
    use_active_if_missing?: boolean;
  }): Promise<UnrealJsonRpcResponse> {
    return this.request("validate_blueprint_dependencies", params);
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
          plugin_name: "UnstuckForUnreal",
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
            "get_protocol_capabilities",

            "begin_transaction",
            "end_transaction",
            "cancel_transaction",
            "get_selected_actors",
            "get_open_editors",
            "get_open_asset_editors",
            "get_active_blueprint",
            "get_current_level",
            "get_open_levels",
            "get_selected_assets",
            "get_selected_components",
            "get_active_asset_editor",
            "get_active_blueprint_graph",
            "get_selected_blueprint_nodes",
            "get_focused_blueprint_node",
            "get_editor_viewport_state",
            "get_world_outliner_selection",
            "get_content_browser_path",
            "get_editor_mode",
            "get_dirty_assets",
            "get_pending_editor_notifications",
            "get_message_log_summary",
            "inspect_blueprint",
            "get_blueprint_graph",
            "get_blueprint_dependencies",
            "get_blueprint_dependents",

            "compile_blueprint",
            "compile_selected_blueprint",
            "compile_blueprints",
            "compile_all_dirty_blueprints",
            "get_compile_messages",
            "get_compile_message_details",
            "get_compile_error_nodes",
            "get_compile_warning_nodes",
            "compile_and_capture_messages",
            "get_generated_class_status",
            "get_skeleton_class_status",
            "get_blueprint_bytecode_summary",
            "get_last_successful_compile",
            "refresh_blueprint_nodes",
            "reconstruct_blueprint_node",
            "reinstance_blueprint",
            "validate_blueprint_asset",
            "validate_blueprint_dependencies"
          ]
        }
      };
    }

    if (method === "begin_transaction") {
      if (this.#mockTransactionId) {
        return {
          protocol_version: 1,
          request_id,
          ok: false,
          error: { code: "TRANSACTION_ALREADY_ACTIVE", message: "Mock: transaction already active" }
        };
      }
      this.#mockTransactionId = randomUUID();
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { transaction_id: this.#mockTransactionId, active: true }
      };
    }

    if (method === "end_transaction" || method === "cancel_transaction") {
      const tid = typeof _params?.transaction_id === "string" ? String((_params as any).transaction_id) : "";
      if (!this.#mockTransactionId) {
        return {
          protocol_version: 1,
          request_id,
          ok: false,
          error: { code: "TRANSACTION_NOT_ACTIVE", message: "Mock: no active transaction" }
        };
      }
      if (!tid) {
        return {
          protocol_version: 1,
          request_id,
          ok: false,
          error: { code: "INVALID_REQUEST", message: "Mock: missing transaction_id" }
        };
      }
      if (tid !== this.#mockTransactionId) {
        return {
          protocol_version: 1,
          request_id,
          ok: false,
          error: {
            code: "TRANSACTION_ID_MISMATCH",
            message: "Mock: transaction_id mismatch",
            details: { active_transaction_id: this.#mockTransactionId }
          }
        };
      }
      this.#mockTransactionId = null;
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { active: false }
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
    if (method === "get_open_asset_editors") {
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
        ok: true,
        result: {
          asset_path: "",
          object_path: "",
          open_blueprint_count: 0,
          note: "Mock: no active Blueprint"
        }
      };
    }
    if (method === "get_current_level") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { world_name: "", map_package: "", persistent_level: "", is_valid: false }
      };
    }
    if (method === "get_open_levels") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { persistent_level: "", levels: [], streaming_levels: [], is_valid: false }
      };
    }
    if (method === "get_selected_assets") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { assets: [] }
      };
    }
    if (method === "get_selected_components") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { components: [] }
      };
    }
    if (method === "get_active_asset_editor") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { asset: null, note: "Mock: no active asset editor" }
      };
    }
    if (method === "get_active_blueprint_graph") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { blueprint_object_path: "", graph_name: "", graph_type: "", note: "Mock: no active graph" }
      };
    }
    if (method === "get_selected_blueprint_nodes") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { nodes: [], note: "Mock: no selected nodes" }
      };
    }
    if (method === "get_focused_blueprint_node") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { node: null, note: "Mock: no focused node" }
      };
    }
    if (method === "get_editor_viewport_state") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { camera_location: [0, 0, 0], camera_rotation: [0, 0, 0], view_mode: "unknown", is_valid: false }
      };
    }
    if (method === "get_world_outliner_selection") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { actors: [] }
      };
    }
    if (method === "get_content_browser_path") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { path: "", paths: [] }
      };
    }
    if (method === "get_editor_mode") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { active_mode_ids: [] }
      };
    }
    if (method === "get_dirty_assets") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { dirty_packages: [] }
      };
    }
    if (method === "get_pending_editor_notifications") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { modal_windows: [], modal_count: 0 }
      };
    }
    if (method === "get_message_log_summary") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { categories: [], note: "Mock: message log summary unavailable" }
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
        ok: true,
        result: {
          name: "BP_Mock",
          class: "Blueprint",
          object_path: "/Game/Mock/BP_Mock.BP_Mock",
          asset_path: "/Game/Mock/BP_Mock",
          parent_class: "/Script/Engine.Actor",
          generated_class: "/Game/Mock/BP_Mock.BP_Mock_C",
          blueprint_type: "BPTYPE_Normal",
          status: "BS_UpToDate",
          interfaces: [],
          variables: [
            { name: "DoorOffset", type: "float", category: "Default", instance_editable: true }
          ],
          function_graphs: ["OpenDoor"],
          macro_graphs: [],
          ubergraph_pages: ["EventGraph"],
          components: [
            { name: "DefaultSceneRoot", component_class: "SceneComponent", parent: "", attach_socket: "" }
          ],
          timelines: [],
          event_dispatchers: []
        }
      };
    }

    if (method === "get_blueprint_graph") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: {
          blueprint_object_path: "/Game/Mock/BP_Mock.BP_Mock",
          blueprint_asset_path: "/Game/Mock/BP_Mock",
          graph_name: "EventGraph",
          graph_type: "ubergraph",
          mode: "summary",
          node_count: 2,
          edge_count: 1,
          nodes: [
            { id: "00000000-0000-0000-0000-000000000001", title: "Event BeginPlay", class: "UK2Node_Event", pos_x: 0, pos_y: 0 },
            { id: "00000000-0000-0000-0000-000000000002", title: "Print String", class: "UK2Node_CallFunction", pos_x: 250, pos_y: 0 }
          ],
          edges: [
            {
              from_node_id: "00000000-0000-0000-0000-000000000001",
              from_pin: "then",
              to_node_id: "00000000-0000-0000-0000-000000000002",
              to_pin: "execute"
            }
          ],
          note: "Mock graph export"
        }
      };
    }

    if (method === "get_blueprint_dependencies") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: {
          package: "/Game/Mock/BP_Mock",
          dependencies: [],
          returned: 0
        }
      };
    }

    if (method === "get_blueprint_dependents") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: {
          package: "/Game/Mock/BP_Mock",
          dependents: [],
          returned: 0
        }
      };
    }

    if (method === "compile_blueprint" || method === "compile_selected_blueprint" || method === "compile_and_capture_messages") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: {
          operation: method,
          compiled: false,
          success: true,
          errors: 0,
          warnings: 0,
          notes: 0,
          messages: [],
          note: "Mock: compilation not executed"
        }
      };
    }
    if (method === "compile_blueprints" || method === "compile_all_dirty_blueprints") {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { compiled: 0, errors: 0, warnings: 0, results: [], note: "Mock: no blueprints compiled" }
      };
    }
    if (
      method === "get_compile_messages" ||
      method === "get_compile_message_details" ||
      method === "get_compile_error_nodes" ||
      method === "get_compile_warning_nodes" ||
      method === "get_generated_class_status" ||
      method === "get_skeleton_class_status" ||
      method === "get_blueprint_bytecode_summary" ||
      method === "get_last_successful_compile" ||
      method === "refresh_blueprint_nodes" ||
      method === "reconstruct_blueprint_node" ||
      method === "reinstance_blueprint" ||
      method === "validate_blueprint_asset" ||
      method === "validate_blueprint_dependencies"
    ) {
      return {
        protocol_version: 1,
        request_id,
        ok: true,
        result: { note: `Mock: ${method} not executed` }
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
