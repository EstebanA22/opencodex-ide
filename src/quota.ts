import { execFile } from "child_process";
import { promisify } from "util";
import { redactSecrets } from "./security";

const execFileAsync = promisify(execFile);

export type QuotaWindow = {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetAt?: string; // ISO
  resetLabel?: string;
};

export type QuotaAccount = {
  id: string;
  label: string;
  plan?: string;
  active?: boolean;
  needsReauth?: boolean;
  windows: QuotaWindow[];
};

export type QuotaSnapshot = {
  fetchedAt: string;
  accounts: QuotaAccount[];
  providers: Array<{ id: string; windows: QuotaWindow[]; note?: string }>;
  error?: string;
};

function envMinimal(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG,
  };
}

function toIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const ms = value < 10_000_000_000 ? value * 1000 : value;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function formatReset(iso?: string, locale = "es"): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = Date.now();
  const diff = d.getTime() - now;
  if (diff <= 0) return locale.startsWith("es") ? "ya renovó / renovando" : "already reset / renewing";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return locale.startsWith("es") ? `en ${mins} min` : `in ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return locale.startsWith("es") ? `en ${hrs} h` : `in ${hrs} h`;
  const days = Math.round(hrs / 24);
  return locale.startsWith("es") ? `en ${days} d` : `in ${days} d`;
}

function windowLabel(key: "5h" | "weekly" | "monthly" | "30d" | string, locale: string): string {
  const es = locale.startsWith("es");
  if (key === "5h") return "5h";
  if (key === "weekly") return es ? "semanal" : "weekly";
  if (key === "monthly") return es ? "mensual" : "monthly";
  if (key === "30d") return "30d";
  return key;
}

function windowFrom(
  key: string,
  percent: unknown,
  resetAt: unknown,
  locale: string
): QuotaWindow | undefined {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return undefined;
  const used = Math.max(0, Math.min(100, Math.round(percent)));
  const iso = toIso(resetAt);
  return {
    label: windowLabel(key, locale),
    usedPercent: used,
    remainingPercent: Math.max(0, 100 - used),
    resetAt: iso,
    resetLabel: formatReset(iso, locale),
  };
}

function parseCodexAccounts(raw: unknown, locale: string): QuotaAccount[] {
  const root = raw as { accounts?: unknown[] };
  const rows = Array.isArray(root?.accounts) ? root.accounts : Array.isArray(raw) ? raw : [];
  const out: QuotaAccount[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id || "account");
    const email = typeof r.email === "string" ? r.email : "";
    const masked =
      email && email.includes("@")
        ? `${email.slice(0, 2)}***@${email.split("@")[1]}`
        : id === "main"
          ? "main"
          : id.slice(0, 10);
    const q = (r.quota || {}) as Record<string, unknown>;
    const windows = [
      windowFrom("5h", q.fiveHourPercent, q.fiveHourResetAt, locale),
      windowFrom("weekly", q.weeklyPercent, q.weeklyResetAt, locale),
      windowFrom("monthly", q.monthlyPercent, q.monthlyResetAt, locale),
      windowFrom("30d", q.thirtyDayPercent, q.thirtyDayResetAt, locale),
    ].filter(Boolean) as QuotaWindow[];
    if (Array.isArray(q.customWindows)) {
      for (const w of q.customWindows) {
        if (!w || typeof w !== "object") continue;
        const cw = w as Record<string, unknown>;
        const built = windowFrom(String(cw.label || "custom"), cw.percent, cw.resetAt, locale);
        if (built) windows.push(built);
      }
    }
    out.push({
      id,
      label: String(r.label || masked),
      plan: typeof r.plan === "string" ? r.plan : undefined,
      active: Boolean(r.active),
      needsReauth: Boolean(r.needsReauth),
      windows,
    });
  }
  return out;
}

function parseProviderQuota(raw: unknown, locale: string): QuotaSnapshot["providers"] {
  if (!raw || typeof raw !== "object") return [];
  // shapes: { provider, report } or { reports: [] } or map
  const obj = raw as Record<string, unknown>;
  const list: Array<{ id: string; quota: Record<string, unknown>; note?: string }> = [];
  if (obj.report && typeof obj.report === "object") {
    const report = obj.report as Record<string, unknown>;
    list.push({
      id: String(obj.provider || "provider"),
      quota: (report.quota as Record<string, unknown>) || report,
    });
  } else if (Array.isArray(obj.reports)) {
    for (const r of obj.reports) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      list.push({
        id: String(rr.provider || rr.id || "provider"),
        quota: ((rr.quota as Record<string, unknown>) || (rr.report as Record<string, unknown>) || rr) as Record<
          string,
          unknown
        >,
      });
    }
  }
  return list.map((item) => {
    const q = item.quota;
    const windows = [
      windowFrom("5h", q.fiveHourPercent, q.fiveHourResetAt, locale),
      windowFrom("weekly", q.weeklyPercent, q.weeklyResetAt, locale),
      windowFrom("monthly", q.monthlyPercent, q.monthlyResetAt, locale),
      windowFrom("30d", q.thirtyDayPercent, q.thirtyDayResetAt, locale),
    ].filter(Boolean) as QuotaWindow[];
    return {
      id: item.id,
      windows,
      note: windows.length ? undefined : locale.startsWith("es") ? "sin reporte de cuota" : "no quota report",
    };
  });
}

async function runJson(args: string[], timeoutMs = 20_000): Promise<unknown> {
  const { stdout } = await execFileAsync("ocx", args, {
    timeout: timeoutMs,
    env: envMinimal(),
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function fetchQuotaSnapshot(locale = "es"): Promise<QuotaSnapshot> {
  const fetchedAt = new Date().toISOString();
  try {
    const accountsRaw = await runJson(["account", "refresh", "openai", "--json"]);
    const accounts = parseCodexAccounts(accountsRaw, locale);

    // Best-effort extras in parallel; ignore failures / timeouts so UI stays snappy.
    const names = ["anthropic", "openrouter", "google"];
    const extras = await Promise.all(
      names.map(async (name) => {
        try {
          const raw = await runJson(["account", "refresh", name, "--json"], 8_000);
          return parseProviderQuota(raw, locale);
        } catch {
          return [] as QuotaSnapshot["providers"];
        }
      })
    );
    const providers = extras.flat().filter((p) => p.windows.length);

    return { fetchedAt, accounts, providers };
  } catch (err) {
    return {
      fetchedAt,
      accounts: [],
      providers: [],
      error: redactSecrets(err instanceof Error ? err.message : String(err)),
    };
  }
}
