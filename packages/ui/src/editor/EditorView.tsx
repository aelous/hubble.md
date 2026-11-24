import {
	computePosition,
	flip,
	offset,
	shift,
	type VirtualElement,
} from "@floating-ui/dom";
import {
	buildWikiLinkValidTargetKeys,
	ChildPage,
	ContextMenuSpellcheckExtension,
	combineMarkdownFrontMatter,
	FakeSelectionExtension,
	FindExtension,
	HeadingExtension,
	InlineCodeExtension,
	LinkExtension,
	listExtensions,
	MarkdownRolloverExtension,
	markdownToTiptapDoc,
	parseMarkdownFrontMatter,
	ReviewMarkExtension,
	RichTextClipboardExtension,
	resetEditorHistory,
	setWikiLinkValidTargetKeys,
	tiptapDocToMarkdown,
	toggleExtensions,
	WikiLinkValidityExtension,
} from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import {
	EditorContent,
	type EditorOptions,
	type JSONContent,
	useEditor,
} from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AtMentionExtension } from "./AtMentionExtension";
import { clearActiveEditor, setActiveEditor } from "./activeEditor";
import { CODE_BLOCK_COPY_EVENT, HubbleCodeBlock } from "./CodeBlockExtension";
import { copySelectionAsMarkdown } from "./copyAsMarkdown";
import { EmptyBlockDirectionExtension } from "./EmptyBlockDirectionExtension";
import { LinkClickExtension } from "./LinkClickExtension";
import { LinkCreationGhostExtension } from "./LinkCreationGhostExtension";
import type { WikiTarget } from "./LinkPopover";
import {
	flushPendingSave,
	type PendingSave,
	schedulePendingSave,
} from "./pendingSave";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { SmartLinkExtension } from "./SmartLinkExtension";
import { TableCellSelectionExtension } from "./TableCellSelectionExtension";
import {
	MarkdownTableCell,
	MarkdownTableHeader,
} from "./TableMarkdownExtensions";
import { VirtualCursor } from "./VirtualCursor";
import { WikiLinkPicker } from "./WikiLinkPicker";
import { WikiLinkPreview } from "./WikiLinkPreview";
import "./EditorView.css";
import {
	EditorCommandShortcuts,
	starterKitWithRegistryShortcuts,
} from "./EditorCommandShortcuts";
import {
	FilePropertiesPanel,
	frontMatterStateFromMarkdown,
} from "./FilePropertiesPanel";
import { FindBar } from "./FindBar";
import { FormatCommandMenu } from "./FormatCommandMenu";
import {
	FormattingStatusBar,
	type SpellcheckStatus,
} from "./FormattingStatusBar";
import { ReviewCommentPopover } from "./ReviewCommentPopover";
import type { ReviewThread } from "./reviewComments";
import { SelectionFormattingToolbar } from "./SelectionFormattingToolbar";
import type { VirtualCursorMode } from "./virtualCursorMode";

const DEFAULT_SAVE_DEBOUNCE_MS = 120;

export type { WikiTarget };

