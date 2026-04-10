import { useEffect, useMemo, useState } from "react";
import type { UpstreamConfig } from "../api/client";
import { TrashIcon } from "./AppIcons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";

type Props = {
  upstreams: UpstreamConfig[];
  onChange: (upstreams: UpstreamConfig[]) => void;
  validationIssues?: string[][];
};

type RecordTextAreaProps = {
  label: string;
  value: Record<string, string> | undefined;
  placeholder: string;
  help: string;
  onCommit: (value: Record<string, string>) => void;
};

type SourceTextAreaProps = {
  label: string;
  value: string | undefined;
  placeholder: string;
  help: string;
  onCommit: (value: string) => void;
};

type CommandFieldProps = {
  label: string;
  value: string[] | undefined;
  placeholder: string;
  help: string;
  onCommit: (value: string[]) => void;
};

type UpstreamKind = UpstreamConfig["kind"];

type UpstreamKindCopy = {
  title: string;
  description: string;
  summaryPlaceholder: string;
  defaultLabelPrefix: string;
  defaultIdPrefix: string;
};

const upstreamKindCopy: Record<UpstreamKind, UpstreamKindCopy> = {
  "direct-http": {
    title: "远程地址",
    description: "适合已经在线运行的 MCP 服务，粘贴一个可访问地址即可。",
    summaryPlaceholder: "还没有填写地址",
    defaultLabelPrefix: "远程服务",
    defaultIdPrefix: "remote-http",
  },
  "local-stdio": {
    title: "本地命令",
    description: "适合你本机已经能跑通的命令，直接把整条启动命令贴进来。",
    summaryPlaceholder: "还没有填写启动命令",
    defaultLabelPrefix: "本地命令",
    defaultIdPrefix: "local-command",
  },
  "hosted-npm": {
    title: "npm 包",
    description: "适合已经发布到 npm 的服务，只需要包名和入口命令。",
    summaryPlaceholder: "还没有填写 npm 信息",
    defaultLabelPrefix: "npm 服务",
    defaultIdPrefix: "npm-package",
  },
  "hosted-single-file": {
    title: "单文件脚本",
    description: "适合直接托管一段脚本，把内容粘贴进来就能运行。",
    summaryPlaceholder: "还没有贴入脚本内容",
    defaultLabelPrefix: "单文件脚本",
    defaultIdPrefix: "single-file",
  },
};

function buildDefaultIdentity(kind: UpstreamKind, sequence: number) {
  const copy = upstreamKindCopy[kind];
  return {
    label: `${copy.defaultLabelPrefix} ${sequence}`,
    id: `${copy.defaultIdPrefix}-${sequence}`,
  };
}

function buildAvailableIdentity(kind: UpstreamKind, upstreams: UpstreamConfig[]) {
  const usedIds = new Set(upstreams.map((upstream) => trimText(upstream.id)).filter(Boolean));
  let sequence = 1;

  while (usedIds.has(buildDefaultIdentity(kind, sequence).id)) {
    sequence += 1;
  }

  return buildDefaultIdentity(kind, sequence);
}

function trimText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function normalizeRecord(value: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value ?? {})
      .map(([key, current]) => [key.trim(), current.trim()] as const)
      .filter(([key, current]) => key.length > 0 && current.length > 0),
  );
}

