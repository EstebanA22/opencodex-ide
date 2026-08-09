#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vsix = readdirSync(root)
  .filter((f) => f.endsWith(".vsix"))
  .sort()
  .at(-1);

if (!vsix) {
  console.error("No .vsix found. Run: npm run package");
  process.exit(1);
}

const candidates = [
  { name: "cursor", bin: "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" },
  { name: "code", bin: "code" },
  { name: "codium", bin: "codium" },
  { name: "windsurf", bin: "windsurf" },
];

const target = path.join(root, vsix);
let installed = 0;
for (const c of candidates) {
  try {
    if (c.bin.includes("/") && !existsSync(c.bin)) {
      console.log(`SKIP: ${c.name} not available`);
      continue;
    }
    execFileSync(c.bin, ["--install-extension", target, "--force"], { stdio: "inherit" });
    console.log(`OK: installed into ${c.name}`);
    installed++;
  } catch {
    console.log(`SKIP: ${c.name} not available`);
  }
}

if (!installed) {
  console.error("No compatible IDE CLI found.");
  process.exit(1);
}
