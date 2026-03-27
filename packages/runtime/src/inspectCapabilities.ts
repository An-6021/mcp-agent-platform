import type { WorkspaceCapabilities, WorkspaceConfig } from "@mcp-agent-platform/shared";
import { UpstreamManager } from "./upstreamManager";

export async function inspectWorkspaceCapabilities(config: WorkspaceConfig): Promise<WorkspaceCapabilities> {
  const upstreams = new UpstreamManager(config.upstreams);
  await upstreams.initialize();

  try {
    return {
      workspaceId: config.workspaceId,
      generatedAt: new Date().toISOString(),
      upstreams: await upstreams.inspectCapabilities(),
    };
  } finally {
    await upstreams.closeAll();
  }
}
