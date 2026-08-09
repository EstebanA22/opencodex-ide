/**
 * Secret redaction and sensitive-path guards.
 * Never log raw API keys. Never auto-include .env / key material in prompts.
 */

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk|ak)-[A-Za-z0-9_\-]{16,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\b(?:xox[baprs]-)[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_\-]{20,}\b/g,
  /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[^\s"']{8,}/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

const BLOCKED_PATH_RE =
  /(?:^|\/)(?:\.env(?:\..+)?|\.npmrc|\.pypirc|credentials(?:\.json)?|secrets?\.[^/]+|.*\.(?:pem|key|p12|pfx|keystore)|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|.*(?:token|secret|password).*\.(?:txt|json|yml|yaml))$/i;

export function redactSecrets(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

export function isBlockedPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.includes("..")) return true;
  return BLOCKED_PATH_RE.test(normalized);
}

export function assertSafeWorkspacePath(relPath: string): void {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error(`Blocked path traversal: ${relPath}`);
  }
  if (isBlockedPath(normalized)) {
    throw new Error(`Blocked sensitive path: ${relPath}`);
  }
}

export const SAFE_CONTEXT_NOTE =
  "Sensitive files (.env, keys, credentials) are excluded. Secret-looking values are redacted.";
