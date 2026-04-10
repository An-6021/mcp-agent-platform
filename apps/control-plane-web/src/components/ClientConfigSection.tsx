import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type TokenMeta } from "../api/client";
import { buildClientConfigSnippets } from "../utils/clientConfigs";
import { CheckIcon, CopyIcon, KeyIcon, TrashIcon } from "./AppIcons";

type Props = {
  workspaceId: string;
  tokens: TokenMeta[];
};

function formatTokenLabel() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `私有访问 ${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function ConfigBlock({
  title,
  fileHint,
  content,
  copied,
  onCopy,
}: {
  title: string;
  fileHint: string;
  content: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-950">{title}</p>
          <p className="mt-1 text-xs text-slate-500">{fileHint}</p>
        </div>
        <button
          type="button"
          onClick={onCopy}
          title={copied ? "已复制" : "复制"}
          aria-label={copied ? "已复制" : "复制"}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-all active:scale-95 ${
            copied
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
          }`}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>

      <div className="rounded-b-[1.5rem] bg-slate-950 px-4 py-4 sm:px-5">
        <pre className="code-block">{content}</pre>
      </div>
    </div>
  );
}

export function ClientConfigSection({ workspaceId, tokens }: Props) {
  const queryClient = useQueryClient();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionTokenMeta, setSessionTokenMeta] = useState<TokenMeta | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  const activeTokens = [...tokens]
    .filter((token) => !token.revokedAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const isPrivate = activeTokens.length > 0 || Boolean(sessionToken);
  const snippets = buildClientConfigSnippets({
    workspaceId,
    hasToken: isPrivate,
    tokenValue: sessionToken,
  });
  const tomlSnippet = snippets.find((item) => item.id === "codex")!;
  const jsonSnippet = snippets.find((item) => item.id === "claude-code")!;

  const createTokenMutation = useMutation({
    mutationFn: () => api.createToken(workspaceId, { label: formatTokenLabel() }),
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
    onSuccess: (_, tokenId) => {
      if (sessionTokenMeta?.id === tokenId) {
        setSessionToken(null);
        setSessionTokenMeta(null);
        setTokenCopied(false);
      }
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
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

  return (
    <section className="space-y-4">
      <ConfigBlock
        title="TOML"
        fileHint={tomlSnippet.fileHint}
        content={tomlSnippet.content}
        copied={copiedId === "toml"}
        onCopy={() => void copyContent("toml", tomlSnippet.content)}
      />

      <ConfigBlock
        title="JSON"
        fileHint="Claude Code 的 MCP JSON / .cursor/mcp.json"
        content={jsonSnippet.content}
        copied={copiedId === "json"}
        onCopy={() => void copyContent("json", jsonSnippet.content)}
      />

      <details className="surface-card px-4 py-3 sm:px-5">
        <summary className="cursor-pointer list-none text-sm font-medium text-slate-700">私有</summary>
        <div className="mt-4 space-y-4">
          <button
            onClick={() => createTokenMutation.mutate()}
            disabled={createTokenMutation.isPending}
            title="生成私有令牌"
            aria-label="生成私有令牌"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <KeyIcon />
          </button>

          {sessionToken ? (
            <div className="rounded-[1rem] border border-amber-300 bg-white px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-950">刚生成的令牌</p>
                <button
                  type="button"
                  onClick={() => copyTokenContent(sessionToken)}
                  title={tokenCopied ? "已复制令牌" : "复制令牌"}
                  aria-label={tokenCopied ? "已复制令牌" : "复制令牌"}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-all active:scale-95 ${
                    tokenCopied
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                >
                  {tokenCopied ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
              <code className="mt-3 block break-all text-sm leading-6 text-slate-950">{sessionToken}</code>
            </div>
          ) : null}

          {activeTokens.map((token) => (
            <div key={token.id} className="rounded-[1rem] border border-slate-200 bg-white px-3 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-950">{token.label}</p>
                  <code className="mt-2 block text-sm text-slate-700">{token.tokenPreview}</code>
                </div>
                <button
                  type="button"
                  onClick={() => revokeTokenMutation.mutate(token.id)}
                  disabled={revokeTokenMutation.isPending}
                  title="吊销"
                  aria-label="吊销"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 transition-all hover:bg-rose-50 hover:text-rose-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}

          {createTokenMutation.isError ? <p className="text-sm text-rose-600">{(createTokenMutation.error as Error).message}</p> : null}
          {revokeTokenMutation.isError ? <p className="text-sm text-rose-600">{(revokeTokenMutation.error as Error).message}</p> : null}
        </div>
      </details>
    </section>
  );
}
