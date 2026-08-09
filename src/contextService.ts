import * as vscode from "vscode";
import {
  SAFE_CONTEXT_NOTE,
  assertSafeWorkspacePath,
  isBlockedPath,
  redactSecrets,
} from "./security";

export type EditorContext = {
  activeFile?: {
    path: string;
    languageId: string;
    content: string;
    truncated: boolean;
    blocked?: boolean;
  };
  selection?: {
    path: string;
    text: string;
    startLine: number;
    endLine: number;
  };
  openFiles: string[];
  workspaceFolders: string[];
  diagnostics?: string;
  gitDiff?: string;
  memoryFiles?: Array<{ path: string; content: string }>;
};

const MAX_FILE_CHARS = 24_000;
const MAX_SELECTION_CHARS = 12_000;
const MAX_DIFF_CHARS = 16_000;
const MEMORY_CANDIDATES = ["AGENTS.md", ".cursorrules", "CONTRIBUTING.md"];

export function collectEditorContext(): EditorContext {
  const editor = vscode.window.activeTextEditor;
  const openFiles = vscode.window.visibleTextEditors
    .map((e) => vscode.workspace.asRelativePath(e.document.uri))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 12);

  const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.name);

  if (!editor) {
    return { openFiles, workspaceFolders };
  }

  const path = vscode.workspace.asRelativePath(editor.document.uri);
  if (isBlockedPath(path)) {
    return {
      openFiles,
      workspaceFolders,
      activeFile: { path, languageId: editor.document.languageId, content: "[blocked sensitive file]", truncated: false, blocked: true },
    };
  }

  const full = redactSecrets(editor.document.getText());
  const truncated = full.length > MAX_FILE_CHARS;
  const content = truncated ? `${full.slice(0, MAX_FILE_CHARS)}\n\n…[truncated]` : full;

  const sel = editor.selection;
  let selection: EditorContext["selection"];
  if (!sel.isEmpty) {
    let text = redactSecrets(editor.document.getText(sel));
    if (text.length > MAX_SELECTION_CHARS) {
      text = `${text.slice(0, MAX_SELECTION_CHARS)}\n\n…[truncated]`;
    }
    selection = {
      path,
      text,
      startLine: sel.start.line + 1,
      endLine: sel.end.line + 1,
    };
  }

  return {
    activeFile: {
      path,
      languageId: editor.document.languageId,
      content,
      truncated,
    },
    selection,
    openFiles,
    workspaceFolders,
  };
}

export async function enrichContext(base: EditorContext, opts: {
  includeDiagnostics: boolean;
  includeGitDiff: boolean;
  includeMemory: boolean;
}): Promise<EditorContext> {
  const next = { ...base };
  if (opts.includeDiagnostics) {
    next.diagnostics = collectDiagnostics();
  }
  if (opts.includeGitDiff) {
    next.gitDiff = await collectGitDiff();
  }
  if (opts.includeMemory) {
    next.memoryFiles = await collectMemoryFiles();
  }
  return next;
}

function collectDiagnostics(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return "";
  const diags = vscode.languages.getDiagnostics(editor.document.uri).slice(0, 40);
  if (!diags.length) return "No diagnostics on active file.";
  return diags
    .map((d) => {
      const line = d.range.start.line + 1;
      return `L${line} [${vscode.DiagnosticSeverity[d.severity]}] ${redactSecrets(d.message)}`;
    })
    .join("\n");
}

async function collectGitDiff(): Promise<string> {
  try {
    const gitExt = vscode.extensions.getExtension("vscode.git");
    await gitExt?.activate();
    const api = gitExt?.exports?.getAPI?.(1);
    const repo = api?.repositories?.[0];
    if (!repo) return "";
    const staged = (await repo.diff(true)) || "";
    const unstaged = (await repo.diff(false)) || "";
    const combined = redactSecrets(`${staged}\n${unstaged}`.trim());
    if (!combined) return "No git diff.";
    return combined.length > MAX_DIFF_CHARS ? `${combined.slice(0, MAX_DIFF_CHARS)}\n…[truncated]` : combined;
  } catch {
    return "";
  }
}

async function collectMemoryFiles(): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  for (const name of MEMORY_CANDIDATES) {
    const files = await vscode.workspace.findFiles(name, "**/node_modules/**", 3);
    for (const uri of files) {
      const rel = vscode.workspace.asRelativePath(uri);
      if (isBlockedPath(rel)) continue;
      try {
        const buf = await vscode.workspace.fs.readFile(uri);
        const text = redactSecrets(Buffer.from(buf).toString("utf8")).slice(0, 8_000);
        out.push({ path: rel, content: text });
      } catch {
        // ignore
      }
    }
  }
  return out;
}

