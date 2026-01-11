
export function slugifyName(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildEntrySlug(code: string, entryName?: string) {
  const base = code;
  const name = entryName ? slugifyName(entryName) : "";
  if (!name) return base;
  return `${base}-${name}`;
}

export function buildDictionarySlug(id: string, terms: string[]) {
  const base = id;
  const primary = terms?.[0] ? slugifyName(terms[0]) : "";
  if (!primary) return base;
  return `${base}-${primary}`;
}