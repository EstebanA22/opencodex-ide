import * as vscode from "vscode";
import { assertSafeWorkspacePath, redactSecrets } from "./security";

export type ApplyResult = { ok: boolean; message: string };

/** Apply a full-file fenced block: ```path:relative/file.ts\n...\n``` or ```lang filepath */
export async function applyCodeBlocks(markdown: string): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  const re = /```(?:[\w.+-]+)?\s+(?:path:)?([^\n]+)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  const matches: Array<{ path: string; body: string }> = [];
  while ((m = re.exec(markdown))) {
    const path = m[1].trim().replace(/^path:/, "");
    if (!path || path.includes(" ") && !path.includes("/")) continue;
    // skip language-only fences without path-like token
    if (!/[./]/.test(path) && !path.endsWith(".ts") && !path.endsWith(".tsx") && !path.endsWith(".js") && !path.endsWith(".py") && !path.endsWith(".md") && !path.endsWith(".json")) {
      continue;
    }
    matches.push({ path, body: m[2].replace(/\n$/, "") });
  }

  if (!matches.length) {
    return [{ ok: false, message: "No applyable path:file code blocks found. Use ```path:src/file.ts" }];
  }

  for (const item of matches) {
    try {
      assertSafeWorkspacePath(item.path);
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) throw new Error("No workspace");
      const uri = vscode.Uri.joinPath(folder.uri, item.path);
      const content = redactSecrets(item.body);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
      results.push({ ok: true, message: `Applied ${item.path}` });
    } catch (err) {
      results.push({
        ok: false,
        message: `${item.path}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return results;
}

export async function insertAtCursor(text: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error("No active editor");
  await editor.edit((b) => b.insert(editor.selection.active, text));
}

export async function replaceSelection(text: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error("No active editor");
  await editor.edit((b) => b.replace(editor.selection, text));
}
