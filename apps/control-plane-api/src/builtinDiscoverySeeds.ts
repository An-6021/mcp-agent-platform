import type { SourceDiscovery } from "@mcp-agent-platform/shared";
import idaProMcpDiscoverySeed from "./builtin/ida-pro-mcp.discovery.json";

const BUILTIN_DISCOVERY_SEEDS: Record<string, SourceDiscovery> = {
  "ida-pro-mcp": idaProMcpDiscoverySeed as SourceDiscovery,
};

function hasCapabilities(discovery: SourceDiscovery | null): boolean {
  if (!discovery) return false;
  return discovery.tools.length > 0 || discovery.resources.length > 0 || discovery.prompts.length > 0;
}

export function resolveBuiltinDiscoverySeed(sourceId: string, discovery: SourceDiscovery | null): SourceDiscovery | null {
  if (hasCapabilities(discovery)) {
    return discovery;
  }

  const seed = BUILTIN_DISCOVERY_SEEDS[sourceId];
  if (!seed) {
    return discovery;
  }

  if (!discovery || discovery.status === "error") {
    return seed;
  }

  return discovery;
}
