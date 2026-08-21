import type { ReactNode } from "react";
import styles from "./Markdown.module.css";

export interface MarkdownProps {
  /** A `RecipeStep.detail` value (types.ts) — markdown, always user-authored household content, never fetched from anywhere untrusted. */
  readonly text: string;
}

const INLINE_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

/**
 * Bold/italic/link only, applied to one line of already-plain text. Safe by
 * construction, not by escaping: every character that isn't consumed by one
 * of the three capture groups above is pushed as a plain JS string, which
 * React renders as text (auto-escaped) — there is no HTML parsing step
 * anywhere in this module, so a literal `<script>` or `<img onerror=...>`
 * typed into a step's detail renders as inert text, never markup. That is
 * the whole answer to "sanitise: never render untrusted HTML" (task brief,
 * part E): rather than parsing markdown into an HTML string and then
 * stripping the dangerous parts back out, this never produces an HTML
 * string at all.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let index = 0;
  // Reset `lastIndex` — a module-level regex with the `g` flag is stateful
  // across calls, and this function can run many times (once per line).
  INLINE_PATTERN.lastIndex = 0;
  let match = INLINE_PATTERN.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const [, linkLabel, linkHref, boldText, italicText] = match;
    if (linkLabel !== undefined && linkHref !== undefined) {
      // http(s) only (the pattern's own capture group already enforces
      // this) — explicit `color`/`text-decoration` because the UA
      // stylesheet's `a:link` rule outranks anything inherited from an
      // ancestor (four bare links shipped browser-purple before this rule
      // was learned the hard way — see recipe-detail.module.css's peers).
      nodes.push(
        <a key={`${keyPrefix}-${index}`} href={linkHref} target="_blank" rel="noopener noreferrer" className={styles.link}>
          {linkLabel}
        </a>,
      );
    } else if (boldText !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${index}`}>{boldText}</strong>);
    } else if (italicText !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${index}`}>{italicText}</em>);
    }
    lastIndex = INLINE_PATTERN.lastIndex;
    index += 1;
    match = INLINE_PATTERN.exec(text);
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderParagraph(paragraph: string, key: string): ReactNode {
  const lines = paragraph.split("\n");
  return (
    <p key={key} className={styles.paragraph}>
      {lines.map((line, i) => (
        // Index as key is fine here: `lines` is a fixed split of one
        // immutable paragraph string, never reordered/inserted into.
        <span key={i}>
          {renderInline(line, `${key}-${i}`)}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </p>
  );
}

/**
 * A tiny, dependency-free markdown-lite renderer for `RecipeStep.detail`
 * (task brief part E). Deliberately NOT a full markdown parser and
 * deliberately not a third-party dependency: the brief's own constraint is
 * "tiny, and must not land in the initial chunk" — writing the ~40 lines
 * this actually needs, imported only by `RecipeDetail.tsx` (already its own
 * lazily-fetched route chunk, see `App.tsx`'s code-splitting), satisfies
 * both without needing to vet a library's bundle size or add a second
 * dynamic `import()` on top of the route's own.
 *
 * Supports paragraphs (blank-line separated), single line breaks, `**bold**`,
 * `*italic*`, and `[text](https://...)` links — everything the mock's own
 * example detail text (plain prose, no markdown syntax at all) needs, plus
 * the constructs a household member is most likely to actually type. No
 * headings/lists/code/raw HTML — a step's detail is "extra tips", not a
 * document.
 */
export function Markdown({ text }: MarkdownProps) {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const paragraphs = trimmed.split(/\n{2,}/);
  return <div className={styles.markdown}>{paragraphs.map((p, i) => renderParagraph(p, `p-${i}`))}</div>;
}
