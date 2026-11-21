/**
 * Pure wiki-link rewriting helper used by rename/move sweeps (PRD CR-A) and
 * available for future sweeps (PRD CR-03 is currently handled via the LK-09
 * dead-link visual rather than active rewriting; see store/deleteActions.ts).
 *
 * The helper walks `[[target]]` and `[[target|alias]]` occurrences, invokes a
 * caller-supplied `mapper(target)` for each raw target, and substitutes the
 * returned replacement while preserving the alias. Returning `null` keeps the
 * occurrence unchanged.
 *
 * Escaped brackets (`\[[Foo]]`) are left alone — an odd number of preceding
 * backslashes indicates the bracket is Markdown-escaped. `\\[[Foo]]` (an even
 * count, which is a literal backslash followed by the link) is still rewritten.
 */

// Captures any leading backslashes plus `[[target]]` or `[[target|alias]]`.
// An odd leading-backslash count means the bracket is Markdown-escaped and the
// link is treated as literal text; an even count (including zero) represents
// literal backslashes followed by a real link.
const WIKI_LINK_RE = /(\\*)\[\[([^\]\n|]+)(\|[^\]\n]+)?\]\]/g;

/**
 * Walk every `[[...]]` wiki link in `content`. For each, invoke `mapper` with
 * the raw target; if it returns a non-null string, replace the target in place
 * and preserve the alias. Escaped brackets (`\[[Foo]]`) are skipped.
 */
export function rewriteWikiLinksInContent(
	content: string,
	mapper: (target: string) => string | null,
): string {
	return content.replace(
		WIKI_LINK_RE,
		(match, backslashes: string, target: string, alias = "") => {
			if (backslashes.length % 2 === 1) return match;
			const next = mapper(target);
			if (next === null || next === target) return match;
			return `${backslashes}[[${next}${alias}]]`;
		},
	);
}
