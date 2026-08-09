import * as vscode from "vscode";
import { redactSecrets } from "./security";

export type AuditEvent = {
  ts: string;
  kind: string;
  detail: string;
  meta?: Record<string, string | number | boolean | undefined>;
};

const KEY = "opencodex.audit.v1";
const MAX = 200;

export class AuditLog {
  constructor(private readonly state: vscode.Memento) {}

  list(): AuditEvent[] {
    return this.state.get<AuditEvent[]>(KEY, []);
  }

  async record(kind: string, detail: string, meta?: AuditEvent["meta"]): Promise<void> {
    const safeMeta = meta
      ? Object.fromEntries(
          Object.entries(meta).map(([k, v]) => {
            if (typeof v === "string" && /key|token|secret|password|authorization/i.test(k)) {
              return [k, "[REDACTED]"];
            }
            return [k, typeof v === "string" ? redactSecrets(v).slice(0, 500) : v];
          })
        )
      : undefined;
    const next: AuditEvent[] = [
      {
        ts: new Date().toISOString(),
        kind,
        detail: redactSecrets(detail).slice(0, 1000),
        meta: safeMeta,
      },
      ...this.list(),
    ].slice(0, MAX);
    await this.state.update(KEY, next);
  }

  async clear(): Promise<void> {
    await this.state.update(KEY, []);
  }
}
