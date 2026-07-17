import { z } from "zod";

export const envSchema = z.object({
  UNREAL_HOST: z.string().default("127.0.0.1"),
  UNREAL_PORT: z.coerce.number().int().positive().default(17777),
  UNREAL_TOKEN: z.string().default(""),
  UNREAL_TIMEOUT_MS: z.coerce.number().int().positive().default(2500),
  UNREAL_MOCK: z.string().optional()
});

export type McpEnv = z.infer<typeof envSchema>;
