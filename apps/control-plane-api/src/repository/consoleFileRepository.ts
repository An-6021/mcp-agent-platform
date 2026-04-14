import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CreateSourceInputSchema,
  HostedNpmSourceConfigSchema,
  HostedSingleFileSourceConfigSchema,
  LocalStdioSourceConfigSchema,
  RemoteHttpSourceConfigSchema,
  SourceSchema,
  type ConsoleRepository,
  type CreateSourceInput,
  type HostedRuntimeState,
  type LogEntry,
  type Source,
  type SourceDiscovery,
  type ToolExposure,
  type UpdateSourceInput,
} from "@mcp-agent-platform/shared";
import { resolveBuiltinDiscoverySeed } from "../builtinDiscoverySeeds";

export type ConsoleFileRepositoryOptions = {
  dataDir: string;
};

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function nowISO() {
  return new Date().toISOString();
}

function parseSourceConfig(kind: Source["kind"], config: unknown): Source["config"] {
  switch (kind) {
    case "remote-http":
      return RemoteHttpSourceConfigSchema.parse(config);
    case "local-stdio":
      return LocalStdioSourceConfigSchema.parse(config);
    case "hosted-npm":
      return HostedNpmSourceConfigSchema.parse(config);
    case "hosted-single-file":
      return HostedSingleFileSourceConfigSchema.parse(config);
  }
}

function createSourceRecord(input: CreateSourceInput): Source {
  const parsed = CreateSourceInputSchema.parse(input);
  const now = nowISO();
  const seedDiscovery = parsed.seedDiscovery
    ? SourceSchema.parse({
        id: parsed.id,
        name: parsed.name,
        kind: parsed.kind,
        enabled: parsed.enabled ?? true,
        tags: [],
        createdAt: now,
        updatedAt: now,
        lastRefreshedAt: null,
        status: parsed.enabled === false ? "disabled" : "unknown",
        lastError: null,
        seedDiscovery: {
          generatedAt: parsed.seedDiscovery.generatedAt,
          status: parsed.seedDiscovery.status,
          error: parsed.seedDiscovery.error,
          tools: parsed.seedDiscovery.tools,
          resources: parsed.seedDiscovery.resources,
          prompts: parsed.seedDiscovery.prompts,
        },
        config: parseSourceConfig(parsed.kind, parsed.config),
      }).seedDiscovery
    : null;

  return SourceSchema.parse({
    id: parsed.id,
    name: parsed.name,
    kind: parsed.kind,
    enabled: parsed.enabled ?? true,
    tags: [],
    createdAt: now,
    updatedAt: now,
    lastRefreshedAt: seedDiscovery?.generatedAt ?? null,
    status: parsed.enabled === false ? "disabled" : seedDiscovery?.status === "error" ? "error" : seedDiscovery ? "ready" : "unknown",
    lastError: seedDiscovery?.error ?? null,
    seedDiscovery,
    config: parseSourceConfig(parsed.kind, parsed.config),
  });
}

function patchSourceRecord(current: Source, patch: UpdateSourceInput): Source {
  const nextSeedDiscovery = patch.seedDiscovery !== undefined
    ? SourceSchema.parse({
        ...current,
        seedDiscovery: {
          generatedAt: patch.seedDiscovery.generatedAt,
          status: patch.seedDiscovery.status,
          error: patch.seedDiscovery.error,
          tools: patch.seedDiscovery.tools,
          resources: patch.seedDiscovery.resources,
          prompts: patch.seedDiscovery.prompts,
        },
      }).seedDiscovery
    : current.seedDiscovery;

  const candidate = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.status !== undefined
      ? { status: patch.status }
      : patch.seedDiscovery !== undefined
        ? { status: current.enabled ? (patch.seedDiscovery.status === "error" ? "error" : "ready") : "disabled" }
        : {}),
    ...(patch.lastRefreshedAt !== undefined
      ? { lastRefreshedAt: patch.lastRefreshedAt }
      : patch.seedDiscovery !== undefined
        ? { lastRefreshedAt: patch.seedDiscovery.generatedAt }
        : {}),
    ...(patch.lastError !== undefined
      ? { lastError: patch.lastError }
      : patch.seedDiscovery !== undefined
        ? { lastError: patch.seedDiscovery.error }
        : {}),
    seedDiscovery: nextSeedDiscovery,
    updatedAt: nowISO(),
  };

  return SourceSchema.parse({
    ...candidate,
    config: patch.config !== undefined ? parseSourceConfig(current.kind, patch.config) : current.config,
  });
}

function seedToDiscovery(sourceId: string, seedDiscovery: NonNullable<Source["seedDiscovery"]>): SourceDiscovery {
  return {
    sourceId,
    generatedAt: seedDiscovery.generatedAt,
    status: seedDiscovery.status,
    error: seedDiscovery.error,
    tools: seedDiscovery.tools,
    resources: seedDiscovery.resources,
    prompts: seedDiscovery.prompts,
  };
}

