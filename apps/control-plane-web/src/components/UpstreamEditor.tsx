import { useEffect, useState } from "react";
import type { UpstreamConfig } from "../api/client";
import { StatusBadge } from "./ConsolePrimitives";
import { formatUpstreamKindLabel } from "../utils/labels";

type Props = {
  upstreams: UpstreamConfig[];
  onChange: (upstreams: UpstreamConfig[]) => void;
};

type JsonTextAreaProps = {
  label: string;
  value: Record<string, string> | undefined;
  placeholder: string;
  onCommit: (value: Record<string, string>) => void;
};

function emptyDirectHttp(): UpstreamConfig {
  return { id: "", label: "", kind: "direct-http", enabled: true, url: "", headers: {} };
}

function emptyLocalStdio(): UpstreamConfig {
  return {
    id: "",
    label: "",
    kind: "local-stdio",
    enabled: true,
    command: [],
    cwd: null,
    env: {},
    timeoutMs: 30000,
    autoStart: true,
  };
}

function JsonTextArea({ label, value, placeholder, onCommit }: JsonTextAreaProps) {
  const serialized = JSON.stringify(value ?? {}, null, 2);
  const [draft, setDraft] = useState(serialized);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(serialized);
    setError(null);
  }, [serialized]);

  function commit() {
    try {
      const parsed = JSON.parse(draft || "{}");
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("请输入 JSON 对象");
      }
      onCommit(parsed as Record<string, string>);
      setError(null);
    } catch (currentError) {
      setError((currentError as Error).message || "请输入合法 JSON");
    }
  }

  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        className="field-textarea min-h-[132px] text-xs leading-6"
        placeholder={placeholder}
      />
      {error ? <p className="mt-2 text-xs leading-5 text-rose-600">{error}</p> : <p className="field-help">失焦后按 JSON 保存。</p>}
    </label>
  );
}

export function UpstreamEditor({ upstreams, onChange }: Props) {
  const [addKind, setAddKind] = useState<"direct-http" | "local-stdio">("direct-http");

  function update(index: number, patch: Partial<UpstreamConfig>) {
    const next = upstreams.map((u, i) => (i === index ? { ...u, ...patch } : u));
    onChange(next);
  }

  function remove(index: number) {
    onChange(upstreams.filter((_, i) => i !== index));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...upstreams];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    onChange(next);
  }

  function moveDown(index: number) {
    if (index >= upstreams.length - 1) return;
    const next = [...upstreams];
    [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
    onChange(next);
  }

  function add() {
    const u = addKind === "direct-http" ? emptyDirectHttp() : emptyLocalStdio();
    onChange([...upstreams, u]);
  }

  return (
    <div className="space-y-4">
      {upstreams.length === 0 ? (
        <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          还没有来源。
        </div>
      ) : null}

      {upstreams.map((u, i) => (
        <div key={`${u.kind}-${u.id || i}`} className="surface-card-muted p-4 sm:p-5">
          <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={u.enabled ? "success" : "neutral"}>{u.enabled ? "启用中" : "已禁用"}</StatusBadge>
                <StatusBadge tone="info">{formatUpstreamKindLabel(u.kind)}</StatusBadge>
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">来源 {i + 1}</span>
              </div>
              <p className="text-sm leading-6 text-slate-600">匹配顺序从上到下。</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => moveUp(i)} className="button-ghost px-3 py-1.5 text-xs" title="上移">
                上移
              </button>
              <button onClick={() => moveDown(i)} className="button-ghost px-3 py-1.5 text-xs" title="下移">
                下移
              </button>
              <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                <input type="checkbox" checked={u.enabled} onChange={(event) => update(i, { enabled: event.target.checked })} />
                启用
              </label>
              <button onClick={() => remove(i)} className="button-ghost px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                删除
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className="field-label">来源 ID</span>
              <input
                value={u.id}
                onChange={(event) => update(i, { id: event.target.value })}
                className="field-input"
              />
            </label>
            <label className="block">
              <span className="field-label">显示名称</span>
              <input
                value={u.label}
                onChange={(event) => update(i, { label: event.target.value })}
                className="field-input"
              />
            </label>
          </div>

          {u.kind === "direct-http" ? (
            <div className="mt-5 grid gap-4">
              <label className="block">
                <span className="field-label">地址</span>
                <input
                  value={u.url ?? ""}
                  onChange={(event) => update(i, { url: event.target.value })}
                  className="field-input font-mono text-xs sm:text-sm"
                  placeholder="https://example.com/mcp"
                />
              </label>
              <JsonTextArea
                label="请求头"
                value={u.headers}
                placeholder={'{\n  "Authorization": "Bearer ..."\n}'}
                onCommit={(value) => update(i, { headers: value })}
              />
            </div>
          ) : null}

          {u.kind === "local-stdio" ? (
            <div className="mt-5 grid gap-4">
              <label className="block">
                <span className="field-label">启动命令（逗号分隔）</span>
                <input
                  value={(u.command ?? []).join(", ")}
                  onChange={(event) =>
                    update(i, {
                      command: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                  className="field-input font-mono text-xs sm:text-sm"
                  placeholder="npx, -y, your-mcp-package"
                />
                <p className="field-help">按逗号拆分。</p>
              </label>

              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block">
                  <span className="field-label">工作目录</span>
                  <input
                    value={u.cwd ?? ""}
                    onChange={(event) => update(i, { cwd: event.target.value || null })}
                    className="field-input"
                    placeholder="/path/to/project"
                  />
                </label>
                <label className="block">
                  <span className="field-label">超时时间（毫秒）</span>
                  <input
                    type="number"
                    value={u.timeoutMs ?? 30000}
                    onChange={(event) => update(i, { timeoutMs: Number(event.target.value) })}
                    className="field-input"
                  />
                </label>
              </div>

              <JsonTextArea
                label="环境变量"
                value={u.env}
                placeholder={'{\n  "MCP_AGENT_TOKEN": "..."\n}'}
                onCommit={(value) => update(i, { env: value })}
              />

              <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={u.autoStart ?? true}
                  onChange={(event) => update(i, { autoStart: event.target.checked })}
                />
                启动时自动拉起
              </label>
            </div>
          ) : null}
        </div>
      ))}

      <div className="surface-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="block sm:min-w-[220px]">
            <span className="field-label">新增来源类型</span>
            <select
              value={addKind}
              onChange={(event) => setAddKind(event.target.value as "direct-http" | "local-stdio")}
              className="field-select"
            >
              <option value="direct-http">远程 HTTP</option>
              <option value="local-stdio">命令启动</option>
            </select>
          </label>
          <button onClick={add} className="button-primary">
            添加来源
          </button>
        </div>
      </div>
    </div>
  );
}
