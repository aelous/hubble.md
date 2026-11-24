import {
	computePosition,
	flip,
	offset,
	shift,
	type VirtualElement,
} from "@floating-ui/dom";
import { wikiDisplayNameForTarget } from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "../lib/utils";
import { Input } from "../primitives/input";
import {
	AT_MENTION_REQUESTED_EVENT,
	type AtMentionRequestedDetail,
} from "./AtMentionExtension";
import type { WikiTarget } from "./LinkPopover";

type InlineSession = {
	/** Mode: `@` was typed and lives in the document at `atPos`. */
	kind: "inline";
	/** Position of the `@` character. */
	atPos: number;
};

type ModalSession = {
	/** Mode: slash command — no sentinel in doc; picker drives its own input. */
	kind: "modal";
	/** Insertion point in the document. */
	pos: number;
	/** Query string driven by picker input. */
	query: string;
};

type Session = InlineSession | ModalSession;

function filterWikiTargets(wikiTargets: WikiTarget[], rawQuery: string) {
	const query = rawQuery.trim().toLocaleLowerCase();
	return wikiTargets
		.filter((file) => {
			if (!query) return true;
			const haystack = `${file.title} ${file.target}`.toLocaleLowerCase();
			return haystack.includes(query);
		})
		.sort((a, b) => a.title.localeCompare(b.title))
		.slice(0, 6);
}

function hasExactMatch(wikiTargets: WikiTarget[], rawQuery: string) {
	const query = rawQuery.trim().toLocaleLowerCase();
	if (!query) return true;
	return wikiTargets.some(
		(file) =>
			file.title.toLocaleLowerCase() === query ||
			file.target.toLocaleLowerCase() === query,
	);
}

function readInlineQuery(editor: Editor, atPos: number): string | null {
	const { $from } = editor.state.selection;
	if (!editor.state.selection.empty) return null;
	// The `@` must still be in the doc at atPos
	const atChar = editor.state.doc.textBetween(atPos, atPos + 1, "\n", "\0");
	if (atChar !== "@") return null;
	// The caret must be inside the same textblock as `@` and after it.
	if ($from.pos <= atPos) return null;
	const textAfter = editor.state.doc.textBetween(
		atPos + 1,
		$from.pos,
		"\n",
		"\0",
	);
	// Any whitespace terminates the mention.
	if (/\s/.test(textAfter)) return null;
	return textAfter;
}

function insertWikiLinkInline(
	editor: Editor,
	atPos: number,
	queryLength: number,
	target: string,
	alias: string | null,
) {
	const linkType = editor.state.schema.marks.link;
	if (!linkType) return;
	const text = alias ?? wikiDisplayNameForTarget(target);
	const endPos = atPos + 1 + queryLength;
	const linkNode = editor.state.schema.text(text, [
		linkType.create({ href: target, kind: "wiki", target }),
	]);
	// Append a trailing unmarked space so the caret lands outside the inclusive
	// link mark — otherwise further typing continues the link.
	const spaceNode = editor.state.schema.text(" ");
	const tr = editor.state.tr.replaceWith(atPos, endPos, [linkNode, spaceNode]);
	tr.setSelection(
		TextSelection.create(
			tr.doc,
			atPos + linkNode.nodeSize + spaceNode.nodeSize,
		),
	);
	tr.setStoredMarks([]);
	editor.view.dispatch(tr);
	editor.commands.focus(undefined, { scrollIntoView: false });
}

function insertWikiLinkModal(
	editor: Editor,
	pos: number,
	target: string,
	text: string,
) {
	const linkType = editor.state.schema.marks.link;
	if (!linkType) return;
	const linkNode = editor.state.schema.text(text, [
		linkType.create({ href: target, kind: "wiki", target }),
	]);
	const spaceNode = editor.state.schema.text(" ");
	const tr = editor.state.tr.insert(pos, linkNode);
	tr.insert(pos + linkNode.nodeSize, spaceNode);
	tr.setSelection(
		TextSelection.create(tr.doc, pos + linkNode.nodeSize + spaceNode.nodeSize),
	);
	tr.setStoredMarks([]);
	editor.view.dispatch(tr);
	editor.commands.focus(undefined, { scrollIntoView: false });
}

function updatePickerPosition(
	editor: Editor,
	viewport: HTMLDivElement,
	floatingEl: HTMLDivElement,
	pos: number,
	setX: (x: number) => void,
	setY: (y: number) => void,
) {
	const reference: VirtualElement = {
		contextElement: viewport,
		getBoundingClientRect() {
			const coords = editor.view.coordsAtPos(pos);
			return {
				x: coords.left,
				y: coords.top,
				left: coords.left,
				top: coords.top,
				right: coords.right,
				bottom: coords.bottom,
				width: coords.right - coords.left,
				height: coords.bottom - coords.top,
				toJSON() {
					return this;
				},
			};
		},
	};
	return computePosition(reference, floatingEl, {
		strategy: "absolute",
		placement: "bottom-start",
		middleware: [
			offset(4),
			flip({
				boundary: viewport,
				fallbackPlacements: ["top-start"],
				padding: 8,
			}),
			shift({ boundary: viewport, padding: 8 }),
		],
	}).then(({ x, y }) => {
		setX(x);
		setY(y);
	});
}

