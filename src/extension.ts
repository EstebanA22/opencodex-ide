import * as vscode from "vscode";
import { AgentStore } from "./agentStore";
import { OpenCodexChatProvider } from "./chatViewProvider";
import { ProxyClient } from "./proxyClient";

export function activate(context: vscode.ExtensionContext): void {
  const settings = () => {
    const cfg = vscode.workspace.getConfiguration("opencodex");
    return {
      baseUrl: cfg.get<string>("baseUrl", "http://127.0.0.1:10100/v1"),
      apiKey: cfg.get<string>("apiKey", "dummy"),
      defaultModel: cfg.get<string>("defaultModel", "gpt-5.6-sol"),
    };
  };

  const client = new ProxyClient(settings);
  const agents = new AgentStore(context.globalState);
  const provider = new OpenCodexChatProvider(context.extensionUri, client, agents, settings);

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
