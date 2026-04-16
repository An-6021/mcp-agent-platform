import type {
  ImportedSourceDiscovery,
  SourceConfig,
  SourceKind,
} from "../api/consoleClient";
import { getControlPlaneBaseUrl } from "./clientConfigs";

export type ImportedSourceCandidate = {
  id: string;
  name: string;
  kind: SourceKind;
  config: SourceConfig;
  seedDiscovery?: ImportedSourceDiscovery;
};

type ParsedTomlServerMap = Record<string, Record<string, unknown>>;

const SERVER_ROOT_KEYS = new Set(["mcpServers", "mcp_servers", "servers"]);
const EMPTY_TIMEOUT_MS = 30_000;
const SINGLE_FILE_RUNTIME_BY_EXTENSION = {
  ts: "tsx",
  tsx: "tsx",
  mts: "tsx",
  js: "node",
  mjs: "node",
  cjs: "node",
  py: "python",
  sh: "bash",
} satisfies Record<string, "node" | "tsx" | "python" | "bash">;
const DEFAULT_FILE_NAME_BY_RUNTIME = {
  node: "server.mjs",
  tsx: "server.ts",
  python: "server.py",
  bash: "server.sh",
} satisfies Record<"node" | "tsx" | "python" | "bash", string>;

export function parseImportedSources(raw: string): ImportedSourceCandidate[] {
  const text = raw.trim();
  if (!text) {
    return [];
  }

  if (looksLikeJson(text)) {
    return parseJsonSources(text);
  }

  const tomlSources = parseTomlSources(text);
  if (tomlSources.length > 0) {
    return tomlSources;
  }

  const looseCandidate = parseLooseSource(text);
  return looseCandidate ? [looseCandidate] : [];
}

export function buildHostedSingleFileCandidate(fileName: string, source: string): ImportedSourceCandidate {
  const runtime = detectRuntimeFromFileName(fileName) ?? detectRuntimeFromSource(source);
  const safeFileName = fileName.trim() || DEFAULT_FILE_NAME_BY_RUNTIME[runtime];
  const identity = sanitizeIdentifier(safeFileName.replace(/\.[^.]+$/, "")) || "single-file";

  return {
    id: identity,
    name: safeFileName.replace(/\.[^.]+$/, "") || "单文件脚本",
    kind: "hosted-single-file",
    config: {
      fileName: safeFileName,
      runtime,
      source,
      args: [],
      cwd: null,
      env: {},
      timeoutMs: EMPTY_TIMEOUT_MS,
      autoStart: false,
    },
  };
}

export function buildSourceSnapshotCommand(sourceId: string, origin = window.location.origin): string {
  const trimmedId = sourceId.trim();
  if (!trimmedId) {
    return "";
  }

  const endpoint = `${getControlPlaneBaseUrl(origin)}/admin/sources/${encodeURIComponent(trimmedId)}/snapshot`;
  return `curl -sS -X POST ${JSON.stringify(endpoint)}`;
}

function parseJsonSources(text: string): ImportedSourceCandidate[] {
  const parsed = JSON.parse(text) as unknown;
  const directSources = normalizeRootValue(parsed);
  if (directSources.length > 0) {
    return directSources;
  }

  if (!isRecord(parsed)) {
    return [];
  }

  for (const key of SERVER_ROOT_KEYS) {
    const block = parsed[key];
    if (!isRecord(block)) {
      continue;
    }

    return Object.entries(block)
      .map(([serverId, value]) => toImportedSourceCandidate(value, serverId))
      .filter((value): value is ImportedSourceCandidate => Boolean(value));
  }

  return parseNamedJsonSourceMap(parsed);
}

function parseTomlSources(text: string): ImportedSourceCandidate[] {
  const serverMap = parseTomlServerMap(text);
  return Object.entries(serverMap)
    .map(([serverId, value]) => toImportedSourceCandidate(value, serverId))
    .filter((value): value is ImportedSourceCandidate => Boolean(value));
}

