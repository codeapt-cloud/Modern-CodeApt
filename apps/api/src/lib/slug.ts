/**
 * URL-slug helper. Lowercases, strips accents, and collapses any run of
 * non-alphanumerics to a single hyphen (trimmed). Used by curriculum admin
 * authoring to derive Program/Subject slugs from names when none is supplied.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // drop combining marks
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
