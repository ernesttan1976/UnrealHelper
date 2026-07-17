import fs from "node:fs";
import path from "node:path";

type ResolveArgs = {
  token: string;
  port: number;
  projectDir?: string;
  tokenIni?: string;
  // We only override port from the ini when the user did not explicitly set UNREAL_PORT.
  envPortProvided: boolean;
};

type Resolved = {
  token: string;
  port: number;
  tokenSource?: string;
  portSource?: string;
};

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function tryFindEditorPerProjectIni(projectDir: string): string | null {
  const savedConfig = path.join(projectDir, "Saved", "Config");
  try {
    const entries = fs.readdirSync(savedConfig, { withFileTypes: true });
    // Prefer platform-specific *Editor folders (WindowsEditor, MacEditor, etc).
    const candidateDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => name.toLowerCase().includes("editor"));

    for (const dir of candidateDirs) {
      const p = path.join(savedConfig, dir, "EditorPerProjectUserSettings.ini");
      if (fileExists(p)) return p;
    }
  } catch {
    // ignore
  }

  const fallback = path.join(savedConfig, "EditorPerProjectUserSettings.ini");
  if (fileExists(fallback)) return fallback;
  return null;
}

function parseIniSectionValues(text: string, sectionName: string): Record<string, string> {
  const out: Record<string, string> = {};
  const sectionHeader = `[${sectionName}]`;
  const lines = text.split(/\r?\n/);

  let inSection = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(";") || line.startsWith("#")) continue;

    if (line.startsWith("[") && line.endsWith("]")) {
      inSection = line === sectionHeader;
      continue;
    }

    if (!inSection) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) out[key] = value;
  }

  return out;
}

export function resolveUnrealConfigFromProject(args: ResolveArgs): Resolved {
  let token = args.token;
  let port = args.port;

  const iniPath = args.tokenIni
    ? args.tokenIni
    : args.projectDir
      ? tryFindEditorPerProjectIni(args.projectDir)
      : null;

  if (!iniPath || !fileExists(iniPath)) {
    return { token, port };
  }

  let iniText = "";
  try {
    iniText = fs.readFileSync(iniPath, "utf8");
  } catch {
    return { token, port };
  }

  const values = parseIniSectionValues(iniText, "UnrealDebugCopilot");

  if (!token && values.Token) {
    token = values.Token;
  }

  if (!args.envPortProvided && values.Port) {
    const parsed = Number(values.Port);
    if (Number.isInteger(parsed) && parsed > 0) {
      port = parsed;
    }
  }

  return {
    token,
    port,
    tokenSource: !args.token && values.Token ? iniPath : undefined,
    portSource: !args.envPortProvided && values.Port ? iniPath : undefined
  };
}