export type EditorViewProps = {
	path: string;
	/** Stable note identity; physical paths may change without replacing a note. */
	documentId?: string;
	/** Keep undo history when the same note receives rewritten Markdown. */
	preserveHistoryOnUpdate?: boolean;
	initialMarkdown: string;
	editable?: boolean;
	wikiTargets?: WikiTarget[];
	extensions?: EditorOptions["extensions"];
	editorProps?: EditorOptions["editorProps"];
	onPaste?: (editor: Editor, event: ClipboardEvent) => boolean;
	onDrop?: (editor: Editor, event: DragEvent) => boolean;
	saveDebounceMs?: number;
	onLocalChange: (path: string, markdown: string) => void;
	onSave: (path: string, markdown: string) => void | Promise<void>;
	onScrollContainerChange?: (el: HTMLDivElement | null) => void;
	copyAsMarkdownRequest?: number;
	onOpenExternalLink: (href: string) => void | Promise<void>;
	onOpenWikiLink: (target: string) => void | Promise<void>;
	/**
	 * Resolve preview content for a wiki link target. Returning `null` skips
	 * showing a preview (e.g. the target doesn't resolve to a file). The
	 * EditorView caches recent results, so this can safely re-read the file.
	 */
	onPreviewWikiLink?: (
		target: string,
	) => Promise<{ title: string; excerpt: string } | null>;
	/**
	 * Create a new page next to the current file and return its wiki target
	 * (workspace-relative path). Returns null on failure.
	 */
	onCreateAndInsertWikiPage?: (name: string) => Promise<string | null>;
	onMessage?: (message: string, type: "success" | "error") => void;
	/** Review threads in the open document, republished on every edit, so an
	 * app can list them in its own chrome. */
	onReviewThreadsChange?: (threads: ReviewThread[]) => void;
	/** Published headings, for host apps that render their own outline/TOC. */
	onHeadingsChange?: (headings: OutlineHeading[]) => void;
	/** Footer status for non-default spellcheck languages. Desktop-only. */
	spellcheckStatus?: SpellcheckStatus | null;
	/**
	 * Enables format-menu commands that act on the open workspace file
	 * (e.g. "Copy page link"). Defaults to false for consumers that render
	 * EditorView outside a workspace.
	 */
	hasOpenWorkspaceFile?: boolean;
};

export type OutlineHeading = {
	id: string;
	level: number;
	text: string;
	pos: number;
};

