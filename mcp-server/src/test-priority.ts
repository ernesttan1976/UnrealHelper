import "dotenv/config";

import path from "node:path";
import fs from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type Cli = {
  priority: number;
  planPath?: string;
  allowMissing: boolean;
  probeConnectionStatus: boolean;
};

function parseArgs(argv: string[]): Cli {
  const out: Cli = {
    priority: -1,
    allowMissing: false,
    probeConnectionStatus: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--priority" || a === "-p") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --priority");
      out.priority = Number(v);
      i += 1;
      continue;
    }
    if (a === "--plan") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --plan");
      out.planPath = v;
      i += 1;
      continue;
    }
    if (a === "--allow-missing") {
      out.allowMissing = true;
      continue;
    }
    if (a === "--probe") {
      out.probeConnectionStatus = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      // eslint-disable-next-line no-console
      console.log(
        [
          "Usage:",
          "  npm run build && npm run test:priority -- --priority 0 [--probe] [--allow-missing] [--plan <path>]",
          "",
           "Notes:",
           "  - By default, missing tools and tool call errors fail the run.",
           "  - By default, the server is run with UNREAL_MOCK=1 (set UNREAL_MOCK=0 to require a live Unreal connection).",
           ""
         ].join("\n")
       );
      process.exit(0);
    }
  }

  if (!Number.isInteger(out.priority) || out.priority < 0) {
    throw new Error("--priority <non-negative integer> is required");
  }
  return out;
}

function resolveDefaultPlanPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "feature-plan.md"),
    path.resolve(process.cwd(), "..", "feature-plan.md"),
    path.resolve(process.cwd(), "..", "..", "feature-plan.md")
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[1];
}

function extractPriorityTools(plan: string, priority: number): string[] {
  const lines = plan.split(/\r?\n/);
  const headerRe = new RegExp(`^#\\s+Priority\\s+${priority}\\b`);
  const nextHeaderRe = /^#\s+Priority\s+\d+\b/;

  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (headerRe.test(lines[i].trim())) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    throw new Error(`Priority ${priority} section not found in feature plan`);
  }

  const section: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (nextHeaderRe.test(t)) break;
    section.push(lines[i]);
  }

  const tools: string[] = [];
  const seen = new Set<string>();

  // Prefer markdown table rows: `| `tool_name` | ... |`
  for (const raw of section) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const match = /`([^`]+)`/.exec(line);
    if (!match) continue;
    const name = match[1].trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    tools.push(name);
  }

  if (tools.length === 0) {
    throw new Error(`No tools found in Priority ${priority} section (expected a markdown table with backticked tool names)`);
  }

  return tools;
}

function envSubsetForServer(priority: number): Record<string, string> {
  const keys = [
    "UNREAL_HOST",
    "UNREAL_PORT",
    "UNREAL_TOKEN",
    "UNREAL_PROJECT_DIR",
    "UNREAL_TOKEN_INI",
    "UNREAL_TIMEOUT_MS",
    "UNREAL_MOCK",
    "UNREAL_MCP_PACKS",
    "UNREAL_MCP_WRITE_ENABLED"
  ];
  const env: Record<string, string> = {};
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === "string" && v.length > 0) env[k] = v;
  }

  // Priority tests should be runnable in any environment.
  // Default to mock mode unless explicitly disabled (UNREAL_MOCK=0).
  if (env.UNREAL_MOCK === undefined) {
    env.UNREAL_MOCK = "1";
  }

  // Default policy hides write tools. Priority 4 includes write tools (compile/refresh/etc),
  // so opt-in to write packs for this test harness.
  if (env.UNREAL_MCP_PACKS === undefined) {
    const base = ["unreal.core", "unreal.editor.read", "unreal.blueprint.read", "unreal.diagnostics"];
    if (priority >= 4) {
      base.push("unreal.blueprint.write", "unreal.editor.write");
    }
    env.UNREAL_MCP_PACKS = base.join(",");
  }
  if (env.UNREAL_MCP_WRITE_ENABLED === undefined && priority >= 4) {
    env.UNREAL_MCP_WRITE_ENABLED = "1";
  }

  return env;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));

  const planPath = path.resolve(cli.planPath ?? resolveDefaultPlanPath());
  const plan = fs.readFileSync(planPath, "utf8");
  const priorityTools = extractPriorityTools(plan, cli.priority);
  const toolsToTest = priorityTools.map((t) => (t.includes(".") ? t : `unreal.${t}`));

  const serverEntry = path.resolve(process.cwd(), "dist", "index.js");
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`MCP server not built: missing ${serverEntry}. Run: npm run build`);
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: ["--enable-source-maps", serverEntry],
    cwd: process.cwd(),
    env: envSubsetForServer(cli.priority),
    stderr: "pipe"
  });

  const client = new Client({ name: "priority-test", version: "0.0.1" });

  const stderr: string[] = [];
  transport.stderr?.on("data", (chunk) => {
    stderr.push(String(chunk));
  });

  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const available = new Set(listed.tools.map((t) => t.name));
    const missing = toolsToTest.filter((t) => !available.has(t));

    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: false, priority: cli.priority, missing_tools: missing }, null, 2));
      if (!cli.allowMissing) {
        process.exitCode = 1;
      }
    }

    const failures: Array<{ tool: string; error: string }> = [];
    const ran: Array<{ tool: string; ok: boolean; isError?: boolean }> = [];

    for (const tool of toolsToTest) {
      if (!available.has(tool)) continue;
      const args: Record<string, unknown> = {};
      if (tool === "unreal.get_connection_status" && cli.probeConnectionStatus) {
        args.probe = true;
      }
      try {
        const res = await client.callTool({ name: tool, arguments: args });
        ran.push({ tool, ok: !(res as any).isError, isError: (res as any).isError });
        if ((res as any).isError) {
          failures.push({ tool, error: "tool returned isError=true" });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push({ tool, error: msg });
      }
    }

    const summary = {
      ok: failures.length === 0 && (cli.allowMissing || missing.length === 0),
      priority: cli.priority,
      plan_path: planPath,
      tools_in_plan: priorityTools,
      tools_tested: ran,
      missing_tools: missing,
      failures,
      server_stderr: stderr.join("")
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    await transport.close();
  }
}

await main();
