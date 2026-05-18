import { useState, type FocusEvent } from "react";
import {
  DEFAULT_CLIENT_CONFIG_VARIANT,
  findClientConfigSnippet,
  getClientConfigVariants,
  type ClientConfigFormat,
  type ClientConfigSnippet,
  type ClientConfigVariantId,
} from "../utils/clientConfigs";
import { CheckIcon, CopyIcon } from "./AppIcons";

type Props = {
  format: ClientConfigFormat;
  snippets: ClientConfigSnippet[];
  copiedVariantId?: ClientConfigVariantId | null;
  disabled?: boolean;
  compact?: boolean;
  onCopy: (variantId: ClientConfigVariantId) => void;
};

export function ClientConfigCopyMenu({
  format,
  snippets,
  copiedVariantId = null,
  disabled = false,
  compact = false,
  onCopy,
}: Props) {
  const [open, setOpen] = useState(false);
  const defaultSnippet = findClientConfigSnippet(snippets, format, DEFAULT_CLIENT_CONFIG_VARIANT);
  const variants = getClientConfigVariants(snippets, format);
  const isDisabled = disabled || !defaultSnippet;
  const copied = Boolean(copiedVariantId);
  const label = copied ? "已复制" : `复制 ${defaultSnippet?.title ?? format.toUpperCase()}`;
  const sizeClass = compact ? "text-[12px]" : "";

  function handleCopy(variantId: ClientConfigVariantId) {
    setOpen(false);
    onCopy(variantId);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (!nextTarget || !event.currentTarget.contains(nextTarget as Node)) {
      setOpen(false);
    }
  }

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={handleBlur}
    >
      <button
        type="button"
        disabled={isDisabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => handleCopy(DEFAULT_CLIENT_CONFIG_VARIANT)}
        className={`button-secondary gap-1.5 ${sizeClass} ${copied ? "!border-emerald-200 !bg-emerald-50 !text-emerald-700" : ""}`}
      >
        {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
        {label}
      </button>

      {open && variants.length > 1 && !isDisabled ? (
        <div className="absolute right-0 top-full z-30 w-52 pt-1" role="menu">
          <div className="rounded-lg border border-[#e6e6e6] bg-white p-1.5 shadow-lg">
            {variants.map((snippet) => {
              const isCopied = copiedVariantId === snippet.variantId;
              return (
                <button
                  key={`${snippet.id}:${snippet.variantId}`}
                  type="button"
                  role="menuitem"
                  onClick={() => handleCopy(snippet.variantId)}
                  className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition hover:bg-[#f6f6f6] focus:bg-[#f6f6f6] focus:outline-none"
                >
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-[#555]">
                    {isCopied ? <CheckIcon className="h-3.5 w-3.5 text-emerald-600" /> : <CopyIcon className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#111]">
                      {snippet.variantTitle}
                      {snippet.recommended ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                          推荐
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-[#777]">{snippet.variantDescription}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
