import { useStoreValue } from "@simplestack/store/react";
import MingcuteRightSmallLine from "~icons/mingcute/right-small-line";
import {
	basename,
	fileStem,
	hasMarkdownExtension,
	pathEquals,
	relativeWorkspacePath,
} from "../lib/filePath";
import { loadPath } from "../store/actions";
import {
	currentPathStore,
	type FileEntry,
	isInWorkspace,
	workspacePathStore,
	workspaceStore,
} from "../store/state";

export type BreadcrumbSegment = {
	label: string;
	/** Absolute file path to open on click; null = non-clickable. */
	target: string | null;
};

/** Splits a relative workspace path into forward-slash parts, dropping empties. */
function splitRelative(relative: string): string[] {
	return relative
		.replace(/\\/g, "/")
		.split("/")
		.filter((part) => part.length > 0);
}

function pathJoin(workspacePath: string, parts: string[]): string {
	const sep = workspacePath.includes("\\") && !workspacePath.includes("/")
		? "\\"
		: "/";
	const trimmed = workspacePath.replace(/[\\/]+$/, "");
	return parts.length === 0 ? trimmed : `${trimmed}${sep}${parts.join(sep)}`;
}

/**
 * Builds the segments for the breadcrumb bar. Exported for testing.
 *
 * For each intermediate folder segment, pairs it with a sibling `<name>.md`
 * if one exists in the workspace listing (the SP-06 subpage pairing). The
 * last segment is the current file's stem and is never clickable.
 */
export function buildBreadcrumbSegments(
	currentPath: string,
	workspacePath: string | null,
	files: FileEntry[],
): BreadcrumbSegment[] {
	if (!workspacePath || !isInWorkspace(currentPath, workspacePath)) {
		return [{ label: basename(currentPath), target: null }];
	}
	const relative = relativeWorkspacePath(currentPath, workspacePath);
	const parts = splitRelative(relative);
	if (parts.length === 0) return [];
	const segments: BreadcrumbSegment[] = [];
	for (let i = 0; i < parts.length - 1; i += 1) {
		const folderName = parts[i];
		const pairedPath = pathJoin(workspacePath, [
			...parts.slice(0, i),
			`${folderName}.md`,
		]);
		const paired = files.find((file) => pathEquals(file.path, pairedPath));
		segments.push({
			label: paired ? fileStem(paired.path) : folderName,
			target: paired ? paired.path : null,
		});
	}
	const last = parts[parts.length - 1];
	segments.push({
		label: hasMarkdownExtension(last) ? fileStem(last) : last,
		target: null,
	});
	return segments;
}

export function Breadcrumb() {
	const workspacePath = useStoreValue(workspacePathStore);
	const currentPath = useStoreValue(currentPathStore);
	const files = useStoreValue(workspaceStore).files;

	if (!currentPath) return null;

	const inWorkspace = workspacePath
		? isInWorkspace(currentPath, workspacePath)
		: false;

	const segments = inWorkspace
		? buildBreadcrumbSegments(currentPath, workspacePath ?? null, files)
		: ([
				{ label: "External", target: null },
				{ label: basename(currentPath), target: null },
			] satisfies BreadcrumbSegment[]);

	if (segments.length === 0) return null;

	return (
		<nav
			aria-label="Breadcrumb"
			data-breadcrumb
			className="flex h-6 min-w-0 shrink-0 items-center gap-0.5 overflow-hidden px-3 text-[11px] text-muted-foreground select-none"
		>
			<ol className="flex min-w-0 items-center gap-0.5">
				{segments.map((segment, index) => {
					const isLast = index === segments.length - 1;
					const key = `${index}:${segment.label}`;
					return (
						<li
							key={key}
							className="flex min-w-0 shrink items-center gap-0.5"
						>
							{segment.target ? (
								<button
									type="button"
									onClick={() => {
										if (segment.target) void loadPath(segment.target);
									}}
									title={segment.label}
									className="min-w-0 max-w-[16ch] truncate rounded-sm px-1 py-0.5 text-start hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								>
									<MiddleTruncate text={segment.label} />
								</button>
							) : (
								<span
									aria-current={isLast ? "page" : undefined}
									title={segment.label}
									className={`min-w-0 max-w-[16ch] truncate px-1 py-0.5 ${
										isLast ? "text-foreground" : ""
									}`}
								>
									<MiddleTruncate text={segment.label} />
								</span>
							)}
							{!isLast ? (
								<MingcuteRightSmallLine
									aria-hidden="true"
									className="size-3 shrink-0 text-muted-foreground/60"
								/>
							) : null}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

/** Collapses long labels so the start and end stay legible. */
function MiddleTruncate({ text, max = 32 }: { text: string; max?: number }) {
	if (text.length <= max) return <>{text}</>;
	const head = Math.ceil((max - 1) / 2);
	const tail = Math.floor((max - 1) / 2);
	return (
		<>
			{text.slice(0, head)}
			{"…"}
			{text.slice(text.length - tail)}
		</>
	);
}
