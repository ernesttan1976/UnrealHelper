import "dotenv/config";

import { envSchema } from "./mcp.js";
import { UnrealClient } from "./unreal-client.js";
import { resolveUnrealConfigFromProject } from "./unreal-project-config.js";

const env = envSchema.parse(process.env);

const envPortProvided = typeof process.env.UNREAL_PORT === "string" && process.env.UNREAL_PORT.length > 0;

const resolved = resolveUnrealConfigFromProject({
  token: env.UNREAL_TOKEN,
  port: env.UNREAL_PORT,
  projectDir: env.UNREAL_PROJECT_DIR,
  tokenIni: env.UNREAL_TOKEN_INI,
  envPortProvided
});

if (!env.UNREAL_TOKEN && resolved.token && resolved.tokenSource) {
  // eslint-disable-next-line no-console
  console.log(`(loaded UNREAL_TOKEN from ${resolved.tokenSource})`);
}
if (!envPortProvided && resolved.portSource) {
  // eslint-disable-next-line no-console
  console.log(`(loaded UNREAL_PORT from ${resolved.portSource})`);
}

const client = new UnrealClient({
  host: env.UNREAL_HOST,
  port: resolved.port,
  token: resolved.token,
  timeoutMs: env.UNREAL_TIMEOUT_MS,
  mock: env.UNREAL_MOCK === "1" || env.UNREAL_MOCK === "true"
});

async function main() {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["ping", () => client.ping()],
    ["get_editor_status", () => client.getEditorStatus()],
    ["get_engine_version", () => client.getEngineVersion()],
    ["get_current_project", () => client.getCurrentProject()],
    ["get_plugin_version", () => client.getPluginVersion()],
    ["get_protocol_capabilities", () => client.getProtocolCapabilities()],
    ["get_selected_actors", () => client.getSelectedActors()],
    ["get_open_editors", () => client.getOpenEditors()],
    ["get_active_blueprint", () => client.getActiveBlueprint()],
    ["get_component_tree", () => client.getComponentTree()]
  ];

  for (const [name, fn] of calls) {
    // eslint-disable-next-line no-console
    console.log("===", name);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(await fn(), null, 2));
  }
}

await main();
