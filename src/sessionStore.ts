import * as vscode from "vscode";
import { redactSecrets } from "./security";

export type ChatTurn = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "error";
  content: string;
  agentId?: string;
  agentName?: string;
  model?: string;
  ts: string;
  latencyMs?: number;
  tokensApprox?: number;
};

export type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
  pinned?: boolean;
};

const KEY = "opencodex.sessions.v1";
const ACTIVE = "opencodex.sessions.active";
const MAX_SESSIONS = 40;
const MAX_TURNS = 200;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export class SessionStore {
  constructor(private readonly state: vscode.Memento) {}

  list(): Session[] {
    return this.state.get<Session[]>(KEY, []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  activeId(): string | undefined {
    return this.state.get<string>(ACTIVE);
  }

  async setActive(id: string): Promise<void> {
    await this.state.update(ACTIVE, id);
  }

  get(id: string): Session | undefined {
    return this.list().find((s) => s.id === id);
  }

  async ensureActive(): Promise<Session> {
    const id = this.activeId();
    const existing = id ? this.get(id) : undefined;
    if (existing) return existing;
    return this.create("New chat");
  }

  async create(title: string): Promise<Session> {
    const session: Session = {
      id: uid("sess"),
      title: title.slice(0, 80) || "New chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turns: [],
    };
    const next = [session, ...this.list()].slice(0, MAX_SESSIONS);
    await this.state.update(KEY, next);
    await this.setActive(session.id);
    return session;
  }

  async rename(id: string, title: string): Promise<void> {
    await this.patch(id, { title: title.slice(0, 80) });
  }

  async pin(id: string, pinned: boolean): Promise<void> {
    await this.patch(id, { pinned });
  }

  async remove(id: string): Promise<void> {
    const next = this.list().filter((s) => s.id !== id);
    await this.state.update(KEY, next);
    if (this.activeId() === id) {
      await this.state.update(ACTIVE, next[0]?.id);
    }
  }

  async appendTurn(id: string, turn: Omit<ChatTurn, "id" | "ts"> & { id?: string; ts?: string }): Promise<ChatTurn> {
    const full: ChatTurn = {
      id: turn.id ?? uid("turn"),
      ts: turn.ts ?? new Date().toISOString(),
      ...turn,
      content: redactSecrets(turn.content),
    };
    const session = this.get(id);
    if (!session) throw new Error("session not found");
    const turns = [...session.turns, full].slice(-MAX_TURNS);
    const title =
      session.turns.length === 0 && turn.role === "user"
        ? turn.content.trim().slice(0, 48) || session.title
        : session.title;
    await this.patch(id, { turns, title, updatedAt: new Date().toISOString() });
    return full;
  }

  async exportMarkdown(id: string): Promise<string> {
    const session = this.get(id);
    if (!session) return "";
    const lines = [`# ${session.title}`, "", `Updated: ${session.updatedAt}`, ""];
    for (const t of session.turns) {
      const who = t.agentName || t.role;
      lines.push(`## ${who}`, "", redactSecrets(t.content), "");
    }
    return lines.join("\n");
  }

  private async patch(id: string, partial: Partial<Session>): Promise<void> {
    const next = this.list().map((s) => (s.id === id ? { ...s, ...partial } : s));
    await this.state.update(KEY, next);
  }
}
