/**
 * Pure helpers for backlink scanning. No IO — safe to unit-test.
 */

export type BacklinkSnippet = {
	/** 0-indexed line within the source file. */
	line: number;
	/** The full line, trimmed. */
	text: string;
	/** Range inside `text` of the matching `[[...]]` literal. */
	matchStart: number;
	matchEnd: number;
};

// Captures `[[target]]` and `[[target|alias]]`. Target stops at `|`, `]`, or
// newline; the brackets must be literal and adjacent.
const WIKI_LINK_RE = /\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g;

/**
 * Extract every wiki link in `content` with its line context. Pure — no IO.
 */
export function extractWikiLinks(content: string): Array<{
	target: string;
	snippet: BacklinkSnippet;
}> {
	const out: Array<{ target: string; snippet: BacklinkSnippet }> = [];
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		WIKI_LINK_RE.lastIndex = 0;
		let match: RegExpExecArray | null;
		// biome-ignore lint/suspicious/noAssignInExpressions: iterator idiom
		while ((match = WIKI_LINK_RE.exec(line)) !== null) {
			out.push({
				target: match[1].trim(),
				snippet: {
					line: i,
					text: line.trim(),
					matchStart: match.index,
					matchEnd: match.index + match[0].length,
				},
			});
		}
	}
	return out;
}
