/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCAL_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __MCP_AGENT_LOCAL_REPO_ROOT__: string;
declare const __MCP_AGENT_LOCAL_NODE_EXECUTABLE__: string;
declare const __MCP_AGENT_PUBLIC_CONTROL_PLANE_BASE_URL__: string;
