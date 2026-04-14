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

export function parseImportedSources(raw: string): ImportedSourceCandidate[] {
  const text = raw.trim();
  if (!text) {
    return [];
  }

  if (looksLikeJson(text)) {
    return parseJsonSources(text);
  }

  return parseTomlSources(text);
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

  return [];
}

function parseTomlSources(text: string): ImportedSourceCandidate[] {
  const serverMap = parseTomlServerMap(text);
  return Object.entries(serverMap)
    .map(([serverId, value]) => toImportedSourceCandidate(value, serverId))
    .filter((value): value is ImportedSourceCandidate => Boolean(value));
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
