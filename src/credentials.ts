import * as vscode from "vscode";

const SECRET_KEY = "opencodex.apiKey";

export class CredentialVault {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getApiKey(fallbackFromSettings: string): Promise<string> {
    const fromVault = await this.secrets.get(SECRET_KEY);
    if (fromVault && fromVault.trim()) return fromVault.trim();
    // Prefer vault; settings fallback is for migration only and should stay "dummy" for loopback.
    return fallbackFromSettings || "dummy";
  }

  async setApiKey(value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      await this.secrets.delete(SECRET_KEY);
      return;
    }
    await this.secrets.store(SECRET_KEY, trimmed);
  }

  async clear(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
  }
}
