import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function stableJson(obj) {
  return JSON.stringify(obj, null, 2);
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerDir = path.resolve(here, "..");
  const repoRoot = path.resolve(mcpServerDir, "..");

  const registryPath = path.resolve(repoRoot, "MCP", "tools", "registry.json");
  const outPath = path.resolve(mcpServerDir, "src", "tools", "generated", "tool-defs.ts");

  const raw = fs.readFileSync(registryPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tools)) {
    throw new Error(`Invalid registry: expected { tools: [...] } at ${registryPath}`);
  }

  const tools = parsed.tools;
  const seen = new Set();
  for (const t of tools) {
    if (!t || typeof t !== "object") throw new Error("Invalid tool entry (not an object)");
    if (typeof t.name !== "string" || !t.name) throw new Error("Invalid tool entry: missing name");
    if (seen.has(t.name)) throw new Error(`Duplicate tool name in registry: ${t.name}`);
    seen.add(t.name);
    if (typeof t.description !== "string") throw new Error(`Tool ${t.name}: missing description`);
    if (!t.inputSchema || typeof t.inputSchema !== "object") throw new Error(`Tool ${t.name}: missing inputSchema`);
    if (!Array.isArray(t.packs) || t.packs.length === 0) throw new Error(`Tool ${t.name}: missing packs`);
    if (t.access !== "read" && t.access !== "write") throw new Error(`Tool ${t.name}: invalid access`);
    if (t.risk !== "low" && t.risk !== "medium" && t.risk !== "high") throw new Error(`Tool ${t.name}: invalid risk`);
    if (typeof t.requires_editor !== "boolean") throw new Error(`Tool ${t.name}: requires_editor must be boolean`);
  }

  tools.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const toolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema
  }));

  const meta = {};
  for (const t of tools) {
    meta[t.name] = {
      domain: t.domain,
      priority: t.priority,
      access: t.access,
      risk: t.risk,
      requires_editor: t.requires_editor,
      pie: typeof t.pie === "string" ? t.pie : "any",
      packs: t.packs,
      skill: Object.prototype.hasOwnProperty.call(t, "skill") ? t.skill : null,
      stability: t.stability ?? "stable",
      owner: t.owner ?? "mcp"
    };
  }

  const content =
    "/* AUTO-GENERATED: do not edit by hand. */\n" +
    "export type ToolMeta = {\n" +
    "  domain: string;\n" +
    "  priority: number;\n" +
    "  access: 'read' | 'write';\n" +
    "  risk: 'low' | 'medium' | 'high';\n" +
    "  requires_editor: boolean;\n" +
    "  pie: 'any' | 'stopped' | 'running';\n" +
    "  packs: string[];\n" +
    "  skill: string | null;\n" +
    "  stability: 'experimental' | 'stable' | 'deprecated';\n" +
    "  owner: 'mcp' | 'plugin';\n" +
    "};\n\n" +
    `export const TOOL_DEFS = ${stableJson(toolDefs)} as const;\n\n` +
    `export const TOOL_META_BY_NAME: Record<string, ToolMeta> = ${stableJson(meta)};\n`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, "utf8");
}

main();