function normalizeList(value: string[] | undefined): string[] {
  return (value ?? []).map((item) => item.trim()).filter(Boolean);
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function createUpstream(kind: UpstreamKind, upstreams: UpstreamConfig[]): UpstreamConfig {
  const identity = buildAvailableIdentity(kind, upstreams);

  if (kind === "direct-http") {
    return {
      id: identity.id,
      label: identity.label,
      kind,
      enabled: true,
      url: "",
      headers: {},
    };
  }

  if (kind === "local-stdio") {
    return {
      id: identity.id,
      label: identity.label,
      kind,
      enabled: true,
      command: [],
      cwd: null,
      env: {},
      timeoutMs: 30000,
      autoStart: true,
    };
  }

  if (kind === "hosted-npm") {
    return {
      id: identity.id,
      label: identity.label,
      kind,
      enabled: true,
      packageName: "",
      packageVersion: "",
      binName: "",
      args: [],
      cwd: null,
      env: {},
      timeoutMs: 30000,
      autoStart: true,
    };
  }

  return {
    id: identity.id,
    label: identity.label,
    kind,
    enabled: true,
    fileName: "index.mjs",
    runtime: "node",
    source: "",
    args: [],
    cwd: null,
    env: {},
    timeoutMs: 30000,
    autoStart: true,
  };
}

export function normalizeUpstreamDraft(upstream: UpstreamConfig, index: number): UpstreamConfig {
  const identity = buildDefaultIdentity(upstream.kind, index + 1);
  const base = {
    ...upstream,
    id: trimText(upstream.id) || identity.id,
    label: trimText(upstream.label) || identity.label,
    enabled: upstream.enabled ?? true,
  };

  if (upstream.kind === "direct-http") {
    return {
      ...base,
      kind: "direct-http",
      url: trimText(upstream.url),
      headers: normalizeRecord(upstream.headers),
    };
  }

  if (upstream.kind === "local-stdio") {
    return {
      ...base,
      kind: "local-stdio",
      command: normalizeList(upstream.command),
      cwd: trimText(upstream.cwd) || null,
      env: normalizeRecord(upstream.env),
      timeoutMs: normalizePositiveNumber(upstream.timeoutMs, 30000),
      autoStart: upstream.autoStart ?? true,
    };
  }

  if (upstream.kind === "hosted-npm") {
    return {
      ...base,
      kind: "hosted-npm",
      packageName: trimText(upstream.packageName),
      packageVersion: trimText(upstream.packageVersion) || undefined,
      binName: trimText(upstream.binName),
      args: normalizeList(upstream.args),
      cwd: trimText(upstream.cwd) || null,
      env: normalizeRecord(upstream.env),
      timeoutMs: normalizePositiveNumber(upstream.timeoutMs, 30000),
      autoStart: upstream.autoStart ?? true,
    };
  }

  return {
    ...base,
    kind: "hosted-single-file",
    fileName: trimText(upstream.fileName) || "index.mjs",
    runtime: upstream.runtime ?? "node",
    source: upstream.source ?? "",
    args: normalizeList(upstream.args),
    cwd: trimText(upstream.cwd) || null,
    env: normalizeRecord(upstream.env),
    timeoutMs: normalizePositiveNumber(upstream.timeoutMs, 30000),
    autoStart: upstream.autoStart ?? true,
  };
}

export function collectUpstreamIssues(upstream: UpstreamConfig, index: number): string[] {
  const normalized = normalizeUpstreamDraft(upstream, index);
  const issues: string[] = [];

  if (normalized.kind === "direct-http") {
    if (!normalized.url) {
      issues.push("请先粘贴一个可访问的服务地址");
    } else {
      try {
        new URL(normalized.url);
      } catch {
        issues.push("服务地址格式不正确");
      }
    }
  }

  if (normalized.kind === "local-stdio" && !normalized.command?.length) {
    issues.push("请先填写一条本机可运行的启动命令");
  }

  if (normalized.kind === "hosted-npm") {
    if (!normalized.packageName) {
      issues.push("请先填写 npm 包名");
    }
    if (!normalized.binName) {
      issues.push("请先填写入口命令");
    }
  }

  if (normalized.kind === "hosted-single-file" && !normalized.source.trim()) {
    issues.push("请先贴入完整脚本内容");
  }

  return issues;
}

function parseCommandText(value: string): string[] {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g);
  if (!matches) {
    return [];
  }

  return matches.map((item) => item.replace(/^['"]|['"]$/g, "").trim()).filter(Boolean);
}

function formatCommandText(value: string[] | undefined): string {
  return (value ?? []).map((item) => (/\s/.test(item) ? JSON.stringify(item) : item)).join(" ");
}

function serializeRecord(value: Record<string, string> | undefined): string {
  return Object.entries(value ?? {})
    .map(([key, current]) => `${key}=${current}`)
    .join("\n");
}

function parseRecordDraft(value: string): Record<string, string> {
  const lines = value.split(/\r?\n/);
  const next: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error("每行请写成 KEY=VALUE");
    }

    const key = line.slice(0, separatorIndex).trim();
    const current = line.slice(separatorIndex + 1).trim();

    if (!key || !current) {
      throw new Error("每行请写成 KEY=VALUE");
    }

    next[key] = current;
  }

  return next;
}

function getUpstreamSummary(upstream: UpstreamConfig): string {
  if (upstream.kind === "direct-http") {
    return trimText(upstream.url) || upstreamKindCopy[upstream.kind].summaryPlaceholder;
  }

  if (upstream.kind === "local-stdio") {
    return upstream.command?.length ? upstream.command.join(" ") : upstreamKindCopy[upstream.kind].summaryPlaceholder;
  }

  if (upstream.kind === "hosted-npm") {
    const packageText = trimText(upstream.packageVersion)
      ? `${trimText(upstream.packageName)}@${trimText(upstream.packageVersion)}`
      : trimText(upstream.packageName);
    return [packageText, trimText(upstream.binName)].filter(Boolean).join(" / ") || upstreamKindCopy[upstream.kind].summaryPlaceholder;
  }

  return upstream.source?.trim()
    ? `${upstream.source.split("\n").length} 行脚本 · ${upstream.runtime ?? "node"}`
    : upstreamKindCopy[upstream.kind].summaryPlaceholder;
}

function RecordTextArea({ label, value, placeholder, help, onCommit }: RecordTextAreaProps) {
  const serialized = useMemo(() => serializeRecord(value), [value]);
  const [draft, setDraft] = useState(serialized);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(serialized);
    setError(null);
  }, [serialized]);

  function commit() {
    try {
      const next = parseRecordDraft(draft);
      onCommit(next);
      setError(null);
    } catch (currentError) {
      setError((currentError as Error).message || "请输入合法内容");
    }
  }

  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        className="field-textarea min-h-[120px] text-xs leading-6"
        placeholder={placeholder}
      />
      {error ? <p className="mt-2 text-xs leading-5 text-rose-600">{error}</p> : <p className="field-help">{help}</p>}
    </label>
  );
}

