import * as vscode from "vscode";

export type EditorContext = {
  activeFile?: {
    path: string;
    languageId: string;
    content: string;
    truncated: boolean;
  };
  selection?: {
    path: string;
    text: string;
    startLine: number;
    endLine: number;
  };
  openFiles: string[];
  workspaceFolders: string[];
};

const MAX_FILE_CHARS = 24_000;
const MAX_SELECTION_CHARS = 12_000;

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
  const full = editor.document.getText();
  const truncated = full.length > MAX_FILE_CHARS;
  const content = truncated ? `${full.slice(0, MAX_FILE_CHARS)}\n\n…[truncated]` : full;

  const sel = editor.selection;
  let selection: EditorContext["selection"];
  if (!sel.isEmpty) {
    let text = editor.document.getText(sel);
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

export function formatContextBlock(ctx: EditorContext, includeFile: boolean, includeSelection: boolean): string {
  const parts: string[] = ["# IDE Context"];

  if (ctx.workspaceFolders.length) {
    parts.push(`Workspace: ${ctx.workspaceFolders.join(", ")}`);
  }
  if (ctx.openFiles.length) {
    parts.push(`Visible files: ${ctx.openFiles.join(", ")}`);
  }

  if (includeSelection && ctx.selection) {
    parts.push(
      `Selection (${ctx.selection.path}:${ctx.selection.startLine}-${ctx.selection.endLine}):\n\`\`\`\n${ctx.selection.text}\n\`\`\``
    );
  }

  if (includeFile && ctx.activeFile) {
    const note = ctx.activeFile.truncated ? " (truncated)" : "";
    parts.push(
      `Active file${note} (${ctx.activeFile.path}, ${ctx.activeFile.languageId}):\n\`\`\`${ctx.activeFile.languageId}\n${ctx.activeFile.content}\n\`\`\``
    );
  }

  return parts.join("\n\n");
}