function parseNamedJsonSourceMap(value: Record<string, unknown>): ImportedSourceCandidate[] {
  return Object.entries(value)
    .map(([serverId, serverValue]) => toImportedSourceCandidate(serverValue, serverId))
    .filter((item): item is ImportedSourceCandidate => Boolean(item));
}

function parseLooseSource(text: string): ImportedSourceCandidate | null {
  return (
    parseUrlSource(text) ??
    parseCommandSource(text) ??
    parseScriptSource(text)
  );
}

function normalizeRootValue(value: unknown): ImportedSourceCandidate[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      const candidate = toImportedSourceCandidate(item, `source-${index + 1}`);
      return candidate ? [candidate] : [];
    });
  }

  const directCandidate = toImportedSourceCandidate(value, "imported-source");
  return directCandidate ? [directCandidate] : [];
}

function toImportedSourceCandidate(value: unknown, fallbackId: string): ImportedSourceCandidate | null {
  if (!isRecord(value)) {
    return null;
  }

  if (isRecord(value.config) && typeof value.kind === "string") {
    return fromSourceRecord(value, fallbackId);
  }

  const kind = resolveCandidateKind(value);
  if (!kind) {
    return null;
  }

  const id = sanitizeIdentifier(
    stringOrUndefined(value.id) ??
      stringOrUndefined(value.name) ??
      stringOrUndefined(value.label) ??
      fallbackId,
  );
  const name = stringOrUndefined(value.name) ?? stringOrUndefined(value.label) ?? id;
  const config = buildConfigByKind(kind, value);
  if (!config) {
    return null;
  }

  return {
    id,
    name,
    kind,
    config,
    seedDiscovery: normalizeImportedDiscovery(value.seedDiscovery ?? value.discovery),
  };
}

function fromSourceRecord(value: Record<string, unknown>, fallbackId: string): ImportedSourceCandidate | null {
  const kind = normalizeSourceKind(value.kind);
  if (!kind || !isRecord(value.config)) {
    return null;
  }

  const id = sanitizeIdentifier(stringOrUndefined(value.id) ?? fallbackId);
  const name = stringOrUndefined(value.name) ?? stringOrUndefined(value.label) ?? id;
  const config = buildConfigByKind(kind, value.config);
  if (!config) {
    return null;
  }

  return {
    id,
    name,
    kind,
    config,
    seedDiscovery: normalizeImportedDiscovery(value.seedDiscovery),
  };
}

function resolveCandidateKind(value: Record<string, unknown>): SourceKind | null {
  const explicitKind = normalizeSourceKind(value.kind);
  if (explicitKind) {
    return explicitKind;
  }

  const endpoint = stringOrUndefined(value.url) ?? stringOrUndefined(value.endpoint);
  if (endpoint) {
    return "remote-http";
  }

  if (value.command !== undefined || value.args !== undefined) {
    return "local-stdio";
  }

  if (typeof value.packageName === "string") {
    return "hosted-npm";
  }

  if (typeof value.source === "string") {
    return "hosted-single-file";
  }

  return null;
}

function normalizeSourceKind(kind: unknown): SourceKind | null {
  switch (kind) {
    case "remote-http":
    case "direct-http":
      return "remote-http";
    case "local-stdio":
    case "stdio":
      return "local-stdio";
    case "hosted-npm":
      return "hosted-npm";
    case "hosted-single-file":
      return "hosted-single-file";
    default:
      return null;
  }
}

