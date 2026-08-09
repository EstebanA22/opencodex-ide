# OpenCodex IDE

Multi-agent sidebar for **Cursor / VS Code** talking to a local [`opencodex`](https://www.npmjs.com/package/@bitkyc08/opencodex) proxy.

Does **not** modify Continue. Does **not** require Cursor Models override.

## Features (v0.3.0)

- Active file / selection / diagnostics / git diff / AGENTS.md memory
- `@file` `@selection` `@folder:` `@diff` `@diagnostics` `@memory` mentions
- Multiple agents + presets (PR Review, Bug Hunt, Feature Slice, Security Pass, Debate)
- Modes: Single · Team+Orchestrator · Pipeline · Debate
- Tools with approval (`read_file`, `grep`, `git_*`, `terminal`, `run_tests`)
- Apply path:file blocks · Insert · Copy · Inline edit
- Sessions, export markdown, queue, stop/regen, scorecard
- Metrics (latency / approx tokens / failover) + redacted audit log
- SecretStorage for API keys · secret redaction · sensitive path blocking

## Prerequisites

```bash
npm install -g @bitkyc08/opencodex
ocx service start
ocx health
```

## Install

Download the VSIX from [Releases](https://github.com/EstebanA22/opencodex-ide/releases) or build:

```bash
npm ci
npm run compile
npm run test:security
npx vsce package --no-dependencies
cursor --install-extension ./opencodex-ide-0.3.0.vsix
```

Reload Cursor → open the **OpenCodex** activity-bar icon.

## Security

See [SECURITY.md](./SECURITY.md). Use **OpenCodex: Set API Key (SecretStorage)** for non-dummy keys.

## Tests

```bash
npm run test:security
npm run test:smoke   # requires local proxy
```

## License

MIT
