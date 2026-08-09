import * as vscode from "vscode";

export type AgentRole = "coder" | "reviewer" | "architect" | "debugger" | "researcher" | "custom";

export type AgentDef = {
  id: string;
  name: string;
  role: AgentRole;
  model: string;
  systemPrompt: string;
  enabled: boolean;
  color: string;
};

const STORAGE_KEY = "opencodex.agents.v1";

const ROLE_PROMPTS: Record<Exclude<AgentRole, "custom">, string> = {
  coder:
    "You are a senior implementation agent. Write concrete code, patches, and commands. Prefer minimal correct changes. If the user writes in Spanish, reply in Spanish.",
  reviewer:
    "You are a strict code reviewer. Focus on bugs, security, regressions, missing tests, and API misuse. Be blunt and specific. Prefer Spanish if the user writes in Spanish.",
  architect:
    "You are a software architect. Propose structure, boundaries, trade-offs, and sequencing. Avoid unnecessary abstractions. Prefer Spanish if the user writes in Spanish.",
  debugger:
    "You are a debugging specialist. Form hypotheses, ask for the smallest repro evidence, and propose precise fixes. Prefer Spanish if the user writes in Spanish.",
  researcher:
    "You are a research agent. Survey options, compare approaches, and cite trade-offs clearly. Prefer Spanish if the user writes in Spanish.",
};

const COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#ef4444", "#14b8a6", "#e11d48"];

function uid(): string {
  return `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultAgents(defaultModel: string): AgentDef[] {
  const roles: Array<Exclude<AgentRole, "custom">> = ["coder", "reviewer", "architect"];
  return roles.map((role, i) => ({
    id: uid(),
    name: role[0].toUpperCase() + role.slice(1),
    role,
    model: defaultModel,
    systemPrompt: ROLE_PROMPTS[role],
    enabled: i === 0,
    color: COLORS[i % COLORS.length],
  }));
}

export class AgentStore {
  constructor(private readonly state: vscode.Memento) {}

  load(defaultModel: string): AgentDef[] {
    const raw = this.state.get<AgentDef[]>(STORAGE_KEY);
    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      const seeded = defaultAgents(defaultModel);
      void this.save(seeded);
      return seeded;
    }
    return raw;
  }

  async save(agents: AgentDef[]): Promise<void> {
    await this.state.update(STORAGE_KEY, agents);
  }

  create(partial: Partial<AgentDef> & { name: string }, defaultModel: string): AgentDef {
    const role = partial.role ?? "custom";
    return {
      id: uid(),
      name: partial.name,
      role,
      model: partial.model ?? defaultModel,
      systemPrompt:
        partial.systemPrompt ??
        (role === "custom"
          ? "You are a helpful specialist agent inside Cursor. Prefer Spanish if the user writes in Spanish."
          : ROLE_PROMPTS[role]),
      enabled: partial.enabled ?? true,
      color: partial.color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  }
}

export { ROLE_PROMPTS };
