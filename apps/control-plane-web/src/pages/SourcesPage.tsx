import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  consoleApi,
  type CreateSourceInput,
  type Source,
  type SourceConfig,
  type SourceKind,
  type SourceListItem,
} from "../api/consoleClient";
import { api } from "../api/client";
import { MetricStrip, StatusBadge, type BadgeTone } from "../components/ConsolePrimitives";
import { CheckIcon, CopyIcon, EditIcon, PlusIcon, RefreshIcon, TrashIcon, ToggleOnIcon, ToggleOffIcon, UploadIcon } from "../components/AppIcons";
import { ExportProfilesSection } from "../components/ExportProfilesSection";
import { buildClientConfigSnippets } from "../utils/clientConfigs";
import { formatRelativeTime, formatSourceKindLabel, formatSourceStatusLabel } from "../utils/labels";
import { buildHostedSingleFileCandidate, parseImportedSources, type ImportedSourceCandidate } from "../utils/sourceImports";

// ── 状态映射 ────────────────────────────────────────────────────────

function statusTone(status: string): BadgeTone {
  switch (status) {
    case "ready": return "success";
    case "error": return "danger";
    case "offline": return "neutral";
    case "disabled": return "neutral";
    default: return "warning";
  }
}

function kindTone(kind: string): BadgeTone {
  switch (kind) {
    case "remote-http": return "info";
    default: return "neutral";
  }
}

type RemoteHttpDraftConfig = Extract<Source["config"], { endpoint: string }>;
type LocalStdioDraftConfig = Extract<Source["config"], { command: string[] }>;
type HostedNpmDraftConfig = Extract<Source["config"], { packageName: string }>;
type HostedSingleFileDraftConfig = Extract<Source["config"], { fileName: string; source: string }>;

function createDefaultSourceConfig(kind: SourceKind): SourceConfig {
  switch (kind) {
    case "remote-http":
      return { endpoint: "", headers: {}, timeoutMs: 30_000 };
    case "local-stdio":
      return { command: [], cwd: null, env: {}, timeoutMs: 30_000 };
    case "hosted-npm":
      return { packageName: "", binName: "", args: [], cwd: null, env: {}, timeoutMs: 30_000, autoStart: false };
    case "hosted-single-file":
      return { fileName: "server.ts", runtime: "node", source: "", args: [], cwd: null, env: {}, timeoutMs: 30_000, autoStart: false };
  }
}

function formatCommandText(value: string[] | undefined): string {
  return (value ?? []).map((item) => (/\s/.test(item) ? JSON.stringify(item) : item)).join(" ");
}

