import { Button } from "@hubble.md/ui";
import { useEffect, useState } from "react";
import MingcuteDownLine from "~icons/mingcute/down-line";
import MingcuteRefresh2Line from "~icons/mingcute/refresh-2-line";
import {
	BACKLINK_MAX_SNIPPETS_PER_SOURCE,
	type BacklinkSource,
	findBacklinks,
} from "../lib/backlinks";
import { basename, relativeWorkspacePath } from "../lib/filePath";
import type { FileEntry } from "../store/state";
import { viewerStore } from "../store/state";

type Props = {
	path: string;
	workspacePath: string | null;
	files: FileEntry[];
	onOpenSource: (path: string, line: number) => void;
};

type Status = "loading" | "ready" | "error";

/**
 * Backlinks panel shown below the editor for markdown notes. Lists every other
 * markdown file in the workspace that references the open note via `[[...]]`,
 * grouped by source file with a line-level snippet per match. Refreshes on
 * path changes, on save (via a disk-content subscription), and on demand.
 */
export function BacklinksPanel({
	path,
	workspacePath,
	files,
	onOpenSource,
}: Props) {
	const [collapsed, setCollapsed] = useState(false);
	const [sources, setSources] = useState<BacklinkSource[]>([]);
	const [status, setStatus] = useState<Status>("loading");
	const [refreshToken, setRefreshToken] = useState(0);

	// Save-driven refresh: bump the token whenever the open note's on-disk copy
	// changes. savePathContent lands by updating diskContent; a path switch
	// updates it too, but the path-change effect already refreshes separately,
	// so the token coalesces into a single scan.
	useEffect(() => {
		let lastDisk = viewerStore.get().diskContent;
		let lastPath = viewerStore.get().currentPath;
		return viewerStore.subscribe(() => {
			const next = viewerStore.get();
			if (next.currentPath !== lastPath) {
				lastPath = next.currentPath;
				lastDisk = next.diskContent;
				return;
			}
			if (next.diskContent !== lastDisk) {
				lastDisk = next.diskContent;
				setRefreshToken((token) => token + 1);
			}
		});
	}, []);

	useEffect(() => {
		// refreshToken is read so the effect re-runs when disk changes bump it.
		void refreshToken;
		if (!workspacePath) {
			setSources([]);
			setStatus("ready");
			return;
		}
		const controller = new AbortController();
		setStatus("loading");
		findBacklinks(path, workspacePath, files, { signal: controller.signal })
			.then((result) => {
				if (controller.signal.aborted) return;
				setSources(result);
				setStatus("ready");
			})
			.catch(() => {
				if (controller.signal.aborted) return;
				setSources([]);
				setStatus("error");
			});
		return () => controller.abort();
	}, [path, workspacePath, files, refreshToken]);

	const count = sources.reduce((sum, src) => sum + src.snippets.length, 0);
	const hasBacklinks = sources.length > 0;

	return (
		<section
			aria-label="Backlinks"
			className="shrink-0 border-t border-border bg-background text-xs"
		>
			<header className="flex h-8 items-center gap-1 px-2">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={collapsed ? "Expand backlinks" : "Collapse backlinks"}
					title={collapsed ? "Expand backlinks" : "Collapse backlinks"}
					onClick={() => setCollapsed((prev) => !prev)}
				>
					<MingcuteDownLine
						className={`size-4 transition-transform ${collapsed ? "-rotate-90" : ""}`}
					/>
				</Button>
				<span className="text-xs font-medium text-foreground/80">
					Backlinks
				</span>
				<span className="text-xs text-muted-foreground">
					{status === "loading" && !hasBacklinks
						? ""
						: hasBacklinks
							? `(${count})`
							: "(0)"}
				</span>
				<div className="ms-auto flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Refresh backlinks"
						title="Refresh backlinks"
						onClick={() => setRefreshToken((token) => token + 1)}
					>
						<MingcuteRefresh2Line
							className={`size-4 ${status === "loading" ? "animate-spin" : ""}`}
						/>
					</Button>
				</div>
			</header>
			{collapsed ? null : (
				<div className="max-h-56 overflow-y-auto px-2 pb-2">
					{status === "loading" && !hasBacklinks ? (
						<p className="px-1 py-1 text-xs text-muted-foreground">
							Searching…
						</p>
					) : status === "error" ? (
						<p className="px-1 py-1 text-xs text-muted-foreground">
							Failed to load backlinks.
						</p>
					) : !hasBacklinks ? (
						<p className="px-1 py-1 text-xs text-muted-foreground">
							No backlinks yet
						</p>
					) : (
						<ul className="space-y-2">
							{sources.map((source) => (
								<BacklinkSourceRow
									key={source.path}
									source={source}
									workspacePath={workspacePath}
									onOpenSource={onOpenSource}
								/>
							))}
						</ul>
					)}
				</div>
			)}
		</section>
	);
}

function BacklinkSourceRow({
	source,
	workspacePath,
	onOpenSource,
}: {
	source: BacklinkSource;
	workspacePath: string | null;
	onOpenSource: (path: string, line: number) => void;
}) {
	const label = basename(source.path);
	const folder = workspacePath
		? relativeWorkspacePath(source.path, workspacePath)
		: source.path;
	const snippets = source.snippets.slice(0, BACKLINK_MAX_SNIPPETS_PER_SOURCE);
	return (
		<li className="rounded-sm">
			<div
				className="truncate px-1 text-[11px] font-medium text-foreground/80"
				title={folder}
			>
				{label}
			</div>
			<ul className="mt-0.5 space-y-0.5">
				{snippets.map((snippet) => (
					<li key={`${snippet.line}-${snippet.matchStart}`}>
						<button
							type="button"
							onClick={() => onOpenSource(source.path, snippet.line)}
							className="block w-full truncate rounded-sm px-1 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
							title={snippet.text}
						>
							<SnippetText snippet={snippet} />
						</button>
					</li>
				))}
			</ul>
		</li>
	);
}

function SnippetText({
	snippet,
}: {
	snippet: { text: string; matchStart: number; matchEnd: number };
}) {
	const { text, matchStart, matchEnd } = snippet;
	const safeStart = Math.max(0, Math.min(matchStart, text.length));
	const safeEnd = Math.max(safeStart, Math.min(matchEnd, text.length));
	const before = text.slice(0, safeStart);
	const match = text.slice(safeStart, safeEnd);
	const after = text.slice(safeEnd);
	return (
		<>
			{before}
			<mark className="rounded-xs bg-selected/30 font-semibold text-foreground">
				{match}
			</mark>
			{after}
		</>
	);
}
