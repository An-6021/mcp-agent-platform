import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { consoleApi, type ToolListItem } from "../api/consoleClient";
import { MetricStrip, StatusBadge, type BadgeTone } from "../components/ConsolePrimitives";
import { BuildIcon, SearchIcon } from "../components/AppIcons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { formatSourceKindLabel } from "../utils/labels";

// ── 工具行 ──────────────────────────────────────────────────────────

function conflictTone(status: string): BadgeTone {
  return status === "name-conflict" ? "danger" : "success";
}

type ToolRowProps = {
  item: ToolListItem;
  onToggle: (sourceId: string, toolName: string, enabled: boolean) => void;
  onRename: (sourceId: string, toolName: string, newName: string) => void;
};

function ToolRow({ item, onToggle, onRename }: ToolRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.exposedName);

  function handleRename() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== item.exposedName) {
      onRename(item.sourceId, item.originalName, trimmed);
    }
    setEditing(false);
  }

  return (
    <motion.tr 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={`group border-t border-[#eaeaea] transition hover:bg-[#fafafa] ${!item.enabled ? "opacity-40" : ""}`}
    >
      <td className="px-4 py-2.5">
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") { setDraft(item.exposedName); setEditing(false); } }}
            className="field-input py-1 text-[13px]"
            autoFocus
          />
        ) : (
          <div>
            <button
              onClick={() => { setDraft(item.exposedName); setEditing(true); }}
              className="text-left text-[13px] font-medium text-[#111] hover:text-[#0070f3] transition"
              title="点击重命名"
            >
              {item.exposedName}
            </button>
            {item.originalName !== item.exposedName && (
              <p className="mt-0.5 font-mono text-[11px] text-[#999]">{item.originalName}</p>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5">
        <p className="text-[13px] text-[#111]">{item.sourceName}</p>
        <p className="text-[11px] text-[#999]">{formatSourceKindLabel(item.sourceKind)}</p>
      </td>
      <td className="px-4 py-2.5">
        <p className="text-[12px] text-[#999] line-clamp-1 max-w-[200px]">{item.description || "—"}</p>
      </td>
      <td className="px-4 py-2.5">
        {item.conflictStatus === "name-conflict" ? (
          <StatusBadge tone={conflictTone(item.conflictStatus)}>冲突</StatusBadge>
        ) : null}
      </td>
      <td className="px-4 py-2.5">
        <button
          onClick={() => onToggle(item.sourceId, item.originalName, !item.enabled)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${item.enabled ? "bg-[#111]" : "bg-[#eaeaea]"}`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${item.enabled ? "translate-x-4" : "translate-x-0"}`} />
        </button>
      </td>
    </motion.tr>
  );
}

// ── 主页面 ──────────────────────────────────────────────────────────

export function ToolsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterEnabled, setFilterEnabled] = useState("");
  const [filterConflict, setFilterConflict] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["console-tools"],
    queryFn: () => consoleApi.listTools(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ sourceId, toolName, input }: { sourceId: string; toolName: string; input: { exposedName?: string; enabled?: boolean } }) =>
      consoleApi.updateTool(sourceId, toolName, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["console-tools"] }),
  });

  const rebuildMutation = useMutation({
    mutationFn: () => consoleApi.rebuildTools(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["console-tools"] }),
  });

  const allItems = data?.items ?? [];
  const summary = data?.summary ?? { exposedToolCount: 0, hiddenToolCount: 0, conflictToolCount: 0, sourceCount: 0 };

  const sourceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of allItems) {
      map.set(item.sourceId, item.sourceName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allItems]);

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (filterSource && item.sourceId !== filterSource) return false;
      if (filterEnabled === "true" && !item.enabled) return false;
      if (filterEnabled === "false" && item.enabled) return false;
      if (filterConflict && item.conflictStatus !== "name-conflict") return false;
      if (search) {
        const keyword = search.toLowerCase();
        const haystack = [item.exposedName, item.originalName, item.sourceName].join(" ").toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
  }, [allItems, filterSource, filterEnabled, filterConflict, search]);

  if (isLoading) return <p className="pt-12 text-center text-[13px] text-[#999]">加载中...</p>;
  if (error) return <p className="pt-12 text-center text-[13px] text-[#e00]">{(error as Error).message}</p>;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="flex flex-col gap-6"
    >
      {/* 标题行 */}
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold tracking-tight text-[#111]">Tools</h1>
        <button onClick={() => rebuildMutation.mutate()} disabled={rebuildMutation.isPending} className="button-secondary gap-1.5">
          <BuildIcon className="h-3.5 w-3.5" />
          {rebuildMutation.isPending ? "重建中..." : "重建索引"}
        </button>
      </div>

      {/* 统计 */}
      <MetricStrip
        items={[
          { label: "已暴露", value: String(summary.exposedToolCount), tone: "accent" },
          { label: "已隐藏", value: String(summary.hiddenToolCount) },
          { label: "冲突", value: String(summary.conflictToolCount), tone: summary.conflictToolCount > 0 ? "warning" : "default" },
          { label: "来源", value: String(summary.sourceCount) },
        ]}
      />

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#999]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="field-input max-w-[180px] py-1.5 pl-8 text-[12px]"
            placeholder="搜索..."
          />
        </div>

        <div className="w-[150px]">
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="h-[30px] text-[12px]">
              <SelectValue placeholder="全部来源" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部来源</SelectItem>
              {sourceOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>{opt.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[100px]">
          <Select value={filterEnabled} onValueChange={setFilterEnabled}>
            <SelectTrigger className="h-[30px] text-[12px]">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="true">启用</SelectItem>
              <SelectItem value="false">禁用</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-1.5 text-[12px] text-[#666]">
          <input
            type="checkbox"
            checked={filterConflict}
            onChange={(e) => setFilterConflict(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-[#ddd]"
          />
          仅冲突
        </label>
        <span className="ml-auto text-[11px] text-[#999]">
          {filteredItems.length}/{allItems.length}
        </span>
      </div>

      {/* 表格 */}
      <section className="surface-card overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-[#999]">
            {allItems.length === 0 ? "暂无工具" : "无匹配结果"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#eaeaea]">
                  <th className="table-head-cell">暴露名</th>
                  <th className="table-head-cell">来源</th>
                  <th className="table-head-cell">描述</th>
                  <th className="table-head-cell">冲突</th>
                  <th className="table-head-cell w-[60px]" />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {filteredItems.map((item) => (
                    <ToolRow
                      key={`${item.sourceId}:${item.originalName}`}
                      item={item}
                      onToggle={(sourceId, toolName, enabled) =>
                        updateMutation.mutate({ sourceId, toolName, input: { enabled } })
                      }
                      onRename={(sourceId, toolName, newName) =>
                        updateMutation.mutate({ sourceId, toolName, input: { exposedName: newName } })
                      }
                    />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </motion.div>
  );
}
