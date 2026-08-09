import { execFile } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import { PROVIDER_CATALOG, ProviderPreset } from "./catalog";
import { redactSecrets } from "./security";

const execFileAsync = promisify(execFile);

export type ProviderStatus = ProviderPreset & {
  configured: boolean;
};

export async function listProviderStatus(): Promise<ProviderStatus[]> {
  const configured = new Set<string>();
  try {
    const { stdout } = await execFileAsync("ocx", ["provider", "list"], {
      timeout: 15_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
    });
    for (const line of stdout.split(/\r?\n/)) {
      const m = /^\s*([a-z0-9-]+)\s+\(/.exec(line) || /^\s*([a-z0-9-]+)\s+adapter=/.exec(line);
      // "openai (default)" under Configured providers
      const m2 = /^\s*([a-z0-9-]+)(?:\s+\(default\))?\s+adapter=/.exec(line);
      const id = (m2 || m)?.[1];
      if (id && !line.includes("Available from registry")) configured.add(id);
    }
    // Also parse block: lines after "Configured providers:" until blank/Available
    let inConfigured = false;
    for (const line of stdout.split(/\r?\n/)) {
      if (/Configured providers/i.test(line)) {
        inConfigured = true;
        continue;
      }
      if (/Available from registry/i.test(line)) break;
      if (inConfigured) {
        const id = line.trim().split(/\s+/)[0];
        if (id && /^[a-z0-9-]+$/.test(id)) configured.add(id);
      }
    }
  } catch {
    configured.add("openai");
  }

  return PROVIDER_CATALOG.map((p) => ({
    ...p,
    configured: configured.has(p.id) || (p.id === "openai" && configured.size === 0),
  }));
}

export async function enableProvider(
  preset: ProviderPreset,
  audit: (kind: string, detail: string) => Promise<void>
): Promise<string> {
  if (preset.id === "custom") {
    throw new Error("Use the OpenCodex dashboard for custom providers (ocx gui).");
  }

  if (preset.auth === "oauth") {
    const term = vscode.window.createTerminal({ name: `OpenCodex login: ${preset.id}` });
    term.show();
    term.sendText(`ocx login ${preset.id}`);
    await audit("provider-login", preset.id);
    return `Opened terminal for: ocx login ${preset.id}`;
  }

  if (preset.auth === "local" || preset.auth === "forward") {
    await execFileAsync("ocx", ["provider", "add", preset.id], {
      timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
    });
    await audit("provider-add", preset.id);
    return `Provider ${preset.id} added`;
  }

  // key auth — ask securely, never log the key
  const key = await vscode.window.showInputBox({
    title: `API key for ${preset.name}`,
    prompt: "Passed to ocx provider add only. Never written to audit log or git.",
    password: true,
    ignoreFocusOut: true,
  });
  if (!key) throw new Error("Cancelled");

  await execFileAsync("ocx", ["provider", "add", preset.id, "--api-key", key], {
    timeout: 30_000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
  });
  await audit("provider-add", `${preset.id} (key redacted)`);
  return `Provider ${preset.id} added`;
}

export function safeProviderError(err: unknown): string {
  return redactSecrets(err instanceof Error ? err.message : String(err));
}
