export type Locale = "es" | "en";

export type Dict = Record<string, string>;

const en: Dict = {
  "view.title": "Multi-Agent",
  "health.online": "online",
  "health.offline": "offline",
  "mode.single": "Single",
  "mode.team": "Team + Orchestrator",
  "mode.pipeline": "Pipeline",
  "mode.debate": "Debate",
  "tab.agents": "Agents",
  "tab.providers": "Providers",
  "tab.sessions": "Sessions",
  "tab.metrics": "Metrics",
  "tab.audit": "Audit",
  "btn.send": "Send",
  "btn.stop": "Stop",
  "btn.refresh": "Refresh",
  "btn.addAgent": "+ Agent",
  "btn.applyPreset": "Apply preset",
  "btn.newSession": "New session",
  "btn.clearAudit": "Clear audit",
  "btn.inlineEdit": "Inline edit",
  "btn.diagnosticsLoop": "Diagnostics loop",
  "btn.testLoop": "Test loop",
  "btn.prHelper": "PR helper",
  "btn.scorecard": "Scorecard",
  "btn.voice": "Voice",
  "btn.enableProvider": "Enable",
  "btn.loginProvider": "Login",
  "chk.file": "File",
  "chk.selection": "Selection",
  "chk.diagnostics": "Diagnostics",
  "chk.diff": "Diff",
  "chk.memory": "Memory",
  "chk.tools": "Tools",
  "chk.showCatalogModels": "Show full catalog models",
  "placeholder.input": "Enter sends · Shift+Enter newline · @file @selection @diff @diagnostics @memory",
  "hint.footer": "Secrets redacted · sensitive paths blocked · tools need approval · Spanish/English UI",
  "providers.hint": "Enable providers via OpenCodex (ocx). Keys go to SecretStorage / ocx — never committed.",
  "models.live": "live",
  "models.catalog": "catalog",
  "locale.label": "Language",
  "tab.usage": "Usage",
  "section.agents": "Agents",
  "section.context": "Context",
  "section.tools": "Quick tools",
  "section.advanced": "Advanced",
  "usage.title": "How much can you use?",
  "usage.intro": "OpenCodex has no own quota. Limits come from each provider you connect.",
  "usage.cheap.title": "Cheap / local",
  "usage.cheap.body": "Ollama or LM Studio on your machine. Almost unlimited tokens; limited by CPU/GPU. Great for drafts and bulk work.",
  "usage.mid.title": "Medium / flexible",
  "usage.mid.body": "OpenRouter, Groq, DeepSeek, Gemini API. Pay-as-you-go. Good daily coding without burning ChatGPT quota.",
  "usage.pro.title": "Strong / premium",
  "usage.pro.body": "ChatGPT/Codex login, Claude OAuth/API, GPT-5.6*. Use for hard tasks. Watch 5h / weekly / 30d bars in ocx gui.",
  "usage.tip": "Team/Pipeline multiplies cost (each agent = one call). Prefer Single for routine asks.",
  "usage.openGui": "Open OpenCodex dashboard",
  "usage.refresh": "Refresh quotas",
  "usage.liveTitle": "Live usage",
  "usage.used": "used",
  "usage.remaining": "left",
  "usage.resets": "resets",
  "usage.loading": "Refreshing quotas…",
  "usage.empty": "No quota data yet. Connect ChatGPT/Codex with ocx login, then refresh.",
  "usage.plan": "plan",
  "usage.needsReauth": "needs re-login",
  "usage.active": "active",
  "usage.updated": "updated",
  "brand.tag": "Multi-agent chat · local proxy",
  "usage.stripEmpty": "Refresh to load live quotas…",
};

