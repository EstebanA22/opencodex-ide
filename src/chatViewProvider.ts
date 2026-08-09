import * as vscode from "vscode";
import { AgentDef, AgentStore, TEAM_PRESETS, ROLE_PROMPTS } from "./agentStore";
import { applyCodeBlocks, insertAtCursor, replaceSelection } from "./apply";
import { AuditLog } from "./auditLog";
import { mergeModelCatalog, PROVIDER_CATALOG } from "./catalog";
import {
  collectEditorContext,
  enrichContext,
  formatContextBlock,
  resolveMentions,
} from "./contextService";
import { Locale, normalizeLocale, t, table } from "./i18n";
import { ProxyClient, ProxySettings } from "./proxyClient";
import { enableProvider, listProviderStatus, safeProviderError } from "./providers";
import { fetchQuotaSnapshot, QuotaSnapshot } from "./quota";
import { SessionStore } from "./sessionStore";
import { ToolRunner, extractToolRequests } from "./tools";

type SettingsFn = () => ProxySettings & {
  enableToolsDefault: boolean;
  failoverModels: string[];
  locale: Locale;
  showCatalogModels: boolean;
};

type UiMessage = {
  type: string;
  [key: string]: unknown;
};

export class OpenCodexChatProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "opencodex.chatView";
  private view?: vscode.WebviewView;
  private includeFile = true;
  private includeSelection = true;
  private includeDiagnostics = false;
  private includeGitDiff = false;
  private includeMemory = true;
  private enableTools = false;
  private showCatalogModels = true;
  private abort?: AbortController;
  private metrics: Array<Record<string, unknown>> = [];
  private lastUserText = "";
  private quota: QuotaSnapshot | undefined;
  private quotaRefreshing = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: ProxyClient,
    private readonly agents: AgentStore,
    private readonly sessions: SessionStore,
    private readonly audit: AuditLog,
    private readonly tools: ToolRunner,
    private readonly settings: SettingsFn
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webview.html = this.html(webview);
    webview.onDidReceiveMessage((msg: UiMessage) => void this.onMessage(msg));
  }

  async refreshMeta(): Promise<void> {
    if (!this.view) return;
    const healthy = await this.client.health();
    let liveModels: string[] = [];
    let error: string | undefined;
    try {
      liveModels = await this.client.listModels();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const cfg = this.settings();
    this.showCatalogModels = cfg.showCatalogModels;
    const merged = mergeModelCatalog(liveModels);
    const models = this.showCatalogModels ? merged.map((m) => m.id) : liveModels;
    const modelMeta = this.showCatalogModels ? merged : liveModels.map((id) => ({ id, source: "live" as const }));
    const providers = await listProviderStatus();
    const locale = cfg.locale;
    await this.sessions.ensureActive();
    await this.view.webview.postMessage({
      type: "meta",
      healthy,
      models,
      modelMeta,
      defaultModel: cfg.defaultModel,
      agents: this.agents.load(cfg.defaultModel),
      sessions: this.sessions.list().map((s) => ({
        id: s.id,
        title: s.title,
        pinned: s.pinned,
        updatedAt: s.updatedAt,
      })),
      presets: TEAM_PRESETS,
      providers,
      providerCount: PROVIDER_CATALOG.length,
      metrics: this.metrics,
      audit: this.audit.list(),
      includeFile: this.includeFile,
      includeSelection: this.includeSelection,
      includeDiagnostics: this.includeDiagnostics,
      includeGitDiff: this.includeGitDiff,
      includeMemory: this.includeMemory,
      enableTools: this.enableTools,
      showCatalogModels: this.showCatalogModels,
      locale,
      i18n: table(locale),
      quota: this.quota,
      quotaRefreshing: this.quotaRefreshing,
      error,
    });
  }

  async refreshQuota(force = false): Promise<void> {
    if (this.quotaRefreshing) return;
    if (!force && this.quota && Date.now() - Date.parse(this.quota.fetchedAt) < 60_000) {
      await this.view?.webview.postMessage({ type: "quota", quota: this.quota, quotaRefreshing: false });
      return;
    }
    this.quotaRefreshing = true;
    await this.view?.webview.postMessage({ type: "quota", quota: this.quota, quotaRefreshing: true });
    try {
      this.quota = await fetchQuotaSnapshot(this.settings().locale);
      await this.audit.record("quota", "Quota snapshot refreshed");
    } finally {
      this.quotaRefreshing = false;
      await this.view?.webview.postMessage({ type: "quota", quota: this.quota, quotaRefreshing: false });
    }
  }

  async pushContextHint(): Promise<void> {
    if (!this.view) return;
    const ctx = collectEditorContext();
    await this.view.webview.postMessage({
      type: "context",
      activeFile: ctx.activeFile?.path,
      hasSelection: Boolean(ctx.selection),
      selectionLines: ctx.selection ? `${ctx.selection.startLine}-${ctx.selection.endLine}` : undefined,
      openFiles: ctx.openFiles.length,
    });
  }

  async prefillFromSelection(): Promise<void> {
    const ctx = collectEditorContext();
    if (!this.view || !ctx.selection) return;
    await this.view.webview.postMessage({
      type: "prefill",
      text: `Revisa @selection y propón mejoras concretas con bloques \`\`\`path:archivo\`\`\` aplicables.`,
    });
  }

  private async onMessage(msg: UiMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
      case "refresh":
        await this.refreshMeta();
        await this.pushContextHint();
        void this.refreshQuota(msg.type === "refresh");
        break;
      case "quota:refresh":
        await this.refreshQuota(true);
        break;
      case "toggleContext":
        this.includeFile = Boolean(msg.includeFile);
        this.includeSelection = Boolean(msg.includeSelection);
        this.includeDiagnostics = Boolean(msg.includeDiagnostics);
        this.includeGitDiff = Boolean(msg.includeGitDiff);
        this.includeMemory = Boolean(msg.includeMemory);
        this.enableTools = Boolean(msg.enableTools);
        this.showCatalogModels = Boolean(msg.showCatalogModels ?? this.showCatalogModels);
        await this.pushContextHint();
        break;
      case "provider:enable": {
        const id = String(msg.id || "");
        const preset = PROVIDER_CATALOG.find((p) => p.id === id);
        if (!preset) {
          await this.view?.webview.postMessage({ type: "error", text: `Unknown provider: ${id}` });
          break;
        }
        try {
          const result = await enableProvider(preset, (kind, detail) => this.audit.record(kind, detail));
          await this.view?.webview.postMessage({ type: "info", text: result });
          await this.refreshMeta();
        } catch (err) {
          await this.view?.webview.postMessage({ type: "error", text: safeProviderError(err) });
        }
        break;
      }
      case "locale:set": {
        const locale = normalizeLocale(String(msg.locale || "es"));
        await vscode.workspace.getConfiguration("opencodex").update("locale", locale, true);
        await this.refreshMeta();
        break;
      }
      case "catalog:set": {
        this.showCatalogModels = Boolean(msg.showCatalogModels);
        await vscode.workspace
          .getConfiguration("opencodex")
          .update("showCatalogModels", this.showCatalogModels, true);
        await this.refreshMeta();
        break;
      }
      case "openDashboard":
        await vscode.commands.executeCommand("opencodex.openDashboard");
        break;
      case "send":
        await this.handleSend(String(msg.text || ""), String(msg.mode || "single"), msg.agentId as string | undefined, msg);
        break;
      case "stop":
        this.abort?.abort();
        await this.audit.record("stop", "User stopped generation");
        break;
      case "regen":
        if (this.lastUserText) {
          await this.handleSend(this.lastUserText, "single", msg.agentId as string | undefined, {
            enableTools: this.enableTools,
          });
        }
        break;
      case "agents:save":
        await this.agents.save(msg.agents as AgentDef[]);
        await this.refreshMeta();
        break;
      case "agents:add": {
        const list = this.agents.load(this.settings().defaultModel);
        list.push(
          this.agents.create(
            {
              name: String(msg.name || "Agent"),
              role: (msg.role as AgentDef["role"]) || "custom",
              model: String(msg.model || this.settings().defaultModel),
              enabled: true,
            },
            this.settings().defaultModel
          )
        );
        await this.agents.save(list);
        await this.refreshMeta();
        break;
      }
      case "agents:remove": {
        const next = this.agents.load(this.settings().defaultModel).filter((a) => a.id !== msg.id);
        await this.agents.save(next);
        await this.refreshMeta();
        break;
      }
      case "preset:apply":
        await this.agents.applyPreset(String(msg.id), this.settings().defaultModel);
        await this.audit.record("preset", `Applied preset ${msg.id}`);
        await this.refreshMeta();
        break;
      case "session:new":
        await this.sessions.create("New chat");
        await this.view?.webview.postMessage({ type: "clearLog" });
        await this.refreshMeta();
        break;
      case "session:open": {
        await this.sessions.setActive(String(msg.id));
        const session = this.sessions.get(String(msg.id));
        await this.view?.webview.postMessage({ type: "clearLog" });
        for (const t of session?.turns || []) {
          await this.view?.webview.postMessage(
            t.role === "user"
              ? { type: "user", text: t.content, mode: "history" }
              : {
                  type: "assistantStart",
                  agentId: t.agentId || "hist",
                  agentName: t.agentName || "assistant",
                  color: "#64748b",
                  role: "custom",
                  model: t.model || "",
                }
          );
          if (t.role !== "user") {
            await this.view?.webview.postMessage({
              type: "assistantDelta",
              agentId: t.agentId || "hist",
              text: t.content,
            });
            await this.view?.webview.postMessage({ type: "assistantDone", agentId: t.agentId || "hist" });
          }
        }
        await this.refreshMeta();
        break;
      }
      case "session:pin": {
        const s = this.sessions.get(String(msg.id));
        if (s) await this.sessions.pin(s.id, !s.pinned);
        await this.refreshMeta();
        break;
      }
      case "session:remove":
        await this.sessions.remove(String(msg.id));
        await this.refreshMeta();
        break;
      case "session:export": {
        const md = await this.sessions.exportMarkdown(String(msg.id));
        const doc = await vscode.workspace.openTextDocument({ content: md, language: "markdown" });
        await vscode.window.showTextDocument(doc, { preview: true });
        break;
      }
      case "clipboard":
        await vscode.env.clipboard.writeText(String(msg.text || ""));
        break;
      case "insert":
        await insertAtCursor(this.extractPrimaryCode(String(msg.text || "")));
        break;
      case "apply": {
        const results = await applyCodeBlocks(String(msg.text || ""));
        await this.view?.webview.postMessage({
          type: "info",
          text: results.map((r) => `${r.ok ? "OK" : "ERR"} ${r.message}`).join("\n"),
        });
        await this.audit.record("apply", results.map((r) => r.message).join("; "));
        break;
      }
      case "audit:clear":
        await this.audit.clear();
        await this.refreshMeta();
        break;
      case "scorecard":
        await this.runScorecard();
        break;
      case "inlineEdit":
        await this.inlineEdit(String(msg.instruction || ""));
        break;
      case "diagnosticsLoop":
        await this.handleSend(
          "Corrige los diagnósticos del archivo activo. Usa @diagnostics y entrega bloques path:file aplicables.",
          "pipeline",
          undefined,
          { includeDiagnostics: true, enableTools: false }
        );
        break;
      case "testLoop":
        await this.handleSend(
          "Corre los tests del proyecto, interpreta fallos y propone fixes con path:file blocks.",
          "pipeline",
          undefined,
          { enableTools: true }
        );
        break;
      case "prHelper":
        await this.handleSend(
          "Con @diff genera: resumen PR, riesgos, checklist de prueba y mensaje de commit convencional.",
          "team",
          undefined,
          { includeGitDiff: true }
        );
        break;
    }
  }

  private extractPrimaryCode(markdown: string): string {
    const m = /```(?:[\w.+-]*)?(?:[ \t]+(?:path:)?[^\n]+)?\n([\s\S]*?)```/.exec(markdown);
    return m?.[1] ?? markdown;
  }

  private async handleSend(
    text: string,
    mode: string,
    agentId: string | undefined,
    flags: Record<string, unknown>
  ): Promise<void> {
    if (!this.view || !text.trim()) return;
    this.lastUserText = text.trim();
    this.enableTools = Boolean(flags.enableTools ?? this.enableTools);
    this.includeDiagnostics = Boolean(flags.includeDiagnostics ?? this.includeDiagnostics);
    this.includeGitDiff = Boolean(flags.includeGitDiff ?? this.includeGitDiff);
    this.includeMemory = Boolean(flags.includeMemory ?? this.includeMemory);
    this.includeFile = Boolean(flags.includeFile ?? this.includeFile);
    this.includeSelection = Boolean(flags.includeSelection ?? this.includeSelection);

    const budget = Number(flags.budget || 0);
    const debateRounds = Math.max(1, Math.min(4, Number(flags.debateRounds || 2)));
    const session = await this.sessions.ensureActive();
    const mentions = await resolveMentions(text);
    const baseCtx = collectEditorContext();
    const ctx = await enrichContext(baseCtx, {
      includeDiagnostics: this.includeDiagnostics,
      includeGitDiff: this.includeGitDiff,
      includeMemory: this.includeMemory,
    });
    const contextBlock = [
      formatContextBlock(ctx, {
        includeFile: this.includeFile,
        includeSelection: this.includeSelection,
        includeDiagnostics: this.includeDiagnostics,
        includeGitDiff: this.includeGitDiff,
        includeMemory: this.includeMemory,
      }),
      ...mentions.blocks,
    ].join("\n\n");

    await this.sessions.appendTurn(session.id, { role: "user", content: text });
    await this.audit.record("send", `mode=${mode}`, { chars: text.length });
    await this.view.webview.postMessage({ type: "user", text, mode });

    const all = this.agents.load(this.settings().defaultModel);
    let targets: AgentDef[] = [];
    if (mode === "single") {
      targets = all.filter((a) => a.id === agentId).slice(0, 1);
      if (!targets.length) targets = all.filter((a) => a.enabled).slice(0, 1);
    } else {
      targets = all.filter((a) => a.enabled);
    }
    if (!targets.length) {
      await this.view.webview.postMessage({ type: "error", text: "No agents enabled." });
      return;
    }
    if (budget > 0 && targets.length > budget) {
      targets = targets.slice(0, budget);
    }

    this.abort = new AbortController();
    const userContent = mentions.cleaned;

    try {
      if (mode === "pipeline") {
        let carry = userContent;
        for (const agent of targets) {
          const result = await this.runAgent(agent, carry, contextBlock, session.id);
          if (result) carry = `${userContent}\n\nPrevious agent (${agent.name}) output:\n${result}`;
        }
      } else if (mode === "debate") {
        const a = targets[0];
        const b = targets[1] || targets[0];
        let transcript = userContent;
        for (let round = 1; round <= debateRounds; round++) {
          const ra = await this.runAgent(
            a,
            `Debate round ${round}. Argue your position on:\n${transcript}`,
            contextBlock,
            session.id
          );
          const rb = await this.runAgent(
            b,
            `Debate round ${round}. Rebut and improve. Peer said:\n${ra}\n\nTopic:\n${transcript}`,
            contextBlock,
            session.id
          );
          transcript = `Round ${round}\n${a.name}: ${ra}\n${b.name}: ${rb}`;
        }
        await this.synthesize(userContent, [
          { agent: a, content: transcript },
          { agent: b, content: transcript },
        ], session.id);
      } else {
        const results = await Promise.all(
          targets.map((agent) =>
            this.runAgent(agent, userContent, contextBlock, session.id).then((content) => ({
              agent,
              content: content || "",
              ok: Boolean(content),
            }))
          )
        );
        if (mode === "team") {
          await this.synthesize(
            userContent,
            results.filter((r) => r.ok).map((r) => ({ agent: r.agent, content: r.content })),
            session.id
          );
          await this.maybeScore(results.filter((r) => r.ok));
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/aborted/i.test(message)) {
        await this.view.webview.postMessage({ type: "error", text: message });
      }
    }
  }

  private async runAgent(
    agent: AgentDef,
    userText: string,
    contextBlock: string,
    sessionId: string
  ): Promise<string | undefined> {
    if (!this.view) return;
    await this.view.webview.postMessage({
      type: "assistantStart",
      agentId: agent.id,
      agentName: agent.name,
      color: agent.color,
      role: agent.role,
      model: agent.model,
    });

    const toolHint = this.enableTools
      ? `\nYou may request tools with:\n\`\`\`tool\n{"name":"read_file|grep|list_dir|git_status|git_diff|run_tests|terminal","args":{"path":"...","pattern":"...","command":"..."}}\n\`\`\`\nDangerous tools require user approval. Never ask for secrets.`
      : "";

    try {
      let result = await this.client.chat({
        model: agent.model,
        signal: this.abort?.signal,
        messages: [
          { role: "system", content: agent.systemPrompt + toolHint },
          { role: "system", content: contextBlock },
          { role: "user", content: userText },
        ],
        onDelta: (delta) => {
          void this.view?.webview.postMessage({ type: "assistantDelta", agentId: agent.id, text: delta });
        },
      });

      if (this.enableTools) {
        const reqs = extractToolRequests(result.content).slice(0, 3);
        for (const req of reqs) {
          const toolResult = await this.tools.run(req, { allowDangerous: false });
          await this.audit.record("tool", `${req.name}`, { ok: toolResult.ok });
          const follow = await this.client.chat({
            model: agent.model,
            signal: this.abort?.signal,
            messages: [
              { role: "system", content: agent.systemPrompt },
              { role: "system", content: contextBlock },
              { role: "user", content: userText },
              { role: "assistant", content: result.content },
              {
                role: "user",
                content: `Tool ${toolResult.name} =>\n${toolResult.output}\nContinue with final answer. Use path:file fences for edits.`,
              },
            ],
            onDelta: (delta) => {
              void this.view?.webview.postMessage({ type: "assistantDelta", agentId: agent.id, text: delta });
            },
          });
          result = follow;
        }
      }

      const finalText = result.content || "(empty response)";
      await this.sessions.appendTurn(sessionId, {
        role: "assistant",
        content: finalText,
        agentId: agent.id,
        agentName: agent.name,
        model: result.modelUsed,
        latencyMs: result.latencyMs,
        tokensApprox: Math.ceil(finalText.length / 4),
      });
      const metric = {
        agent: agent.name,
        model: result.modelUsed,
        latencyMs: result.latencyMs,
        tokensApprox: Math.ceil(finalText.length / 4),
        failover: result.failoverUsed,
      };
      this.metrics = [metric, ...this.metrics].slice(0, 50);
      await this.view.webview.postMessage({ type: "metric", metric });
      await this.view.webview.postMessage({ type: "assistantDone", agentId: agent.id });
      return finalText;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.view.webview.postMessage({ type: "error", text: `${agent.name}: ${message}`, agentId: agent.id });
      return undefined;
    }
  }

  private async synthesize(
    userText: string,
    results: Array<{ agent: AgentDef; content: string }>,
    sessionId: string
  ): Promise<void> {
    if (!this.view || !results.length) return;
    const synthId = "orchestrator";
    await this.view.webview.postMessage({
      type: "assistantStart",
      agentId: synthId,
      agentName: "Orchestrator",
      color: "#f97316",
      role: "custom",
      model: this.settings().defaultModel,
    });
    const dossier = results
      .map((r) => `### ${r.agent.name} (${r.agent.role}/${r.agent.model})\n${r.content}`)
      .join("\n\n");
    try {
      const result = await this.client.chat({
        model: this.settings().defaultModel,
        signal: this.abort?.signal,
        messages: [
          {
            role: "system",
            content:
              "You are the orchestrator. Merge specialist answers into one actionable plan. Call out disagreements. Prefer Spanish if the user writes in Spanish.",
          },
          { role: "user", content: `User task:\n${userText}\n\nAgent reports:\n${dossier}` },
        ],
        onDelta: (delta) => {
          void this.view?.webview.postMessage({ type: "assistantDelta", agentId: synthId, text: delta });
        },
      });
      await this.sessions.appendTurn(sessionId, {
        role: "assistant",
        content: result.content,
        agentId: synthId,
        agentName: "Orchestrator",
        model: result.modelUsed,
        latencyMs: result.latencyMs,
      });
      await this.view.webview.postMessage({ type: "assistantDone", agentId: synthId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.view.webview.postMessage({ type: "error", text: `Orchestrator: ${message}` });
    }
  }

  private async maybeScore(results: Array<{ agent: AgentDef; content: string }>): Promise<void> {
    if (results.length < 2 || !this.view) return;
    const scoreId = "scorecard";
    await this.view.webview.postMessage({
      type: "assistantStart",
      agentId: scoreId,
      agentName: "Scorecard",
      color: "#eab308",
      role: "custom",
      model: this.settings().defaultModel,
    });
    try {
      await this.client.chat({
        model: this.settings().defaultModel,
        signal: this.abort?.signal,
        messages: [
          {
            role: "system",
            content:
              "Score each agent answer 0-10 on correctness, security, completeness. Return a compact markdown table and pick a winner.",
          },
          {
            role: "user",
            content: results.map((r) => `## ${r.agent.name}\n${r.content}`).join("\n\n"),
          },
        ],
        onDelta: (delta) => {
          void this.view?.webview.postMessage({ type: "assistantDelta", agentId: scoreId, text: delta });
        },
      });
      await this.view.webview.postMessage({ type: "assistantDone", agentId: scoreId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.view.webview.postMessage({ type: "error", text: `Scorecard: ${message}` });
    }
  }

  private async runScorecard(): Promise<void> {
    const session = await this.sessions.ensureActive();
    const assistants = session.turns.filter((t) => t.role === "assistant").slice(-6);
    if (assistants.length < 2) {
      await this.view?.webview.postMessage({ type: "error", text: "Need at least 2 assistant answers to score." });
      return;
    }
    await this.maybeScore(
      assistants.map((t) => ({
        agent: {
          id: t.agentId || t.id,
          name: t.agentName || "agent",
          role: "custom",
          model: t.model || this.settings().defaultModel,
          systemPrompt: "",
          enabled: true,
          color: "#eab308",
        },
        content: t.content,
      }))
    );
  }

  private async inlineEdit(instruction: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      await this.view?.webview.postMessage({ type: "error", text: "Select code for inline edit." });
      return;
    }
    const selected = editor.document.getText(editor.selection);
    const prompt = instruction || "Improve this code.";
    const agentId = "inline";
    await this.view?.webview.postMessage({
      type: "assistantStart",
      agentId,
      agentName: "Inline Edit",
      color: "#06b6d4",
      role: "coder",
      model: this.settings().defaultModel,
    });
    try {
      let full = "";
      await this.client.chat({
        model: this.settings().defaultModel,
        signal: this.abort?.signal,
        messages: [
          {
            role: "system",
            content: "Return ONLY the replacement code for the selection. No markdown fences.",
          },
          { role: "user", content: `${prompt}\n\n\`\`\`\n${selected}\n\`\`\`` },
        ],
        onDelta: (delta) => {
          full += delta;
          void this.view?.webview.postMessage({ type: "assistantDelta", agentId, text: delta });
        },
      });
      await replaceSelection(full.replace(/^```[\s\S]*?\n/, "").replace(/```$/, "").trim());
      await this.view?.webview.postMessage({ type: "assistantDone", agentId });
      await this.audit.record("inlineEdit", "Applied inline edit");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.view?.webview.postMessage({ type: "error", text: message });
    }
  }

  private html(webview: vscode.Webview): string {
    const v = "0.4.2";
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "webview.css")).with({
      query: `v=${v}`,
    });
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "webview.js")).with({
      query: `v=${v}`,
    });
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${css}" />
  <title>OpenCodex ${v}</title>
</head>
<body>
  <div class="brand">
    <div class="brand-mark">
      <div class="name">OpenCodex</div>
      <div class="tag" data-i18n="brand.tag">Chat multi-agente · proxy local</div>
    </div>
    <span class="ver" id="extVersion">v0.4.2</span>
  </div>

  <div id="quotaStrip" class="quota-strip">
    <div class="qs-head">
      <strong data-i18n="usage.liveTitle">Uso en vivo</strong>
      <button id="refreshQuotaTop" class="ghost" data-i18n="usage.refresh">Actualizar</button>
    </div>
    <div id="quotaMini" class="qs-empty" data-i18n="usage.stripEmpty">Abrí Uso o actualizá para ver cuotas…</div>
  </div>

  <div class="topbar">
    <div class="status-row">
      <span id="health" class="pill">…</span>
      <span id="ctx" class="pill">context…</span>
      <span class="queue" id="queueTop"></span>
    </div>
    <div class="status-row">
      <select id="mode" title="Mode" style="flex:1">
        <option value="single" data-i18n="mode.single">Individual</option>
        <option value="team" data-i18n="mode.team">Equipo + Orquestador</option>
        <option value="pipeline" data-i18n="mode.pipeline">Pipeline</option>
        <option value="debate" data-i18n="mode.debate">Debate</option>
      </select>
      <select id="locale" title="Language">
        <option value="es">ES</option>
        <option value="en">EN</option>
      </select>
    </div>
    <div class="tabs">
      <button class="secondary active" data-tab="chat" data-i18n="tab.agents">Agentes</button>
      <button class="secondary" data-tab="usage" data-i18n="tab.usage">Uso</button>
      <button class="secondary" data-tab="providers" data-i18n="tab.providers">Proveedores</button>
      <button class="secondary" data-tab="sessions" data-i18n="tab.sessions">Sesiones</button>
      <button class="secondary" data-tab="more" data-i18n="section.advanced">Avanzado</button>
    </div>
  </div>

  <div id="panel-chat">
    <details class="section">
      <summary data-i18n="section.agents">Agentes</summary>
      <div class="body">
        <div id="agents"></div>
        <div class="addbox">
          <input id="newName" placeholder="Nuevo agente" />
          <select id="newRole">
            <option value="coder">coder</option>
            <option value="reviewer">reviewer</option>
            <option value="architect">architect</option>
            <option value="debugger">debugger</option>
            <option value="researcher">researcher</option>
            <option value="tester">tester</option>
            <option value="security">security</option>
            <option value="custom">custom</option>
          </select>
          <select id="newModel"></select>
          <button id="addAgent" class="secondary" data-i18n="btn.addAgent">+ Agente</button>
        </div>
      </div>
    </details>

    <details class="section">
      <summary data-i18n="section.context">Contexto</summary>
      <div class="body">
        <div class="chip-row">
          <label class="chip"><input type="checkbox" id="includeFile" checked /> <span data-i18n="chk.file">Archivo</span></label>
          <label class="chip"><input type="checkbox" id="includeSelection" checked /> <span data-i18n="chk.selection">Selección</span></label>
          <label class="chip"><input type="checkbox" id="includeDiagnostics" /> <span data-i18n="chk.diagnostics">Diagnósticos</span></label>
          <label class="chip"><input type="checkbox" id="includeGitDiff" /> <span data-i18n="chk.diff">Diff</span></label>
          <label class="chip"><input type="checkbox" id="includeMemory" checked /> <span data-i18n="chk.memory">Memoria</span></label>
          <label class="chip"><input type="checkbox" id="enableTools" /> <span data-i18n="chk.tools">Herramientas</span></label>
          <label class="chip"><input type="checkbox" id="showCatalogModels" checked /> <span data-i18n="chk.showCatalogModels">Catálogo completo</span></label>
        </div>
      </div>
    </details>

    <details class="section">
      <summary data-i18n="section.tools">Herramientas rápidas</summary>
      <div class="body">
        <div class="tools-grid">
          <button id="inlineEdit" class="secondary" data-i18n="btn.inlineEdit">Edición inline</button>
          <button id="diagnosticsLoop" class="secondary" data-i18n="btn.diagnosticsLoop">Loop diagnósticos</button>
          <button id="testLoop" class="secondary" data-i18n="btn.testLoop">Loop tests</button>
          <button id="prHelper" class="secondary" data-i18n="btn.prHelper">Ayuda PR</button>
          <button id="scorecard" class="secondary" data-i18n="btn.scorecard">Scorecard</button>
          <button id="voice" class="secondary" data-i18n="btn.voice">Voz</button>
        </div>
      </div>
    </details>
  </div>

  <div id="panel-usage" class="hidden">
    <div class="section">
      <div class="body">
        <div class="row" style="justify-content:space-between">
          <strong data-i18n="usage.title">¿Cuánto se puede usar?</strong>
          <button id="refreshQuota" class="secondary" data-i18n="usage.refresh">Actualizar cuotas</button>
        </div>
        <div class="hint" data-i18n="usage.intro">OpenCodex no tiene cupo propio.</div>
        <div id="quotaLive" class="quota-live"></div>
        <div id="usage">
          <div class="usage-card">
            <div class="tier" data-i18n="usage.cheap.title">Barato / local</div>
            <div class="hint" data-i18n="usage.cheap.body"></div>
          </div>
          <div class="usage-card">
            <div class="tier" data-i18n="usage.mid.title">Medio / flexible</div>
            <div class="hint" data-i18n="usage.mid.body"></div>
          </div>
          <div class="usage-card">
            <div class="tier" data-i18n="usage.pro.title">Fuerte / premium</div>
            <div class="hint" data-i18n="usage.pro.body"></div>
          </div>
        </div>
        <div class="hint" data-i18n="usage.tip"></div>
        <button id="openGui" class="secondary" data-i18n="usage.openGui">Abrir dashboard OpenCodex</button>
      </div>
    </div>
  </div>

  <div id="panel-providers" class="hidden">
    <div class="section">
      <div class="body">
        <div class="hint" data-i18n="providers.hint">Activa proveedores con OpenCodex (ocx).</div>
        <div id="providers"></div>
      </div>
    </div>
  </div>

  <div id="panel-sessions" class="hidden">
    <div class="section">
      <div class="body">
        <button id="newSession" class="secondary" data-i18n="btn.newSession">Nueva sesión</button>
        <div id="sessions"></div>
      </div>
    </div>
  </div>

  <div id="panel-more" class="hidden">
    <details class="section" open>
      <summary data-i18n="section.advanced">Avanzado</summary>
      <div class="body">
        <div class="row">
          <select id="preset" style="flex:1"></select>
          <button id="applyPreset" class="secondary" data-i18n="btn.applyPreset">Aplicar preset</button>
        </div>
        <div class="row">
          <input id="budget" type="number" min="0" max="8" value="0" title="Max agents" style="width:72px" />
          <input id="debateRounds" type="number" min="1" max="4" value="2" title="Debate rounds" style="width:72px" />
          <button id="clearAudit" class="secondary" data-i18n="btn.clearAudit">Limpiar auditoría</button>
        </div>
        <div id="metrics"></div>
        <div id="audit"></div>
      </div>
    </details>
  </div>

  <div id="log"></div>

  <div class="composer">
    <select id="activeAgent"></select>
    <textarea id="input" data-i18n-placeholder="placeholder.input" placeholder="Enter envía · Shift+Enter nueva línea"></textarea>
    <div class="composer-actions">
      <button id="send" data-i18n="btn.send">Enviar</button>
      <button id="stop" class="secondary" disabled data-i18n="btn.stop">Detener</button>
      <button id="refresh" class="ghost" data-i18n="btn.refresh">Actualizar</button>
      <span id="queue" class="queue"></span>
    </div>
    <div class="hint" data-i18n="hint.footer"></div>
  </div>
  <script src="${js}"></script>
</body>
</html>`;
  }
}

void ROLE_PROMPTS;
void t;
