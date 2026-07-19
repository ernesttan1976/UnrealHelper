import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PackPolicy = {
  enabledPacks: Set<string>;
  writeEnabled: boolean;
  source: {
    defaultFile: string;
    envEnabledPacks?: string;
    envWriteEnabled?: string;
  };
};

function repoRootFromThisFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // here = mcp-server/src/core
  return path.resolve(here, "..", "..", "..");
}

export function loadPackPolicyFromEnv(env: Record<string, string | undefined>): PackPolicy {
  const repoRoot = repoRootFromThisFile();
  const defaultFile = path.resolve(repoRoot, "MCP", "packs", "default.json");
  const raw = fs.readFileSync(defaultFile, "utf8");
  const parsed = JSON.parse(raw);

  const enabled: Set<string> = new Set(Array.isArray(parsed.enabled_packs) ? parsed.enabled_packs.map((x: any) => String(x)) : []);
  const defaultWriteEnabled = Boolean(parsed.write_enabled);

  const envPacks = env.UNREAL_MCP_PACKS;
  if (typeof envPacks === "string" && envPacks.trim().length > 0) {
    enabled.clear();
    for (const part of envPacks.split(",")) {
      const p = part.trim();
      if (p) enabled.add(p);
    }
  }

  const envWrite = env.UNREAL_MCP_WRITE_ENABLED;
  const writeEnabled =
    envWrite === undefined
      ? defaultWriteEnabled
      : envWrite === "1" || envWrite === "true" || envWrite === "TRUE" || envWrite === "yes";

  return {
    enabledPacks: enabled,
    writeEnabled,
    source: { defaultFile, envEnabledPacks: envPacks, envWriteEnabled: envWrite }
  };
}
