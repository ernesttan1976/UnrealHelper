export type UnrealPieState =
  | "stopped"
  | "starting"
  | "running"
  | "paused"
  | "simulating"
  | "stopping"
  | "unknown";

export type UnrealJsonRpcRequest = {
  protocol_version: 1;
  request_id: string;
  token: string;
  method: string;
  params?: Record<string, unknown>;
};

export type UnrealJsonRpcSuccess = {
  protocol_version: 1;
  request_id: string;
  ok: true;
  result: unknown;
};

export type UnrealJsonRpcFailure = {
  protocol_version: 1;
  request_id: string;
  ok: false;
  error: {
    code:
      | "UNREAL_NOT_CONNECTED"
      | "UNAUTHORIZED"
      | "REQUEST_TIMEOUT"
      | "INVALID_REQUEST"
      | "ACTOR_NOT_FOUND"
      | "BLUEPRINT_NOT_FOUND"
      | "INTERNAL_UNREAL_ERROR";
    message: string;
    details?: Record<string, unknown>;
  };
};

export type UnrealJsonRpcResponse = UnrealJsonRpcSuccess | UnrealJsonRpcFailure;