export function WikiLinkPicker({
	editor,
	viewportRef,
	wikiTargets,
	onCreateAndInsert,
}: {
	editor: Editor | null;
	viewportRef: RefObject<HTMLDivElement | null>;
	wikiTargets: WikiTarget[];
	onCreateAndInsert?: (name: string) => Promise<string | null> | string | null;
}) {
	const [session, setSession] = useState<Session | null>(null);
	const [inlineQuery, setInlineQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const [x, setX] = useState(0);
	const [y, setY] = useState(0);
	const floatingRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const sessionRef = useRef<Session | null>(null);
	useEffect(() => {
		sessionRef.current = session;
	}, [session]);

	const query = session?.kind === "modal" ? session.query : inlineQuery;
	const suggestions = filterWikiTargets(wikiTargets, query);
	const canCreate =
		Boolean(onCreateAndInsert) &&
		query.trim().length > 0 &&
		!hasExactMatch(wikiTargets, query);
	const totalItems = suggestions.length + (canCreate ? 1 : 0);
	const boundedIndex =
		totalItems === 0 ? 0 : Math.min(activeIndex, totalItems - 1);

	const closeSession = useCallback(() => {
		setSession(null);
		setInlineQuery("");
		setActiveIndex(0);
	}, []);

	// Listen for @ trigger and /link trigger.
	useEffect(() => {
		const onRequest = (event: Event) => {
			const detail = (event as CustomEvent<AtMentionRequestedDetail>).detail;
			if (!editor) return;
			setActiveIndex(0);
			if (detail.insertPlain) {
				setSession({
					kind: "modal",
					pos: detail.pos,
					query: "",
				});
				setInlineQuery("");
			} else {
				setSession({ kind: "inline", atPos: detail.pos });
				setInlineQuery("");
			}
		};
		window.addEventListener(AT_MENTION_REQUESTED_EVENT, onRequest);
		return () =>
			window.removeEventListener(AT_MENTION_REQUESTED_EVENT, onRequest);
	}, [editor]);

	// Track inline query from the editor state.
	useEffect(() => {
		if (!editor || !session || session.kind !== "inline") return;
		const update = () => {
			const current = sessionRef.current;
			if (!current || current.kind !== "inline") return;
			const next = readInlineQuery(editor, current.atPos);
			if (next === null) {
				closeSession();
				return;
			}
			setInlineQuery(next);
			setActiveIndex(0);
		};
		editor.on("transaction", update);
		editor.on("selectionUpdate", update);
		editor.on("blur", update);
		return () => {
			editor.off("transaction", update);
			editor.off("selectionUpdate", update);
			editor.off("blur", update);
		};
	}, [editor, session, closeSession]);

	// Positioning.
	useLayoutEffect(() => {
		if (!editor || !session) return;
		const viewport = viewportRef.current;
		const floating = floatingRef.current;
		if (!viewport || !floating) return;
		const pos = session.kind === "inline" ? session.atPos : session.pos;
		const place = () => {
			void updatePickerPosition(editor, viewport, floating, pos, setX, setY);
		};
		place();
		viewport.addEventListener("scroll", place, { passive: true });
		window.addEventListener("resize", place);
		return () => {
			viewport.removeEventListener("scroll", place);
			window.removeEventListener("resize", place);
		};
	}, [editor, session, viewportRef]);

	// Focus the input once when entering modal mode. We intentionally do NOT
	// re-focus on every session change: `value={session.query}` causes a
	// re-render on each keystroke, and re-selecting the input on each render
	// would wipe the typed text, so the effect keys only on whether we are in
	// modal mode.
	const isModalSession = session?.kind === "modal";
	useEffect(() => {
		if (!isModalSession) return;
		queueMicrotask(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	}, [isModalSession]);

	const applySuggestion = useCallback(
		(suggestion: WikiTarget) => {
			if (!editor || !session) return;
			if (session.kind === "inline") {
				insertWikiLinkInline(
					editor,
					session.atPos,
					inlineQuery.length,
					suggestion.target,
					suggestion.title,
				);
			} else {
				insertWikiLinkModal(
					editor,
					session.pos,
					suggestion.target,
					suggestion.title,
				);
			}
			closeSession();
		},
		[editor, session, inlineQuery, closeSession],
	);

	const applyCreate = useCallback(async () => {
		if (!editor || !session || !onCreateAndInsert) return;
		const name = query.trim();
		if (!name) return;
		// Snapshot session before any await — the editor may update during creation.
		const currentSession = session;
		const inlineQueryLen = inlineQuery.length;
		// Close the picker UI immediately; the heavy filesystem work runs after.
		// Any error path below silently bails without reopening.
		closeSession();
		const created = await onCreateAndInsert(name);
		if (!created) return;
		// If the editor state has shifted (e.g. because file creation remounted
		// the editor), bail without throwing.
		try {
			if (currentSession.kind === "inline") {
				insertWikiLinkInline(
					editor,
					currentSession.atPos,
					inlineQueryLen,
					created,
					name,
				);
			} else {
				insertWikiLinkModal(editor, currentSession.pos, created, name);
			}
		} catch {
			// swallow — the newly loaded doc may no longer have the insertion point.
		}
	}, [editor, session, onCreateAndInsert, query, inlineQuery, closeSession]);

	// Keyboard.
	useEffect(() => {
		if (!editor || !session) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				closeSession();
				editor.commands.focus(undefined, { scrollIntoView: false });
				return;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				if (totalItems === 0) return;
				event.preventDefault();
				event.stopPropagation();
				const delta = event.key === "ArrowDown" ? 1 : -1;
				setActiveIndex(
					(index) =>
						(Math.min(index, totalItems - 1) + delta + totalItems) % totalItems,
				);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				if (totalItems === 0) return;
				event.preventDefault();
				event.stopPropagation();
				if (boundedIndex < suggestions.length) {
					applySuggestion(suggestions[boundedIndex]);
				} else if (canCreate) {
					void applyCreate();
				}
				return;
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [
		editor,
		session,
		totalItems,
		boundedIndex,
		suggestions,
		canCreate,
		applySuggestion,
		applyCreate,
		closeSession,
	]);

	if (!session) return null;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: container only prevents mousedown from stealing editor focus; the options inside are the real controls.
		<div
			ref={floatingRef}
			className="absolute z-4 w-[250px] overflow-hidden rounded-[var(--radius-popover)] border border-border bg-popover text-popover-foreground shadow-overlay"
			style={{
				insetInlineStart: `${x}px`,
				insetBlockStart: `${y}px`,
			}}
			onMouseDown={(event) => event.preventDefault()}
		>
			{session.kind === "modal" ? (
				<div className="p-1">
					<Input
						ref={inputRef}
						type="text"
						value={session.query}
						placeholder="Search pages…"
						onKeyDown={(event) => {
							// Stop every keystroke from bubbling into ProseMirror; the
							// window-capture handler above still gets Esc/Enter/arrows
							// because they're dispatched before the input receives them.
							if (
								event.key !== "Escape" &&
								event.key !== "Enter" &&
								event.key !== "Tab" &&
								event.key !== "ArrowDown" &&
								event.key !== "ArrowUp"
							) {
								event.stopPropagation();
							}
						}}
						onKeyUp={(event) => event.stopPropagation()}
						onKeyPress={(event) => event.stopPropagation()}
						onBeforeInput={(event) => event.stopPropagation()}
						onInput={(event) => event.stopPropagation()}
						onChange={(event) => {
							const value = event.target.value;
							setSession({ ...session, query: value });
							setActiveIndex(0);
						}}
						className="h-7 rounded-sm border-border bg-background px-2 py-1.25 text-[11px] leading-4"
					/>
				</div>
			) : null}
			{totalItems === 0 ? (
				<div className="px-2 py-1.5 text-[11px] leading-[15px] text-muted-foreground">
					No matching pages
				</div>
			) : (
				<div role="listbox" className="max-h-40 overflow-y-auto p-1">
					{suggestions.map((suggestion, index) => {
						const isActive = index === boundedIndex;
						return (
							<button
								key={suggestion.path}
								type="button"
								role="option"
								aria-selected={isActive}
								className={cn(
									"flex w-full min-w-0 flex-col rounded-[var(--radius-inner)] border-0 bg-transparent px-2 py-1 text-start text-[11px] leading-[15px] text-popover-foreground hover:bg-accent",
									isActive && "bg-muted text-foreground",
								)}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => applySuggestion(suggestion)}
							>
								<span className="w-full truncate">{suggestion.title}</span>
								<span className="w-full truncate text-[10px] leading-[13px] text-muted-foreground">
									{suggestion.target}
								</span>
							</button>
						);
					})}
					{canCreate ? (
						<button
							type="button"
							role="option"
							aria-selected={boundedIndex === suggestions.length}
							className={cn(
								"flex w-full min-w-0 items-center gap-1 rounded-[var(--radius-inner)] border-0 bg-transparent px-2 py-1 text-start text-[11px] leading-[15px] text-popover-foreground hover:bg-accent",
								boundedIndex === suggestions.length &&
									"bg-muted text-foreground",
							)}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => void applyCreate()}
						>
							<span className="text-muted-foreground">Create</span>
							<span className="truncate">“{query.trim()}”</span>
						</button>
					) : null}
				</div>
			)}
		</div>
	);
}

// end