export function createConsoleFileRepository(options: ConsoleFileRepositoryOptions): ConsoleRepository {
  const baseDir = path.join(options.dataDir, "console");
  const sourcesDir = path.join(baseDir, "sources");
  const discoveriesDir = path.join(baseDir, "discoveries");
  const logsDir = path.join(baseDir, "logs");
  const exposuresFile = path.join(baseDir, "exposures.json");
  const hostedStateFile = path.join(baseDir, "hosted-state.json");

  function sourceFile(sourceId: string) {
    return path.join(sourcesDir, `${sourceId}.json`);
  }

  function discoveryFile(sourceId: string) {
    return path.join(discoveriesDir, `${sourceId}.json`);
  }

  function logFile(sourceId: string) {
    return path.join(logsDir, `${sourceId}.log`);
  }

  async function listSourceIds() {
    try {
      const files = await readdir(sourcesDir);
      return files.filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5));
    } catch {
      return [];
    }
  }

  async function readExposures(): Promise<ToolExposure[]> {
    return (await readJsonFile<ToolExposure[]>(exposuresFile)) ?? [];
  }

  async function writeExposures(exposures: ToolExposure[]): Promise<void> {
    await writeJsonFile(exposuresFile, exposures);
  }

  async function readHostedStates(): Promise<Record<string, HostedRuntimeState>> {
    return (await readJsonFile<Record<string, HostedRuntimeState>>(hostedStateFile)) ?? {};
  }

  async function writeHostedStates(states: Record<string, HostedRuntimeState>): Promise<void> {
    await writeJsonFile(hostedStateFile, states);
  }

  return {
    async listSources() {
      const ids = await listSourceIds();
      const sources = await Promise.all(ids.map((id) => readJsonFile<Source>(sourceFile(id))));
      return sources.filter((value): value is Source => Boolean(value));
    },

    async getSource(id: string) {
      return readJsonFile<Source>(sourceFile(id));
    },

    async createSource(input: CreateSourceInput) {
      const parsed = CreateSourceInputSchema.parse(input);
      const existing = await readJsonFile<Source>(sourceFile(parsed.id));
      if (existing) {
        throw new Error(`Source \"${parsed.id}\" already exists`);
      }

      const source = createSourceRecord(parsed);
      await writeJsonFile(sourceFile(source.id), source);
      if (source.seedDiscovery) {
        await writeJsonFile(discoveryFile(source.id), seedToDiscovery(source.id, source.seedDiscovery));
      }
      return source;
    },

    async updateSource(id: string, patch: UpdateSourceInput) {
      const current = await readJsonFile<Source>(sourceFile(id));
      if (!current) {
        throw new Error(`Source \"${id}\" not found`);
      }

      const next = patchSourceRecord(current, patch);
      await writeJsonFile(sourceFile(id), next);
      if (patch.seedDiscovery !== undefined && next.seedDiscovery) {
        await writeJsonFile(discoveryFile(id), seedToDiscovery(id, next.seedDiscovery));
      }
      return next;
    },

    async deleteSource(id: string) {
      const current = await readJsonFile<Source>(sourceFile(id));
      if (!current) {
        throw new Error(`Source \"${id}\" not found`);
      }

      await rm(sourceFile(id), { force: true });
      await rm(discoveryFile(id), { force: true });
      await rm(logFile(id), { force: true });

      const exposures = await readExposures();
      await writeExposures(exposures.filter((item) => item.sourceId !== id));

      const states = await readHostedStates();
      delete states[id];
      await writeHostedStates(states);
    },

    async saveDiscovery(discovery: SourceDiscovery) {
      await writeJsonFile(discoveryFile(discovery.sourceId), discovery);
    },

    async getDiscovery(sourceId: string) {
      const discovery = await readJsonFile<SourceDiscovery>(discoveryFile(sourceId));
      if (discovery) {
        return resolveBuiltinDiscoverySeed(sourceId, discovery);
      }

      const source = await readJsonFile<Source>(sourceFile(sourceId));
      const seededDiscovery = source?.seedDiscovery ? seedToDiscovery(sourceId, source.seedDiscovery) : null;
      return resolveBuiltinDiscoverySeed(sourceId, seededDiscovery);
    },

    async listExposures() {
      return readExposures();
    },

    async saveExposure(exposure: ToolExposure) {
      const exposures = await readExposures();
      const index = exposures.findIndex(
        (item) => item.sourceId === exposure.sourceId && item.originalName === exposure.originalName,
      );
      if (index >= 0) {
        exposures[index] = exposure;
      } else {
        exposures.push(exposure);
      }
      await writeExposures(exposures);
      return exposure;
    },

    async saveExposures(exposures: ToolExposure[]) {
      await writeExposures(exposures);
    },

    async getHostedState(sourceId: string) {
      const states = await readHostedStates();
      return states[sourceId] ?? null;
    },

    async saveHostedState(state: HostedRuntimeState) {
      const states = await readHostedStates();
      states[state.sourceId] = state;
      await writeHostedStates(states);
    },

    async listHostedStates() {
      const states = await readHostedStates();
      return Object.values(states);
    },

    async appendLog(entry: LogEntry) {
      await mkdir(logsDir, { recursive: true });
      const line = JSON.stringify({ ...entry, id: entry.id || randomUUID() }) + "\n";
      await writeFile(logFile(entry.sourceId), line, { encoding: "utf8", flag: "a" });
    },

    async listLogs(sourceId: string, limit = 100) {
      try {
        const raw = await readFile(logFile(sourceId), "utf8");
        return raw
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as LogEntry)
          .slice(-limit);
      } catch {
        return [];
      }
    },
  };
}
