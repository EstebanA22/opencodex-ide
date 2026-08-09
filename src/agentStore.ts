import * as vscode from "vscode";

export type AgentRole =
  | "coder"
  | "reviewer"
  | "architect"
  | "debugger"
  | "researcher"
  | "tester"
  | "security"
  | "custom";

export type AgentDef = {
  id: string;
  name: string;
  role: AgentRole;
  model: string;
  systemPrompt: string;
  enabled: boolean;
  color: string;
};

export type RunMode = "single" | "team" | "pipeline" | "debate";

export type TeamPreset = {
  id: string;
  name: string;
  mode: RunMode;
  roles: AgentRole[];
  description: string;
};

const STORAGE_KEY = "opencodex.agents.v1";

export const ROLE_PROMPTS: Record<Exclude<AgentRole, "custom">, string> = {
  coder:
    "You are a senior implementation agent. Write concrete code and path:file fenced blocks for Apply. Prefer minimal correct changes. Spanish if user writes Spanish.",
  reviewer:
    "You are a strict code reviewer. Focus on bugs, security, regressions, missing tests. Be blunt. Spanish if user writes Spanish.",
  architect:
    "You are a software architect. Propose structure, boundaries, trade-offs, sequencing. Avoid unnecessary abstractions. Spanish if user writes Spanish.",
  debugger:
    "You are a debugging specialist. Form hypotheses and precise fixes. Spanish if user writes Spanish.",
  researcher:
    "You are a research agent. Compare approaches and trade-offs clearly. Spanish if user writes Spanish.",
  tester:
    "You are a QA/testing agent. Propose tests, edge cases, and reproduction steps. Spanish if user writes Spanish.",
  security:
    "You are an application security reviewer. Hunt for injection, secret leaks, authZ bugs, unsafe tool use. Spanish if user writes Spanish.",
};

export const TEAM_PRESETS: TeamPreset[] = [
  {
    id: "pr-review",
    name: "PR Review",
    mode: "pipeline",
    roles: ["reviewer", "security", "tester"],
    description: "Review → Security → Tester",
  },
  {
    id: "bug-hunt",
    name: "Bug Hunt",
    mode: "pipeline",
    roles: ["debugger", "coder", "tester"],
    description: "Debug → Fix → Verify",
  },
  {
    id: "feature-slice",
    name: "Feature Slice",
    mode: "pipeline",
    roles: ["architect", "coder", "reviewer"],
    description: "Design → Build → Review",
  },
  {
    id: "security-pass",
    name: "Security Pass",
    mode: "team",
    roles: ["security", "reviewer"],
    description: "Parallel security + review",
  },
  {
    id: "debate",
    name: "Debate",
    mode: "debate",
    roles: ["architect", "coder"],
    description: "Two agents debate, then orchestrator decides",
  },
];

const COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#ef4444", "#14b8a6", "#e11d48", "#64748b"];

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

  async applyPreset(presetId: string, defaultModel: string): Promise<AgentDef[]> {
    const preset = TEAM_PRESETS.find((p) => p.id === presetId);
    if (!preset) throw new Error("Unknown preset");
    const agents = preset.roles.map((role, i) => {
      const named = role as Exclude<AgentRole, "custom">;
      return this.create(
        {
          name: named[0].toUpperCase() + named.slice(1),
          role: named,
          model: defaultModel,
          enabled: true,
          color: COLORS[i % COLORS.length],
          systemPrompt: ROLE_PROMPTS[named],
        },
        defaultModel
      );
    });
    await this.save(agents);
    return agents;
  }
}

export { ROLE_PROMPTS as rolePrompts };