export function EditorView({
	path,
	documentId = path,
	preserveHistoryOnUpdate = false,
	initialMarkdown,
	editable = true,
	wikiTargets = [],
	extensions = [],
	editorProps,
	onPaste,
	onDrop,
	saveDebounceMs = DEFAULT_SAVE_DEBOUNCE_MS,
	onLocalChange,
	onSave,
	onScrollContainerChange,
	copyAsMarkdownRequest = 0,
	onOpenExternalLink,
	onOpenWikiLink,
	onPreviewWikiLink,
	onMessage,
	onReviewThreadsChange,
	onHeadingsChange,
	onCreateAndInsertWikiPage,
	spellcheckStatus,
	hasOpenWorkspaceFile = false,
}: EditorViewProps) {
	const initialFrontMatter = parseMarkdownFrontMatter(initialMarkdown);
	const initialFrontMatterRaw =
		initialFrontMatter.type === "none" ? "" : initialFrontMatter.raw;
	const partsRef = useRef({
		body: initialFrontMatter.body,
		frontMatter: initialFrontMatterRaw,
	});
	const latestMarkdownRef = useRef(
		combineMarkdownFrontMatter(initialFrontMatterRaw, initialFrontMatter.body),
	);
	const pendingSaveRef = useRef<PendingSave | null>(null);
	const editorRootRef = useRef<HTMLDivElement | null>(null);
	const editorViewportRef = useRef<HTMLDivElement | null>(null);
	const lastCopyAsMarkdownRequestRef = useRef(copyAsMarkdownRequest);
	const [editorViewportEl, setEditorViewportEl] =
		useState<HTMLDivElement | null>(null);
	const [cursorModeOverride] = useState<VirtualCursorMode | null>(null);
	const [reviewCommentRequest, setReviewCommentRequest] = useState(0);
	const [frontMatterState, setFrontMatterState] = useState(() =>
		frontMatterStateFromMarkdown(initialMarkdown),
	);
	const pathRef = useRef(path);
	const editorRef = useRef<Editor | null>(null);
	useLayoutEffect(() => {
		pathRef.current = path;
	}, [path]);

	const setEditorViewport = (node: HTMLDivElement | null) => {
		editorViewportRef.current = node;
		setEditorViewportEl(node);
		onScrollContainerChange?.(node);
	};

	// Only used at editor creation. Later file loads sync through setContent.
	const [initialDoc] = useState(() =>
		markdownToTiptapDoc(initialFrontMatter.body),
	);

	const scheduleSave = () => {
		schedulePendingSave({
			delay: saveDebounceMs,
			markdown: latestMarkdownRef.current,
			path: pathRef.current,
			ref: pendingSaveRef,
			save: onSave,
		});
	};

	const editor = useEditor({
		editable,
		textDirection: "auto",
		extensions: [
			...starterKitWithRegistryShortcuts({
				code: false,
				codeBlock: false,
				listItem: false,
			}),
			InlineCodeExtension,
			HubbleCodeBlock,
			ChildPage,
			LinkExtension,
			RichTextClipboardExtension,
			SmartLinkExtension,
			LinkClickExtension.configure({
				onOpenExternalLink,
				onOpenWikiLink,
				requireModifier: editable,
			}),
			LinkCreationGhostExtension,
			ContextMenuSpellcheckExtension,
			EmptyBlockDirectionExtension,
			FakeSelectionExtension,
			FindExtension,
			HeadingExtension,
			MarkdownRolloverExtension,
			ReviewMarkExtension,
			EditorCommandShortcuts,
			AtMentionExtension,
			WikiLinkValidityExtension,
			...listExtensions,
			...toggleExtensions,
			...extensions,
			TaskItem.configure({ nested: true }),
			Table.configure({ resizable: true }),
			TableRow,
			MarkdownTableHeader,
			MarkdownTableCell,
			TableCellSelectionExtension,
		],
		content: initialDoc,
		onCreate: ({ editor: current }) => {
			publishHeadings(current, onHeadingsChange);
		},
		onUpdate: ({ editor: current }) => {
			const doc = current.getJSON() as JSONContent;
			if (hasUploadImage(doc)) return;
			const body = tiptapDocToMarkdown(doc);
			partsRef.current = { ...partsRef.current, body };
			const markdown = combineMarkdownFrontMatter(
				partsRef.current.frontMatter,
				body,
			);
			latestMarkdownRef.current = markdown;
			onLocalChange(pathRef.current, markdown);
			scheduleSave();
			publishHeadings(current, onHeadingsChange);
		},
		editorProps: {
			...editorProps,
			attributes: {
				...editorProps?.attributes,
				"data-editor-input": "",
			},
			handlePaste: (view, event, slice): boolean => {
				if (editorProps?.handlePaste?.(view, event, slice)) return true;
				const currentEditor = editorRef.current;
				if (!currentEditor || !onPaste) return false;
				return onPaste(currentEditor, event);
			},
			handleDrop: (view, event, slice, moved): boolean => {
				if (editorProps?.handleDrop?.(view, event, slice, moved)) return true;
				const currentEditor = editorRef.current;
				if (!currentEditor || !onDrop) return false;
				return onDrop(currentEditor, event);
			},
		},
	});
	useLayoutEffect(() => {
		editorRef.current = editor;
		setActiveEditor(editor);
		return () => clearActiveEditor(editor);
	}, [editor]);

	// Push the valid wiki target set into the WikiLinkValidityExtension plugin
	// whenever the workspace file list changes. The plugin re-decorates the doc
	// so links flip between the muted "invalid" style and the normal style as
	// soon as the matching file appears or disappears.
	useEffect(() => {
		if (!editor) return;
		const keys = buildWikiLinkValidTargetKeys(wikiTargets);
		setWikiLinkValidTargetKeys(editor.view, keys);
	}, [editor, wikiTargets]);

	// LK-08: hover preview. Delay before showing, keep a single instance, cache
	// recent previews to avoid rereading the same file on round-trip hover.
	const [hoverPreview, setHoverPreview] = useState<{
		position: { x: number; y: number };
		title: string;
		excerpt: string;
		loading: boolean;
	} | null>(null);
	useHoverPreview({
		editorRoot: editorViewportEl,
		onPreviewWikiLink,
		setPreview: setHoverPreview,
	});

	useEffect(() => {
		if (!editor || !editorViewportEl) return;
		const focusEditorEnd = (event: MouseEvent) => {
			if (event.target !== editorViewportEl) return;
			editor.commands.focus("end");
		};
		editorViewportEl.addEventListener("mousedown", focusEditorEnd);
		return () =>
			editorViewportEl.removeEventListener("mousedown", focusEditorEnd);
	}, [editor, editorViewportEl]);

	useEffect(() => {
		if (!editor) return;
		if (initialMarkdown === latestMarkdownRef.current) {
			return;
		}
		const parsed = parseMarkdownFrontMatter(initialMarkdown);
		const frontMatter = parsed.type === "none" ? "" : parsed.raw;
		partsRef.current = { body: parsed.body, frontMatter };
		latestMarkdownRef.current = combineMarkdownFrontMatter(
			frontMatter,
			parsed.body,
		);
		setFrontMatterState(frontMatterStateFromMarkdown(initialMarkdown));
		const currentBody = tiptapDocToMarkdown(editor.getJSON() as JSONContent);
		if (currentBody !== parsed.body) {
			editor
				.chain()
				.setMeta("addToHistory", false)
				.setContent(markdownToTiptapDoc(parsed.body), { emitUpdate: false })
				.run();
			if (!preserveHistoryOnUpdate) resetEditorHistory(editor);
		}
	}, [editor, initialMarkdown, preserveHistoryOnUpdate]);

	useEffect(() => {
		// One editor instance can serve every file, so each new document starts its own
		// undo stack. Otherwise undo replays the last file's edits into this one.
		void documentId;
		if (!editor) return;
		resetEditorHistory(editor);
	}, [editor, documentId]);

	useEffect(() => {
		// Flush the pending edit before the next document takes over.
		void documentId;
		return () => {
			flushPendingSave(pendingSaveRef);
		};
	}, [documentId]);

	useEffect(() => {
		if (!onMessage) return;
		const handleCopyMessage = (event: Event) => {
			const detail = (event as CustomEvent).detail as
				| { message?: unknown; type?: unknown }
				| undefined;
			if (typeof detail?.message !== "string") return;
			onMessage(detail.message, detail.type === "error" ? "error" : "success");
		};
		window.addEventListener(CODE_BLOCK_COPY_EVENT, handleCopyMessage);
		return () =>
			window.removeEventListener(CODE_BLOCK_COPY_EVENT, handleCopyMessage);
	}, [onMessage]);

	useEffect(() => {
		if (!editor || copyAsMarkdownRequest === 0) return;
		if (copyAsMarkdownRequest === lastCopyAsMarkdownRequestRef.current) return;
		lastCopyAsMarkdownRequestRef.current = copyAsMarkdownRequest;
		void copySelectionAsMarkdown({
			editor,
			onCopied: () => onMessage?.("Markdown copied", "success"),
		});
	}, [copyAsMarkdownRequest, editor, onMessage]);

	return (
		<div
			className="relative flex h-full min-h-0 flex-col"
			ref={editorRootRef}
			data-hubble-editor
		>
			<div
				className="editorViewport relative min-h-0 flex-1 overflow-auto overscroll-contain"
				ref={setEditorViewport}
			>
				{editable && (
					<FilePropertiesPanel
						path={path}
						state={frontMatterState}
						onChange={(nextState, frontMatter) => {
							setFrontMatterState(nextState);
							partsRef.current = { ...partsRef.current, frontMatter };
							const markdown = combineMarkdownFrontMatter(
								frontMatter,
								partsRef.current.body,
							);
							latestMarkdownRef.current = markdown;
							onLocalChange(pathRef.current, markdown);
							scheduleSave();
						}}
					/>
				)}
				<EditorContent editor={editor} />
				<VirtualCursor
					editor={editor}
					containerRef={editorRootRef}
					viewportRef={editorViewportRef}
					modeOverride={cursorModeOverride}
				/>
				{hoverPreview && (
					<WikiLinkPreview
						position={hoverPreview.position}
						loading={hoverPreview.loading}
						title={hoverPreview.title}
						excerpt={hoverPreview.excerpt}
					/>
				)}
				{editable && (
					<>
						<SlashCommandMenu editor={editor} viewportRef={editorViewportRef} />
						<WikiLinkPicker
							editor={editor}
							viewportRef={editorViewportRef}
							wikiTargets={wikiTargets}
							onCreateAndInsert={onCreateAndInsertWikiPage}
						/>
						<SelectionFormattingToolbar
							editor={editor}
							viewport={editorViewportEl}
							onComment={() => setReviewCommentRequest((value) => value + 1)}
						/>
						<ReviewCommentPopover
							editor={editor}
							filePath={path}
							viewportRef={editorViewportRef}
							request={reviewCommentRequest}
							onMessage={onMessage}
							onThreadsChange={onReviewThreadsChange}
						/>
						<FormatCommandMenu
							editor={editor}
							viewportRef={editorViewportRef}
							hasOpenWorkspaceFile={hasOpenWorkspaceFile}
						/>
					</>
				)}
			</div>
			<FindBar editor={editor} />
			<FormattingStatusBar
				editor={editor}
				scrollContainer={editorViewportEl}
				spellcheckStatus={spellcheckStatus}
			/>
		</div>
	);
}

