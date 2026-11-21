import type { SidebarDeleteItem } from "@hubble.md/ui";
import {
	dirname,
	fileStem,
	hasMarkdownExtension,
	joinPath,
	normalizePath,
	pathEquals,
	pathInFolder,
} from "../lib/filePath";

function itemPath(item: SidebarDeleteItem) {
	return item.kind === "file" ? item.path : item.folderId;
}

/**
 * For a page `A.md`, the companion folder `A/` holds its subpages.
 * Deleting the page should cascade to that folder; deleting the folder
 * alone should not reach the page. Returns the paired folder path if
 * the file name has a Markdown extension.
 */
export function pairedFolderPath(filePath: string): string | null {
	if (!hasMarkdownExtension(filePath)) return null;
	const parent = dirname(filePath);
	if (!parent) return null;
	const stem = fileStem(filePath);
	if (!stem) return null;
	return normalizePath(joinPath(parent, stem));
}

/**
 * Expand each `file` delete item to also stage its paired subpage folder
 * `A/` when that folder exists in the current workspace. Folder items are
 * left alone; deleting `A/` on its own does not touch `A.md`. Redundant
 * entries covered by another folder in the set are dropped.
 */
export function withCascadedPairs(
	items: SidebarDeleteItem[],
	knownFolderPaths: ReadonlySet<string>,
): SidebarDeleteItem[] {
	const seen = new Set<string>();
	const expanded: SidebarDeleteItem[] = [];
	const push = (item: SidebarDeleteItem) => {
		const key = `${item.kind}:${itemPath(item).toLocaleLowerCase()}`;
		if (seen.has(key)) return;
		seen.add(key);
		expanded.push(item);
	};
	for (const item of items) {
		push(item);
		if (item.kind !== "file") continue;
		const folder = pairedFolderPath(item.path);
		if (folder && knownFolderPaths.has(folder.toLocaleLowerCase())) {
			push({ kind: "folder", folderId: folder });
		}
	}
	const folders = expanded.filter((item) => item.kind === "folder");
	return expanded.filter((item) => {
		const path = itemPath(item);
		return !folders.some((folder) => {
			const folderPath = itemPath(folder);
			if (pathEquals(folderPath, path)) return false;
			return pathInFolder(path, folderPath);
		});
	});
}