function CommandField({ label, value, placeholder, help, onCommit }: CommandFieldProps) {
  const serialized = useMemo(() => formatCommandText(value), [value]);
  const [draft, setDraft] = useState(serialized);

  useEffect(() => {
    setDraft(serialized);
  }, [serialized]);

  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(parseCommandText(draft))}
        className="field-input font-mono text-xs sm:text-sm"
        placeholder={placeholder}
      />
      {help ? <p className="field-help">{help}</p> : null}
    </label>
  );
}

function SourceTextArea({ label, value, placeholder, help, onCommit }: SourceTextAreaProps) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(draft)}
        className="field-textarea min-h-[260px] font-mono text-xs leading-6"
        placeholder={placeholder}
      />
      <p className="field-help">{help}</p>
    </label>
  );
}

function QuickAddButton({ kind, onClick }: { kind: UpstreamKind; onClick: () => void }) {
  const copy = upstreamKindCopy[kind];

  return (
    <button
      type="button"
      onClick={onClick}
      className="surface-card-muted group rounded-[1.5rem] p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-base font-semibold text-slate-950">{copy.title}</p>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 transition group-hover:border-slate-300 group-hover:text-slate-900">
          添加
        </span>
      </div>
    </button>
  );
}

function UpstreamCard({
  upstream,
  issues,
  onUpdate,
  onRemove,
}: {
  upstream: UpstreamConfig;
  issues: string[];
  onUpdate: (patch: Partial<UpstreamConfig>) => void;
  onRemove: () => void;
}) {
  const copy = upstreamKindCopy[upstream.kind];

  return (
    <div className="surface-card p-4 sm:p-5">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-tight text-slate-950">{copy.title}</p>
          <p className="mt-1 text-sm text-slate-500">{trimText(upstream.label) || getUpstreamSummary(upstream)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            <input type="checkbox" checked={upstream.enabled} onChange={(event) => onUpdate({ enabled: event.target.checked })} />
            使用
          </label>
          <button
            type="button"
            onClick={onRemove}
            title="删除"
            aria-label="删除"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 transition hover:bg-rose-50 hover:text-rose-700"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {issues.length ? (
        <div className="mt-4 rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-medium text-rose-700">还差一点就能保存：</p>
          <ul className="mt-2 space-y-1 text-sm text-rose-700">
            {issues.map((issue) => (
              <li key={issue}>• {issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {upstream.kind === "direct-http" ? (
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="field-label">服务地址</span>
            <input
              value={upstream.url ?? ""}
              onChange={(event) => onUpdate({ url: event.target.value })}
              className="field-input font-mono text-xs sm:text-sm"
              placeholder="https://example.com/mcp"
            />
          </label>
        </div>
      ) : null}

      {upstream.kind === "local-stdio" ? (
        <div className="mt-5 space-y-4">
          <CommandField
            label="启动命令"
            value={upstream.command}
            onCommit={(value) => onUpdate({ command: value })}
            placeholder="npx -y your-mcp-server"
            help=""
          />
        </div>
      ) : null}

      {upstream.kind === "hosted-npm" ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className="field-label">npm 包名</span>
            <input
              value={upstream.packageName ?? ""}
              onChange={(event) => onUpdate({ packageName: event.target.value })}
              className="field-input font-mono text-xs sm:text-sm"
              placeholder="@scope/your-mcp-server"
            />
          </label>

          <label className="block">
            <span className="field-label">入口命令</span>
            <input
              value={upstream.binName ?? ""}
              onChange={(event) => onUpdate({ binName: event.target.value })}
              className="field-input font-mono text-xs sm:text-sm"
              placeholder="mcp-server"
            />
          </label>
        </div>
      ) : null}

      {upstream.kind === "hosted-single-file" ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[160px_minmax(0,1fr)]">
            <label className="block">
              <span className="field-label">运行方式</span>
              <Select
                value={upstream.runtime ?? "node"}
                onValueChange={(val) => onUpdate({ runtime: val as UpstreamConfig["runtime"] })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择运行时" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="node">Node.js</SelectItem>
                  <SelectItem value="tsx">TSX</SelectItem>
                  <SelectItem value="python">Python</SelectItem>
                  <SelectItem value="bash">Bash</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          <SourceTextArea
            label="脚本内容"
            value={upstream.source}
            placeholder={`import { Server } from "@modelcontextprotocol/sdk/server";\n// 把单文件 MCP 服务内容贴到这里`}
            help="直接粘贴完整脚本即可，保存后会按上面的运行方式启动。"
            onCommit={(value) => onUpdate({ source: value })}
          />
        </div>
      ) : null}

      <div className="mt-5 space-y-4 rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className="field-label">名称</span>
            <input value={upstream.label} onChange={(event) => onUpdate({ label: event.target.value })} className="field-input" />
          </label>

          <label className="block">
            <span className="field-label">ID</span>
            <input
              value={upstream.id}
              onChange={(event) => onUpdate({ id: event.target.value })}
              className="field-input font-mono text-xs sm:text-sm"
            />
          </label>
        </div>

        {upstream.kind === "direct-http" ? (
          <RecordTextArea
            label="请求头"
            value={upstream.headers}
            placeholder={`Authorization=Bearer ...\nX-Workspace=demo`}
            help=""
            onCommit={(value) => onUpdate({ headers: value })}
          />
        ) : null}

        {upstream.kind === "local-stdio" || upstream.kind === "hosted-npm" || upstream.kind === "hosted-single-file" ? (
          <>
            {upstream.kind === "hosted-npm" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block">
                  <span className="field-label">版本</span>
                  <input
                    value={upstream.packageVersion ?? ""}
                    onChange={(event) => onUpdate({ packageVersion: event.target.value })}
                    className="field-input font-mono text-xs sm:text-sm"
                    placeholder="latest / 1.2.3"
                  />
                </label>

                <CommandField
                  label="参数"
                  value={upstream.args}
                  onCommit={(value) => onUpdate({ args: value })}
                  placeholder="--port 3101"
                  help=""
                />
              </div>
            ) : null}

            {upstream.kind === "hosted-single-file" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block">
                  <span className="field-label">文件名</span>
                  <input
                    value={upstream.fileName ?? ""}
                    onChange={(event) => onUpdate({ fileName: event.target.value })}
                    className="field-input font-mono text-xs sm:text-sm"
                    placeholder="index.mjs"
                  />
                </label>

                <CommandField
                  label="参数"
                  value={upstream.args}
                  onCommit={(value) => onUpdate({ args: value })}
                  placeholder="--mode production"
                  help=""
                />
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className="field-label">目录</span>
                <input
                  value={upstream.cwd ?? ""}
                  onChange={(event) => onUpdate({ cwd: event.target.value || null })}
                  className="field-input"
                  placeholder="/path/to/project"
                />
              </label>

              <label className="block">
                <span className="field-label">超时</span>
                <input
                  type="number"
                  min={1000}
                  value={upstream.timeoutMs ?? 30000}
                  onChange={(event) => onUpdate({ timeoutMs: Number(event.target.value) })}
                  className="field-input"
                />
              </label>
            </div>

            <RecordTextArea
              label="环境变量"
              value={upstream.env}
              placeholder={`OPENAI_API_KEY=...\nMCP_AGENT_TOKEN=...`}
              help=""
              onCommit={(value) => onUpdate({ env: value })}
            />

            <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              <input type="checkbox" checked={upstream.autoStart ?? true} onChange={(event) => onUpdate({ autoStart: event.target.checked })} />
              自动拉起
            </label>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function UpstreamEditor({ upstreams, onChange, validationIssues = [] }: Props) {
  function update(index: number, patch: Partial<UpstreamConfig>) {
    onChange(upstreams.map((current, currentIndex) => (currentIndex === index ? { ...current, ...patch } : current)));
  }

  function remove(index: number) {
    onChange(upstreams.filter((_, currentIndex) => currentIndex !== index));
  }

  function add(kind: UpstreamKind) {
    onChange([...upstreams, createUpstream(kind, upstreams)]);
  }

  return (
    <div className="space-y-4">
      {upstreams.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {(Object.keys(upstreamKindCopy) as UpstreamKind[]).map((kind) => (
            <QuickAddButton key={kind} kind={kind} onClick={() => add(kind)} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {upstreams.map((upstream, index) => (
            <UpstreamCard
              key={`${upstream.kind}-${upstream.id || index}`}
              upstream={upstream}
              issues={validationIssues[index] ?? []}
              onUpdate={(patch) => update(index, patch)}
              onRemove={() => remove(index)}
            />
          ))}

          <div className="grid gap-3 md:grid-cols-2">
            {(Object.keys(upstreamKindCopy) as UpstreamKind[]).map((kind) => (
              <QuickAddButton key={kind} kind={kind} onClick={() => add(kind)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
