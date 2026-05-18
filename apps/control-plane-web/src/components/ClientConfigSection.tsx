import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import {
  buildClientConfigSnippets,
  findClientConfigSnippet,
  type ClientConfigFormat,
  type ClientConfigVariantId,
} from "../utils/clientConfigs";
import { ClientConfigCopyMenu } from "./ClientConfigCopyMenu";

type Props = {
  workspaceId: string;
};

export function ClientConfigSection({ workspaceId }: Props) {
  const queryClient = useQueryClient();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const snippets = buildClientConfigSnippets({ workspaceId, token: generatedToken ?? undefined });

  function buildCopyKey(format: ClientConfigFormat, variantId: ClientConfigVariantId) {
    return `${format}:${variantId}`;
  }

  function getCopiedVariant(format: ClientConfigFormat): ClientConfigVariantId | null {
    const [copiedFormat, copiedVariant] = copiedKey?.split(":") ?? [];
    return copiedFormat === format ? (copiedVariant as ClientConfigVariantId) : null;
  }

  function markCopied(key: string) {
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
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

  async function copyContent(format: ClientConfigFormat, variantId: ClientConfigVariantId) {
    try {
      setCopyError(null);
      const token = await ensureToken();
      const snippet = findClientConfigSnippet(buildClientConfigSnippets({ workspaceId, token }), format, variantId);
      if (!snippet) {
        throw new Error("未找到可复制的配置");
      }
      await navigator.clipboard.writeText(snippet.content);
      markCopied(buildCopyKey(format, variantId));
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "复制失败");
      setCopiedKey(null);
    }
  }

  const tomlSnippet = findClientConfigSnippet(snippets, "toml");
  const jsonSnippet = findClientConfigSnippet(snippets, "json");

  return (
    <section className="surface-card px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#111]">客户端配置</p>
          <p className="mt-1 text-[13px] text-[#666]">复制后直接粘贴到对应配置文件。</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {tomlSnippet ? (
            <ClientConfigCopyMenu
              format="toml"
              snippets={snippets}
              copiedVariantId={getCopiedVariant("toml")}
              onCopy={(variantId) => void copyContent("toml", variantId)}
            />
          ) : null}
          {jsonSnippet ? (
            <ClientConfigCopyMenu
              format="json"
              snippets={snippets}
              copiedVariantId={getCopiedVariant("json")}
              onCopy={(variantId) => void copyContent("json", variantId)}
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
