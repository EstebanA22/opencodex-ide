#!/usr/bin/env node
/**
 * Static security checks for the extension sources.
 * Fails if likely secrets or unsafe patterns are committed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "src",
  "media",
  "scripts",
  "package.json",
  "README.md",
  "SECURITY.md",
];

const secretRe =
  /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z\-_]{20,})\b/;

const findings = [];

function walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(p)) {
      if (name === "node_modules" || name === "out") continue;
      walk(path.join(p, name));
    }
    return;
  }
  if (!/\.(ts|js|mjs|md|json|css)$/.test(p)) return;
  const text = fs.readFileSync(p, "utf8");
  if (secretRe.test(text)) {
    findings.push(`Possible secret material in ${path.relative(root, p)}`);
  }
  if (/apiKey\s*:\s*["'](?!dummy)[^"']{20,}["']/.test(text)) {
    findings.push(`Hardcoded apiKey-looking value in ${path.relative(root, p)}`);
  }
}

for (const t of targets) walk(path.join(root, t));

// Positive checks that security helpers exist
const security = fs.readFileSync(path.join(root, "src/security.ts"), "utf8");
for (const needle of ["redactSecrets", "isBlockedPath", "assertSafeWorkspacePath"]) {
  if (!security.includes(needle)) findings.push(`Missing ${needle} in security.ts`);
}

if (findings.length) {
  console.error("SECURITY CHECK FAILED");
  for (const f of findings) console.error("-", f);
  process.exit(1);
}

console.log("OK: security check passed (no committed secrets; guards present)");
