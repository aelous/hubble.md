import {
	startTransition,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { z } from "zod/v4";
import {
	fileNameFromPath,
	normalizeDisplayPath,
	splitFileName,
} from "../lib/filePath";

export type SidebarSortMode = "alpha" | "recent";
export type SidebarFile = {
	path: string;
	modifiedAt?: number;
	pinned?: boolean;
};

export type SidebarFolder = {
	path: string;
};

type FolderNode = {
	id: string;
	name: string;
	folders: Map<string, FolderNode>;
	files: TreeFileNode[];
};

type TreeFileNode = {
	file: SidebarFile;
	pairedFolder: FolderNode | null;
};

export type SidebarRow =
	| {
			kind: "section";
			id: string;
			label: string;
			depth: number;
	  }
	| {
			kind: "folder";
			id: string;
			label: string;
			depth: number;
			expanded: boolean;
			segments: SidebarFolderSegment[];
	  }
	| {
			kind: "file";
			file: SidebarFile;
			label: string;
			depth: number;
	  }
	| {
			kind: "pairedFile";
			file: SidebarFile;
			label: string;
			depth: number;
			expanded: boolean;
			/** The companion folder's id — DnD routes drops here, children render under. */
			folderId: string;
	  };

export type SidebarFolderSegment = {
	id: string;
	name: string;
};

type ExpandedState = {
	key: string | null;
	folders: Set<string>;
};

const expandedFoldersSchema = z.array(z.string());

const allFoldersListeners = new Set<(expanded: boolean) => void>();

/** Expand or collapse every folder in each mounted sidebar. */
export function setAllSidebarFoldersExpanded(expanded: boolean) {
	for (const listener of allFoldersListeners) listener(expanded);
}

export function useSidebarTree({
	files,
	folders = [],
	getDisplayPath,
	highlightPath,
	sortMode,
	storageScope,
	uncompactFolderId = null,
}: {
	files: SidebarFile[];
	folders?: SidebarFolder[];
	getDisplayPath: (path: string) => string;
	highlightPath: string | null;
	sortMode: SidebarSortMode;
	storageScope?: string | null;
	uncompactFolderId?: string | null;
}) {
	const storageKey = storageScope
		? `hubble-sidebar-expanded-folders:${storageScope}`
		: null;
	const revealedPathRef = useRef<string | null>(null);
	const [expandedState, setExpandedState] = useState<ExpandedState>(() => ({
		key: storageKey,
		folders: readExpandedFolders(storageKey),
	}));
	const expandedFolders =
		expandedState.key === storageKey
			? expandedState.folders
			: new Set<string>();

	useEffect(() => {
		revealedPathRef.current = null;
		setExpandedState({
			key: storageKey,
			folders: readExpandedFolders(storageKey),
		});
	}, [storageKey]);

	useEffect(() => {
		if (expandedState.key !== storageKey) return;
		writeExpandedFolders(storageKey, expandedState.folders);
	}, [storageKey, expandedState]);

	const tree = buildFileTree(files, folders, getDisplayPath);
	const rows = flattenRows({
		files,
		getDisplayPath,
		tree,
		sortMode,
		expandedFolders,
		uncompactFolderId,
	});
	const folderIds = getFolderIds(tree, uncompactFolderId);

	useEffect(() => {
		if (!highlightPath || revealedPathRef.current === highlightPath) return;
		revealedPathRef.current = highlightPath;
		const activeAncestorIds = getRevealAncestorKeys(
			tree,
			highlightPath,
			getDisplayPath(highlightPath),
		);
		if (activeAncestorIds.size === 0) return;
		// Auto-expand ancestors once per selected file so manual collapse still works.
		setExpandedState((current) => {
			const next = new Set(
				current.key === storageKey
					? current.folders
					: readExpandedFolders(storageKey),
			);
			let changed = false;
			for (const id of activeAncestorIds) {
				if (next.has(id)) continue;
				next.add(id);
				changed = true;
			}
			return changed ? { key: storageKey, folders: next } : current;
		});
	}, [getDisplayPath, highlightPath, storageKey, tree]);

	const setExpanded = (id: string, expanded: boolean) => {
		setExpandedState((current) => {
			const next = new Set(
				current.key === storageKey
					? current.folders
					: readExpandedFolders(storageKey),
			);
			if (expanded) next.add(id);
			else next.delete(id);
			return { key: storageKey, folders: next };
		});
	};
	const expandFolder = (id: string) => setExpanded(id, true);
	const collapseFolder = (id: string) => setExpanded(id, false);
	const toggleFolder = (id: string) =>
		setExpanded(id, !expandedFolders.has(id));
	const setAllFoldersExpanded = (expanded: boolean) => {
		startTransition(() => {
			setExpandedState({
				key: storageKey,
				folders: expanded ? new Set(folderIds) : new Set(),
			});
		});
	};

	const onAllFoldersExpanded = useEffectEvent(setAllFoldersExpanded);
	useEffect(() => {
		const listener = (expanded: boolean) => onAllFoldersExpanded(expanded);
		allFoldersListeners.add(listener);
		return () => {
			allFoldersListeners.delete(listener);
		};
	}, []);

	return {
		collapseFolder,
		expandFolder,
		rows,
		toggleFolder,
	};
}

function makeFolder(id: string, name: string): FolderNode {
	return {
		id,
		name,
		folders: new Map(),
		files: [],
	};
}

export function buildFileTree(
	files: SidebarFile[],
	folders: SidebarFolder[],
	getDisplayPath: (path: string) => string,
): FolderNode {
	const root = makeFolder("", "");

	for (const folderEntry of folders) {
		const displayPath = normalizeDisplayPath(getDisplayPath(folderEntry.path));
		if (!displayPath) continue;
		const segments = displayPath.split("/").filter(Boolean);
		let parent = root;
		for (const segment of segments) {
			const folder = ensureFolder(parent, segment);
			parent = folder;
		}
	}

	for (const file of files) {
		const displayPath = normalizeDisplayPath(getDisplayPath(file.path));
		if (!displayPath) continue;
		const segments = displayPath.split("/").filter(Boolean);
		const fileName = segments.pop();
		if (!fileName) continue;

		let parent = root;
		const modifiedAt = file.modifiedAt ?? 0;
		for (const segment of segments) {
			const folder = ensureFolder(parent, segment);
			parent = folder;
		}

		parent.files.push({
			file: {
				...file,
				path: file.path,
				modifiedAt,
			},
			pairedFolder: null,
		});
	}

	applySubpagePairing(root);

	return root;
}

/**
 * Subpage-pair convention: if `A.md` and a non-empty sibling folder `A/`
 * both exist, treat `A.md` as the row for the pair — the folder's contents
 * nest under the file. The folder is removed from its parent so it does not
 * also render as a top-level entry. Empty folders are left unpaired so we
 * never surface a chevron that reveals nothing.
 */
function applySubpagePairing(folder: FolderNode) {
	for (const file of folder.files) {
		const { name, extension } = splitFileName(file.file.path);
		if (extension.toLocaleLowerCase() !== ".md") continue;
		const stem = fileNameFromPath(name);
		if (!stem) continue;
		const sibling = folder.folders.get(stem);
		if (!sibling) continue;
		if (isFolderEmpty(sibling)) continue;
		file.pairedFolder = sibling;
		folder.folders.delete(stem);
	}
	for (const child of folder.folders.values()) applySubpagePairing(child);
	for (const file of folder.files) {
		if (file.pairedFolder) applySubpagePairing(file.pairedFolder);
	}
}

function isFolderEmpty(folder: FolderNode): boolean {
	return folder.files.length === 0 && folder.folders.size === 0;
}

function ensureFolder(parent: FolderNode, name: string): FolderNode {
	const id = `${parent.id}${name}/`;
	let folder = parent.folders.get(name);
	if (!folder) {
		folder = makeFolder(id, name);
		parent.folders.set(name, folder);
	}
	return folder;
}

function getFolderIds(tree: FolderNode, uncompactFolderId: string | null) {
	const ids: string[] = [];
	const walk = (folder: FolderNode) => {
		for (const child of folder.folders.values()) {
			const compacted = compactFolder(child, uncompactFolderId);
			for (const segment of compacted.segments) ids.push(segment.id);
			walk(compacted.folder);
		}
		for (const file of folder.files) {
			if (file.pairedFolder) {
				ids.push(file.file.path);
				walk(file.pairedFolder);
			}
		}
	};
	walk(tree);
	return ids;
}

export function flattenRows({
	files,
	getDisplayPath,
	tree,
	sortMode,
	expandedFolders,
	uncompactFolderId = null,
}: {
	files: SidebarFile[];
	getDisplayPath: (path: string) => string;
	tree: FolderNode;
	sortMode: SidebarSortMode;
	expandedFolders: Set<string>;
	uncompactFolderId?: string | null;
}): SidebarRow[] {
	const rows: SidebarRow[] = [];
	const pinnedFiles = files
		.filter((file) => file.pinned)
		.sort((a, b) => compareFiles(a, b, sortMode));
	if (pinnedFiles.length > 0) {
		rows.push({ kind: "section", id: "pinned", label: "Pinned", depth: 0 });
		for (const file of pinnedFiles) {
			rows.push({
				kind: "file",
				file,
				label: normalizeDisplayPath(getDisplayPath(file.path)),
				depth: 0,
			});
		}
	}
	appendFolderChildren(
		tree,
		0,
		sortMode,
		expandedFolders,
		rows,
		uncompactFolderId,
	);
	return rows;
}

function appendFolderChildren(
	folder: FolderNode,
	depth: number,
	sortMode: SidebarSortMode,
	expandedFolders: Set<string>,
	rows: SidebarRow[],
	uncompactFolderId: string | null,
) {
	const folders = [...folder.folders.values()].sort(compareFolders);
	const files = [...folder.files].sort((a, b) =>
		compareFiles(a.file, b.file, sortMode),
	);

	for (const child of folders) {
		const compacted = compactFolder(child, uncompactFolderId);
		const expanded = expandedFolders.has(compacted.folder.id);
		rows.push({
			kind: "folder",
			id: compacted.folder.id,
			label: compacted.label,
			depth,
			expanded,
			segments: compacted.segments,
		});
		if (expanded) {
			appendFolderChildren(
				compacted.folder,
				depth + 1,
				sortMode,
				expandedFolders,
				rows,
				uncompactFolderId,
			);
		}
	}

	for (const entry of files) {
		const file = entry.file;
		if (file.pinned) continue;
		if (entry.pairedFolder) {
			const expanded = expandedFolders.has(file.path);
			rows.push({
				kind: "pairedFile",
				file,
				label: fileNameFromPath(file.path),
				depth,
				expanded,
				folderId: entry.pairedFolder.id,
			});
			if (expanded) {
				appendFolderChildren(
					entry.pairedFolder,
					depth + 1,
					sortMode,
					expandedFolders,
					rows,
					uncompactFolderId,
				);
			}
			continue;
		}
		rows.push({
			kind: "file",
			file,
			label: fileNameFromPath(file.path),
			depth,
		});
	}
}

/** Collapses chains like `deeply/nested/folder` into one folder row. */
function compactFolder(
	folder: FolderNode,
	uncompactFolderId: string | null,
): {
	folder: FolderNode;
	label: string;
	segments: SidebarFolderSegment[];
} {
	const names = [folder.name];
	const segments = [{ id: folder.id, name: folder.name }];
	let cursor = folder;
	while (cursor.files.length === 0 && cursor.folders.size === 1) {
		const onlyChild = cursor.folders.values().next().value as
			| FolderNode
			| undefined;
		if (!onlyChild) break;
		// New nested folders stay visible as their own row while the name input is open.
		if (onlyChild.id === uncompactFolderId) break;
		names.push(onlyChild.name);
		segments.push({ id: onlyChild.id, name: onlyChild.name });
		cursor = onlyChild;
	}
	return { folder: cursor, label: names.join("/"), segments };
}

function compareFolders(a: FolderNode, b: FolderNode) {
	return compareNames(a.name, b.name);
}

function compareFiles(
	a: SidebarFile,
	b: SidebarFile,
	sortMode: SidebarSortMode,
) {
	const byName = compareNames(
		fileNameFromPath(a.path),
		fileNameFromPath(b.path),
	);
	if (sortMode === "recent") {
		return (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) || byName;
	}
	return byName;
}

const nameCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

function compareNames(a: string, b: string) {
	return nameCollator.compare(a, b) || a.localeCompare(b);
}

/**
 * Walk `tree` to the file identified by `targetPath`, collecting the expand
 * keys for every ancestor row so a highlighted file can be auto-revealed.
 * Folder rows key off their id; paired-file rows key off the file path.
 */
function getRevealAncestorKeys(
	tree: FolderNode,
	targetPath: string,
	displayPath: string,
): Set<string> {
	const segments = normalizeDisplayPath(displayPath).split("/").filter(Boolean);
	const fileName = segments.pop();
	if (!fileName) return new Set();
	const keys = new Set<string>();
	let cursor = tree;
	for (const segment of segments) {
		const folder = cursor.folders.get(segment);
		if (folder) {
			keys.add(folder.id);
			cursor = folder;
			continue;
		}
		// Segment matches a paired file whose companion folder absorbed the dir.
		const paired = cursor.files.find((entry) => {
			if (!entry.pairedFolder) return false;
			const name = fileNameFromPath(entry.file.path);
			const { name: stem } = splitFileName(name);
			return stem === segment;
		});
		if (!paired || !paired.pairedFolder) return new Set();
		keys.add(paired.file.path);
		cursor = paired.pairedFolder;
	}
	// If the target itself is a paired-file (unusual for reveal), nothing extra.
	void targetPath;
	return keys;
}

function readExpandedFolders(storageKey: string | null): Set<string> {
	if (!storageKey || typeof localStorage === "undefined") return new Set();
	try {
		const raw = localStorage.getItem(storageKey);
		return new Set(expandedFoldersSchema.parse(raw ? JSON.parse(raw) : []));
	} catch {
		return new Set();
	}
}

function writeExpandedFolders(
	storageKey: string | null,
	expandedFolders: Set<string>,
) {
	if (!storageKey || typeof localStorage === "undefined") return;
	localStorage.setItem(storageKey, JSON.stringify([...expandedFolders]));
}