function buildConfigByKind(kind: SourceKind, value: Record<string, unknown>): SourceConfig | null {
  if (kind === "remote-http") {
    const endpoint = stringOrUndefined(value.endpoint) ?? stringOrUndefined(value.url);
    if (!endpoint) {
      return null;
    }

    return {
      endpoint,
      headers: normalizeStringRecord(value.headers),
      timeoutMs: positiveNumber(value.timeoutMs) ?? positiveNumber(value.timeout_ms) ?? EMPTY_TIMEOUT_MS,
    };
  }

  if (kind === "local-stdio") {
    const command = normalizeCommand(value.command, value.args);
    if (command.length === 0) {
      return null;
    }

    return {
      command,
      cwd: stringOrUndefined(value.cwd) ?? null,
      env: normalizeStringRecord(value.env),
      timeoutMs: positiveNumber(value.timeoutMs) ?? positiveNumber(value.timeout_ms) ?? EMPTY_TIMEOUT_MS,
    };
  }

  if (kind === "hosted-npm") {
    const packageName = stringOrUndefined(value.packageName);
    if (!packageName) {
      return null;
    }

    return {
      packageName,
      packageVersion: stringOrUndefined(value.packageVersion),
      binName: stringOrUndefined(value.binName) ?? packageName,
      args: normalizeCommand(undefined, value.args),
      cwd: stringOrUndefined(value.cwd) ?? null,
      env: normalizeStringRecord(value.env),
      timeoutMs: positiveNumber(value.timeoutMs) ?? positiveNumber(value.timeout_ms) ?? EMPTY_TIMEOUT_MS,
      autoStart: booleanOrDefault(value.autoStart, false),
    };
  }

  const source = stringOrUndefined(value.source);
  if (!source) {
    return null;
  }

  return {
    fileName: stringOrUndefined(value.fileName) ?? "server.ts",
    runtime: normalizeRuntime(value.runtime),
    source,
    args: normalizeCommand(undefined, value.args),
    cwd: stringOrUndefined(value.cwd) ?? null,
    env: normalizeStringRecord(value.env),
    timeoutMs: positiveNumber(value.timeoutMs) ?? positiveNumber(value.timeout_ms) ?? EMPTY_TIMEOUT_MS,
    autoStart: booleanOrDefault(value.autoStart, false),
  };
}

function normalizeImportedDiscovery(value: unknown): ImportedSourceDiscovery | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const generatedAt = stringOrUndefined(value.generatedAt);
  const status = value.status === "error" ? "error" : value.status === "ready" ? "ready" : null;
  const tools = normalizeDiscoveryTools(value.tools);
  const resources = normalizeDiscoveryResources(value.resources);
  const prompts = normalizeDiscoveryPrompts(value.prompts);
  if (!generatedAt || !status) {
    return undefined;
  }

  return {
    sourceId: stringOrUndefined(value.sourceId),
    generatedAt,
    status,
    error: stringOrNull(value.error),
    tools,
    resources,
    prompts,
  };
}

function normalizeDiscoveryTools(value: unknown): ImportedSourceDiscovery["tools"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string") {
      return [];
    }

    return [{
      name: item.name,
      description: stringOrUndefined(item.description),
      inputSchema: item.inputSchema,
    }];
  });
}

function normalizeDiscoveryResources(value: unknown): ImportedSourceDiscovery["resources"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.uri !== "string") {
      return [];
    }

    return [{
      uri: item.uri,
      name: stringOrUndefined(item.name),
      description: stringOrUndefined(item.description),
      mimeType: stringOrUndefined(item.mimeType),
    }];
  });
}

function normalizeDiscoveryPrompts(value: unknown): ImportedSourceDiscovery["prompts"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string") {
      return [];
    }

    return [{
      name: item.name,
      description: stringOrUndefined(item.description),
      arguments: normalizePromptArguments(item.arguments),
    }];
  });
}

function normalizePromptArguments(value: unknown): Array<{ name: string; description?: string; required?: boolean }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const args = value.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string") {
      return [];
    }

    return [{
      name: item.name,
      description: stringOrUndefined(item.description),
      required: typeof item.required === "boolean" ? item.required : undefined,
    }];
  });

  return args.length > 0 ? args : undefined;
}

function normalizeCommand(command: unknown, args: unknown): string[] {
  if (Array.isArray(command)) {
    return command.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
  }

  if (typeof command === "string" && command.trim()) {
    const base = parseCommandText(command);
    if (!Array.isArray(args)) {
      return base;
    }

    return [...base, ...normalizeCommand(args, undefined)];
  }

  if (Array.isArray(args)) {
    return args.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
  }

  return [];
}

function normalizeRuntime(value: unknown): "node" | "tsx" | "python" | "bash" {
  switch (value) {
    case "tsx":
    case "python":
    case "bash":
      return value;
    default:
      return "node";
  }
}

