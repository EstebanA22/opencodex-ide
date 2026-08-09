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
