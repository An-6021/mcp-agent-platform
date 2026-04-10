import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { consoleApi, type CreateSourceInput, type SourceKind, type SourceListItem } from "../api/consoleClient";
import { MetricStrip, StatusBadge, type BadgeTone } from "../components/ConsolePrimitives";
import { PlusIcon, RefreshIcon, TrashIcon, ToggleOnIcon, ToggleOffIcon } from "../components/AppIcons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { formatRelativeTime, formatSourceKindLabel, formatSourceStatusLabel } from "../utils/labels";

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

// ── 新增来源弹窗 ────────────────────────────────────────────────────

type AddSourceDialogProps = {
  onClose: () => void;
  onCreated: () => void;
};

const SOURCE_KIND_OPTIONS: { value: SourceKind; label: string }[] = [
  { value: "remote-http", label: "远程 HTTP" },
  { value: "local-stdio", label: "本地命令" },
  { value: "hosted-npm", label: "npm 托管" },
  { value: "hosted-single-file", label: "单文件托管" },
];

function AddSourceDialog({ onClose, onCreated }: AddSourceDialogProps) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SourceKind>("remote-http");
  const [endpoint, setEndpoint] = useState("");
  const [command, setCommand] = useState("");
  const [packageName, setPackageName] = useState("");
  const [binName, setBinName] = useState("");
  const [fileName, setFileName] = useState("");
  const [sourceCode, setSourceCode] = useState("");
  const [runtime, setRuntime] = useState<"node" | "tsx" | "python" | "bash">("node");

  const createMutation = useMutation({
    mutationFn: (input: CreateSourceInput) => consoleApi.createSource(input),
    onSuccess: () => onCreated(),
  });

  function buildConfig() {
    switch (kind) {
      case "remote-http":
        return { endpoint };
      case "local-stdio":
        return { command: command.split(/\s+/).filter(Boolean), cwd: null, env: {} };
      case "hosted-npm":
        return { packageName, binName: binName || packageName, args: [], cwd: null, env: {}, autoStart: false };
      case "hosted-single-file":
        return { fileName: fileName || "server.ts", runtime, source: sourceCode, args: [], cwd: null, env: {}, autoStart: false };
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({ id, name, kind, config: buildConfig() });
  }

  const error = createMutation.error as Error | null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <motion.form
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="mx-4 w-full max-w-lg space-y-4 rounded-lg border border-[#eaeaea] bg-white p-6 shadow-xl"
      >
        <h2 className="text-[15px] font-semibold text-[#111]">新增来源</h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">ID</span>
            <input value={id} onChange={(e) => setId(e.target.value)} className="field-input" placeholder="my-source" required />
          </label>
          <label className="block">
            <span className="field-label">名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="field-input" placeholder="我的来源" required />
          </label>
        </div>

        <label className="block">
          <span className="field-label">类型</span>
          <Select value={kind} onValueChange={(val) => setKind(val as SourceKind)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择类型" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_KIND_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        {kind === "remote-http" && (
          <label className="block">
            <span className="field-label">Endpoint</span>
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="field-input" placeholder="https://..." required />
          </label>
        )}

        {kind === "local-stdio" && (
          <label className="block">
            <span className="field-label">命令</span>
            <input value={command} onChange={(e) => setCommand(e.target.value)} className="field-input" placeholder="npx -y @mcp/server" required />
          </label>
        )}

        {kind === "hosted-npm" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="field-label">包名</span>
              <input value={packageName} onChange={(e) => setPackageName(e.target.value)} className="field-input" placeholder="@scope/package" required />
            </label>
            <label className="block">
              <span className="field-label">bin</span>
              <input value={binName} onChange={(e) => setBinName(e.target.value)} className="field-input" placeholder="可选" />
            </label>
          </div>
        )}

        {kind === "hosted-single-file" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">文件名</span>
                <input value={fileName} onChange={(e) => setFileName(e.target.value)} className="field-input" placeholder="server.ts" />
              </label>
              <label className="block">
                <span className="field-label">运行时</span>
                <Select value={runtime} onValueChange={(val) => setRuntime(val as typeof runtime)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择运行时" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="node">Node</SelectItem>
                    <SelectItem value="tsx">TSX</SelectItem>
                    <SelectItem value="python">Python</SelectItem>
                    <SelectItem value="bash">Bash</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="block">
              <span className="field-label">源代码</span>
              <textarea value={sourceCode} onChange={(e) => setSourceCode(e.target.value)} className="field-textarea font-mono text-xs" placeholder="// MCP server code" required />
            </label>
          </>
        )}

        {error ? <p className="text-[13px] text-[#e00]">{error.message}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="button-secondary">取消</button>
          <button type="submit" disabled={createMutation.isPending} className="button-primary">
            {createMutation.isPending ? "创建中..." : "创建"}
          </button>
        </div>
      </motion.form>
    </div>
  );
}

// ── 来源行 ──────────────────────────────────────────────────────────

type SourceRowProps = {
  item: SourceListItem;
  onRefresh: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  isRefreshing: boolean;
  isBatchRefreshing: boolean;
};

function SourceRow({ item, onRefresh, onToggle, onDelete, isRefreshing, isBatchRefreshing }: SourceRowProps) {
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
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

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

  if (isLoading) return <p className="pt-12 text-center text-[13px] text-[#999]">加载中...</p>;
  if (error) return <p className="pt-12 text-center text-[13px] text-[#e00]">{(error as Error).message}</p>;

  const { items, summary } = data!;

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
          <div className="overflow-x-auto">
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
          <AddSourceDialog
            onClose={() => setShowAdd(false)}
            onCreated={() => {
              setShowAdd(false);
              queryClient.invalidateQueries({ queryKey: ["console-sources"] });
            }}
          />
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
