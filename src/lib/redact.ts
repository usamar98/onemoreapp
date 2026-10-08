export function redact(value: string, secrets: string[] = []) {
  let safe = value
    .replace(
      /-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?-----END [\w ]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g,
      "[REDACTED]",
    )
    .replace(/\bch_dev_[a-f0-9]{64}\b/g, "[REDACTED]")
    .replace(
      /((?:authorization|proxy-authorization)\s*:\s*)(?:Bearer|Basic)\s+[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|authorization|database_url)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
  for (const secret of secrets)
    if (secret.length > 5) safe = safe.split(secret).join("[REDACTED]");
  return safe;
}
