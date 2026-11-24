import { desktopApi } from "../desktopApi";
import type { FileEntry } from "../store/state";
import { type BacklinkSnippet, extractWikiLinks } from "./backlinkScan";
import { resolveWikiPath } from "./wikiPath";

/**
 * Backlinks are computed on-demand by scanning every .md file in the workspace
 * for `[[...]]` and resolving each reference against the file tree. There is
 * intentionally no persistent index: the panel is lazy and only pays the scan
 * cost when a user opens it on a given note.
 */

export type BacklinkSource = {
	/** Absolute path of the file that contains the reference. */
	path: string;
	/** Line-level snippets showing each match's context. */
	snippets: BacklinkSnippet[];
};

export type { BacklinkSnippet } from "./backlinkScan";

export const BACKLINK_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const BACKLINK_CONCURRENCY = 8;
export const BACKLINK_MAX_SNIPPETS_PER_SOURCE = 3;

/**
 * Scan every markdown file in `files` and return the ones whose content links
 * to `targetPath`. Each returned entry groups snippets by source file.
 */
export async function findBacklinks(
	targetPath: string,
	workspacePath: string,
	files: FileEntry[],
	options?: { signal?: AbortSignal },
): Promise<BacklinkSource[]> {
	const sources = new Map<string, BacklinkSnippet[]>();
	const queue = files.filter(
		(f) => f.path !== targetPath && f.path.toLowerCase().endsWith(".md"),
	);
	let cursor = 0;
	const workerCount = Math.min(BACKLINK_CONCURRENCY, queue.length);
	const workers = new Array(workerCount).fill(0).map(async () => {
		while (cursor < queue.length) {
			if (options?.signal?.aborted) return;
			const file = queue[cursor++];
			try {
				const content = await desktopApi.readFileText(file.path);
				if (content.length > BACKLINK_MAX_FILE_BYTES) continue;
				const wikiLinks = extractWikiLinks(content);
				for (const { target, snippet } of wikiLinks) {
					const resolved = resolveWikiPath({
						target,
						files,
						workspacePath,
					});
					if (resolved !== targetPath) continue;
					const bucket = sources.get(file.path) ?? [];
					if (bucket.length >= BACKLINK_MAX_SNIPPETS_PER_SOURCE) continue;
					bucket.push(snippet);
					sources.set(file.path, bucket);
				}
			} catch {
				// Skip unreadable files; they just don't contribute backlinks.
			}
		}
	});
	await Promise.all(workers);
	return Array.from(sources.entries()).map(([path, snippets]) => ({
		path,
		snippets,
	}));
}
