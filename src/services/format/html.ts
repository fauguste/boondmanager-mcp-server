/**
 * Rendering of BoondManager's HTML note fields as a short plain-text excerpt.
 * Each invariant here has a regression test (`format/html.test.ts`).
 */

/** Max length (in code points) of the `text` excerpt used to identify an action. */
export const MAX_TEXT_EXCERPT = 80;

/**
 * HTML comments, then element tags. The tag pattern requires a tag name right
 * after the `<` (or `</`), so free text such as
 * `Relancer si < 3 jours > sinon cloturer` survives intact — a naive
 * `/<[^>]*>/` swallowed everything between the two operators. Quoted attribute
 * values are matched explicitly so a `>` inside one (`<a href="a>b">`) doesn't
 * end the tag early and leak `b">` into the excerpt. The alternatives are
 * mutually exclusive on their first character, so there is no backtracking
 * blow-up on unterminated input.
 */
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const HTML_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9:._-]*(?:\s+(?:"[^"]*"|'[^']*'|[^"'<>])*)?\/?>/g;

/** Entities actually seen in BoondManager notes (WYSIWYG output + French text). */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  icirc: "î",
  iuml: "ï",
  ocirc: "ô",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
  laquo: "«",
  raquo: "»",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  deg: "°",
  euro: "€",
  ndash: "–",
  mdash: "—",
};

/** Decodes numeric and common named entities so the excerpt reads as text, not as markup. */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // Surrogate code points are rejected on purpose: decoding `&#55296;`
      // would inject the very unpaired surrogate the excerpt guards against.
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Renders BoondManager's HTML note fields (`/actions`.text is a `<div>…</div>`)
 * as a short single-line excerpt. Only strings are excerpted — `text: null` and
 * nested objects are skipped by the caller rather than printed as `null` /
 * `[object Object]`.
 *
 * Truncation runs on code points (`Array.from`), never on UTF-16 code units, so
 * an emoji sitting on the boundary can't be cut into an unpaired surrogate.
 */
export function textExcerpt(raw: string): string | undefined {
  const stripped = decodeHtmlEntities(raw.replace(HTML_COMMENT_RE, " ").replace(HTML_TAG_RE, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (stripped === "") return undefined;
  const chars = Array.from(stripped);
  return chars.length > MAX_TEXT_EXCERPT ? `${chars.slice(0, MAX_TEXT_EXCERPT).join("")}…` : stripped;
}
