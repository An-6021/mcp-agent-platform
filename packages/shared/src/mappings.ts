const RESOURCE_URI_PREFIX = "mcp-agent://";

export function prefixName(upstreamId: string, name: string): string {
  return `${upstreamId}.${name}`;
}

export function splitPrefixedName(prefixed: string): { upstreamId: string; name: string } | null {
  const dotIndex = prefixed.indexOf(".");
  if (dotIndex <= 0) return null;
  return { upstreamId: prefixed.slice(0, dotIndex), name: prefixed.slice(dotIndex + 1) };
}

export function encodeResourceUri(upstreamId: string, upstreamUri: string): string {
  const encoded = base64UrlEncodeUtf8(upstreamUri);
  return `${RESOURCE_URI_PREFIX}${upstreamId}/${encoded}`;
}

export function decodeResourceUri(uri: string): { upstreamId: string; upstreamUri: string } | null {
  if (!uri.startsWith(RESOURCE_URI_PREFIX)) return null;
  const rest = uri.slice(RESOURCE_URI_PREFIX.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0) return null;
  const upstreamId = rest.slice(0, slashIndex);
  const encoded = rest.slice(slashIndex + 1);
  if (!encoded) return null;
  try {
    const upstreamUri = base64UrlDecodeUtf8(encoded);
    return { upstreamId, upstreamUri };
  } catch {
    return null;
  }
}

function base64UrlEncodeUtf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const base64 = toBase64(bytes);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeUtf8(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const bytes = fromBase64(padded);
  return new TextDecoder().decode(bytes);
}

function toBase64(bytes: Uint8Array): string {
  const buffer = globalThis.Buffer as undefined | { from(data: Uint8Array): { toString(enc: string): string } };
  if (buffer) return buffer.from(bytes).toString("base64");

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const buffer = globalThis.Buffer as undefined | { from(data: string, enc: string): Uint8Array };
  if (buffer) return buffer.from(base64, "base64");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

