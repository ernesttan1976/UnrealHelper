export type ToolOk<T = unknown> = {
  ok: true;
  result: T;
};

export type ToolFail = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type ToolEnvelope<T = unknown> = ToolOk<T> | ToolFail;

export function ok<T>(result: T): ToolOk<T> {
  return { ok: true, result };
}

export function fail(code: string, message: string, details?: Record<string, unknown>): ToolFail {
  return details ? { ok: false, error: { code, message, details } } : { ok: false, error: { code, message } };
}

export function isFail(x: unknown): x is ToolFail {
  return Boolean(x && typeof x === "object" && "ok" in (x as any) && (x as any).ok === false && "error" in (x as any));
}