function hasUploadImage(node: JSONContent): boolean {
	if (node.type === "image" && node.attrs?.uploadId) return true;
	return node.content?.some(hasUploadImage) ?? false;
}

// LK-08: lightweight hover preview. Delay before showing to avoid popping on
// cursor pass-through, dismiss on mouseleave, and keep a single instance by
// aborting any in-flight load when the pointer moves to a different link.
const HOVER_PREVIEW_DELAY_MS = 500;
const HOVER_PREVIEW_CACHE_LIMIT = 16;

type HoverPreviewState = {
	position: { x: number; y: number };
	title: string;
	excerpt: string;
	loading: boolean;
} | null;

function useHoverPreview({
	editorRoot,
	onPreviewWikiLink,
	setPreview,
}: {
	editorRoot: HTMLDivElement | null;
	onPreviewWikiLink:
		| ((target: string) => Promise<{ title: string; excerpt: string } | null>)
		| undefined;
	setPreview: (next: HoverPreviewState) => void;
}) {
	const cacheRef = useRef<Map<string, { title: string; excerpt: string }>>(
		new Map(),
	);

	useEffect(() => {
		if (!editorRoot) return;
		if (!onPreviewWikiLink) return;

		let hoverTimer: ReturnType<typeof setTimeout> | null = null;
		const loadState = { token: 0 };
		let currentAnchor: HTMLElement | null = null;

		const clearHover = () => {
			if (hoverTimer) {
				clearTimeout(hoverTimer);
				hoverTimer = null;
			}
			loadState.token += 1;
			currentAnchor = null;
			setPreview(null);
		};

		const positionFor = (
			anchor: HTMLElement,
		): Promise<{ x: number; y: number } | null> => {
			const reference: VirtualElement = {
				contextElement: anchor,
				getBoundingClientRect: () => anchor.getBoundingClientRect(),
			};
			const floatingEl = document.createElement("div");
			floatingEl.style.position = "absolute";
			floatingEl.style.visibility = "hidden";
			floatingEl.style.inlineSize = "280px";
			floatingEl.style.blockSize = "80px";
			editorRoot.appendChild(floatingEl);
			return computePosition(reference, floatingEl, {
				strategy: "absolute",
				placement: "top",
				middleware: [
					offset(6),
					flip({ boundary: editorRoot, fallbackPlacements: ["bottom"] }),
					shift({ boundary: editorRoot, padding: 8 }),
				],
			})
				.then(({ x, y }) => {
					floatingEl.remove();
					return { x, y };
				})
				.catch(() => {
					floatingEl.remove();
					return null;
				});
		};

		const schedulePreview = (anchor: HTMLElement) => {
			// Dead links skip preview — nothing to show for a missing file.
			if (anchor.closest("[data-link-invalid]")) return;
			if (anchor.closest("[data-child-page-missing='true']")) return;
			const target = extractWikiTarget(anchor);
			if (!target) return;

			currentAnchor = anchor;
			if (hoverTimer) clearTimeout(hoverTimer);
			hoverTimer = setTimeout(() => {
				hoverTimer = null;
				loadState.token += 1;
				const token = loadState.token;
				void positionFor(anchor).then(async (position) => {
					if (!position) return;
					if (token !== loadState.token) return;
					const cached = cacheRef.current.get(target);
					if (cached) {
						setPreview({
							position,
							title: cached.title,
							excerpt: cached.excerpt,
							loading: false,
						});
						return;
					}
					setPreview({ position, title: target, excerpt: "", loading: true });
					try {
						const result = await onPreviewWikiLink(target);
						if (token !== loadState.token) return;
						if (!result) {
							setPreview(null);
							return;
						}
						rememberPreview(cacheRef.current, target, result);
						setPreview({
							position,
							title: result.title,
							excerpt: result.excerpt,
							loading: false,
						});
					} catch {
						if (token !== loadState.token) return;
						setPreview(null);
					}
				});
			}, HOVER_PREVIEW_DELAY_MS);
		};

		const findLinkAnchor = (node: EventTarget | null): HTMLElement | null => {
			if (!(node instanceof Element)) return null;
			return node.closest<HTMLElement>(
				'[data-link-kind="wiki"], [data-type="child-page"]',
			);
		};

		const onMouseOver = (event: MouseEvent) => {
			const anchor = findLinkAnchor(event.target);
			if (!anchor) {
				if (currentAnchor) clearHover();
				return;
			}
			if (anchor === currentAnchor) return;
			clearHover();
			schedulePreview(anchor);
		};

		const onMouseOut = (event: MouseEvent) => {
			if (!currentAnchor) return;
			const related = event.relatedTarget;
			if (related instanceof Node && currentAnchor.contains(related)) return;
			clearHover();
		};

		const onScroll = () => {
			if (currentAnchor) clearHover();
		};

		editorRoot.addEventListener("mouseover", onMouseOver);
		editorRoot.addEventListener("mouseout", onMouseOut);
		editorRoot.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			editorRoot.removeEventListener("mouseover", onMouseOver);
			editorRoot.removeEventListener("mouseout", onMouseOut);
			editorRoot.removeEventListener("scroll", onScroll);
			clearHover();
		};
	}, [editorRoot, onPreviewWikiLink, setPreview]);
}