function parseUrlSource(text: string): ImportedSourceCandidate | null {
  if (!/^https?:\/\//i.test(text)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  const hostName = url.hostname.replace(/^www\./, "") || "remote-http";
  const id = sanitizeIdentifier(hostName.split(".")[0] ?? hostName);
  return {
    id,
    name: hostName,
    kind: "remote-http",
    config: {
      endpoint: url.toString(),
      headers: {},
      timeoutMs: EMPTY_TIMEOUT_MS,
    },
  };
}

function parseCommandSource(text: string): ImportedSourceCandidate | null {
  if (text.includes("\n")) {
    return null;
  }

  const command = parseCommandText(text);
  if (command.length === 0 || !looksLikeCommand(command)) {
    return null;
  }

  const identity = sanitizeIdentifier(deriveCommandIdentity(command));
  return {
    id: identity,
    name: deriveCommandLabel(command),
    kind: "local-stdio",
    config: {
      command,
      cwd: null,
      env: {},
      timeoutMs: EMPTY_TIMEOUT_MS,
    },
  };
}

function parseScriptSource(text: string): ImportedSourceCandidate | null {
  const unwrapped = unwrapCodeFence(text);
  const runtime = detectRuntimeFromSource(unwrapped.content, unwrapped.language);
  if (!runtime) {
    return null;
  }

  return buildHostedSingleFileCandidate(
    fileNameFromLanguage(runtime, unwrapped.language),
    unwrapped.content,
  );
}

function unwrapCodeFence(text: string): { content: string; language: string | null } {
  const match = text.match(/^```([^\n`]*)\n([\s\S]*?)\n```$/);
  if (!match) {
    return { content: text, language: null };
  }

  return {
    language: match[1]?.trim().toLowerCase() || null,
    content: match[2] ?? text,
  };
}

function detectRuntimeFromFileName(fileName: string): "node" | "tsx" | "python" | "bash" | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return SINGLE_FILE_RUNTIME_BY_EXTENSION[ext as keyof typeof SINGLE_FILE_RUNTIME_BY_EXTENSION] ?? null;
}

function detectRuntimeFromSource(
  source: string,
  languageHint?: string | null,
): "node" | "tsx" | "python" | "bash" | null {
  const hint = normalizeLanguageHint(languageHint);
  if (hint) {
    return hint;
  }

  const text = source.trim();
  if (!text) {
    return null;
  }

  if (/^#!.*\bpython[23]?\b/m.test(text) || /\b(async\s+def|def\s+\w+\s*\()/m.test(text)) {
    return "python";
  }

  if (/^#!.*\b(bash|sh)\b/m.test(text)) {
    return "bash";
  }

  if (/\binterface\s+\w+|\btype\s+\w+\s*=|\bimport\s+type\b|:\s*(string|number|boolean|unknown|any|Record<)/m.test(text)) {
    return "tsx";
  }

  if (/\b(import\s+.+from|export\s+(async\s+)?function|module\.exports|require\(|console\.log|process\.)/m.test(text)) {
    return "node";
  }

  return null;
}

function normalizeLanguageHint(languageHint?: string | null): "node" | "tsx" | "python" | "bash" | null {
  switch ((languageHint ?? "").trim().toLowerCase()) {
    case "ts":
    case "tsx":
    case "typescript":
    case "mts":
      return "tsx";
    case "js":
    case "javascript":
    case "mjs":
    case "cjs":
    case "node":
      return "node";
    case "py":
    case "python":
      return "python";
    case "sh":
    case "bash":
    case "shell":
      return "bash";
    default:
      return null;
  }
}

function fileNameFromLanguage(runtime: "node" | "tsx" | "python" | "bash", languageHint?: string | null): string {
  const hint = (languageHint ?? "").trim().toLowerCase();
  const ext = hint && SINGLE_FILE_RUNTIME_BY_EXTENSION[hint as keyof typeof SINGLE_FILE_RUNTIME_BY_EXTENSION]
    ? hint
    : DEFAULT_FILE_NAME_BY_RUNTIME[runtime].split(".").pop() ?? "";
  return `server.${ext}`;
}

function deriveCommandIdentity(command: string[]): string {
  const meaningful = command.filter((item) => !item.startsWith("-"));
  const last = meaningful.at(-1) ?? command[0] ?? "local-command";
  return last.replace(/^@[^/]+\//, "").replace(/\.[^.]+$/, "");
}

function deriveCommandLabel(command: string[]): string {
  const identity = deriveCommandIdentity(command);
  return identity || "本地命令";
}

function looksLikeCommand(command: string[]): boolean {
  if (command.length > 1) {
    return true;
  }

  const first = command[0] ?? "";
  return /[./@]/.test(first) || /^(node|npx|pnpm|npm|yarn|bun|python|python3|uvx|bash|sh)$/i.test(first);
}

function parseTomlServerMap(text: string): ParsedTomlServerMap {
  const serverMap: ParsedTomlServerMap = {};
  let currentServerId: string | null = null;
  let currentSection: "root" | "headers" | "env" = "root";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const header = parseTomlHeader(line);
    if (header) {
      currentServerId = header.serverId;
      currentSection = header.section;
      serverMap[currentServerId] ??= {};
      if (currentSection === "headers" || currentSection === "env") {
        serverMap[currentServerId][currentSection] = serverMap[currentServerId][currentSection] ?? {};
      }
      continue;
    }

    if (!currentServerId) {
      continue;
    }

    const assignment = parseTomlAssignment(line);
    if (!assignment) {
      continue;
    }

    if (currentSection === "headers" || currentSection === "env") {
      const block = serverMap[currentServerId][currentSection];
      if (isRecord(block) && typeof assignment.value === "string") {
        block[assignment.key] = assignment.value;
      }
      continue;
    }

    serverMap[currentServerId][assignment.key] = assignment.value;
  }

  return serverMap;
}

function parseTomlHeader(line: string): { serverId: string; section: "root" | "headers" | "env" } | null {
  const match = line.match(/^\[(mcp_servers|mcpServers|servers)\.(".*?"|[^.\]]+)(?:\.(headers|env))?\]$/);
  if (!match) {
    return null;
  }

  const serverId = stripWrappingQuotes(match[2] ?? "");
  if (!serverId) {
    return null;
  }

  const section = match[3] === "headers" || match[3] === "env" ? match[3] : "root";
  return { serverId, section };
}

function parseTomlAssignment(line: string): { key: string; value: unknown } | null {
  const separatorIndex = line.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = line.slice(0, separatorIndex).trim();
  const rawValue = line.slice(separatorIndex + 1).trim();
  if (!key) {
    return null;
  }

  return {
    key,
    value: parseTomlValue(rawValue),
  };
}

function parseTomlValue(value: string): unknown {
  if (!value) {
    return "";
  }

  if (value.startsWith("\"") && value.endsWith("\"")) {
    return JSON.parse(value);
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    return splitTomlCollection(value.slice(1, -1)).map((item) => parseTomlValue(item));
  }

  if (value.startsWith("{") && value.endsWith("}")) {
    return parseTomlInlineTable(value.slice(1, -1));
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}

function parseTomlInlineTable(value: string): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const item of splitTomlCollection(value)) {
    const assignment = parseTomlAssignment(item);
    if (!assignment) {
      continue;
    }

    record[assignment.key] = assignment.value;
  }
  return record;
}

function splitTomlCollection(value: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (!char) {
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote && value[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "[" || char === "{") {
      depth += 1;
      current += char;
      continue;
    }

    if (char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (char === "," && depth === 0) {
      if (current.trim()) {
        items.push(current.trim());
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items;
}

function parseCommandText(value: string): string[] {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g);
  if (!matches) {
    return [];
  }

  return matches.map((item) => stripWrappingQuotes(item).trim()).filter(Boolean);
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, current]) => [key.trim(), stringOrUndefined(current)?.trim() ?? ""] as const)
      .filter(([key, current]) => key.length > 0 && current.length > 0),
  );
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function sanitizeIdentifier(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "imported-source";
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

function looksLikeJson(value: string): boolean {
  return value.startsWith("{") || value.startsWith("[");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
