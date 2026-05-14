# mcp-hub agent

Local `stdio` MCP agent for `mcp-hub`.

The agent is designed for AI coding tools such as Codex, Claude Code, and OpenCode. It loads workspace configuration from a control-plane API, connects to upstream MCP services from the local machine, and exposes the aggregated tools through one `stdio` MCP server.

- Package: `@a1ua/mcp-hub`
- Repository: <https://github.com/aiua-dev/mcp-hub>
- License: MIT

## Install

```bash
npm install -g @a1ua/mcp-hub
```

Or run it directly:

```bash
npx -y @a1ua/mcp-hub \
  --base-url https://your-control-plane.example.com \
  --workspace mcp-hub \
  --token your-token
```

## Codex Setup

```bash
codex mcp add mcp-hub -- \
  npx -y @a1ua/mcp-hub \
  --base-url https://your-control-plane.example.com \
  --workspace mcp-hub \
  --token your-token
```

Or add the server manually:

```toml
[mcp_servers."mcp-hub"]
type = "stdio"
command = "/bin/sh"
args = ["-lc", "PATH=\"/opt/homebrew/bin:/usr/local/bin:$PATH\"; if [ -d \"$HOME/.nvm/versions/node\" ]; then for dir in \"$HOME\"/.nvm/versions/node/*/bin; do [ -d \"$dir\" ] && PATH=\"$dir:$PATH\"; done; fi; cd \"$HOME\"; exec 'npx' '-y' '@a1ua/mcp-hub' '--base-url' 'https://your-control-plane.example.com' '--workspace' 'mcp-hub' '--token' 'your-token'"]
```

## Config URL Mode

```bash
mcp-hub \
  --config-url https://your-control-plane.example.com/v1/workspaces/mcp-hub/config \
  --workspace mcp-hub \
  --token your-token
```

## Options

| Option | Description |
| --- | --- |
| `--base-url` | Control-plane base URL. The agent resolves `/v1/workspaces/<workspace>/config`. |
| `--config-url` | Full configuration URL. Takes precedence over `--base-url`. |
| `--workspace` | Workspace ID and local cache key. |
| `--token` | Bearer token passed directly on the command line. |
| `--token-env` | Environment variable name used to read the Bearer token. |
| `--cache-dir` | Custom local cache directory. |

## Environment Variables

- `MCP_AGENT_BASE_URL`
- `MCP_AGENT_CONFIG_URL`
- `MCP_AGENT_WORKSPACE`
- `MCP_AGENT_TOKEN`
- `MCP_AGENT_TOKEN_ENV`
- `MCP_AGENT_CACHE_DIR`

## Behavior

- Remote config is preferred when the control plane is reachable.
- The latest successful config is cached locally.
- If the control plane is temporarily unavailable, the agent attempts to start from cache.
- Upstream MCP traffic is handled locally by default; the control plane provides configuration, not a mandatory central proxy.

## License

MIT
