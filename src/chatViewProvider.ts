import * as vscode from "vscode";
import { AgentDef, AgentStore, ROLE_PROMPTS } from "./agentStore";
import { collectEditorContext, formatContextBlock } from "./contextService";
import { ProxyClient, ProxySettings } from "./proxyClient";

type UiMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "send"; text: string; mode: "single" | "team"; agentId?: string }
  | { type: "agents:save"; agents: AgentDef[] }
  | { type: "agents:add"; name: string; role: AgentDef["role"]; model: string }
  | { type: "agents:remove"; id: string }
  | { type: "toggleContext"; includeFile: boolean; includeSelection: boolean };

export class OpenCodexChatProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "opencodex.chatView";
  private view?: vscode.WebviewView;
  private includeFile = true;
  private includeSelection = true;
  private histories = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: ProxyClient,
    private readonly store: AgentStore,
    private readonly settings: () => ProxySettings
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.html(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: UiMessage) => {
      switch (msg.type) {
        case "ready":
        case "refresh":
          await this.refreshMeta();
          await this.pushContextHint();
          break;
        case "send":
          await this.handleSend(msg.text, msg.mode, msg.agentId);
          break;
        case "agents:save":
          await this.store.save(msg.agents);
          await this.refreshMeta();
          break;
        case "agents:add": {
          const agents = this.store.load(this.settings().defaultModel);
          agents.push(
            this.store.create(
              { name: msg.name, role: msg.role, model: msg.model, enabled: true },
              this.settings().defaultModel
            )
          );
          await this.store.save(agents);
          await this.refreshMeta();
          break;
        }
        case "agents:remove": {
          const next = this.store
            .load(this.settings().defaultModel)
            .filter((a) => a.id !== msg.id);
          await this.store.save(next);
          this.histories.delete(msg.id);
          await this.refreshMeta();
          break;
        }
        case "toggleContext":
          this.includeFile = msg.includeFile;
          this.includeSelection = msg.includeSelection;
          await this.pushContextHint();
          break;
      }
    });
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
    const agents = this.store.load(defaultModel);
    await this.view.webview.postMessage({
      type: "meta",
      healthy,
      models,
      defaultModel,
      agents,
      rolePrompts: ROLE_PROMPTS,
      includeFile: this.includeFile,
      includeSelection: this.includeSelection,
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
      selectionLines: ctx.selection
        ? `${ctx.selection.startLine}-${ctx.selection.endLine}`
        : undefined,
      openFiles: ctx.openFiles.length,
    });
  }

  async prefillFromSelection(): Promise<void> {
    const ctx = collectEditorContext();
    if (!this.view || !ctx.selection) return;
    await this.view.webview.postMessage({
      type: "prefill",
      text: `Revisa esta selección (${ctx.selection.path}:${ctx.selection.startLine}-${ctx.selection.endLine}) y propón mejoras concretas.`,
    });
  }

  private historyFor(agentId: string) {
    if (!this.histories.has(agentId)) this.histories.set(agentId, []);
    return this.histories.get(agentId)!;
  }

  private async handleSend(text: string, mode: "single" | "team", agentId?: string): Promise<void> {
    if (!this.view || !text.trim()) return;
    const userText = text.trim();
    const ctx = collectEditorContext();
    const contextBlock = formatContextBlock(ctx, this.includeFile, this.includeSelection);
    const agents = this.store.load(this.settings().defaultModel);
    const targets =
      mode === "team"
        ? agents.filter((a) => a.enabled)
        : agents.filter((a) => a.id === agentId).slice(0, 1);

    if (targets.length === 0) {
      await this.view.webview.postMessage({
        type: "error",
        text: mode === "team" ? "No hay agentes habilitados." : "Selecciona un agente.",
      });
      return;
    }

    await this.view.webview.postMessage({ type: "user", text: userText, mode });

    const runs = targets.map((agent) => this.runAgent(agent, userText, contextBlock));
    const results = await Promise.all(runs);

    if (mode === "team" && results.some((r) => r.ok)) {
      await this.synthesize(userText, results.filter((r) => r.ok));
    }
  }

  private async runAgent(
    agent: AgentDef,
    userText: string,
    contextBlock: string
  ): Promise<{ ok: boolean; agent: AgentDef; content: string }> {
    if (!this.view) return { ok: false, agent, content: "" };
    const history = this.historyFor(agent.id);
    history.push({ role: "user", content: userText });

    await this.view.webview.postMessage({
      type: "assistantStart",
      agentId: agent.id,
      agentName: agent.name,
      color: agent.color,
      role: agent.role,
      model: agent.model,
    });

    try {
      const content = await this.client.chat({
        model: agent.model,
        messages: [
          { role: "system", content: agent.systemPrompt },
          { role: "system", content: contextBlock },
          ...history,
        ],
        onDelta: (delta) => {
          void this.view?.webview.postMessage({
            type: "assistantDelta",
            agentId: agent.id,
            text: delta,
          });
        },
      });
      const finalText = content || "(empty response)";
      history.push({ role: "assistant", content: finalText });
      await this.view.webview.postMessage({ type: "assistantDone", agentId: agent.id });
      return { ok: true, agent, content: finalText };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.view.webview.postMessage({
        type: "error",
        text: `${agent.name}: ${message}`,
        agentId: agent.id,
      });
      return { ok: false, agent, content: "" };
    }
  }

  private async synthesize(
    userText: string,
    results: Array<{ agent: AgentDef; content: string }>
  ): Promise<void> {
    if (!this.view) return;
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
      await this.client.chat({
        model: this.settings().defaultModel,
        messages: [
          {
            role: "system",
            content:
              "You are the orchestrator. Merge specialist agent answers into one actionable plan. Call out disagreements. Prefer Spanish if the user writes in Spanish.",
          },
          {
            role: "user",
            content: `User task:\n${userText}\n\nAgent reports:\n${dossier}\n\nProduce the final synthesis.`,
          },
        ],
        onDelta: (delta) => {
          void this.view?.webview.postMessage({
            type: "assistantDelta",
            agentId: synthId,
            text: delta,
          });
        },
      });
      await this.view.webview.postMessage({ type: "assistantDone", agentId: synthId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.view.webview.postMessage({ type: "error", text: `Orchestrator: ${message}` });
    }
  }

  private html(webview: vscode.Webview): string {
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OpenCodex</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border, #444);
      --input: var(--vscode-input-background);
      --btn: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --err: var(--vscode-errorForeground);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 10px; height: 100vh;
      display: flex; flex-direction: column; gap: 8px;
      font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg);
    }
    .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
    .pill.ok { color: #3fb950; border-color: #3fb95055; }
    .pill.bad { color: var(--err); }
    select, input, textarea, button {
      font: inherit; color: var(--fg); background: var(--input);
      border: 1px solid var(--border); border-radius: 6px;
    }
    select, input { padding: 4px 6px; }
    button { background: var(--btn); color: var(--btn-fg); border: none; padding: 6px 10px; cursor: pointer; }
    button.secondary { background: transparent; color: var(--fg); border: 1px solid var(--border); }
    button:disabled { opacity: .5; cursor: default; }
    #agents {
      display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow: auto;
      border: 1px solid var(--border); border-radius: 8px; padding: 6px;
    }
    .agent {
      display: grid; grid-template-columns: auto 1fr auto auto; gap: 6px; align-items: center;
      font-size: 12px;
    }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    #log {
      flex: 1; overflow: auto; border: 1px solid var(--border); border-radius: 8px;
      padding: 8px; display: flex; flex-direction: column; gap: 8px;
    }
    .msg { white-space: pre-wrap; word-break: break-word; font-size: 12.5px; line-height: 1.4; }
    .msg.user { opacity: .95; }
    .msg.assistant { border-left: 3px solid var(--accent, var(--btn)); padding-left: 8px; }
    .msg.error { color: var(--err); }
    .role { font-size: 10px; text-transform: uppercase; color: var(--muted); margin-bottom: 2px; }
    textarea { width: 100%; min-height: 70px; resize: vertical; padding: 8px; }
    .hint { font-size: 11px; color: var(--muted); }
    label.chk { font-size: 11px; color: var(--muted); display: flex; gap: 4px; align-items: center; }
    .addbox { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  </style>
</head>
<body>
  <div class="row">
    <span id="health" class="pill">…</span>
    <span id="ctx" class="pill">context…</span>
    <select id="mode">
      <option value="single">Single agent</option>
      <option value="team">Team + Orchestrator</option>
    </select>
  </div>

  <div id="agents"></div>

  <div class="addbox">
    <input id="newName" placeholder="Nuevo agente (nombre)" />
    <select id="newRole">
      <option value="coder">coder</option>
      <option value="reviewer">reviewer</option>
      <option value="architect">architect</option>
      <option value="debugger">debugger</option>
      <option value="researcher">researcher</option>
      <option value="custom">custom</option>
    </select>
    <select id="newModel"></select>
    <button id="addAgent" class="secondary">+ Agregar agente</button>
  </div>

  <div class="row">
    <label class="chk"><input type="checkbox" id="includeFile" checked /> Active file</label>
    <label class="chk"><input type="checkbox" id="includeSelection" checked /> Selection</label>
  </div>

  <div id="log"></div>
  <div class="row">
    <select id="activeAgent" style="flex:1"></select>
  </div>
  <textarea id="input" placeholder="Tarea para OpenCodex… (Cmd/Ctrl+Enter)"></textarea>
  <div class="row">
    <button id="send">Enviar</button>
    <button id="refresh" class="secondary">Refresh</button>
  </div>
  <div class="hint">Multi-agent · contexto IDE · proxy local · Continue intacto</div>

  <script>
    const vscode = acquireVsCodeApi();
    const state = { agents: [], models: [], bodies: {}, busy: 0 };

    const els = {
      health: document.getElementById('health'),
      ctx: document.getElementById('ctx'),
      agents: document.getElementById('agents'),
      activeAgent: document.getElementById('activeAgent'),
      newModel: document.getElementById('newModel'),
      mode: document.getElementById('mode'),
      log: document.getElementById('log'),
      input: document.getElementById('input'),
      send: document.getElementById('send'),
      includeFile: document.getElementById('includeFile'),
      includeSelection: document.getElementById('includeSelection'),
    };

    function addMsg(role, text, meta = {}) {
      const wrap = document.createElement('div');
      wrap.className = 'msg ' + role;
      if (meta.color) wrap.style.setProperty('--accent', meta.color);
      const label = document.createElement('div');
      label.className = 'role';
      label.textContent = meta.title || role;
      const body = document.createElement('div');
      body.textContent = text;
      wrap.appendChild(label);
      wrap.appendChild(body);
      els.log.appendChild(wrap);
      els.log.scrollTop = els.log.scrollHeight;
      return body;
    }

    function renderAgents() {
      els.agents.innerHTML = '';
      els.activeAgent.innerHTML = '';
      state.agents.forEach((a) => {
        const row = document.createElement('div');
        row.className = 'agent';
        row.style.gridTemplateColumns = 'auto 1fr auto auto auto';

        const left = document.createElement('span');
        left.className = 'dot';
        left.style.background = a.color;

        const mid = document.createElement('div');
        mid.innerHTML = '<strong></strong><div class="hint"></div>';
        mid.querySelector('strong').textContent = a.name;
        mid.querySelector('.hint').textContent = a.role;

        const en = document.createElement('input');
        en.type = 'checkbox';
        en.checked = a.enabled;
        en.title = 'Enabled in team';
        en.onchange = () => {
          a.enabled = en.checked;
          vscode.postMessage({ type: 'agents:save', agents: state.agents });
        };

        const model = document.createElement('select');
        state.models.forEach((id) => {
          const o = document.createElement('option');
          o.value = id; o.textContent = id;
          if (id === a.model) o.selected = true;
          model.appendChild(o);
        });
        model.onchange = () => {
          a.model = model.value;
          vscode.postMessage({ type: 'agents:save', agents: state.agents });
        };

        const rm = document.createElement('button');
        rm.className = 'secondary';
        rm.textContent = '×';
        rm.title = 'Remove agent';
        rm.onclick = () => vscode.postMessage({ type: 'agents:remove', id: a.id });

        row.appendChild(left);
        row.appendChild(mid);
        row.appendChild(en);
        row.appendChild(model);
        row.appendChild(rm);
        els.agents.appendChild(row);

        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name + ' (' + a.role + ')';
        els.activeAgent.appendChild(opt);
      });
    }

    function fillModels(select, selected) {
      select.innerHTML = '';
      state.models.forEach((id) => {
        const o = document.createElement('option');
        o.value = id; o.textContent = id;
        if (id === selected) o.selected = true;
        select.appendChild(o);
      });
    }

    function setBusy(delta) {
      state.busy = Math.max(0, state.busy + delta);
      els.send.disabled = state.busy > 0;
    }

    els.send.onclick = () => {
      const text = els.input.value.trim();
      if (!text || state.busy) return;
      vscode.postMessage({
        type: 'send',
        text,
        mode: els.mode.value,
        agentId: els.activeAgent.value,
      });
      els.input.value = '';
    };
    document.getElementById('refresh').onclick = () => vscode.postMessage({ type: 'refresh' });
    document.getElementById('addAgent').onclick = () => {
      const name = document.getElementById('newName').value.trim() || 'Agent';
      vscode.postMessage({
        type: 'agents:add',
        name,
        role: document.getElementById('newRole').value,
        model: els.newModel.value,
      });
      document.getElementById('newName').value = '';
    };
    const emitCtx = () => vscode.postMessage({
      type: 'toggleContext',
      includeFile: els.includeFile.checked,
      includeSelection: els.includeSelection.checked,
    });
    els.includeFile.onchange = emitCtx;
    els.includeSelection.onchange = emitCtx;
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        els.send.click();
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'meta') {
        els.health.textContent = msg.healthy ? 'online' : 'offline';
        els.health.className = 'pill ' + (msg.healthy ? 'ok' : 'bad');
        state.models = msg.models || [];
        state.agents = msg.agents || [];
        fillModels(els.newModel, msg.defaultModel);
        els.includeFile.checked = !!msg.includeFile;
        els.includeSelection.checked = !!msg.includeSelection;
        renderAgents();
        if (msg.error) addMsg('error', msg.error);
      }
      if (msg.type === 'context') {
        const bits = [];
        if (msg.activeFile) bits.push(msg.activeFile);
        if (msg.hasSelection) bits.push('sel ' + msg.selectionLines);
        bits.push(msg.openFiles + ' visible');
        els.ctx.textContent = bits.join(' · ') || 'no editor';
      }
      if (msg.type === 'prefill') els.input.value = msg.text;
      if (msg.type === 'user') addMsg('user', msg.text, { title: 'you · ' + msg.mode });
      if (msg.type === 'assistantStart') {
        setBusy(1);
        state.bodies[msg.agentId] = addMsg('assistant', '', {
          title: msg.agentName + ' · ' + msg.role + ' · ' + msg.model,
          color: msg.color,
        });
      }
      if (msg.type === 'assistantDelta' && state.bodies[msg.agentId]) {
        state.bodies[msg.agentId].textContent += msg.text;
        els.log.scrollTop = els.log.scrollHeight;
      }
      if (msg.type === 'assistantDone') {
        setBusy(-1);
        delete state.bodies[msg.agentId];
      }
      if (msg.type === 'error') {
        setBusy(-1);
        addMsg('error', msg.text);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