const es: Dict = {
  "view.title": "Multi-Agente",
  "health.online": "en línea",
  "health.offline": "fuera de línea",
  "mode.single": "Individual",
  "mode.team": "Equipo + Orquestador",
  "mode.pipeline": "Pipeline",
  "mode.debate": "Debate",
  "tab.agents": "Agentes",
  "tab.providers": "Proveedores",
  "tab.sessions": "Sesiones",
  "tab.metrics": "Métricas",
  "tab.audit": "Auditoría",
  "btn.send": "Enviar",
  "btn.stop": "Detener",
  "btn.refresh": "Actualizar",
  "btn.addAgent": "+ Agente",
  "btn.applyPreset": "Aplicar preset",
  "btn.newSession": "Nueva sesión",
  "btn.clearAudit": "Limpiar auditoría",
  "btn.inlineEdit": "Edición inline",
  "btn.diagnosticsLoop": "Loop diagnósticos",
  "btn.testLoop": "Loop tests",
  "btn.prHelper": "Ayuda PR",
  "btn.scorecard": "Scorecard",
  "btn.voice": "Voz",
  "btn.enableProvider": "Activar",
  "btn.loginProvider": "Iniciar sesión",
  "chk.file": "Archivo",
  "chk.selection": "Selección",
  "chk.diagnostics": "Diagnósticos",
  "chk.diff": "Diff",
  "chk.memory": "Memoria",
  "chk.tools": "Herramientas",
  "chk.showCatalogModels": "Mostrar catálogo completo",
  "placeholder.input": "Enter envía · Shift+Enter nueva línea · @file @selection @diff @diagnostics @memory",
  "hint.footer": "Secretos redactados · rutas sensibles bloqueadas · tools con aprobación · UI ES/EN",
  "providers.hint": "Activa proveedores con OpenCodex (ocx). Las claves van a SecretStorage/ocx — nunca al repo.",
  "models.live": "activo",
  "models.catalog": "catálogo",
  "locale.label": "Idioma",
  "tab.usage": "Uso",
  "section.agents": "Agentes",
  "section.context": "Contexto",
  "section.tools": "Herramientas rápidas",
  "section.advanced": "Avanzado",
  "usage.title": "¿Cuánto se puede usar?",
  "usage.intro": "OpenCodex no tiene cupo propio. El límite lo pone cada proveedor que conectes.",
  "usage.cheap.title": "Barato / local",
  "usage.cheap.body": "Ollama o LM Studio en tu máquina. Casi ilimitado en tokens; te limita CPU/GPU. Ideal para borradores y volumen.",
  "usage.mid.title": "Medio / flexible",
  "usage.mid.body": "OpenRouter, Groq, DeepSeek, Gemini API. Pagas por uso. Bueno para codear todos los días sin quemar ChatGPT.",
  "usage.pro.title": "Fuerte / premium",
  "usage.pro.body": "Login ChatGPT/Codex, Claude OAuth/API, GPT-5.6*. Para lo difícil. Mirá barras 5h / semanal / 30d en ocx gui.",
  "usage.tip": "Equipo/Pipeline multiplica el gasto (cada agente = una llamada). Usá Individual para lo rutinario.",
  "usage.openGui": "Abrir dashboard OpenCodex",
  "usage.refresh": "Actualizar cuotas",
  "usage.liveTitle": "Uso en vivo",
  "usage.used": "usado",
  "usage.remaining": "resta",
  "usage.resets": "renueva",
  "usage.loading": "Actualizando cuotas…",
  "usage.empty": "Sin datos de cuota. Conectá ChatGPT/Codex con ocx login y actualizá.",
  "usage.plan": "plan",
  "usage.needsReauth": "requiere re-login",
  "usage.active": "activa",
  "usage.updated": "actualizado",
  "brand.tag": "Chat multi-agente · proxy local",
  "usage.stripEmpty": "Actualizá para ver cuotas en vivo…",
};

const TABLES: Record<Locale, Dict> = { en, es };

export function normalizeLocale(value: string | undefined): Locale {
  if (!value || value === "auto") {
    const env = (process.env.VSCODE_NLS_CONFIG && safeParseLang(process.env.VSCODE_NLS_CONFIG)) || "";
    return env.startsWith("es") ? "es" : "en";
  }
  return value.startsWith("es") ? "es" : "en";
}

function safeParseLang(raw: string): string {
  try {
    return String(JSON.parse(raw).locale || "");
  } catch {
    return "";
  }
}

export function t(locale: Locale, key: string): string {
  return TABLES[locale][key] || TABLES.en[key] || key;
}

export function table(locale: Locale): Dict {
  return TABLES[locale];
}
