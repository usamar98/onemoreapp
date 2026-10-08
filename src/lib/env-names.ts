export function referencedEnvNames(text: string) {
  const names = new Set<string>();
  for (const match of text.matchAll(
    /(?:process\.env\.|import\.meta\.env\.)([A-Z][A-Z0-9_]{1,79})|(?:process\.env|import\.meta\.env)\[['"]([A-Z][A-Z0-9_]{1,79})['"]\]/g,
  ))
    names.add(match[1] || match[2]);
  return [...names].sort();
}
