import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type WorkspaceExportProfile } from "../api/client";
import type { SourceListItem } from "../api/consoleClient";
import { CheckIcon, CopyIcon, EditIcon, PlusIcon, TrashIcon } from "./AppIcons";
import { SectionCard, StatusBadge } from "./ConsolePrimitives";
import { buildExportClientConfigSnippets } from "../utils/clientConfigs";
import { formatSourceKindLabel } from "../utils/labels";

type Props = {
  workspaceId: string | null;
  sources: SourceListItem[];
};

type ExportDialogProps = {
  workspaceId: string;
  sources: SourceListItem[];
  initialExport?: WorkspaceExportProfile | null;
  onClose: () => void;
  onSaved: () => void;
};

function buildServerName(value: string, fallback = "export"): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || fallback;
}

function CopyButton({
  title,
  copied,
  onClick,
}: {
  title: string;
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`button-secondary gap-1.5 text-[12px] ${copied ? "!border-emerald-200 !bg-emerald-50 !text-emerald-700" : ""}`}
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
      {copied ? "已复制" : title}
    </button>
  );
}

function ExportDialog({ workspaceId, sources, initialExport, onClose, onSaved }: ExportDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(initialExport);
  const fallbackServerName = initialExport?.id ?? "export";
  const selectableSources = useMemo(
    () =>
      [...sources].sort((left, right) => {
        if (left.enabled !== right.enabled) {
          return left.enabled ? -1 : 1;
        }
        return left.name.localeCompare(right.name, "zh-CN");
      }),
    [sources],
  );
  const defaultSourceIds = useMemo(
    () => selectableSources.filter((item) => item.enabled).map((item) => item.id),
    [selectableSources],
  );
  const [name, setName] = useState(initialExport?.name ?? "");
  const [serverName, setServerName] = useState(initialExport?.serverName ?? "");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(initialExport?.enabledSourceIds ?? defaultSourceIds);
  const [serverNameTouched, setServerNameTouched] = useState(Boolean(initialExport?.serverName));

  useEffect(() => {
    if (initialExport) {
      setName(initialExport.name);
      setServerName(initialExport.serverName);
      setSelectedSourceIds(initialExport.enabledSourceIds);
      setServerNameTouched(true);
      return;
    }

    setSelectedSourceIds(defaultSourceIds);
  }, [defaultSourceIds, initialExport]);

  useEffect(() => {
    if (!initialExport && !name.trim() && selectableSources.length === 1) {
      setName(selectableSources[0]?.name ?? "");
    }
  }, [initialExport, name, selectableSources]);

  useEffect(() => {
    if (!serverNameTouched) {
      setServerName(buildServerName(name, fallbackServerName));
    }
  }, [fallbackServerName, name, serverNameTouched]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        serverName: serverName.trim() || buildServerName(name, fallbackServerName),
        enabledSourceIds: selectedSourceIds,
      };

      if (isEdit && initialExport) {
        return api.updateExport(workspaceId, initialExport.id, payload);
      }

      return api.createExport(workspaceId, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-exports", workspaceId] });
      onSaved();
    },
  });

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((current) =>
      current.includes(sourceId) ? current.filter((item) => item !== sourceId) : [...current, sourceId],
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveMutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <motion.form
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-2xl border border-[#eaeaea] bg-white p-6 shadow-xl"
      >
        <div>
          <h2 className="text-[16px] font-semibold text-[#111]">{isEdit ? "编辑出口" : "新增出口"}</h2>
          <p className="mt-1 text-[13px] text-[#666]">选好要暴露的来源后，复制配置即可直接接入客户端。</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">出口名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="field-input"
              placeholder="例如：IDEA 只读"
              required
            />
          </label>
          <label className="block">
            <span className="field-label">客户端名称</span>
            <input
              value={serverName}
              onChange={(event) => {
                setServerNameTouched(true);
                setServerName(event.target.value);
              }}
              className="field-input font-mono text-xs sm:text-sm"
              placeholder="例如：idea-readonly"
              required
            />
          </label>
        </div>

        <div className="rounded-xl border border-[#eaeaea] bg-[#fafafa] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[#111]">来源开关</p>
              <p className="mt-1 text-[12px] text-[#666]">默认带上当前已启用来源，你只需要把不想暴露的关掉。</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelectedSourceIds(defaultSourceIds)}
                className="button-secondary text-[12px]"
              >
                恢复默认
              </button>
              <button
                type="button"
                onClick={() => setSelectedSourceIds([])}
                className="button-secondary text-[12px]"
              >
                全部关闭
              </button>
            </div>
          </div>

          {selectableSources.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-[#d8d8d8] bg-white px-4 py-6 text-center text-[13px] text-[#777]">
              先添加来源，再创建出口。
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {selectableSources.map((source) => {
                const checked = selectedSourceIds.includes(source.id);
                return (
                  <label
                    key={source.id}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 transition ${
                      checked ? "border-[#111] bg-white shadow-sm" : "border-[#e3e3e3] bg-white hover:border-[#cfcfcf]"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-medium text-[#111]">{source.name}</p>
                        <StatusBadge tone={source.enabled ? "success" : "neutral"}>
                          {source.enabled ? "启用中" : "已停用"}
                        </StatusBadge>
                        <StatusBadge tone="info">{formatSourceKindLabel(source.kind)}</StatusBadge>
                      </div>
                      {source.lastError ? <p className="mt-1 text-[12px] text-[#a3570a]">{source.lastError}</p> : null}
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSource(source.id)}
                      className="h-4 w-4 rounded border-[#c9c9c9] text-[#111] focus:ring-[#111]"
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {saveMutation.error ? (
          <p className="text-[13px] text-rose-600">{(saveMutation.error as Error).message || "保存失败，请稍后再试。"}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="button-secondary">取消</button>
          <button
            type="submit"
            disabled={saveMutation.isPending || !name.trim() || !serverName.trim()}
            className="button-primary"
          >
            {saveMutation.isPending ? "保存中..." : isEdit ? "保存" : "创建"}
          </button>
        </div>
      </motion.form>
    </div>
  );
}

export function ExportProfilesSection({ workspaceId, sources }: Props) {
  const queryClient = useQueryClient();
  const [editingExport, setEditingExport] = useState<WorkspaceExportProfile | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const sourceMap = useMemo(() => new Map(sources.map((item) => [item.id, item])), [sources]);

  const exportsQuery = useQuery({
    queryKey: ["workspace-exports", workspaceId],
    queryFn: () => api.listExports(workspaceId!),
    enabled: Boolean(workspaceId),
  });

  const deleteMutation = useMutation({
    mutationFn: (exportId: string) => api.deleteExport(workspaceId!, exportId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-exports", workspaceId] });
    },
  });

  function markCopied(key: string) {
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1500);
  }

  async function copyConfig(profile: WorkspaceExportProfile, format: "toml" | "json") {
    if (!workspaceId) {
      return;
    }

    try {
      setActionError(null);
      const created = await api.createExportToken(workspaceId, profile.id, {
        label: `${profile.name} Copy ${new Date().toISOString()}`,
      });
      const snippet = buildExportClientConfigSnippets({
        workspaceId,
        exportId: profile.id,
        serverName: profile.serverName,
        token: created.token,
      }).find((item) => item.id === format);

      if (!snippet) {
        throw new Error("未找到可复制的配置");
      }

      await navigator.clipboard.writeText(snippet.content);
      markCopied(`${profile.id}:${format}`);
    } catch (error) {
      setCopiedKey(null);
      setActionError(error instanceof Error ? error.message : "复制失败，请稍后再试。");
    }
  }

  const exports = exportsQuery.data ?? [];

  return (
    <SectionCard
      title="出口"
      description="把来源拆成多个独立入口，每个入口都用自己的客户端名称和令牌。"
      actions={
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          disabled={!workspaceId}
          className="button-primary gap-1.5"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          新增出口
        </button>
      }
    >
      {!workspaceId ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          当前还没有可用服务，先创建工作区后再来拆出口。
        </div>
      ) : exportsQuery.isLoading ? (
        <p className="text-[13px] text-[#666]">正在读取出口...</p>
      ) : exportsQuery.error ? (
        <p className="text-[13px] text-rose-600">{(exportsQuery.error as Error).message || "出口读取失败，请稍后再试。"}</p>
      ) : exports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#d9d9d9] bg-[#fafafa] px-5 py-8 text-center">
          <p className="text-sm font-medium text-[#111]">还没有拆分出口</p>
          <p className="mt-1 text-[13px] text-[#666]">新增一个出口，勾选要保留的来源，然后直接复制配置。</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {exports.map((profile) => {
            const sourcesForProfile = profile.enabledSourceIds
              .map((sourceId) => sourceMap.get(sourceId))
              .filter((item): item is SourceListItem => Boolean(item));
            const missingSourceCount = profile.enabledSourceIds.length - sourcesForProfile.length;

            return (
              <article key={profile.id} className="rounded-2xl border border-[#e6e6e6] bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-[#111]">{profile.name}</h3>
                      <StatusBadge tone="info">{profile.serverName}</StatusBadge>
                    </div>
                    <p className="mt-1 text-[12px] text-[#666]">包含 {profile.enabledSourceIds.length} 个来源</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingExport(profile)}
                      className="rounded-md p-1.5 text-[#888] transition hover:bg-[#f2f2f2] hover:text-[#111]"
                      title="编辑出口"
                    >
                      <EditIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(profile.id)}
                      className="rounded-md p-1.5 text-[#888] transition hover:bg-red-50 hover:text-red-600"
                      title="删除出口"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {sourcesForProfile.map((source) => (
                    <span
                      key={source.id}
                      className="inline-flex items-center rounded-full border border-[#e2e2e2] bg-[#fafafa] px-2.5 py-1 text-[12px] text-[#444]"
                    >
                      {source.name}
                    </span>
                  ))}
                  {missingSourceCount > 0 ? (
                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[12px] text-amber-800">
                      {missingSourceCount} 个来源已不存在
                    </span>
                  ) : null}
                  {profile.enabledSourceIds.length === 0 ? (
                    <span className="inline-flex items-center rounded-full border border-[#e2e2e2] bg-[#fafafa] px-2.5 py-1 text-[12px] text-[#666]">
                      当前未选择来源
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <CopyButton
                    title="复制 TOML"
                    copied={copiedKey === `${profile.id}:toml`}
                    onClick={() => void copyConfig(profile, "toml")}
                  />
                  <CopyButton
                    title="复制 JSON"
                    copied={copiedKey === `${profile.id}:json`}
                    onClick={() => void copyConfig(profile, "json")}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}

      {actionError ? <p className="mt-3 text-[13px] text-rose-600">{actionError}</p> : null}
      {deleteMutation.error ? (
        <p className="mt-3 text-[13px] text-rose-600">{(deleteMutation.error as Error).message || "删除失败，请稍后再试。"}</p>
      ) : null}

      <AnimatePresence>
        {showCreate && workspaceId ? (
          <ExportDialog
            workspaceId={workspaceId}
            sources={sources}
            onClose={() => setShowCreate(false)}
            onSaved={() => setShowCreate(false)}
          />
        ) : null}
        {editingExport && workspaceId ? (
          <ExportDialog
            workspaceId={workspaceId}
            sources={sources}
            initialExport={editingExport}
            onClose={() => setEditingExport(null)}
            onSaved={() => setEditingExport(null)}
          />
        ) : null}
      </AnimatePresence>
    </SectionCard>
  );
}
