import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { consoleApi, type HostedListItem, type LogEntry } from "../api/consoleClient";
import { MetricStrip, StatusBadge, type BadgeTone } from "../components/ConsolePrimitives";
import { PlayIcon, StopIcon, RestartIcon, LogIcon, CloseIcon } from "../components/AppIcons";
import { formatHostedRuntimeStatusLabel, formatRelativeTime, formatSourceKindLabel } from "../utils/labels";

// ── 状态映射 ────────────────────────────────────────────────────────

function runtimeStatusTone(status: string): BadgeTone {
  switch (status) {
    case "running": return "success";
    case "starting": return "warning";
    case "error": return "danger";
    default: return "neutral";
  }
}

// ── 日志面板 ────────────────────────────────────────────────────────

type LogPanelProps = { sourceId: string; sourceName: string; onClose: () => void };

function LogPanel({ sourceId, sourceName, onClose }: LogPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["console-hosted-logs", sourceId],
    queryFn: () => consoleApi.getHostedLogs(sourceId, 200),
    refetchInterval: 3000,
  });

  function streamColor(stream: LogEntry["stream"]) {
    switch (stream) {
      case "stderr": return "text-red-400";
      case "system": return "text-blue-400";
      default: return "text-[#999]";
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()} 
        className="mx-4 flex h-[75vh] w-full max-w-2xl flex-col rounded-lg border border-[#333] bg-[#000] p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-white">{sourceName}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-[#888] transition-all hover:bg-[#222] hover:text-white active:scale-95">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto rounded-md bg-[#111] p-3">
          {isLoading ? (
            <p className="text-[12px] text-[#666]">加载中...</p>
          ) : !data?.items.length ? (
            <p className="text-[12px] text-[#666]">暂无日志</p>
          ) : (
            <div className="space-y-px font-mono text-[11px] leading-5">
              {data.items.map((entry) => (
                <div key={entry.id} className="flex gap-2">
                  <span className="shrink-0 text-[#444]">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  <span className={`shrink-0 w-10 text-right ${streamColor(entry.stream)}`}>{entry.stream}</span>
                  <span className="text-[#ccc] break-all">{entry.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Hosted 行 ───────────────────────────────────────────────────────

type HostedRowProps = {
  item: HostedListItem;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onViewLogs: (id: string, name: string) => void;
  isPending: boolean;
};

function HostedRow({ item, onStart, onStop, onRestart, onViewLogs, isPending }: HostedRowProps) {
  const isRunning = item.runtimeStatus === "running";
  const isStopped = item.runtimeStatus === "stopped";

  return (
    <motion.tr 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="group border-t border-[#eaeaea] transition hover:bg-[#fafafa]"
    >
      <td className="px-4 py-2.5">
        <p className="text-[13px] font-medium text-[#111]">{item.name}</p>
        <p className="mt-0.5 font-mono text-[11px] text-[#999]">{item.sourceId}</p>
      </td>
      <td className="px-4 py-2.5">
        <StatusBadge tone="neutral">{formatSourceKindLabel(item.kind)}</StatusBadge>
      </td>
      <td className="px-4 py-2.5">
        <StatusBadge tone={runtimeStatusTone(item.runtimeStatus)}>
          {formatHostedRuntimeStatusLabel(item.runtimeStatus)}
        </StatusBadge>
      </td>
      <td className="px-4 py-2.5">
        <div className="space-y-1">
          <StatusBadge tone={item.autoStart ? "success" : "neutral"}>
            {item.autoStart ? "已开启" : "未开启"}
          </StatusBadge>
          <p className="text-[11px] text-[#999]">{item.startedAt ? `最近启动 ${formatRelativeTime(item.startedAt)}` : "尚未启动"}</p>
        </div>
      </td>
      <td className="px-4 py-2.5">
        {item.lastError ? (
          <p className="max-w-[160px] truncate text-[11px] text-[#e00]" title={item.lastError}>{item.lastError}</p>
        ) : (
          <span className="text-[11px] text-[#ccc]">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100">
          {isStopped ? (
            <button onClick={() => onStart(item.sourceId)} disabled={isPending} className="rounded-md p-1.5 text-[#0a7d41] transition-all hover:bg-[#dcfce7] active:scale-95 disabled:pointer-events-none disabled:opacity-30" title="启动">
              <PlayIcon className="h-4 w-4" />
            </button>
          ) : isRunning ? (
            <>
              <button onClick={() => onStop(item.sourceId)} disabled={isPending} className="rounded-md p-1.5 text-[#888] transition-all hover:bg-[#eaeaea] hover:text-[#111] active:scale-95 disabled:pointer-events-none disabled:opacity-30" title="停止">
                <StopIcon className="h-4 w-4" />
              </button>
              <button onClick={() => onRestart(item.sourceId)} disabled={isPending} className="rounded-md p-1.5 text-[#9a6700] transition-all hover:bg-[#fef3c7] active:scale-95 disabled:pointer-events-none disabled:opacity-30" title="重启">
                <RestartIcon className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button onClick={() => onStart(item.sourceId)} disabled={isPending} className="rounded-md p-1.5 text-[#0a7d41] transition-all hover:bg-[#dcfce7] active:scale-95 disabled:pointer-events-none disabled:opacity-30" title="启动">
              <PlayIcon className="h-4 w-4" />
            </button>
          )}
          <button onClick={() => onViewLogs(item.sourceId, item.name)} className="rounded-md p-1.5 text-[#888] transition-all hover:bg-[#eaeaea] hover:text-[#111] active:scale-95" title="日志">
            <LogIcon className="h-4 w-4" />
          </button>
        </div>
      </td>
    </motion.tr>
  );
}

// ── 主页面 ──────────────────────────────────────────────────────────

export function HostedPage() {
  const queryClient = useQueryClient();
  const [logTarget, setLogTarget] = useState<{ sourceId: string; name: string } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["console-hosted"],
    queryFn: consoleApi.listHosted,
  });

  const actionMutation = useMutation({
    mutationFn: ({ sourceId, action }: { sourceId: string; action: "start" | "stop" | "restart" }) => {
      switch (action) {
        case "start": return consoleApi.startHosted(sourceId);
        case "stop": return consoleApi.stopHosted(sourceId);
        case "restart": return consoleApi.restartHosted(sourceId);
      }
    },
    onMutate: ({ sourceId }) => setPendingId(sourceId),
    onSettled: () => {
      setPendingId(null);
      queryClient.invalidateQueries({ queryKey: ["console-hosted"] });
    },
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
      <h1 className="text-[20px] font-semibold tracking-tight text-[#111]">Hosted</h1>

      {/* 统计 */}
      <MetricStrip
        items={[
          { label: "总数", value: String(summary.total), tone: "accent" },
          { label: "运行中", value: String(summary.running), tone: "success" },
          { label: "已停止", value: String(summary.stopped) },
          { label: "异常", value: String(summary.error), tone: summary.error > 0 ? "warning" : "default" },
        ]}
      />

      {/* 表格 */}
      <section className="surface-card overflow-hidden">
        {items.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-[#999]">
            暂无托管来源
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#eaeaea]">
                  <th className="table-head-cell">名称</th>
                  <th className="table-head-cell">类型</th>
                  <th className="table-head-cell">状态</th>
                  <th className="table-head-cell">自动启动</th>
                  <th className="table-head-cell">错误</th>
                  <th className="table-head-cell w-[100px]" />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {items.map((item) => (
                    <HostedRow
                      key={item.sourceId}
                      item={item}
                      onStart={(id) => actionMutation.mutate({ sourceId: id, action: "start" })}
                      onStop={(id) => actionMutation.mutate({ sourceId: id, action: "stop" })}
                      onRestart={(id) => actionMutation.mutate({ sourceId: id, action: "restart" })}
                      onViewLogs={(id, name) => setLogTarget({ sourceId: id, name })}
                      isPending={pendingId === item.sourceId}
                    />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AnimatePresence>
        {logTarget ? (
          <LogPanel
            sourceId={logTarget.sourceId}
            sourceName={logTarget.name}
            onClose={() => setLogTarget(null)}
          />
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
