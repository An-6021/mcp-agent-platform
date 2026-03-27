/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCAL_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __MCP_AGENT_LOCAL_REPO_ROOT__: string;
declare const __MCP_AGENT_LOCAL_NODE_EXECUTABLE__: string;
