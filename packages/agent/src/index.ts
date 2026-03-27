import { runAgentRuntime } from "@mcp-agent-platform/runtime";
import { loadWorkspaceConfig, type LoadWorkspaceConfigOptions } from "./loadWorkspaceConfig";

export async function runAgent(options: LoadWorkspaceConfigOptions): Promise<void> {
  const loaded = await loadWorkspaceConfig(options);
  process.stderr.write(
    `[mcp-agent-platform] workspace=${loaded.config.workspaceId} source=${loaded.source} cache=${loaded.cacheFile}\n`,
  );
  await runAgentRuntime(loaded.config);
}

export * from "./cache";
export * from "./cliOptions";
export * from "./loadWorkspaceConfig";
