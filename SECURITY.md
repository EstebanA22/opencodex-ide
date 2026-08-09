# Security

OpenCodex IDE is designed for a **local loopback proxy**. Still:

## Credentials

- Prefer **Command Palette → OpenCodex: Set API Key (SecretStorage)**.
- Do **not** put real secrets in `settings.json` (`opencodex.apiKey` is a fallback for `dummy` only).
- API keys are never written to the webview, audit log, or exported sessions.
- Outbound `Authorization` headers use SecretStorage / fallback; responses and prompts are redacted for common secret patterns.

## Prompt / context guards

- Blocks reading/sending `.env*`, `*.pem`, `id_rsa`, credential filenames, etc.
- Rejects path traversal (`..`) for file tools and Apply.
- Redacts tokens resembling OpenAI/GitHub/Slack/Google keys, Bearer tokens, JWTs, and PEM private keys.

## Tools

- `terminal` / `run_tests` require an explicit modal approval.
- Command environment is minimized (`PATH`, `HOME`, `LANG` only).
- Obvious destructive / exfil patterns (`rm -rf`, `curl`, `wget`, `ssh`) are blocked.
- Tool outputs are redacted before being fed back to the model.

## Webview

- Strict CSP: no remote scripts/styles, no `unsafe-inline` scripts.
- Markdown rendering escapes HTML before formatting.

## Reporting

If you find a vulnerability, open a private security advisory on the GitHub repo or contact the maintainer. Do not attach live secrets to issues.
