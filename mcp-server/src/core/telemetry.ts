import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ToolTelemetryRecord = {
  at: string;
  tool: string;
  duration_ms: number;
  ok: boolean;
  error_category?: "unreal_error" | "exception" | "policy_denied" | "validation_failed" | "timeout" | "cancelled";
  request_bytes: number;
  response_bytes: number;
  packs: string[];
  write_enabled: boolean;
  editor_ready?: boolean;
  pie_state?: string;
};

function defaultTelemetryPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // here = mcp-server/src/core
  const mcpServerDir = path.resolve(here, "..", "..");
  return path.resolve(mcpServerDir, ".telemetry", "tool_calls.ndjson");
}

export class Telemetry {
  #enabled: boolean;
  #filePath: string;

  constructor(opts: { enabled: boolean; filePath?: string }) {
    this.#enabled = opts.enabled;
    this.#filePath = opts.filePath ?? defaultTelemetryPath();
  }

  async emit(rec: ToolTelemetryRecord): Promise<void> {
    if (!this.#enabled) return;
    await fs.promises.mkdir(path.dirname(this.#filePath), { recursive: true });
    const line = JSON.stringify(rec) + "\n";
    await fs.promises.appendFile(this.#filePath, line, "utf8");
  }
}