function parseCommandText(value: string): string[] {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g);
  if (!matches) {
    return [];
  }

  return matches.map((item) => item.replace(/^['"]|['"]$/g, "").trim()).filter(Boolean);
}

// ── 运行时自动识别 ──────────────────────────────────────────────────

const EXTENSION_RUNTIME_MAP: Record<string, HostedSingleFileDraftConfig["runtime"]> = {
  ts: "tsx",
  tsx: "tsx",
  mts: "tsx",
  js: "node",
  mjs: "node",
  cjs: "node",
  py: "python",
  sh: "bash",
};

function detectRuntimeFromFileName(fileName: string): HostedSingleFileDraftConfig["runtime"] {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_RUNTIME_MAP[ext] ?? "node";
}

function describeImportedCandidate(candidate: ImportedSourceCandidate): string {
  if (candidate.kind === "remote-http") {
    return candidate.config.endpoint;
  }

  if (candidate.kind === "local-stdio") {
    return formatCommandText(candidate.config.command);
  }

  if (candidate.kind === "hosted-npm") {
    return candidate.config.packageName;
  }

  return `${candidate.config.fileName} · ${candidate.config.runtime}`;
}

function formatSnapshotError(error: Error): string {
  const message = error.message.toLowerCase();
  if (message.includes("non-200 status code (400)") || message.includes("unexpected content type")) {
    return "这个地址没有返回可用的 MCP 服务，请确认粘贴的是正确入口后再试。";
  }

  if (message.includes("fetch failed") || message.includes("econnrefused") || message.includes("enotfound") || message.includes("timedout")) {
    return "暂时连不上这个服务，请确认地址可访问后再试。";
  }

  return "暂时拿不到能力快照，请稍后再试。";
}

function buildSourceIdFromName(name: string, fallback: string): string {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || fallback;
}

function ClientConfigQuickActions({ workspaceId }: { workspaceId: string | null }) {
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const snippets = workspaceId ? buildClientConfigSnippets({ workspaceId, token: generatedToken ?? undefined }) : [];
  const tomlSnippet = snippets.find((snippet) => snippet.id === "toml") ?? null;
  const jsonSnippet = snippets.find((snippet) => snippet.id === "json") ?? null;

  async function ensureToken() {
    if (!workspaceId) {
      throw new Error("当前没有可用服务");
    }

    if (generatedToken) {
      return generatedToken;
    }

    const created = await api.createToken(workspaceId, {
      label: `Sources Copy ${new Date().toISOString()}`,
    });
    setGeneratedToken(created.token);
    queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
    return created.token;
  }

  async function copyContent(id: "toml" | "json") {
    try {
      if (!workspaceId) {
        return;
      }

      const token = await ensureToken();
      const snippet = buildClientConfigSnippets({ workspaceId, token }).find((item) => item.id === id);
      if (!snippet) {
        throw new Error("未找到可复制的配置");
      }

      await navigator.clipboard.writeText(snippet.content);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1500);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={!tomlSnippet}
        onClick={() => { if (tomlSnippet) void copyContent("toml"); }}
        className={`button-secondary gap-1.5 ${copiedId === "toml" ? "!border-emerald-200 !bg-emerald-50 !text-emerald-700" : ""}`}
      >
        {copiedId === "toml" ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
        {copiedId === "toml" ? "已复制" : "复制 TOML"}
      </button>
      <button
        type="button"
        disabled={!jsonSnippet}
        onClick={() => { if (jsonSnippet) void copyContent("json"); }}
        className={`button-secondary gap-1.5 ${copiedId === "json" ? "!border-emerald-200 !bg-emerald-50 !text-emerald-700" : ""}`}
      >
        {copiedId === "json" ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
        {copiedId === "json" ? "已复制" : "复制 JSON"}
      </button>
    </>
  );
}

// ── 新增来源弹窗 ────────────────────────────────────────────────────

type SourceDialogProps = {
  mode: "create" | "edit";
  sourceId?: string | null;
  onClose: () => void;
  onSaved: () => void;
};

function SourceDialog({ mode, sourceId, onClose, onSaved }: SourceDialogProps) {
  const isEdit = mode === "edit";
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SourceKind>("remote-http");
  const [draftConfig, setDraftConfig] = useState<SourceConfig>(() => createDefaultSourceConfig("remote-http"));
  const [importText, setImportText] = useState("");
  const [detectedImport, setDetectedImport] = useState<ImportedSourceCandidate | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [seedDiscoveryText, setSeedDiscoveryText] = useState("");
  const [seedDiscoveryError, setSeedDiscoveryError] = useState<string | null>(null);
  const [fetchingSnapshot, setFetchingSnapshot] = useState(false);

  const sourceQuery = useQuery({
    queryKey: ["console-source", sourceId],
    queryFn: () => consoleApi.getSource(sourceId!),
    enabled: isEdit && Boolean(sourceId),
  });

  useEffect(() => {
    if (!sourceQuery.data?.source) {
      return;
    }

    applySourceToForm(sourceQuery.data.source, {
      setId,
      setName,
      setKind,
      setDraftConfig,
      setSeedDiscoveryText,
    });
    
    // 如果后台有已获取的最新快照，优先显示它而不是初始 seed
    if (sourceQuery.data.discovery) {
      setSeedDiscoveryText(JSON.stringify(sourceQuery.data.discovery, null, 2));
    }

    setImportText("");
    setDetectedImport(null);
    setImportError(null);
  }, [sourceQuery.data?.source, sourceQuery.data?.discovery]);

  const saveMutation = useMutation({
    mutationFn: (variables: { id: string; name: string; kind: SourceKind; config: SourceConfig; seedDiscovery?: CreateSourceInput["seedDiscovery"] }) => {
      if (isEdit && sourceId) {
        return consoleApi.updateSource(sourceId, {
          name: variables.name,
          config: variables.config,
          ...(variables.seedDiscovery ? { seedDiscovery: variables.seedDiscovery } : {}),
        });
      }
      return consoleApi.createSource({
        id: variables.id,
        name: variables.name,
        kind: variables.kind,
        config: variables.config,
        ...(variables.seedDiscovery ? { seedDiscovery: variables.seedDiscovery } : {}),
      });
    },
    onSuccess: () => onSaved(),
  });

  function parseSeedDiscoveryInput() {
    const rawSeedDiscovery = seedDiscoveryText.trim();
    if (!rawSeedDiscovery) {
      setSeedDiscoveryError(null);
      return undefined;
    }

    try {
      const seedDiscovery = JSON.parse(rawSeedDiscovery) as CreateSourceInput["seedDiscovery"];
      setSeedDiscoveryError(null);
      return seedDiscovery;
    } catch {
      setSeedDiscoveryError("能力快照 JSON 不合法");
      return null;
    }
  }

  const [copiedScript, setCopiedScript] = useState(false);

  async function copyLocalScript() {
    let nodeScript = "";
    if (kind === "remote-http") {
      const config = draftConfig as RemoteHttpDraftConfig;
      nodeScript = `import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
async function safeList(run, fallback) {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("MCP error -32601")) {
      return fallback;
    }
    throw error;
  }
}
async function main() {
  const endpoint = new URL(${JSON.stringify(config.endpoint || "http://127.0.0.1/mcp")});
  const transport = endpoint.pathname.endsWith("/sse")
    ? new SSEClientTransport(endpoint)
    : new StreamableHTTPClientTransport(endpoint);
  const client = new Client({ name: "mcp-snapshot", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  const discovery = {
    generatedAt: new Date().toISOString(),
    status: "ready",
    error: null,
    tools: (await client.listTools()).tools,
    resources: (await safeList(() => client.listResources(), { resources: [] })).resources,
    prompts: (await safeList(() => client.listPrompts(), { prompts: [] })).prompts,
  };
  console.log(JSON.stringify(discovery, null, 2));
  process.exit(0);
}
main().catch(console.error);`;
    } else if (kind === "local-stdio") {
      const config = draftConfig as LocalStdioDraftConfig;
      const cmdStr = JSON.stringify(config.command?.filter(Boolean).length ? config.command : ["npx", "-y", "@modelcontextprotocol/server-sqlite"]);
      const envStr = JSON.stringify(config.env || {});
      nodeScript = `import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
async function safeList(run, fallback) {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("MCP error -32601")) {
      return fallback;
    }
    throw error;
  }
}
async function main() {
  const transport = new StdioClientTransport({
    command: ${cmdStr}[0],
    args: ${cmdStr}.slice(1),
    env: { ...process.env, ...${envStr} },
  });
  const client = new Client({ name: "mcp-snapshot", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  const discovery = {
    generatedAt: new Date().toISOString(),
    status: "ready",
    error: null,
    tools: (await client.listTools()).tools,
    resources: (await safeList(() => client.listResources(), { resources: [] })).resources,
    prompts: (await safeList(() => client.listPrompts(), { prompts: [] })).prompts,
  };
  console.log(JSON.stringify(discovery, null, 2));
  process.exit(0);
}
main().catch(console.error);`;
    }

    if (!nodeScript) return;

    // 组装成 Mac 终端一键运行的 Bash 复合指令
    const bashCommand = `echo "稍等，正在后台连接 MCP 服务提取配置..." && DIR=$(mktemp -d) && cd "$DIR" && npm init -y >/dev/null 2>&1 && npm i @modelcontextprotocol/sdk >/dev/null 2>&1 && cat << 'EOF' > snap.mjs\n${nodeScript}\nEOF\nnode snap.mjs > snap.json 2>&1\nif [ $? -eq 0 ] && grep -q '"generatedAt"' snap.json; then cat snap.json | pbcopy 2>/dev/null; echo "\\n✅ 获取成功！快照 JSON 已自动存入剪贴板。"; echo "（若无法粘贴，请直接复制下方内容：）\\n"; cat snap.json; else echo "\\n❌ 获取失败！可能的错误信息：\\n"; cat snap.json; fi; echo "" && cd - >/dev/null && rm -rf "$DIR"`;

    try {
      await navigator.clipboard.writeText(bashCommand);
      setCopiedScript(true);
      window.setTimeout(() => setCopiedScript(false), 2000);
    } catch {}
  }

  async function fetchSnapshot() {
    if (!id.trim()) return;
    setFetchingSnapshot(true);
    try {
      const discovery = await consoleApi.getSourceSnapshot(id);
      setSeedDiscoveryText(JSON.stringify(discovery, null, 2));
      setSeedDiscoveryError(null);
    } catch (err) {
      setSeedDiscoveryError(formatSnapshotError(err as Error));
    } finally {
      setFetchingSnapshot(false);
    }
  }

  function applyImportedDraft(candidate: ImportedSourceCandidate) {
    applySourceToForm(candidate, {
      setId,
      setName,
      setKind,
      setDraftConfig,
      setSeedDiscoveryText,
    });
  }

  function handleImportInputChange(value: string) {
    setImportText(value);
    if (!value.trim()) {
      setDetectedImport(null);
      setImportError(null);
      setId("");
      setName("");
      setKind("remote-http");
      setDraftConfig(createDefaultSourceConfig("remote-http"));
      return;
    }

    try {
      const candidate = parseImportedSources(value)[0] ?? null;
      if (!candidate) {
        setDetectedImport(null);
        setImportError("未识别到可用来源，请粘贴地址、命令、配置或脚本。");
        setId("");
        setName("");
        setKind("remote-http");
        setDraftConfig(createDefaultSourceConfig("remote-http"));
        return;
      }

      setDetectedImport(candidate);
      setImportError(null);
      applyImportedDraft(candidate);
    } catch (error) {
      setDetectedImport(null);
      setImportError((error as Error).message || "配置解析失败");
      setId("");
      setName("");
      setKind("remote-http");
      setDraftConfig(createDefaultSourceConfig("remote-http"));
    }
  }

  function handleFileUpload(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      if (!content.trim()) {
        setImportError("脚本内容为空，请重新选择文件。");
        return;
      }

      if (!isEdit) {
        const candidate = buildHostedSingleFileCandidate(file.name, content);
        setDetectedImport(candidate);
        setImportText("");
        setImportError(null);
        applyImportedDraft(candidate);
        return;
      }

      setDraftConfig((current) => ({
        ...(current as HostedSingleFileDraftConfig),
        fileName: file.name,
        runtime: detectRuntimeFromFileName(file.name),
        source: content,
      }));
    };
    reader.readAsText(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const seedDiscovery = parseSeedDiscoveryInput();
    if (seedDiscovery === null) {
      return;
    }

    let payloadId = id || `src-${Math.random().toString(36).slice(2, 8)}`;
    let payloadName = name || payloadId;
    let payloadKind = kind;
    let payloadConfig = draftConfig;
    let payloadSeed = seedDiscovery;

    if (!isEdit) {
      if (!detectedImport) {
        setImportError("未识别到可用来源，请先粘贴配置或上传脚本。");
        return;
      }

      payloadId = detectedImport.kind === "remote-http"
        ? buildSourceIdFromName(name || detectedImport.name, detectedImport.id)
        : detectedImport.id;
      payloadName = detectedImport.kind === "remote-http"
        ? (name.trim() || detectedImport.name)
        : detectedImport.name;
      payloadKind = detectedImport.kind;
      payloadConfig = detectedImport.config;
      if (detectedImport.seedDiscovery) {
        payloadSeed = detectedImport.seedDiscovery;
      }
    }

    saveMutation.mutate({
      id: payloadId,
      name: payloadName,
      kind: payloadKind,
      config: payloadConfig,
      seedDiscovery: payloadSeed,
    });
  }

  const error = (saveMutation.error || sourceQuery.error) as Error | null;

  const remoteConfig = kind === "remote-http" ? draftConfig as RemoteHttpDraftConfig : null;
  const stdioConfig = kind === "local-stdio" ? draftConfig as LocalStdioDraftConfig : null;
  const hostedNpmConfig = kind === "hosted-npm" ? draftConfig as HostedNpmDraftConfig : null;
  const hostedSingleFileConfig = kind === "hosted-single-file" ? draftConfig as HostedSingleFileDraftConfig : null;
  const canCopyLocalScript = kind === "remote-http" || kind === "local-stdio";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <motion.form
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-lg border border-[#eaeaea] bg-white p-6 shadow-xl"
      >
        <h2 className="text-[15px] font-semibold text-[#111]">{isEdit ? "编辑来源" : "新增来源"}</h2>

        {!isEdit ? (
          <div className="rounded-lg border border-[#eaeaea] bg-[#fafafa] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[#111]">粘贴配置或脚本</p>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#d9d9d9] bg-white px-3 py-1.5 text-[12px] font-medium text-[#333] transition hover:border-[#111] hover:text-[#111]">
                <UploadIcon className="h-3.5 w-3.5" />
                上传脚本
                <input
                  type="file"
                  accept=".ts,.tsx,.mts,.js,.mjs,.cjs,.py,.sh"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
              </label>
            </div>

            <textarea
              value={importText}
              onChange={(e) => handleImportInputChange(e.target.value)}
              className="field-textarea mt-3 min-h-[176px] font-mono text-xs"
              placeholder={`{"idea":{"url":"http://127.0.0.1:64342/stream"}}\n\nhttps://example.com/mcp\n\nnpx -y @scope/server\n\n[mcp_servers.demo]\nurl = "https://example.com/mcp"\n\n\`\`\`ts\nimport { Server } from "@modelcontextprotocol/sdk/server/index.js"\n\`\`\``}
            />

            {detectedImport ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusBadge tone={kindTone(detectedImport.kind)}>{formatSourceKindLabel(detectedImport.kind)}</StatusBadge>
                <span className="text-[12px] text-[#666]">{describeImportedCandidate(detectedImport)}</span>
              </div>
            ) : null}

            {detectedImport?.kind === "remote-http" ? (
              <label className="mt-3 block">
                <span className="field-label">名称</span>
                <input
                  value={name}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    setName(nextName);
                    setId(buildSourceIdFromName(nextName, detectedImport.id));
                  }}
                  className="field-input"
                  placeholder="给这个 HTTP 来源起个名字"
                />
              </label>
            ) : null}

            {importError ? <p className="mt-3 text-[13px] text-[#e00]">{importError}</p> : null}
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
              <label className="block">
                <span className="field-label">名称</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="field-input"
                  placeholder="来源名称"
                  required
                />
              </label>
              <div className="block">
                <span className="field-label">类型</span>
                <div className="field-input flex items-center">
                  <StatusBadge tone={kindTone(kind)}>{formatSourceKindLabel(kind)}</StatusBadge>
                </div>
              </div>
            </div>

            {kind === "remote-http" ? (
              <label className="block">
                <span className="field-label">地址</span>
                <input
                  value={remoteConfig?.endpoint ?? ""}
                  onChange={(e) => setDraftConfig((current) => ({ ...(current as RemoteHttpDraftConfig), endpoint: e.target.value }))}
                  className="field-input"
                  placeholder="https://..."
                  required
                />
              </label>
            ) : null}

            {kind === "local-stdio" ? (
              <label className="block">
                <span className="field-label">启动命令</span>
                <input
                  value={formatCommandText(stdioConfig?.command)}
                  onChange={(e) => setDraftConfig((current) => ({ ...(current as LocalStdioDraftConfig), command: parseCommandText(e.target.value) }))}
                  className="field-input"
                  placeholder="npx -y @mcp/server"
                  required
                />
              </label>
            ) : null}

            {kind === "hosted-npm" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">包名</span>
                  <input
                    value={hostedNpmConfig?.packageName ?? ""}
                    onChange={(e) => setDraftConfig((current) => ({ ...(current as HostedNpmDraftConfig), packageName: e.target.value }))}
                    className="field-input"
                    placeholder="@scope/package"
                    required
                  />
                </label>
                <label className="block">
                  <span className="field-label">入口命令</span>
                  <input
                    value={hostedNpmConfig?.binName ?? ""}
                    onChange={(e) => setDraftConfig((current) => ({ ...(current as HostedNpmDraftConfig), binName: e.target.value }))}
                    className="field-input"
                    placeholder="mcp-server"
                    required
                  />
                </label>
              </div>
            ) : null}

            {kind === "hosted-single-file" ? (
              <>
                <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-[#eaeaea] bg-[#fafafa] px-6 py-5 text-center transition hover:border-[#999] hover:bg-white">
                  <UploadIcon className="h-5 w-5 text-[#999]" />
                  <span className="text-[13px] font-medium text-[#666]">
                    {hostedSingleFileConfig?.source ? hostedSingleFileConfig.fileName : "选择脚本文件"}
                  </span>
                  <input
                    type="file"
                    accept=".ts,.tsx,.mts,.js,.mjs,.cjs,.py,.sh"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                  <label className="block">
                    <span className="field-label">文件名</span>
                    <input
                      value={hostedSingleFileConfig?.fileName ?? ""}
                      onChange={(e) => {
                        const fileName = e.target.value;
                        setDraftConfig((current) => ({
                          ...(current as HostedSingleFileDraftConfig),
                          fileName,
                          runtime: detectRuntimeFromFileName(fileName),
                        }));
                      }}
                      className="field-input"
                      placeholder="server.ts"
                    />
                  </label>
                  <div className="block">
                    <span className="field-label">运行方式</span>
                    <div className="field-input flex items-center">
                      <StatusBadge tone="neutral">{hostedSingleFileConfig?.runtime ?? "node"}</StatusBadge>
                    </div>
                  </div>
                </div>

                {hostedSingleFileConfig?.source ? (
                  <div className="rounded-lg border border-[#eaeaea] bg-[#fafafa] px-4 py-3">
                    <p className="text-[12px] text-[#999]">
                      已加载 {hostedSingleFileConfig.source.split("\n").length} 行，
                      {(new Blob([hostedSingleFileConfig.source]).size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        )}

        <details className="rounded-lg border border-[#eaeaea] bg-[#fafafa] px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-medium text-[#444]">离线快照</summary>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-[#999]">可直接粘贴快照 JSON。</p>
              <div className="flex gap-2">
                {canCopyLocalScript && (
                  <button
                    type="button"
                    onClick={() => void copyLocalScript()}
                    className={`button-secondary gap-1.5 text-xs ${copiedScript ? "!border-emerald-200 !bg-emerald-50 !text-emerald-700" : ""}`}
                  >
                    {copiedScript ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
                    {copiedScript ? "已复制脚本" : "复制本地读取脚本"}
                  </button>
                )}
                {isEdit ? (
                  <button
                    type="button"
                    onClick={() => void fetchSnapshot()}
                    disabled={!id.trim() || fetchingSnapshot}
                    className="button-secondary gap-1.5 text-xs"
                  >
                    <RefreshIcon className={`h-3 w-3 ${fetchingSnapshot ? "animate-spin" : ""}`} />
                    {fetchingSnapshot ? "获取中..." : "获取快照"}
                  </button>
                ) : null}
              </div>
            </div>

            <textarea
              value={seedDiscoveryText}
              onChange={(e) => {
                setSeedDiscoveryText(e.target.value);
                if (seedDiscoveryError) {
                  setSeedDiscoveryError(null);
                }
              }}
              className="field-textarea font-mono text-xs"
              placeholder='{"generatedAt":"...","status":"ready","tools":[...]}'
            />
          </div>
        </details>

        {seedDiscoveryError ? <p className="text-[13px] text-[#e00]">{seedDiscoveryError}</p> : null}
        {sourceQuery.isLoading ? <p className="text-[13px] text-[#666]">正在读取来源配置...</p> : null}
        {error ? <p className="text-[13px] text-[#e00]">{error.message}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="button-secondary">取消</button>
          <button
            type="submit"
            disabled={saveMutation.isPending || sourceQuery.isLoading || (!isEdit && !detectedImport)}
            className="button-primary"
          >
            {saveMutation.isPending ? (isEdit ? "保存中..." : "创建中...") : isEdit ? "保存" : "创建"}
          </button>
        </div>
      </motion.form>
    </div>
  );
}

function applySourceToForm(
  source: Pick<Source, "id" | "name" | "kind" | "config" | "seedDiscovery"> | ImportedSourceCandidate,
  setters: {
    setId: (value: string) => void;
    setName: (value: string) => void;
    setKind: (value: SourceKind) => void;
    setDraftConfig: (value: SourceConfig) => void;
    setSeedDiscoveryText: (value: string) => void;
  },
) {
  setters.setId(source.id);
  setters.setName(source.name);
  setters.setKind(source.kind);
  setters.setDraftConfig(source.config);
  setters.setSeedDiscoveryText(source.seedDiscovery ? JSON.stringify(source.seedDiscovery, null, 2) : "");
}

// ── 来源行 ──────────────────────────────────────────────────────────

type SourceRowProps = {
  item: SourceListItem;
  onEdit: (id: string) => void;
  onRefresh: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  isRefreshing: boolean;
  isBatchRefreshing: boolean;
};

function SourceRow({ item, onEdit, onRefresh, onToggle, onDelete, isRefreshing, isBatchRefreshing }: SourceRowProps) {
  const isLoading = isRefreshing || (isBatchRefreshing && item.status === "unknown" && item.enabled);

  return (
    <motion.tr 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="group border-t border-[#eaeaea] transition hover:bg-[#fafafa]"
    >
      <td className="px-4 py-3">
        <p className="text-[13px] font-medium text-[#111]">{item.name}</p>
        <p className="mt-0.5 font-mono text-[11px] text-[#999]">{item.id}</p>
      </td>
      <td className="px-4 py-3">
        <StatusBadge tone={kindTone(item.kind)}>{formatSourceKindLabel(item.kind)}</StatusBadge>
      </td>
      <td className="px-4 py-3">
        {isLoading ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[#666]">
            <RefreshIcon className="h-3 w-3 animate-spin" />
            探测中
          </span>
        ) : (
          <StatusBadge tone={statusTone(item.status)}>{formatSourceStatusLabel(item.status)}</StatusBadge>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <span className="text-[13px] font-medium tabular-nums text-[#111]">{item.toolCount}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-[12px] text-[#999]">{formatRelativeTime(item.lastRefreshedAt)}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            onClick={() => onEdit(item.id)}
            className="rounded-md p-1.5 text-[#888] transition-all hover:bg-[#eaeaea] hover:text-[#111] active:scale-95"
            title="编辑"
          >
            <EditIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => onToggle(item.id, !item.enabled)}
            className="rounded-md p-1.5 text-[#888] transition-all hover:bg-[#eaeaea] hover:text-[#111] active:scale-95"
            title={item.enabled ? "停用" : "启用"}
          >
            {item.enabled ? <ToggleOnIcon className="h-4 w-4" /> : <ToggleOffIcon className="h-4 w-4" />}
          </button>
          <button
            onClick={() => onRefresh(item.id)}
            disabled={isRefreshing || isBatchRefreshing}
            className="rounded-md p-1.5 text-[#888] transition-all hover:bg-[#eaeaea] hover:text-[#111] active:scale-95 disabled:pointer-events-none disabled:opacity-30"
            title="刷新能力"
          >
            <RefreshIcon className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => { if (confirm(`确认删除 "${item.name}"？`)) onDelete(item.id); }}
            className="rounded-md p-1.5 text-[#888] transition-all hover:bg-red-50 hover:text-red-600 active:scale-95"
            title="删除"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </td>
    </motion.tr>
  );
}

// ── 主页面 ──────────────────────────────────────────────────────────

export function SourcesPage() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const workspaceQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: api.listWorkspaces,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["console-sources"],
    queryFn: consoleApi.listSources,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => consoleApi.toggleSource(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["console-sources"] }),
  });

  const refreshMutation = useMutation({
    mutationFn: (id: string) => consoleApi.refreshSource(id),
    onMutate: (id) => setRefreshingId(id),
    onSettled: () => {
      setRefreshingId(null);
      queryClient.invalidateQueries({ queryKey: ["console-sources"] });
    },
  });

  const refreshAllMutation = useMutation({
    mutationFn: () => consoleApi.refreshAllSources(),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["console-sources"] });
      queryClient.invalidateQueries({ queryKey: ["console-tools"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => consoleApi.deleteSource(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["console-sources"] }),
  });

  const migrateMutation = useMutation({
    mutationFn: () => consoleApi.migrateHostedNpmToLocalStdio(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["console-sources"] });
      queryClient.invalidateQueries({ queryKey: ["console-tools"] });
    },
  });

  if (isLoading) return <p className="pt-12 text-center text-[13px] text-[#999]">加载中...</p>;
  if (error) return <p className="pt-12 text-center text-[13px] text-[#e00]">{(error as Error).message}</p>;

  const { items, summary } = data!;
  const hasNpmSources = items.some((item) => item.kind === "hosted-npm");
  const workspace = workspaceQuery.data?.find((item) => item.status === "active") ?? workspaceQuery.data?.[0] ?? null;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="flex flex-col gap-6"
    >
      {/* 标题行 */}
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold tracking-tight text-[#111]">Sources</h1>
        <div className="flex items-center gap-2">
          <ClientConfigQuickActions workspaceId={workspace?.id ?? null} />
          <button
            onClick={() => refreshAllMutation.mutate()}
            disabled={refreshAllMutation.isPending}
            className="button-secondary gap-1.5"
          >
            <RefreshIcon className={`h-3.5 w-3.5 ${refreshAllMutation.isPending ? "animate-spin" : ""}`} />
            {refreshAllMutation.isPending ? "刷新中..." : "全部刷新"}
          </button>
          <button onClick={() => setShowAdd(true)} className="button-primary gap-1.5">
            <PlusIcon className="h-3.5 w-3.5" />
            新增
          </button>
        </div>
      </div>

      {/* 统计 */}
      <MetricStrip
        items={[
          { label: "来源", value: String(summary.sourceCount) },
          { label: "已启用", value: String(summary.enabledSourceCount), tone: "success" },
          { label: "暴露工具", value: String(summary.exposedToolCount), tone: "accent" },
          { label: "托管运行", value: String(summary.hostedRunningCount) },
        ]}
      />

      <ExportProfilesSection workspaceId={workspace?.id ?? null} sources={items} />

      {/* npm 托管迁移提示 */}
      {hasNpmSources ? (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-[13px] font-medium text-amber-900">
              检测到 {items.filter((i) => i.kind === "hosted-npm").length} 个 npm 托管来源
            </p>
            <p className="mt-0.5 text-[12px] text-amber-700">
              建议迁移为本地命令（npx -y），减少服务器压力。工具和能力数据将被保留。
            </p>
          </div>
          <button
            onClick={() => { if (confirm("确认将所有 npm 托管来源迁移为本地命令？")) migrateMutation.mutate(); }}
            disabled={migrateMutation.isPending}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-[13px] font-medium text-amber-900 transition-all hover:bg-amber-100 active:scale-95 disabled:opacity-50"
          >
            {migrateMutation.isPending ? "迁移中..." : "一键迁移"}
          </button>
        </div>
      ) : null}

      {/* 表格 */}
      <section className="surface-card overflow-hidden">
        {items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[13px] text-[#999]">暂无来源</p>
            <button onClick={() => setShowAdd(true)} className="button-secondary mt-4 text-[12px]">
              新增第一个来源
            </button>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#eaeaea]">
                  <th className="table-head-cell">名称</th>
                  <th className="table-head-cell">类型</th>
                  <th className="table-head-cell">状态</th>
                  <th className="table-head-cell text-center">工具</th>
                  <th className="table-head-cell">刷新</th>
                  <th className="table-head-cell w-[100px]" />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {items.map((item) => (
                    <SourceRow
                      key={item.id}
                      item={item}
                      onEdit={setEditingSourceId}
                      onRefresh={(id) => refreshMutation.mutate(id)}
                      onToggle={(id, enabled) => toggleMutation.mutate({ id, enabled })}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      isRefreshing={refreshingId === item.id}
                      isBatchRefreshing={refreshAllMutation.isPending}
                    />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AnimatePresence>
        {showAdd ? (
          <SourceDialog
            mode="create"
            onClose={() => setShowAdd(false)}
            onSaved={() => {
              setShowAdd(false);
              queryClient.invalidateQueries({ queryKey: ["console-sources"] });
            }}
          />
        ) : null}
        {editingSourceId ? (
          <SourceDialog
            mode="edit"
            sourceId={editingSourceId}
            onClose={() => setEditingSourceId(null)}
            onSaved={() => {
              setEditingSourceId(null);
              queryClient.invalidateQueries({ queryKey: ["console-sources"] });
              queryClient.invalidateQueries({ queryKey: ["console-source", editingSourceId] });
            }}
          />
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
