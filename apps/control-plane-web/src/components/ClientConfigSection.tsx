import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { buildClientConfigSnippets } from "../utils/clientConfigs";
import { CheckIcon, CopyIcon } from "./AppIcons";

type Props = {
  workspaceId: string;
};

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
      className={`button-secondary gap-1.5 ${
        copied
          ? "!border-emerald-200 !bg-emerald-50 !text-emerald-700"
          : ""
      }`}
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
      {copied ? "已复制" : title}
    </button>
  );
}

export function ClientConfigSection({ workspaceId }: Props) {
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const snippets = buildClientConfigSnippets({ workspaceId, token: generatedToken ?? undefined });

  function markCopied(id: string) {
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 1500);
  }

  async function ensureToken() {
    if (generatedToken) return generatedToken;
    const created = await api.createToken(workspaceId, {
      label: `Config Copy ${new Date().toISOString()}`,
    });
    setGeneratedToken(created.token);
    queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
    return created.token;
  }

  async function copyContent(id: string) {
    try {
      setCopyError(null);
      const token = await ensureToken();
      const snippet = buildClientConfigSnippets({ workspaceId, token }).find((item) => item.id === id);
      if (!snippet) {
        throw new Error("未找到可复制的配置");
      }
      await navigator.clipboard.writeText(snippet.content);
      markCopied(id);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "复制失败");
      setCopiedId(null);
    }
  }

  const tomlSnippet = snippets.find((snippet) => snippet.id === "toml");
  const jsonSnippet = snippets.find((snippet) => snippet.id === "json");

  return (
    <section className="surface-card px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#111]">客户端配置</p>
          <p className="mt-1 text-[13px] text-[#666]">复制后直接粘贴到对应配置文件。</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {tomlSnippet ? (
            <CopyButton
              title="复制 TOML"
              copied={copiedId === "toml"}
              onClick={() => void copyContent("toml")}
            />
          ) : null}
          {jsonSnippet ? (
            <CopyButton
              title="复制 JSON"
              copied={copiedId === "json"}
              onClick={() => void copyContent("json")}
            />
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {tomlSnippet ? (
          <div className="rounded-lg border border-[#eaeaea] bg-white px-4 py-3">
            <p className="text-sm font-semibold text-[#111]">TOML</p>
            <p className="mt-1 text-xs text-[#999]">{tomlSnippet.fileHint}</p>
          </div>
        ) : null}
        {jsonSnippet ? (
          <div className="rounded-lg border border-[#eaeaea] bg-white px-4 py-3">
            <p className="text-sm font-semibold text-[#111]">JSON</p>
            <p className="mt-1 text-xs text-[#999]">{jsonSnippet.fileHint}</p>
          </div>
        ) : null}
      </div>

      {copyError ? <p className="mt-3 text-sm text-rose-600">{copyError}</p> : null}
    </section>
  );
}
