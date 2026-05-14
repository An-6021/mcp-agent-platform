# mcp-hub

`mcp-hub` is a lightweight control plane and local `stdio` agent for managing MCP sources across AI coding tools.

It lets Codex, Claude Code, OpenCode, and other MCP clients connect to one local agent while the actual upstream MCP services are configured from a remote control plane.

- npm package: `@a1ua/mcp-hub`
- Repository: <https://github.com/aiua-dev/mcp-hub>
- License: MIT

## Overview

MCP tools are often installed and configured per client. As the number of tools grows, keeping every local client in sync becomes repetitive and error-prone.

`mcp-hub` separates the system into two parts:

- **Local agent**
  - Runs as a `stdio` MCP server.
  - Loads workspace configuration from a control-plane API.
  - Connects to upstream MCP services from the local machine.
  - Falls back to cached configuration when the control plane is temporarily unavailable.
- **Control plane**
  - Maintains MCP sources, exposed tools, and hosted source definitions.
  - Provides configuration endpoints for local agents.
  - Includes a web console for managing sources and copied client configs.

## Features

- One local `stdio` entrypoint for multiple MCP clients.
- Remote workspace configuration with local cache fallback.
- Tool naming and exposure control.
- Support for multiple upstream source types:
  - `direct-http`
  - `local-stdio`
  - `hosted-npm`
  - `hosted-single-file`
- Codex-friendly TOML output with explicit `type = "stdio"`.
- Shell-wrapped `npx` command generation for GUI clients with limited `$PATH`.
- Optional export profiles for exposing different source sets as separate MCP servers.

## Install

Use the published local agent directly with `npx`:

```bash
npx -y @a1ua/mcp-hub \
  --base-url https://your-control-plane.example.com \
  --workspace mcp-hub \
  --token your-token
```

Or install it globally:

```bash
npm install -g @a1ua/mcp-hub
```

## Client Setup

### Codex

```bash
codex mcp add mcp-hub -- \
  npx -y @a1ua/mcp-hub \
  --base-url https://your-control-plane.example.com \
  --workspace mcp-hub \
  --token your-token
```

You can also write the server configuration directly:

```toml
[mcp_servers."mcp-hub"]
type = "stdio"
command = "/bin/sh"
args = ["-lc", "PATH=\"/opt/homebrew/bin:/usr/local/bin:$PATH\"; if [ -d \"$HOME/.nvm/versions/node\" ]; then for dir in \"$HOME\"/.nvm/versions/node/*/bin; do [ -d \"$dir\" ] && PATH=\"$dir:$PATH\"; done; fi; cd \"$HOME\"; exec 'npx' '-y' '@a1ua/mcp-hub' '--base-url' 'https://your-control-plane.example.com' '--workspace' 'mcp-hub' '--token' 'your-token'"]
```

### Config URL Mode

Use `--config-url` when the control plane gives you a full workspace or export config endpoint:

```bash
npx -y @a1ua/mcp-hub \
  --config-url https://your-control-plane.example.com/v1/workspaces/mcp-hub/config \
  --workspace mcp-hub \
  --token your-token
```

## CLI Options

| Option | Description |
| --- | --- |
| `--base-url` | Control-plane base URL. The agent resolves `/v1/workspaces/<workspace>/config`. |
| `--config-url` | Full configuration URL. Takes precedence over `--base-url`. |
| `--workspace` | Workspace ID and local cache key. |
| `--token` | Bearer token passed directly on the command line. |
| `--token-env` | Environment variable name used to read the Bearer token. |
| `--cache-dir` | Custom local cache directory. |

The same settings can also be supplied through environment variables:

- `MCP_AGENT_BASE_URL`
- `MCP_AGENT_CONFIG_URL`
- `MCP_AGENT_WORKSPACE`
- `MCP_AGENT_TOKEN`
- `MCP_AGENT_TOKEN_ENV`
- `MCP_AGENT_CACHE_DIR`

## Project Structure

```text
.
├── apps
│   ├── control-plane-api     # Fastify API and hosted-source runtime management
│   └── control-plane-web     # React control-plane console
├── packages
│   ├── agent                 # Published local stdio agent
│   ├── runtime               # MCP aggregation runtime
│   └── shared                # Shared schemas and config mapping
└── docs                      # Architecture and product notes
```

## Development

Install dependencies:

```bash
pnpm install
```

Run the development helper:

```bash
pnpm go
```

Run API and web console separately:

```bash
pnpm dev:api
pnpm dev:web
```

Run checks:

```bash
pnpm -r test
pnpm build
```

## Control-Plane Contract

The local agent expects a workspace config endpoint that returns a JSON workspace configuration.

With `--base-url https://your-control-plane.example.com --workspace mcp-hub`, the agent requests:

```text
https://your-control-plane.example.com/v1/workspaces/mcp-hub/config
```

With export profiles, the control plane can provide separate config URLs for different MCP server views.

## Current Scope

`mcp-hub` focuses on local MCP aggregation and configuration delivery. It is not intended to be a multi-tenant SaaS backend out of the box.

The current implementation is best suited for:

- personal MCP workspaces,
- small team tool setups,
- self-hosted control planes,
- experiments with hosted or generated MCP sources.

## Roadmap

- Improve the public setup wizard and install documentation.
- Expand hosted-source lifecycle management.
- Add more automated coverage around source discovery and export profiles.
- Refine the web console for clearer source, tool, and export workflows.

## License

MIT
