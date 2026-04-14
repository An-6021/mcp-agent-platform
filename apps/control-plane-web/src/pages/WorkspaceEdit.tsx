import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type UpstreamConfig } from "../api/client";
import { SaveIcon } from "../components/AppIcons";
import { ClientConfigSection } from "../components/ClientConfigSection";
import { UpstreamEditor, collectUpstreamIssues, normalizeUpstreamDraft } from "../components/UpstreamEditor";

export function WorkspaceEdit() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["workspace", id],
    queryFn: () => api.getWorkspace(id!),
    enabled: !!id,
  });

  const [displayName, setDisplayName] = useState("");
  const [cacheTtl, setCacheTtl] = useState(300);
  const [upstreams, setUpstreams] = useState<UpstreamConfig[]>([]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const draft = data.draft;
    const workspace = data.workspace;
    setDisplayName(draft?.displayName ?? workspace.displayName);
    setCacheTtl(draft?.cacheTtlSeconds ?? workspace.cacheTtlSeconds);
    setUpstreams(draft?.upstreams ?? data.publishedConfig?.upstreams ?? []);
  }, [data]);

  const normalizedDisplayName = displayName.trim();
  const normalizedUpstreams = useMemo(() => upstreams.map((upstream, index) => normalizeUpstreamDraft(upstream, index)), [upstreams]);
  const validationIssues = useMemo(
    () => normalizedUpstreams.map((upstream, index) => collectUpstreamIssues(upstream, index)),
    [normalizedUpstreams],
  );

  const applyMutation = useMutation({
    mutationFn: async (input: { displayName: string; cacheTtlSeconds: number; upstreams: UpstreamConfig[] }) => {
      if (!input.displayName) {
        throw new Error("请先填写服务名称");
      }

      const issue = input.upstreams.flatMap((upstream, index) => collectUpstreamIssues(upstream, index))[0];
      if (issue) {
        throw new Error(issue);
      }

      await api.saveDraft(id!, input);
      return api.publish(id!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", id] });
      queryClient.invalidateQueries({ queryKey: ["publishedConfig", id] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  function handleSave() {
    const nextDisplayName = displayName.trim();
    const nextUpstreams = upstreams.map((upstream, index) => normalizeUpstreamDraft(upstream, index));

    setDisplayName(nextDisplayName);
    setUpstreams(nextUpstreams);

    applyMutation.mutate({
      displayName: nextDisplayName,
      cacheTtlSeconds: cacheTtl,
      upstreams: nextUpstreams,
    });
  }

  if (isLoading) {
    return <p className="text-gray-500">加载中...</p>;
  }

  if (!data) {
    return <p className="text-red-500">未找到服务。</p>;
  }

  const actionError = applyMutation.error as Error | null;
  const canShowClientConfig = Boolean(publishedConfig);

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-5">
      <section className="surface-card p-4 sm:p-5">
        <div className="space-y-5">
          <label className="block">
            <span className="field-label">服务名称</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="field-input"
              placeholder="给这个服务起个名字"
            />
          </label>

          <UpstreamEditor upstreams={upstreams} onChange={setUpstreams} validationIssues={validationIssues} />
        </div>
      </section>

      {canShowClientConfig ? <ClientConfigSection workspaceId={data.workspace.id} /> : null}

      <div className="sticky bottom-4 z-20">
        <div className="surface-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-[24px]">{actionError ? <p className="text-sm text-rose-600">{actionError.message}</p> : null}</div>

          <button onClick={handleSave} disabled={applyMutation.isPending} className="button-primary gap-2">
            <SaveIcon />
            {applyMutation.isPending ? "保存中" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
