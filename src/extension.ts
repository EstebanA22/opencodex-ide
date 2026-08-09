import * as vscode from "vscode";
import { AgentStore } from "./agentStore";
import { AuditLog } from "./auditLog";
import { OpenCodexChatProvider } from "./chatViewProvider";
import { CredentialVault } from "./credentials";
import { normalizeLocale } from "./i18n";
import { ProxyClient, ProxySettings } from "./proxyClient";
import { SessionStore } from "./sessionStore";
import { ToolRunner } from "./tools";

export function activate(context: vscode.ExtensionContext): void {
  const vault = new CredentialVault(context.secrets);
  let cachedKey = "dummy";

  const readSettings = (): ProxySettings & {
    enableToolsDefault: boolean;
    locale: ReturnType<typeof normalizeLocale>;
    showCatalogModels: boolean;
  } => {
    const cfg = vscode.workspace.getConfiguration("opencodex");
    return {
      baseUrl: cfg.get<string>("baseUrl", "http://127.0.0.1:10100/v1"),
      apiKey: cachedKey,
      defaultModel: cfg.get<string>("defaultModel", "gpt-5.6-sol"),
      failoverModels: cfg.get<string[]>("failoverModels", ["gpt-5.6-terra", "gpt-5.5"]),
      enableToolsDefault: cfg.get<boolean>("enableToolsDefault", false),
      locale: normalizeLocale(cfg.get<string>("locale", "es")),
      showCatalogModels: cfg.get<boolean>("showCatalogModels", true),
    };
  };

  const refreshKey = async () => {
    const cfgKey = vscode.workspace.getConfiguration("opencodex").get<string>("apiKey", "dummy");
    cachedKey = await vault.getApiKey(cfgKey);
  };

  const client = new ProxyClient(() => readSettings());
  const agents = new AgentStore(context.globalState);
  const sessions = new SessionStore(context.globalState);
  const audit = new AuditLog(context.globalState);
  const tools = new ToolRunner();
  const provider = new OpenCodexChatProvider(
    context.extensionUri,
    client,
    agents,
    sessions,
    audit,
    tools,
    () => readSettings()
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(OpenCodexChatProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  status.command = "opencodex.focusChat";
  status.tooltip = "Open OpenCodex multi-agent chat";
  status.show();
  context.subscriptions.push(status);

  const refreshHealth = async () => {
    await refreshKey();
    const healthy = await client.health();
    status.text = healthy ? "$(rocket) OpenCodex" : "$(warning) OpenCodex offline";
    status.backgroundColor = healthy
      ? undefined
      : new vscode.ThemeColor("statusBarItem.warningBackground");
    await provider.refreshMeta();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("opencodex.openDashboard", async () => {
      await vscode.env.openExternal(vscode.Uri.parse(client.rootUrl()));
    }),
    vscode.commands.registerCommand("opencodex.refreshHealth", refreshHealth),
    vscode.commands.registerCommand("opencodex.focusChat", async () => {
      await vscode.commands.executeCommand("opencodex.chatView.focus");
    }),
    vscode.commands.registerCommand("opencodex.sendSelectionToAgent", async () => {
      await vscode.commands.executeCommand("opencodex.chatView.focus");
      await provider.prefillFromSelection();
    }),
    vscode.commands.registerCommand("opencodex.setApiKey", async () => {
      const value = await vscode.window.showInputBox({
        title: "OpenCodex API key",
        prompt: "Stored in SecretStorage (not settings.json). Use dummy for local loopback.",
        password: true,
        ignoreFocusOut: true,
      });
      if (value === undefined) return;
      await vault.setApiKey(value);
      await audit.record("credentials", "API key updated in SecretStorage");
      await refreshKey();
      vscode.window.showInformationMessage("OpenCodex API key saved to SecretStorage.");
    }),
    vscode.commands.registerCommand("opencodex.clearApiKey", async () => {
      await vault.clear();
      await audit.record("credentials", "API key cleared from SecretStorage");
      await refreshKey();
      vscode.window.showInformationMessage("OpenCodex API key cleared.");
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => void provider.pushContextHint()),
    vscode.window.onDidChangeTextEditorSelection(() => void provider.pushContextHint())
  );

  void refreshHealth();
  const timer = setInterval(() => void refreshHealth(), 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate(): void {}
