import { z } from "zod";

export const envSchema = z.object({
  UNREAL_HOST: z.string().default("127.0.0.1"),
  UNREAL_PORT: z.coerce.number().int().positive().default(17777),
  UNREAL_TOKEN: z.string().default(""),
  // Optional convenience: infer token (and port if not explicitly set) from an Unreal project directory.
  // Token + port are stored by the UE plugin under GEditorPerProjectIni (EditorPerProjectUserSettings.ini).
  UNREAL_PROJECT_DIR: z.string().optional(),
  // Optional explicit path to EditorPerProjectUserSettings.ini.
  UNREAL_TOKEN_INI: z.string().optional(),
  UNREAL_TIMEOUT_MS: z.coerce.number().int().positive().default(2500),
  UNREAL_MOCK: z.string().optional(),

  // Capability packs and safety gates
  UNREAL_MCP_PACKS: z.string().optional(),
  UNREAL_MCP_WRITE_ENABLED: z.string().optional(),

  // Local-only telemetry (NDJSON)
  UNREAL_MCP_TELEMETRY: z.string().optional(),
  UNREAL_MCP_TELEMETRY_PATH: z.string().optional()
});

export type McpEnv = z.infer<typeof envSchema>;
