import "dotenv/config";

import { envSchema } from "./mcp.js";
import { UnrealClient } from "./unreal-client.js";

const env = envSchema.parse(process.env);

const client = new UnrealClient({
  host: env.UNREAL_HOST,
  port: env.UNREAL_PORT,
  token: env.UNREAL_TOKEN,
  timeoutMs: env.UNREAL_TIMEOUT_MS,
  mock: env.UNREAL_MOCK === "1" || env.UNREAL_MOCK === "true"
});

async function main() {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["ping", () => client.ping()],
    ["get_editor_status", () => client.getEditorStatus()],
    ["get_engine_version", () => client.getEngineVersion()],
    ["get_current_project", () => client.getCurrentProject()],
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
