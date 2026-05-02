const SENSITIVE_KEY_RE = /(?:api[_-]?key|apikey|x[_-]?api[_-]?key|secret|token|password|authorization|cookie|credential|private[_-]?key|webhook|base[_-]?url|endpoint[_-]?url|homeserver[_-]?url|signed[_-]?url|presigned[_-]?url)/i;
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk-(?:proj-|ant-|live-)?[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:sk|rk|pk|whsec)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:gh[oprsu]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/g,
  /\bya29\.[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bnpm_[A-Za-z0-9]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bhf_[A-Za-z0-9]{20,}\b/g,
  /\b(?:eyJ[A-Za-z0-9_-]{8,}\.){2}[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi,
  /((?:[?&]|\b)(?:access[_-]?token|api[_-]?key|apikey|client[_-]?secret|secret|sig|signature|token|password|x-amz-signature|awsaccesskeyid)=)[^&\s]+/gi,
];

export function redactSensitiveText(value: string): string {
  let redacted = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return redacted;
}

export function redactSensitiveValue(
  value: unknown,
  key = "",
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (SENSITIVE_KEY_RE.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (typeof value === "function" || typeof value === "symbol" || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
      stack: typeof value.stack === "string" ? redactSensitiveText(value.stack) : undefined,
    };
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const output = value.map((entry) => redactSensitiveValue(entry, "", seen));
    seen.delete(value);
    return output;
  }
  const output: Record<string, unknown> = {};
  for (const [entryKey, entry] of Object.entries(value as Record<string, unknown>)) {
    const redacted = redactSensitiveValue(entry, entryKey, seen);
    if (redacted !== undefined) {
      output[entryKey] = redacted;
    }
  }
  seen.delete(value);
  return output;
}
