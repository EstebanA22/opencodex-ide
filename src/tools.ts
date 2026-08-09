import * as vscode from "vscode";
import { assertSafeWorkspacePath, isBlockedPath, redactSecrets } from "./security";

export type ToolName = "read_file" | "grep" | "list_dir" | "git_status" | "git_diff" | "run_tests" | "terminal";

export type ToolRequest = {
  name: ToolName;
  args: Record<string, string>;
};

export type ToolResult = {
  name: ToolName;
  ok: boolean;
  output: string;
};

const DANGEROUS = new Set<ToolName>(["terminal", "run_tests"]);

export class ToolRunner {
  async run(req: ToolRequest, opts: { allowDangerous: boolean }): Promise<ToolResult> {
    try {
      if (DANGEROUS.has(req.name) && !opts.allowDangerous) {
        const approved = await vscode.window.showWarningMessage(
          `OpenCodex wants to run tool "${req.name}": ${req.args.command || req.args.script || ""}`,
          { modal: true },
          "Allow once"
        );
        if (approved !== "Allow once") {
          return { name: req.name, ok: false, output: "User denied tool execution." };
        }
      }

      switch (req.name) {
        case "read_file":
          return { name: req.name, ok: true, output: await this.readFile(req.args.path || "") };
        case "list_dir":
          return { name: req.name, ok: true, output: await this.listDir(req.args.path || ".") };
        case "grep":
          return { name: req.name, ok: true, output: await this.grep(req.args.pattern || "", req.args.path) };
        case "git_status":
          return { name: req.name, ok: true, output: await this.execGit(["status", "--short"]) };
        case "git_diff":
          return { name: req.name, ok: true, output: await this.execGit(["diff", "--", ...(req.args.path ? [req.args.path] : [])]) };
        case "run_tests":
          return { name: req.name, ok: true, output: await this.terminal(req.args.command || "npm test", 120_000) };
        case "terminal":
          return { name: req.name, ok: true, output: await this.terminal(req.args.command || "echo ok", 60_000) };
        default:
          return { name: req.name, ok: false, output: `Unknown tool` };
      }
    } catch (err) {
      return {
        name: req.name,
        ok: false,
        output: redactSecrets(err instanceof Error ? err.message : String(err)),
      };
    }
  }

  private workspaceRoot(): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error("No workspace folder open");
    return folder.uri;
  }

  private async readFile(rel: string): Promise<string> {
    assertSafeWorkspacePath(rel);
    const uri = vscode.Uri.joinPath(this.workspaceRoot(), rel);
    const buf = await vscode.workspace.fs.readFile(uri);
    return redactSecrets(Buffer.from(buf).toString("utf8")).slice(0, 40_000);
  }

  private async listDir(rel: string): Promise<string> {
    const safe = rel === "." ? "." : rel;
    if (safe !== ".") assertSafeWorkspacePath(safe);
    const uri = safe === "." ? this.workspaceRoot() : vscode.Uri.joinPath(this.workspaceRoot(), safe);
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return entries
      .map(([name, type]) => `${type === vscode.FileType.Directory ? "dir" : "file"}\t${name}`)
      .filter((line) => !isBlockedPath(`${safe}/${line.split("\t")[1]}`))
      .slice(0, 200)
      .join("\n");
  }

  private async grep(pattern: string, path?: string): Promise<string> {
    if (!pattern || pattern.length > 200) throw new Error("Invalid grep pattern");
    if (path) assertSafeWorkspacePath(path);
    const files = await vscode.workspace.findFiles(
      path ? `${path.replace(/\/$/, "")}/**/*` : "**/*",
      "**/{node_modules,.git,dist,out,build,coverage}/**",
      80
    );
    const re = new RegExp(pattern, "i");
    const hits: string[] = [];
    for (const uri of files) {
      const rel = vscode.workspace.asRelativePath(uri);
      if (isBlockedPath(rel)) continue;
      try {
        const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            hits.push(`${rel}:${i + 1}: ${redactSecrets(lines[i]).slice(0, 240)}`);
            if (hits.length >= 80) return hits.join("\n");
          }
        }
      } catch {
        // ignore unreadable
      }
    }
    return hits.join("\n") || "(no matches)";
  }

  private async execGit(args: string[]): Promise<string> {
    return this.terminal(`git ${args.map(shellQuote).join(" ")}`, 30_000);
  }

  private async terminal(command: string, timeoutMs: number): Promise<string> {
    if (/[;&|`$<>]|\brm\b|\bcurl\b|\bwget\b|\bssh\b|\bscp\b/i.test(command) && !/^git\b/.test(command.trim())) {
      // still allow if user approved, but block obvious exfil / destructive chains by default unless pure git
      if (/\brm\s+-rf\b|\bcurl\b|\bwget\b|\bssh\b/i.test(command)) {
        throw new Error("Blocked potentially destructive or exfiltrating command.");
      }
    }
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    const cwd = this.workspaceRoot().fsPath;
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: process.env.LANG,
        },
      });
      return redactSecrets(`${stdout}\n${stderr}`.trim()).slice(0, 40_000);
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return redactSecrets(`${e.stdout || ""}\n${e.stderr || e.message || String(err)}`.trim()).slice(0, 40_000);
    }
  }
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Parse fenced tool calls from model output: ```tool\n{"name":"read_file","args":{"path":"x"}}\n``` */
export function extractToolRequests(text: string): ToolRequest[] {
  const out: ToolRequest[] = [];
  const re = /```tool\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    try {
      const json = JSON.parse(m[1].trim()) as ToolRequest;
      if (json?.name && json.args) out.push(json);
    } catch {
      // ignore
    }
  }
  return out;
}
