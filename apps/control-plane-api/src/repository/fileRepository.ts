import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
  type WorkspaceConfig,
  type UpstreamConfig,
  WORKSPACE_CONFIG_SCHEMA_VERSION,
  parseWorkspaceConfig,
} from "@mcp-agent-platform/shared";
import type {
  Workspace,
  WorkspaceDraft,
  WorkspaceSummary,
  PublishedConfigSnapshot,
  WorkspaceTokenMeta,
  CreateWorkspaceTokenInput,
  CreateWorkspaceInput,
  PublishInput,
  WorkspaceRepository,
} from "@mcp-agent-platform/shared";

// ── Helpers ─────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokenPreview(token: string): string {
  return token.length > 8 ? `${token.slice(0, 4)}****${token.slice(-4)}` : "****";
}

function nowISO(): string {
  return new Date().toISOString();
}

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

// ── Token store (flat file) ─────────────────────────────────────────────

type LegacyWorkspaceTokenMeta = {
  workspaceId: string;
  tokenHash: string;
  tokenPreview: string;
  createdAt: string;
  rotatedAt?: string;
};

type TokenStore = Record<string, WorkspaceTokenMeta[]>;

function defaultTokenLabel(index: number): string {
  return `令牌 ${index + 1}`;
}

function getLegacyTokenId(tokenHash: string, index: number): string {
  return `legacy-${tokenHash.slice(0, 12) || index + 1}`;
}

function normalizeTokenMeta(workspaceId: string, raw: WorkspaceTokenMeta | LegacyWorkspaceTokenMeta, index: number): WorkspaceTokenMeta {
  const tokenHash = typeof raw.tokenHash === "string" ? raw.tokenHash : "";
  const tokenPreview = typeof raw.tokenPreview === "string" ? raw.tokenPreview : "****";
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : nowISO();

  return {
    id: "id" in raw && typeof raw.id === "string" && raw.id ? raw.id : getLegacyTokenId(tokenHash, index),
    workspaceId,
    label: "label" in raw && typeof raw.label === "string" && raw.label ? raw.label : defaultTokenLabel(index),
    tokenHash,
    tokenPreview,
    createdAt,
    revokedAt: "revokedAt" in raw && typeof raw.revokedAt === "string" ? raw.revokedAt : null,
  };
}

function hasActiveToken(tokens: WorkspaceTokenMeta[] | undefined): boolean {
  return (tokens ?? []).some((token) => !token.revokedAt);
}

// ── File Repository ─────────────────────────────────────────────────────

export type FileRepositoryOptions = {
  dataDir: string;
  /** Legacy tokens from MCP_CONTROL_PLANE_TOKENS env var for backward compat */
  legacyTokens?: Record<string, string>;
};

