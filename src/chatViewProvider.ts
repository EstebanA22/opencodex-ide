import * as vscode from "vscode";
import { AgentDef, AgentStore, TEAM_PRESETS, ROLE_PROMPTS } from "./agentStore";
import { applyCodeBlocks, insertAtCursor, replaceSelection } from "./apply";
import { AuditLog } from "./auditLog";
import {
  collectEditorContext,
  enrichContext,
  formatContextBlock,
  resolveMentions,
} from "./contextService";
import { ProxyClient, ProxySettings } from "./proxyClient";
import { SessionStore } from "./sessionStore";
import { ToolRunner, extractToolRequests } from "./tools";

type SettingsFn = () => ProxySettings & {
  enableToolsDefault: boolean;
  failoverModels: string[];
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
  private abort?: AbortController;
  private metrics: Array<Record<string, unknown>> = [];
  private lastUserText = "";

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
    let models: string[] = [];
    let error: string | undefined;
    try {
      models = await this.client.listModels();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const { defaultModel } = this.settings();
    await this.sessions.ensureActive();
    await this.view.webview.postMessage({
      type: "meta",
      healthy,
      models,
      defaultModel,
      agents: this.agents.load(defaultModel),
      sessions: this.sessions.list().map((s) => ({
        id: s.id,
        title: s.title,
        pinned: s.pinned,
        updatedAt: s.updatedAt,
      })),
      presets: TEAM_PRESETS,
      metrics: this.metrics,
      audit: this.audit.list(),
      includeFile: this.includeFile,
      includeSelection: this.includeSelection,
      includeDiagnostics: this.includeDiagnostics,
      includeGitDiff: this.includeGitDiff,
      includeMemory: this.includeMemory,
      enableTools: this.enableTools,
      error,
    });
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
        break;
      case "toggleContext":
        this.includeFile = Boolean(msg.includeFile);
        this.includeSelection = Boolean(msg.includeSelection);
        this.includeDiagnostics = Boolean(msg.includeDiagnostics);
        this.includeGitDiff = Boolean(msg.includeGitDiff);
        this.includeMemory = Boolean(msg.includeMemory);
        this.enableTools = Boolean(msg.enableTools);
        await this.pushContextHint();
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
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "webview.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "webview.js"));
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
  <title>OpenCodex</title>
</head>
<body>
  <div class="row">
    <span id="health" class="pill">…</span>
    <span id="ctx" class="pill">context…</span>
    <select id="mode">
      <option value="single">Single</option>
      <option value="team">Team + Orchestrator</option>
      <option value="pipeline">Pipeline</option>
      <option value="debate">Debate</option>
    </select>
  </div>

  <div class="tabs">
    <button class="secondary active" data-tab="agents">Agents</button>
    <button class="secondary" data-tab="sessions">Sessions</button>
    <button class="secondary" data-tab="metrics">Metrics</button>
    <button class="secondary" data-tab="audit">Audit</button>
  </div>
  <div id="panel-agents">
    <div id="agents"></div>
    <div class="row">
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
      <button id="addAgent" class="secondary">+ Agent</button>
    </div>
    <div class="row">
      <select id="preset"></select>
      <button id="applyPreset" class="secondary">Apply preset</button>
      <input id="budget" type="number" min="0" max="8" value="0" title="Max agents (0=all)" style="width:64px" />
      <input id="debateRounds" type="number" min="1" max="4" value="2" title="Debate rounds" style="width:64px" />
    </div>
  </div>
  <div id="panel-sessions" class="hidden">
    <div class="row"><button id="newSession" class="secondary">New session</button></div>
    <div id="sessions"></div>
  </div>
  <div id="panel-metrics" class="hidden"><div id="metrics"></div></div>
  <div id="panel-audit" class="hidden">
    <div class="row"><button id="clearAudit" class="secondary">Clear audit</button></div>
    <div id="audit"></div>
  </div>

  <div class="row">
    <label class="chk"><input type="checkbox" id="includeFile" checked /> File</label>
    <label class="chk"><input type="checkbox" id="includeSelection" checked /> Selection</label>
    <label class="chk"><input type="checkbox" id="includeDiagnostics" /> Diagnostics</label>
    <label class="chk"><input type="checkbox" id="includeGitDiff" /> Diff</label>
    <label class="chk"><input type="checkbox" id="includeMemory" checked /> Memory</label>
    <label class="chk"><input type="checkbox" id="enableTools" /> Tools</label>
  </div>
  <div class="row">
    <button id="inlineEdit" class="secondary">Inline edit</button>
    <button id="diagnosticsLoop" class="secondary">Diagnostics loop</button>
    <button id="testLoop" class="secondary">Test loop</button>
    <button id="prHelper" class="secondary">PR helper</button>
    <button id="scorecard" class="secondary">Scorecard</button>
    <button id="voice" class="secondary">Voice</button>
  </div>

  <div id="log"></div>
  <div class="row"><select id="activeAgent" style="flex:1"></select><span id="queue" class="queue"></span></div>
  <textarea id="input" placeholder="Enter envía · Shift+Enter nueva línea · @file @selection @diff @diagnostics @memory @folder:src"></textarea>
  <div class="row">
    <button id="send">Enviar</button>
    <button id="stop" class="secondary" disabled>Stop</button>
    <button id="refresh" class="secondary">Refresh</button>
  </div>
  <div class="hint">Secrets redacted · sensitive paths blocked · tools need approval · Continue untouched</div>
  <script src="${js}"></script>
</body>
</html>`;
  }
}

// silence unused import in case tree-shaking edge cases
void ROLE_PROMPTS;
