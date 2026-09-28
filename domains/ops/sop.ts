/** Stable address for an SOP, used by tasks and department boards. */

export function sopSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "sop";
}

export function uniqueSlug(title: string, taken: string[]): string {
  const base = sopSlug(title);
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