export function createFileRepository(options: FileRepositoryOptions): WorkspaceRepository {
  const { dataDir } = options;

  const workspacesDir = path.join(dataDir, "workspaces");
  const tokensFile = path.join(dataDir, "tokens.json");

  // Path helpers
  function wsDir(id: string) {
    return path.join(workspacesDir, id);
  }
  function wsFile(id: string) {
    return path.join(wsDir(id), "workspace.json");
  }
  function draftFile(id: string) {
    return path.join(wsDir(id), "draft.json");
  }
  function publishedFile(id: string) {
    return path.join(wsDir(id), "published.json");
  }
  function snapshotsDir(id: string) {
    return path.join(wsDir(id), "snapshots");
  }
  function snapshotFile(id: string, version: number) {
    return path.join(snapshotsDir(id), `v${version}.json`);
  }
  // Legacy flat file path
  function legacyFile(id: string) {
    return path.join(dataDir, `${id}.json`);
  }

  // ── Token helpers ───────────────────────────────────────────────

  async function readTokenStore(): Promise<TokenStore> {
    const raw = (await readJsonFile<Record<string, WorkspaceTokenMeta[] | LegacyWorkspaceTokenMeta>>(tokensFile)) ?? {};
    const normalized: TokenStore = {};

    for (const [workspaceId, entry] of Object.entries(raw)) {
      if (Array.isArray(entry)) {
        normalized[workspaceId] = entry.map((token, index) => normalizeTokenMeta(workspaceId, token, index));
        continue;
      }

      if (entry && typeof entry === "object") {
        normalized[workspaceId] = [normalizeTokenMeta(workspaceId, entry, 0)];
      }
    }

    return normalized;
  }

  async function writeTokenStore(store: TokenStore): Promise<void> {
    await writeJsonFile(tokensFile, store);
  }

  // ── Migration: legacy flat file → new structure ─────────────────

  async function migrateIfNeeded(id: string): Promise<void> {
    const wsExists = await fileExists(wsFile(id));
    if (wsExists) return;

    const legacy = await readJsonFile<WorkspaceConfig>(legacyFile(id));
    if (!legacy) return;

    const now = nowISO();
    const workspace: Workspace = {
      id,
      displayName: legacy.displayName ?? id,
      description: "",
      status: "active",
      cacheTtlSeconds: legacy.cacheTtlSeconds ?? 300,
      createdAt: now,
      updatedAt: now,
    };
    const draft: WorkspaceDraft = {
      workspaceId: id,
      displayName: workspace.displayName,
      cacheTtlSeconds: workspace.cacheTtlSeconds,
      upstreams: legacy.upstreams ?? [],
      updatedAt: now,
      updatedBy: "migration",
    };

    await writeJsonFile(wsFile(id), workspace);
    await writeJsonFile(draftFile(id), draft);
    await writeJsonFile(publishedFile(id), legacy);

    // Migrate legacy token if present
    if (options.legacyTokens?.[id]) {
      const store = await readTokenStore();
      if (!hasActiveToken(store[id])) {
        store[id] = [
          {
            id: randomUUID(),
            workspaceId: id,
            label: defaultTokenLabel(0),
            tokenHash: sha256(options.legacyTokens[id]),
            tokenPreview: tokenPreview(options.legacyTokens[id]),
            createdAt: now,
            revokedAt: null,
          },
        ];
        await writeTokenStore(store);
      }
    }
  }

  function buildTokenLabel(existingTokens: WorkspaceTokenMeta[], input?: CreateWorkspaceTokenInput): string {
    const nextLabel = input?.label?.trim();
    if (nextLabel) {
      return nextLabel;
    }

    return defaultTokenLabel(existingTokens.length);
  }

  // ── Next snapshot version ───────────────────────────────────────

  async function nextVersion(id: string): Promise<number> {
    try {
      const files = await readdir(snapshotsDir(id));
      const versions = files
        .filter((f) => f.startsWith("v") && f.endsWith(".json"))
        .map((f) => Number.parseInt(f.slice(1, -5), 10))
        .filter((n) => !Number.isNaN(n));
      return versions.length > 0 ? Math.max(...versions) + 1 : 1;
    } catch {
      return 1;
    }
  }

  // ── Repository implementation ───────────────────────────────────

  const repo: WorkspaceRepository = {
    async list(): Promise<WorkspaceSummary[]> {
      // Ensure workspaces dir exists
      await mkdir(workspacesDir, { recursive: true });

      // Also check for legacy files that need migration
      try {
        const rootFiles = await readdir(dataDir);
        for (const f of rootFiles) {
          if (f.endsWith(".json") && f !== "tokens.json") {
            const id = f.slice(0, -5);
            await migrateIfNeeded(id);
          }
        }
      } catch {
        // ignore
      }

      let entries: string[];
      try {
        entries = await readdir(workspacesDir);
      } catch {
        return [];
      }

      const tokenStore = await readTokenStore();
      const summaries: WorkspaceSummary[] = [];
      for (const id of entries) {
        const ws = await readJsonFile<Workspace>(wsFile(id));
        if (!ws) continue;
        const draft = await readJsonFile<WorkspaceDraft>(draftFile(id));
        const published = await readJsonFile<WorkspaceConfig>(publishedFile(id));
        summaries.push({
          id: ws.id,
          displayName: ws.displayName,
          status: ws.status,
          upstreamCount: draft?.upstreams?.length ?? published?.upstreams?.length ?? 0,
          hasToken: hasActiveToken(tokenStore[id]),
          lastPublishedAt: published?.generatedAt ?? null,
        });
      }
      return summaries;
    },

    async getWorkspace(id: string): Promise<Workspace | null> {
      await migrateIfNeeded(id);
      return readJsonFile<Workspace>(wsFile(id));
    },

    async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
      const existing = await readJsonFile<Workspace>(wsFile(input.id));
      if (existing) {
        throw new Error(`Workspace "${input.id}" already exists`);
      }
      const now = nowISO();
      const workspace: Workspace = {
        id: input.id,
        displayName: input.displayName,
        description: input.description ?? "",
        status: "active",
        cacheTtlSeconds: input.cacheTtlSeconds ?? 300,
        createdAt: now,
        updatedAt: now,
      };
      const draft: WorkspaceDraft = {
        workspaceId: input.id,
        displayName: workspace.displayName,
        cacheTtlSeconds: workspace.cacheTtlSeconds,
        upstreams: [],
        updatedAt: now,
        updatedBy: "system",
      };
      await writeJsonFile(wsFile(input.id), workspace);
      await writeJsonFile(draftFile(input.id), draft);
      return workspace;
    },

    async getDraft(id: string): Promise<WorkspaceDraft | null> {
      await migrateIfNeeded(id);
      return readJsonFile<WorkspaceDraft>(draftFile(id));
    },

    async saveDraft(draft: WorkspaceDraft): Promise<void> {
      const ws = await readJsonFile<Workspace>(wsFile(draft.workspaceId));
      if (!ws) throw new Error(`Workspace "${draft.workspaceId}" not found`);
      // Also update workspace metadata from draft
      ws.displayName = draft.displayName;
      ws.cacheTtlSeconds = draft.cacheTtlSeconds;
      ws.updatedAt = nowISO();
      await writeJsonFile(wsFile(draft.workspaceId), ws);
      await writeJsonFile(draftFile(draft.workspaceId), draft);
    },

    async getPublishedConfig(id: string): Promise<WorkspaceConfig | null> {
      await migrateIfNeeded(id);
      const raw = await readJsonFile<unknown>(publishedFile(id));
      if (!raw) {
        // Fallback to legacy flat file
        const legacyRaw = await readJsonFile<unknown>(legacyFile(id));
        if (!legacyRaw) return null;
        return parseWorkspaceConfig(legacyRaw);
      }
      return parseWorkspaceConfig(raw);
    },

    async publish(id: string, input: PublishInput): Promise<PublishedConfigSnapshot> {
      const draft = await readJsonFile<WorkspaceDraft>(draftFile(id));
      if (!draft) throw new Error(`No draft found for workspace "${id}"`);

      const now = nowISO();
      // Render draft → WorkspaceConfig
      const config: WorkspaceConfig = parseWorkspaceConfig({
        schemaVersion: WORKSPACE_CONFIG_SCHEMA_VERSION,
        workspaceId: id,
        displayName: draft.displayName,
        generatedAt: now,
        cacheTtlSeconds: draft.cacheTtlSeconds,
        upstreams: draft.upstreams,
      });

      const version = await nextVersion(id);
      const snapshot: PublishedConfigSnapshot = {
        workspaceId: id,
        version,
        publishedAt: now,
        publishedBy: input.publishedBy,
        config,
        note: input.note ?? "",
      };

      // Write snapshot first, then published (atomic-ish)
      await writeJsonFile(snapshotFile(id, version), snapshot);
      await writeJsonFile(publishedFile(id), config);

      return snapshot;
    },

    async listSnapshots(id: string): Promise<PublishedConfigSnapshot[]> {
      const dir = snapshotsDir(id);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        return [];
      }
      const snapshots: PublishedConfigSnapshot[] = [];
      for (const f of files.sort()) {
        const snap = await readJsonFile<PublishedConfigSnapshot>(path.join(dir, f));
        if (snap) snapshots.push(snap);
      }
      return snapshots;
    },

    async rollback(id: string, version: number): Promise<PublishedConfigSnapshot> {
      const snap = await readJsonFile<PublishedConfigSnapshot>(snapshotFile(id, version));
      if (!snap) throw new Error(`Snapshot v${version} not found for workspace "${id}"`);

      // Re-publish the snapshot's config as a new version
      const now = nowISO();
      const newVersion = await nextVersion(id);
      const newSnapshot: PublishedConfigSnapshot = {
        workspaceId: id,
        version: newVersion,
        publishedAt: now,
        publishedBy: "rollback",
        config: snap.config,
        note: `Rollback to v${version}`,
      };
      await writeJsonFile(snapshotFile(id, newVersion), newSnapshot);
      await writeJsonFile(publishedFile(id), snap.config);

      // Also update draft to match
      const draft: WorkspaceDraft = {
        workspaceId: id,
        displayName: snap.config.displayName,
        cacheTtlSeconds: snap.config.cacheTtlSeconds,
        upstreams: snap.config.upstreams as UpstreamConfig[],
        updatedAt: now,
        updatedBy: "rollback",
      };
      await writeJsonFile(draftFile(id), draft);

      return newSnapshot;
    },

    async listTokens(id: string): Promise<WorkspaceTokenMeta[]> {
      const store = await readTokenStore();
      return store[id] ?? [];
    },

    async createToken(id: string, input?: CreateWorkspaceTokenInput): Promise<{ token: string; meta: WorkspaceTokenMeta }> {
      const ws = await readJsonFile<Workspace>(wsFile(id));
      if (!ws) throw new Error(`Workspace "${id}" not found`);

      const token = randomUUID();
      const now = nowISO();
      const store = await readTokenStore();
      const tokens = store[id] ?? [];
      const meta: WorkspaceTokenMeta = {
        id: randomUUID(),
        workspaceId: id,
        label: buildTokenLabel(tokens, input),
        tokenHash: sha256(token),
        tokenPreview: tokenPreview(token),
        createdAt: now,
        revokedAt: null,
      };

      store[id] = [...tokens, meta];
      await writeTokenStore(store);

      return { token, meta };
    },

    async revokeToken(id: string, tokenId: string): Promise<WorkspaceTokenMeta> {
      const store = await readTokenStore();
      const tokens = store[id] ?? [];
      const tokenIndex = tokens.findIndex((token) => token.id === tokenId);
      if (tokenIndex === -1) {
        throw new Error(`Token "${tokenId}" not found for workspace "${id}"`);
      }

      const existing = tokens[tokenIndex];
      if (!existing) {
        throw new Error(`Token "${tokenId}" not found for workspace "${id}"`);
      }

      if (existing.revokedAt) {
        return existing;
      }

      const nextMeta: WorkspaceTokenMeta = {
        ...existing,
        revokedAt: nowISO(),
      };
      tokens[tokenIndex] = nextMeta;
      store[id] = tokens;
      await writeTokenStore(store);
      return nextMeta;
    },

    async verifyToken(id: string, token: string): Promise<boolean> {
      const tokenHash = sha256(token);

      // Check persisted token store first
      const store = await readTokenStore();
      const tokens = store[id] ?? [];
      const hasStoredActiveToken = tokens.some((meta) => !meta.revokedAt);
      if (tokens.some((meta) => !meta.revokedAt && meta.tokenHash === tokenHash)) {
        return true;
      }

      // Fallback to legacy env-var tokens
      const legacyToken = options.legacyTokens?.[id];
      if (legacyToken) {
        return legacyToken === token;
      }

      // No token configured → no auth required
      return !hasStoredActiveToken;
    },
  };

  return repo;
}