function extractWikiTarget(anchor: HTMLElement): string | null {
	const target = anchor.getAttribute("data-target");
	if (target) return target;
	const kind = anchor.getAttribute("data-link-kind");
	if (kind === "wiki") {
		return anchor.getAttribute("data-href") ?? null;
	}
	const inner = anchor.querySelector<HTMLElement>('[data-link-kind="wiki"]');
	if (inner) {
		return (
			inner.getAttribute("data-target") ??
			inner.getAttribute("data-href") ??
			null
		);
	}
	return anchor.getAttribute("data-href") ?? null;
}

function rememberPreview(
	cache: Map<string, { title: string; excerpt: string }>,
	target: string,
	value: { title: string; excerpt: string },
) {
	cache.delete(target);
	cache.set(target, value);
	while (cache.size > HOVER_PREVIEW_CACHE_LIMIT) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
}

function publishHeadings(
	editor: Editor,
	onHeadingsChange: ((headings: OutlineHeading[]) => void) | undefined,
) {
	if (!onHeadingsChange) return;
	const list: OutlineHeading[] = [];
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === "heading") {
			const text = node.textContent.trim();
			if (!text) return;
			list.push({
				id: `h-${pos}`,
				level: Number(node.attrs.level ?? 1),
				text,
				pos,
			});
			return;
		}
		if (node.type.name === "toggleBlock") {
			const level = Number(node.attrs.level ?? 0);
			if (level < 1 || level > 6) return;
			const text = node.firstChild?.textContent?.trim() ?? "";
			if (!text) return;
			list.push({
				id: `h-${pos}`,
				level,
				text,
				pos,
			});
			return;
		}
	});
	onHeadingsChange(list);
}
