import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type TokenMeta } from "../api/client";
import { buildClientConfigSnippets, getWorkspaceConfigUrl } from "../utils/clientConfigs";
import { formatDateTime } from "../utils/format";
import { StatusBadge } from "./ConsolePrimitives";

type Props = {
  workspaceId: string;
  tokens: TokenMeta[];
};

function formatTokenLabel(clientTitle: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${clientTitle} ${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function ClientConfigSection({ workspaceId, tokens }: Props) {
  const queryClient = useQueryClient();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionTokenMeta, setSessionTokenMeta] = useState<TokenMeta | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);

  const activeTokens = [...tokens]
    .filter((token) => !token.revokedAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const revokedTokens = [...tokens]
    .filter((token) => token.revokedAt)
    .sort((left, right) => (right.revokedAt ?? "").localeCompare(left.revokedAt ?? ""));
  const isPrivate = activeTokens.length > 0 || Boolean(sessionToken);
  const snippets = buildClientConfigSnippets({
    workspaceId,
    hasToken: isPrivate,
    tokenValue: sessionToken,
  });
  const initialSnippet = snippets[0]!;
  const [activeId, setActiveId] = useState<(typeof snippets)[number]["id"]>(initialSnippet.id);

  const activeSnippet = snippets.find((item) => item.id === activeId) ?? initialSnippet;
  const configUrl = getWorkspaceConfigUrl(workspaceId);

  const createTokenMutation = useMutation({
    mutationFn: (label: string) => api.createToken(workspaceId, { label }),
    onSuccess: (result) => {
      setSessionToken(result.token);
      setSessionTokenMeta(result.meta);
      setTokenCopied(false);
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  const revokeTokenMutation = useMutation({
    mutationFn: (tokenId: string) => api.revokeToken(workspaceId, tokenId),
    onMutate: (tokenId) => {
      setRevokingTokenId(tokenId);
    },
    onSuccess: (_, tokenId) => {
      if (sessionTokenMeta?.id === tokenId) {
        setSessionToken(null);
        setSessionTokenMeta(null);
        setTokenCopied(false);
      }
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onSettled: () => {
      setRevokingTokenId(null);
    },
  });

  function markCopied(id: string) {
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 1500);
  }

  async function copyContent(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      markCopied(id);
    } catch {
      setCopiedId(null);
    }
  }

  async function copyTokenContent(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setTokenCopied(true);
      window.setTimeout(() => {
        setTokenCopied(false);
      }, 1500);
    } catch {
      setTokenCopied(false);
    }
  }

  async function createAndCopyCurrentConfig() {
    try {
      const result = await createTokenMutation.mutateAsync(formatTokenLabel(activeSnippet.title));
      const nextSnippets = buildClientConfigSnippets({
        workspaceId,
        hasToken: true,
        tokenValue: result.token,
      });
      const nextSnippet = nextSnippets.find((item) => item.id === activeId) ?? nextSnippets[0]!;
      await copyContent(nextSnippet.id, nextSnippet.content);
    } catch {
      // 错误由 mutation 状态展示
    }
  }

  return (
    <section className="surface-card p-4 sm:p-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">接入配置</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">选一个客户端，直接复制。需要私有接入时，再给当前客户端单独发一枚令牌。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="info">固定配置地址</StatusBadge>
            <StatusBadge tone="success">线上 npm 包</StatusBadge>
            {isPrivate ? (
              <StatusBadge tone={sessionToken ? "warning" : "neutral"}>{sessionToken ? "已带新令牌" : "私有接入"}</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">公开接入</StatusBadge>
            )}
          </div>
        </div>

        <div className="surface-card-muted flex flex-col gap-3 rounded-[1.75rem] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">配置地址</p>
            <code className="mt-2 block break-all text-xs leading-6 text-slate-900">{configUrl}</code>
          </div>
          {sessionToken ? (
            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">当前配置可直接复制</div>
          ) : isPrivate ? (
            <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">{activeTokens.length} 枚令牌生效中</div>
          ) : (
            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">当前可直接接入</div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {snippets.map((snippet) => {
            const isActive = snippet.id === activeSnippet.id;
            return (
              <button
                key={snippet.id}
                onClick={() => setActiveId(snippet.id)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? "border-slate-950 bg-slate-950 text-white shadow-[0_12px_30px_-18px_rgba(2,6,23,0.9)]"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                }`}
              >
                {snippet.title}
              </button>
            );
          })}
        </div>
      </div>

      {isPrivate && !sessionToken ? (
        <div className="mt-4 overflow-hidden rounded-[1.75rem] border border-amber-200 bg-[linear-gradient(180deg,rgba(255,251,235,0.96),rgba(255,247,ed,0.98))]">
          <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-amber-950">给当前客户端新增一枚独立令牌</p>
                <StatusBadge tone="warning">{activeSnippet.title}</StatusBadge>
              </div>
              <p className="mt-2 text-sm leading-6 text-amber-900">不会影响已经接入的其他客户端。生成后，会自动复制当前选中的配置。</p>
            </div>
            <button onClick={() => void createAndCopyCurrentConfig()} disabled={createTokenMutation.isPending} className="button-primary whitespace-nowrap">
              {createTokenMutation.isPending ? "生成中..." : `新增并复制 ${activeSnippet.title}`}
            </button>
          </div>

          {createTokenMutation.isError ? (
            <p className="border-t border-amber-200/80 px-4 py-3 text-sm text-rose-600 sm:px-5">{(createTokenMutation.error as Error).message}</p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/90 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-slate-950">{activeSnippet.title}</h3>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-500">
                  {activeSnippet.format}
                </span>
                {sessionToken ? <StatusBadge tone="warning">含新令牌</StatusBadge> : null}
                {!sessionToken && isPrivate ? <StatusBadge tone="neutral">需环境变量</StatusBadge> : null}
              </div>
              <p className="mt-1 text-sm text-slate-500">{activeSnippet.fileHint}</p>
              <p className="mt-1 text-xs text-slate-400">{activeSnippet.description}</p>
            </div>
            <button
              type="button"
              onClick={() => copyContent(activeSnippet.id, activeSnippet.content)}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                copiedId === activeSnippet.id
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-950"
              }`}
              aria-label={copiedId === activeSnippet.id ? "已复制当前配置" : "复制当前配置"}
              title={copiedId === activeSnippet.id ? "已复制" : "复制"}
            >
              {copiedId === activeSnippet.id ? (
                <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                  <path d="M4.5 10.5 8 14l7.5-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                  <rect x="6.5" y="5.5" width="9" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M4.5 12.5V6.5a2 2 0 0 1 2-2h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
              <span className="sr-only">{copiedId === activeSnippet.id ? "已复制" : "复制"}</span>
            </button>
          </div>

          <div className="bg-slate-950 px-4 py-4 sm:px-5">
            <pre className="code-block">{activeSnippet.content}</pre>
          </div>
        </div>
      )}

      <details className={`mt-4 rounded-[1.5rem] border px-4 py-3 ${isPrivate ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-slate-50"}`}>
        <summary className={`cursor-pointer list-none text-sm font-medium ${sessionToken ? "text-amber-950" : "text-slate-700"}`}>令牌管理</summary>
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1rem] bg-white px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">生效中</p>
              <p className="mt-2 text-sm text-slate-900">{activeTokens.length} 枚</p>
            </div>
            <div className="rounded-[1rem] bg-white px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">已吊销</p>
              <p className="mt-2 text-sm text-slate-900">{revokedTokens.length} 枚</p>
            </div>
          </div>

          {!activeTokens.length && !sessionToken ? (
            <div className="flex flex-col gap-4 rounded-[1rem] border border-dashed border-slate-300 bg-white px-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-slate-600">如果你不想让任何人都能拉取这份配置，可以先给当前客户端新增一枚私有令牌。</p>
              <button onClick={() => void createAndCopyCurrentConfig()} disabled={createTokenMutation.isPending} className="button-secondary whitespace-nowrap">
                {createTokenMutation.isPending ? "生成中..." : `启用并复制 ${activeSnippet.title}`}
              </button>
            </div>
          ) : null}

          {sessionToken ? (
            <div className="rounded-[1rem] border border-amber-300 bg-white px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">刚生成的令牌</p>
                  <p className="mt-1 text-xs text-slate-500">{sessionTokenMeta?.label ?? "当前客户端"}，仅本次可见。</p>
                </div>
                <button type="button" onClick={() => copyTokenContent(sessionToken)} className="button-secondary px-3 py-1.5 text-xs">
                  {tokenCopied ? "已复制令牌" : "复制令牌"}
                </button>
              </div>
              <code className="mt-3 block break-all text-sm leading-6 text-slate-950">{sessionToken}</code>
              <p className="mt-2 text-xs leading-5 text-slate-500">现在直接复制上面的接入配置即可，不需要另外手填环境变量。</p>
            </div>
          ) : null}

          {activeTokens.length ? (
            <div className="space-y-3">
              {activeTokens.map((token) => {
                const isRevoking = revokingTokenId === token.id && revokeTokenMutation.isPending;
                return (
                  <div key={token.id} className="rounded-[1rem] border border-slate-200 bg-white px-3 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-950">{token.label}</p>
                          <StatusBadge tone="success">生效中</StatusBadge>
                          {sessionTokenMeta?.id === token.id ? <StatusBadge tone="warning">刚生成</StatusBadge> : null}
                        </div>
                        <code className="mt-2 block text-sm text-slate-900">{token.tokenPreview}</code>
                        <p className="mt-2 text-xs text-slate-500">创建于 {formatDateTime(token.createdAt, "未知时间")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => revokeTokenMutation.mutate(token.id)}
                        disabled={revokeTokenMutation.isPending}
                        className="button-ghost whitespace-nowrap px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      >
                        {isRevoking ? "吊销中..." : "吊销这枚令牌"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[1rem] border border-dashed border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">当前还没有生效中的令牌。</div>
          )}

          {revokedTokens.length ? (
            <details className="rounded-[1rem] border border-slate-200 bg-white px-3 py-3">
              <summary className="cursor-pointer list-none text-sm font-medium text-slate-700">查看已吊销令牌</summary>
              <div className="mt-3 space-y-3">
                {revokedTokens.map((token) => (
                  <div key={token.id} className="rounded-[0.9rem] border border-slate-100 bg-slate-50 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-slate-900">{token.label}</p>
                      <StatusBadge tone="neutral">已吊销</StatusBadge>
                    </div>
                    <code className="mt-2 block text-sm text-slate-700">{token.tokenPreview}</code>
                    <p className="mt-2 text-xs text-slate-500">
                      创建于 {formatDateTime(token.createdAt, "未知时间")}，吊销于 {formatDateTime(token.revokedAt, "未知时间")}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </details>

      {createTokenMutation.isError && !isPrivate ? <p className="mt-3 text-sm text-rose-600">{(createTokenMutation.error as Error).message}</p> : null}
      {revokeTokenMutation.isError ? <p className="mt-3 text-sm text-rose-600">{(revokeTokenMutation.error as Error).message}</p> : null}
    </section>
  );
}
