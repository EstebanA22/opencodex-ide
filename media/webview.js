(function () {
  const vscode = acquireVsCodeApi();
  const state = {
    agents: [],
    models: [],
    modelMeta: [],
    providers: [],
    sessions: [],
    presets: [],
    bodies: {},
    busy: 0,
    queue: [],
    metrics: [],
    audit: [],
    lastAssistant: {},
    i18n: {},
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    health: $("health"),
    ctx: $("ctx"),
    agents: $("agents"),
    providers: $("providers"),
    sessions: $("sessions"),
    metrics: $("metrics"),
    audit: $("audit"),
    activeAgent: $("activeAgent"),
    newModel: $("newModel"),
    mode: $("mode"),
    preset: $("preset"),
    locale: $("locale"),
    log: $("log"),
    input: $("input"),
    send: $("send"),
    stop: $("stop"),
    includeFile: $("includeFile"),
    includeSelection: $("includeSelection"),
    includeDiagnostics: $("includeDiagnostics"),
    includeGitDiff: $("includeGitDiff"),
    includeMemory: $("includeMemory"),
    enableTools: $("enableTools"),
    showCatalogModels: $("showCatalogModels"),
    budget: $("budget"),
    debateRounds: $("debateRounds"),
    queue: $("queue"),
  };

  function tt(key) {
    return state.i18n[key] || key;
  }

  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key && state.i18n[key]) el.textContent = state.i18n[key];
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key && state.i18n[key]) el.setAttribute("placeholder", state.i18n[key]);
    });
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMarkdown(text) {
    let html = esc(text);
    html = html.replace(/```([\w.+-]*)?(?:[ \t]+(path:)?([^\n]+))?\n([\s\S]*?)```/g, (_, lang, _p, path, body) => {
      const label = path ? esc(path) : esc(lang || "code");
      return `<pre data-path="${path ? esc(path) : ""}"><div class="hint">${label}</div>${esc(body)}</pre>`;
    });
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/\n/g, "<br/>");
    return `<div class="md">${html}</div>`;
  }

  function addMsg(role, text, meta = {}) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    if (meta.color) wrap.style.setProperty("--accent", meta.color);
    const label = document.createElement("div");
    label.className = "role";
    label.innerHTML = `<span>${esc(meta.title || role)}</span><span>${esc(meta.right || "")}</span>`;
    const body = document.createElement("div");
    if (role === "assistant") body.innerHTML = renderMarkdown(text || "");
    else body.textContent = text || "";
    wrap.appendChild(label);
    wrap.appendChild(body);
    if (role === "assistant") {
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.innerHTML = `
        <button class="secondary" data-act="copy">Copy</button>
        <button class="secondary" data-act="insert">Insert</button>
        <button class="secondary" data-act="apply">Apply</button>
        <button class="secondary" data-act="regen">Regen</button>
      `;
      actions.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        const act = btn.getAttribute("data-act");
        const content = meta.raw || text || "";
        if (act === "copy") vscode.postMessage({ type: "clipboard", text: content });
        if (act === "insert") vscode.postMessage({ type: "insert", text: content });
        if (act === "apply") vscode.postMessage({ type: "apply", text: content });
        if (act === "regen") vscode.postMessage({ type: "regen", agentId: meta.agentId });
      });
      wrap.appendChild(actions);
    }
    els.log.appendChild(wrap);
    els.log.scrollTop = els.log.scrollHeight;
    return {
      wrap,
      body,
      setText(t) {
        meta.raw = t;
        if (role === "assistant") body.innerHTML = renderMarkdown(t);
        else body.textContent = t;
      },
    };
  }

  function setBusy(delta) {
    state.busy = Math.max(0, state.busy + delta);
    els.send.disabled = state.busy > 0;
    els.stop.disabled = state.busy <= 0;
    flushQueue();
  }

  function flushQueue() {
    els.queue.textContent = state.queue.length ? `Queue: ${state.queue.length}` : "";
    if (state.busy === 0 && state.queue.length) {
      const next = state.queue.shift();
      sendNow(next);
    }
  }

  function modelLabel(id) {
    const meta = state.modelMeta.find((m) => m.id === id);
    if (!meta) return id;
    const tag = meta.source === "live" ? tt("models.live") : tt("models.catalog");
    return `${id} (${tag})`;
  }

  function fillModels(select, selected) {
    select.innerHTML = "";
    state.models.forEach((id) => {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = modelLabel(id);
      if (id === selected) o.selected = true;
      select.appendChild(o);
    });
  }

  function renderAgents() {
    els.agents.innerHTML = "";
    els.activeAgent.innerHTML = "";
    state.agents.forEach((a) => {
      const row = document.createElement("div");
      row.className = "agent";
      const left = document.createElement("span");
      left.className = "dot";
      left.style.background = a.color;
      const mid = document.createElement("div");
      mid.innerHTML = `<strong></strong><div class="hint"></div>`;
      mid.querySelector("strong").textContent = a.name;
      mid.querySelector(".hint").textContent = a.role;
      const en = document.createElement("input");
      en.type = "checkbox";
      en.checked = a.enabled;
      en.onchange = () => {
        a.enabled = en.checked;
        vscode.postMessage({ type: "agents:save", agents: state.agents });
      };
      const model = document.createElement("select");
      fillModels(model, a.model);
      model.onchange = () => {
        a.model = model.value;
        vscode.postMessage({ type: "agents:save", agents: state.agents });
      };
      const rm = document.createElement("button");
      rm.className = "secondary";
      rm.textContent = "×";
      rm.onclick = () => vscode.postMessage({ type: "agents:remove", id: a.id });
      row.append(left, mid, en, model, rm);
      els.agents.appendChild(row);
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.name} (${a.role})`;
      els.activeAgent.appendChild(opt);
    });
  }

  function renderProviders() {
    if (!els.providers) return;
    els.providers.innerHTML = "";
    state.providers.forEach((p) => {
      const row = document.createElement("div");
      row.className = "row";
      row.style.justifyContent = "space-between";
      const left = document.createElement("div");
      left.innerHTML = `<strong></strong><div class="hint"></div>`;
      left.querySelector("strong").textContent = p.name;
      left.querySelector(".hint").textContent = `${p.id} · ${p.auth} · ${p.configured ? "ON" : "off"} · ${p.seedModels.length} models`;
      const btn = document.createElement("button");
      btn.className = "secondary";
      btn.textContent = p.auth === "oauth" ? tt("btn.loginProvider") : tt("btn.enableProvider");
      if (p.configured) {
        btn.textContent = "OK";
        btn.disabled = p.id !== "custom";
      }
      btn.onclick = () => vscode.postMessage({ type: "provider:enable", id: p.id });
      row.append(left, btn);
      els.providers.appendChild(row);
    });
  }

  function renderSessions() {
    els.sessions.innerHTML = "";
    state.sessions.forEach((s) => {
      const row = document.createElement("div");
      row.className = "row";
      const btn = document.createElement("button");
      btn.className = "secondary";
      btn.textContent = `${s.pinned ? "📌 " : ""}${s.title}`;
      btn.onclick = () => vscode.postMessage({ type: "session:open", id: s.id });
      const pin = document.createElement("button");
      pin.className = "secondary";
      pin.textContent = "Pin";
      pin.onclick = () => vscode.postMessage({ type: "session:pin", id: s.id });
      const exp = document.createElement("button");
      exp.className = "secondary";
      exp.textContent = "Export";
      exp.onclick = () => vscode.postMessage({ type: "session:export", id: s.id });
      const del = document.createElement("button");
      del.className = "secondary";
      del.textContent = "Del";
      del.onclick = () => vscode.postMessage({ type: "session:remove", id: s.id });
      row.append(btn, pin, exp, del);
      els.sessions.appendChild(row);
    });
  }

  function renderMetrics() {
    els.metrics.innerHTML = state.metrics
      .slice(0, 30)
      .map((m) => `<div>${esc(m.agent)} · ${esc(m.model)} · ${m.latencyMs}ms · ~${m.tokensApprox || 0} tok ${m.failover ? "· failover" : ""}</div>`)
      .join("") || "<div class='hint'>—</div>";
  }

  function renderAudit() {
    els.audit.innerHTML = state.audit
      .slice(0, 40)
      .map((a) => `<div><strong>${esc(a.kind)}</strong> ${esc(a.detail)}</div>`)
      .join("") || "<div class='hint'>—</div>";
  }

  function contextFlags() {
    return {
      includeFile: els.includeFile.checked,
      includeSelection: els.includeSelection.checked,
      includeDiagnostics: els.includeDiagnostics.checked,
      includeGitDiff: els.includeGitDiff.checked,
      includeMemory: els.includeMemory.checked,
      enableTools: els.enableTools.checked,
      showCatalogModels: els.showCatalogModels ? els.showCatalogModels.checked : true,
      budget: Number(els.budget.value || 0),
      debateRounds: Number(els.debateRounds.value || 2),
    };
  }

  function sendNow(text) {
    vscode.postMessage({
      type: "send",
      text,
      mode: els.mode.value,
      agentId: els.activeAgent.value,
      ...contextFlags(),
    });
  }

  function enqueueOrSend() {
    const text = els.input.value.trim();
    if (!text) return;
    els.input.value = "";
    if (state.busy > 0) {
      state.queue.push(text);
      flushQueue();
      return;
    }
    sendNow(text);
  }

  $("send").onclick = enqueueOrSend;
  $("stop").onclick = () => vscode.postMessage({ type: "stop" });
  $("refresh").onclick = () => vscode.postMessage({ type: "refresh" });
  $("newSession").onclick = () => vscode.postMessage({ type: "session:new" });
  $("clearAudit").onclick = () => vscode.postMessage({ type: "audit:clear" });
  $("scorecard").onclick = () => vscode.postMessage({ type: "scorecard" });
  $("inlineEdit").onclick = () => vscode.postMessage({ type: "inlineEdit", instruction: els.input.value.trim() });
  $("diagnosticsLoop").onclick = () => vscode.postMessage({ type: "diagnosticsLoop" });
  $("testLoop").onclick = () => vscode.postMessage({ type: "testLoop" });
  $("prHelper").onclick = () => vscode.postMessage({ type: "prHelper" });
  $("voice").onclick = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      addMsg("error", "Speech recognition not available in this host.");
      return;
    }
    const rec = new SR();
    rec.lang = els.locale && els.locale.value === "en" ? "en-US" : "es-ES";
    rec.onresult = (ev) => {
      els.input.value = (els.input.value + " " + ev.results[0][0].transcript).trim();
    };
    rec.start();
  };
  $("addAgent").onclick = () => {
    vscode.postMessage({
      type: "agents:add",
      name: $("newName").value.trim() || "Agent",
      role: $("newRole").value,
      model: els.newModel.value,
    });
    $("newName").value = "";
  };
  $("applyPreset").onclick = () => vscode.postMessage({ type: "preset:apply", id: els.preset.value });
  if (els.locale) els.locale.onchange = () => vscode.postMessage({ type: "locale:set", locale: els.locale.value });

  document.querySelectorAll(".tabs button").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ["agents", "providers", "sessions", "metrics", "audit"].forEach((name) => {
        const panel = $("panel-" + name);
        if (panel) panel.classList.toggle("hidden", btn.dataset.tab !== name);
      });
    };
  });

  ["includeFile", "includeSelection", "includeDiagnostics", "includeGitDiff", "includeMemory"].forEach((id) => {
    const node = $(id);
    if (node) node.onchange = () => vscode.postMessage({ type: "toggleContext", ...contextFlags() });
  });
  if (els.showCatalogModels) {
    els.showCatalogModels.onchange = () =>
      vscode.postMessage({ type: "catalog:set", showCatalogModels: els.showCatalogModels.checked });
  }

  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      enqueueOrSend();
    }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "meta") {
      state.i18n = msg.i18n || {};
      applyI18n();
      els.health.textContent = msg.healthy ? tt("health.online") : tt("health.offline");
      els.health.className = "pill " + (msg.healthy ? "ok" : "bad");
      state.models = msg.models || [];
      state.modelMeta = msg.modelMeta || state.models.map((id) => ({ id, source: "live" }));
      state.agents = msg.agents || [];
      state.sessions = msg.sessions || [];
      state.presets = msg.presets || [];
      state.providers = msg.providers || [];
      state.metrics = msg.metrics || [];
      state.audit = msg.audit || [];
      if (msg.locale && els.locale) els.locale.value = msg.locale;
      fillModels(els.newModel, msg.defaultModel);
      els.preset.innerHTML = "";
      state.presets.forEach((p) => {
        const o = document.createElement("option");
        o.value = p.id;
        o.textContent = `${p.name} (${p.mode})`;
        els.preset.appendChild(o);
      });
      els.includeFile.checked = !!msg.includeFile;
      els.includeSelection.checked = !!msg.includeSelection;
      els.includeDiagnostics.checked = !!msg.includeDiagnostics;
      els.includeGitDiff.checked = !!msg.includeGitDiff;
      els.includeMemory.checked = !!msg.includeMemory;
      els.enableTools.checked = !!msg.enableTools;
      if (els.showCatalogModels) els.showCatalogModels.checked = !!msg.showCatalogModels;
      renderAgents();
      renderProviders();
      renderSessions();
      renderMetrics();
      renderAudit();
      if (msg.error) addMsg("error", msg.error);
    }
    if (msg.type === "context") {
      const bits = [];
      if (msg.activeFile) bits.push(msg.activeFile);
      if (msg.hasSelection) bits.push("sel " + msg.selectionLines);
      bits.push((msg.openFiles || 0) + " visible");
      els.ctx.textContent = bits.join(" · ") || "no editor";
    }
    if (msg.type === "prefill") els.input.value = msg.text;
    if (msg.type === "clearLog") els.log.innerHTML = "";
    if (msg.type === "user") addMsg("user", msg.text, { title: "you · " + msg.mode });
    if (msg.type === "assistantStart") {
      setBusy(1);
      const handle = addMsg("assistant", "", {
        title: `${msg.agentName} · ${msg.role} · ${msg.model}`,
        color: msg.color,
        agentId: msg.agentId,
        raw: "",
      });
      state.bodies[msg.agentId] = handle;
      state.lastAssistant[msg.agentId] = "";
    }
    if (msg.type === "assistantDelta" && state.bodies[msg.agentId]) {
      state.lastAssistant[msg.agentId] = (state.lastAssistant[msg.agentId] || "") + msg.text;
      state.bodies[msg.agentId].setText(state.lastAssistant[msg.agentId]);
      els.log.scrollTop = els.log.scrollHeight;
    }
    if (msg.type === "assistantDone") {
      setBusy(-1);
      delete state.bodies[msg.agentId];
    }
    if (msg.type === "metric") {
      state.metrics = [msg.metric, ...state.metrics].slice(0, 50);
      renderMetrics();
    }
    if (msg.type === "audit") {
      state.audit = msg.audit || state.audit;
      renderAudit();
    }
    if (msg.type === "error") {
      setBusy(-1);
      addMsg("error", msg.text);
    }
    if (msg.type === "info") addMsg("user", msg.text, { title: "system" });
  });

  vscode.postMessage({ type: "ready" });
})();
