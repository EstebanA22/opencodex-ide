# OpenCodex IDE

Multi-agent sidebar extension for **Cursor / VS Code** that talks to a local [`opencodex`](https://www.npmjs.com/package/@bitkyc08/opencodex) proxy.

- Does **not** modify Continue
- Does **not** require Cursor Settings → Models override
- Uses `http://127.0.0.1:10100/v1`

## Features

- **Active file + selection context** injected into every agent turn
- **Multiple agents** with roles: coder, reviewer, architect, debugger, researcher, custom
- **Team mode**: run enabled agents in parallel, then an **Orchestrator** synthesizes
- Per-agent model picker from the live proxy catalog
- Status bar health + dashboard shortcut
- Editor context menu: **OpenCodex: Send Selection To Agent**

## Prerequisites

```bash
npm install -g @bitkyc08/opencodex
ocx service install
ocx service start
ocx health
```

## Install (from VSIX)

```bash
npm install
npm run compile
npx vsce package --no-dependencies
cursor --install-extension ./opencodex-ide-0.2.0.vsix
```

Then reload Cursor and open the **OpenCodex** activity-bar icon.

## Configure

Optional settings:

| Setting | Default |
|--------|---------|
| `opencodex.baseUrl` | `http://127.0.0.1:10100/v1` |
| `opencodex.apiKey` | `dummy` |
| `opencodex.defaultModel` | `gpt-5.6-sol` |

## Test

With the proxy running:

```bash
npm run test:smoke
```

## Usage

1. Keep `ocx` healthy
2. Open the OpenCodex sidebar
3. Enable the agents you want
4. Choose **Single agent** or **Team + Orchestrator**
5. Send a task (`Cmd/Ctrl+Enter`)

## License

MIT