export async function resolveMentions(text: string): Promise<{ cleaned: string; blocks: string[] }> {
  const blocks: string[] = [];
  const mentionRe = /@(file|folder|selection|terminal|diff|diagnostics|memory)(?::([^\s]+))?/gi;
  let cleaned = text;
  const matches = [...text.matchAll(mentionRe)];

  for (const m of matches) {
    const kind = m[1].toLowerCase();
    const arg = m[2];
    try {
      if (kind === "selection") {
        const ctx = collectEditorContext();
        if (ctx.selection) {
          blocks.push(
            `Selection ${ctx.selection.path}:${ctx.selection.startLine}-${ctx.selection.endLine}\n\`\`\`\n${ctx.selection.text}\n\`\`\``
          );
        }
      } else if (kind === "file") {
        const rel = arg || collectEditorContext().activeFile?.path;
        const root = vscode.workspace.workspaceFolders?.[0];
        if (rel && root) {
          assertSafeWorkspacePath(rel);
          const uri = vscode.Uri.joinPath(root.uri, rel);
          const buf = await vscode.workspace.fs.readFile(uri);
          const body = redactSecrets(Buffer.from(buf).toString("utf8")).slice(0, MAX_FILE_CHARS);
          blocks.push(`File ${rel}\n\`\`\`\n${body}\n\`\`\``);
        } else if (rel && !root) {
          blocks.push("@file error: No workspace folder open");
        }
      } else if (kind === "folder") {
        const rel = arg || ".";
        if (rel !== ".") assertSafeWorkspacePath(rel);
        const pattern = rel === "." ? "**/*" : `${rel.replace(/\/$/, "")}/**/*`;
        const files = await vscode.workspace.findFiles(pattern, "**/{node_modules,.git,dist,out,build}/**", 40);
        const listing = files
          .map((f) => vscode.workspace.asRelativePath(f))
          .filter((p) => !isBlockedPath(p))
          .join("\n");
        blocks.push(`Folder listing ${rel}:\n${listing || "(empty)"}`);
      } else if (kind === "diff") {
        blocks.push(`Git diff:\n\`\`\`\n${(await collectGitDiff()) || "(none)"}\n\`\`\``);
      } else if (kind === "diagnostics") {
        blocks.push(`Diagnostics:\n${collectDiagnostics()}`);
      } else if (kind === "memory") {
        const mem = await collectMemoryFiles();
        blocks.push(
          mem.map((m) => `Memory ${m.path}:\n\`\`\`\n${m.content}\n\`\`\``).join("\n\n") || "(no memory files)"
        );
      } else if (kind === "terminal") {
        blocks.push("Terminal mention: use Team tools or Diagnostics/Test loops for live command output (requires approval).");
      }
    } catch (err) {
      blocks.push(`@${kind} error: ${err instanceof Error ? err.message : String(err)}`);
    }
    cleaned = cleaned.replace(m[0], "").trim();
  }

  return { cleaned: cleaned || text, blocks };
}

export function formatContextBlock(
  ctx: EditorContext,
  flags: {
    includeFile: boolean;
    includeSelection: boolean;
    includeDiagnostics: boolean;
    includeGitDiff: boolean;
    includeMemory: boolean;
  }
): string {
  const parts: string[] = ["# IDE Context", SAFE_CONTEXT_NOTE];

  if (ctx.workspaceFolders.length) {
    parts.push(`Workspace: ${ctx.workspaceFolders.join(", ")}`);
  }
  if (ctx.openFiles.length) {
    parts.push(`Visible files: ${ctx.openFiles.join(", ")}`);
  }
  if (flags.includeSelection && ctx.selection) {
    parts.push(
      `Selection (${ctx.selection.path}:${ctx.selection.startLine}-${ctx.selection.endLine}):\n\`\`\`\n${ctx.selection.text}\n\`\`\``
    );
  }
  if (flags.includeFile && ctx.activeFile) {
    const note = ctx.activeFile.truncated ? " (truncated)" : "";
    parts.push(
      `Active file${note} (${ctx.activeFile.path}, ${ctx.activeFile.languageId}):\n\`\`\`${ctx.activeFile.languageId}\n${ctx.activeFile.content}\n\`\`\``
    );
  }
  if (flags.includeDiagnostics && ctx.diagnostics) {
    parts.push(`Diagnostics:\n\`\`\`\n${ctx.diagnostics}\n\`\`\``);
  }
  if (flags.includeGitDiff && ctx.gitDiff) {
    parts.push(`Git diff:\n\`\`\`\n${ctx.gitDiff}\n\`\`\``);
  }
  if (flags.includeMemory && ctx.memoryFiles?.length) {
    for (const m of ctx.memoryFiles) {
      parts.push(`Memory ${m.path}:\n\`\`\`\n${m.content}\n\`\`\``);
    }
  }
  return parts.join("\n\n");
}
