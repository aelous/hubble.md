import {
	TURN_INTO_PAGE_EVENT,
	type TurnIntoPageDetail,
	tiptapDocToMarkdown,
} from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";

/**
 * Dispatched by the Cmd+/ format menu when the user picks "Copy page link".
 * The desktop shell owns workspace paths, so it listens for this and copies
 * `[[relative/path]]` for the currently-open file.
 */
export const COPY_PAGE_LINK_EVENT = "hubble:copy-page-link-requested";

/**
 * The set of formatting actions Hubble exposes on top of its editor commands.
 * Shared by the `Cmd+/` format command menu and the selection toolbar so both
 * apply formatting and report active state identically.
 */
export type FormatCommandKind =
	| "paragraph"
	| "heading1"
	| "heading2"
	| "heading3"
	| "bulletList"
	| "orderedList"
	| "taskList"
	| "blockquote"
	| "toggle"
	| "toggleHeading1"
	| "toggleHeading2"
	| "toggleHeading3"
	| "divider"
	| "turnIntoPage"
	| "copyPageLink"
	| "bold"
	| "italic"
	| "strike"
	| "link";

export function isFormatActive(editor: Editor, kind: FormatCommandKind) {
	const taskListActive =
		editor.isActive("listItem", { checked: false }) ||
		editor.isActive("listItem", { checked: true });

	switch (kind) {
		case "paragraph":
			return (
				editor.isActive("paragraph") &&
				!editor.isActive("bulletList") &&
				!editor.isActive("orderedList") &&
				!editor.isActive("blockquote")
			);
		case "heading1":
			return editor.isActive("heading", { level: 1 });
		case "heading2":
			return editor.isActive("heading", { level: 2 });
		case "heading3":
			return editor.isActive("heading", { level: 3 });
		case "bulletList":
			return editor.isActive("bulletList") && !taskListActive;
		case "orderedList":
			return editor.isActive("orderedList");
		case "taskList":
			return taskListActive;
		case "blockquote":
			return editor.isActive("blockquote");
		case "toggle":
			return editor.isActive("toggleBlock", { level: 0 });
		case "toggleHeading1":
			return editor.isActive("toggleBlock", { level: 1 });
		case "toggleHeading2":
			return editor.isActive("toggleBlock", { level: 2 });
		case "toggleHeading3":
			return editor.isActive("toggleBlock", { level: 3 });
		case "bold":
			return editor.isActive("bold");
		case "italic":
			return editor.isActive("italic");
		case "strike":
			return editor.isActive("strike");
		case "link":
			return editor.isActive("link");
		case "turnIntoPage":
			return false;
		case "copyPageLink":
			return false;
		case "divider":
			return false;
	}
}

export function applyFormatCommand(editor: Editor, kind: FormatCommandKind) {
	const chain = editor.chain().focus(undefined, { scrollIntoView: false });

	switch (kind) {
		case "paragraph":
			chain.setParagraph().run();
			return;
		case "heading1":
			chain.setHeading({ level: 1 }).run();
			return;
		case "heading2":
			chain.setHeading({ level: 2 }).run();
			return;
		case "heading3":
			chain.setHeading({ level: 3 }).run();
			return;
		case "bulletList":
			chain.toggleParentBulletList().run();
			return;
		case "orderedList":
			chain.toggleParentOrderedList().run();
			return;
		case "taskList":
			chain.toggleParentTaskList().run();
			return;
		case "blockquote":
			chain.toggleBlockquote().run();
			return;
		case "toggle":
			convertCurrentBlockToToggle(editor, 0);
			return;
		case "toggleHeading1":
			convertCurrentBlockToToggle(editor, 1);
			return;
		case "toggleHeading2":
			convertCurrentBlockToToggle(editor, 2);
			return;
		case "toggleHeading3":
			convertCurrentBlockToToggle(editor, 3);
			return;
		case "divider":
			chain.setHorizontalRule().run();
			return;
		case "turnIntoPage":
			requestTurnIntoPage(editor);
			return;
		case "copyPageLink":
			window.dispatchEvent(new CustomEvent(COPY_PAGE_LINK_EVENT));
			return;
		case "bold":
			chain.toggleBold().run();
			return;
		case "italic":
			chain.toggleItalic().run();
			return;
		case "strike":
			chain.toggleStrike().run();
			return;
		case "link":
			editor.commands.focus(undefined, { scrollIntoView: false });
			// Selections touching a link remove it. Otherwise open the link popover.
			if (removeLinksInSelection(editor)) return;
			editor.commands.toggleLinkAtSelection();
			return;
	}
}

/**
 * Removes every link the current selection touches. Partial selections remove
 * the whole link instead of splitting it, mirroring how `getActiveLinkRange`
 * treats adjacent linked text as a single link.
 */
export function removeLinksInSelection(editor: Editor): boolean {
	const { state } = editor;
	const linkType = state.schema.marks.link;
	if (!linkType) return false;

	const { from, to } = state.selection;
	const linkRanges: { from: number; to: number }[] = [];
	state.doc.nodesBetween(from, to, (node, pos) => {
		if (!node.isTextblock) return true;
		// Collect runs of adjacent linked text so a link split across marks
		// (e.g. a bold word inside a link) still counts as one link.
		let runStart: number | null = null;
		let runEnd = 0;
		node.forEach((child, offset) => {
			const childFrom = pos + 1 + offset;
			if (!linkType.isInSet(child.marks)) {
				if (runStart !== null) linkRanges.push({ from: runStart, to: runEnd });
				runStart = null;
				return;
			}
			if (runStart === null) runStart = childFrom;
			runEnd = childFrom + child.nodeSize;
		});
		if (runStart !== null) linkRanges.push({ from: runStart, to: runEnd });
		return false;
	});

	const touching = linkRanges.filter((range) =>
		from === to
			? range.from <= from && from <= range.to
			: range.from < to && from < range.to,
	);
	if (touching.length === 0) return false;

	const tr = state.tr;
	for (const range of touching) tr.removeMark(range.from, range.to, linkType);
	editor.view.dispatch(tr);
	return true;
}

/**
 * Turn the current top-level block into a Toggle. Preserves its visible text as
 * the Toggle's summary.
 */
function convertCurrentBlockToToggle(
	editor: Editor,
	level: 0 | 1 | 2 | 3,
) {
	const { state } = editor;
	const schema = state.schema;
	const toggleBlock = schema.nodes.toggleBlock;
	const toggleSummary = schema.nodes.toggleSummary;
	const toggleContent = schema.nodes.toggleContent;
	const paragraph = schema.nodes.paragraph;
	if (!toggleBlock || !toggleSummary || !toggleContent || !paragraph) return;
	const { $from } = state.selection;
	const topDepth = 1;
	if ($from.depth < topDepth) return;
	const blockStart = $from.before(topDepth);
	const blockEnd = $from.after(topDepth);
	const current = state.doc.nodeAt(blockStart);
	const summaryText = current?.textContent ?? "";
	const toggle = toggleBlock.create(
		{ open: false, level },
		[
			toggleSummary.create(
				null,
				summaryText ? schema.text(summaryText) : undefined,
			),
			toggleContent.create(null, paragraph.create()),
		],
	);
	editor
		.chain()
		.focus(undefined, { scrollIntoView: false })
		.command(({ tr, dispatch }) => {
			if (!dispatch) return true;
			tr.replaceWith(blockStart, blockEnd, toggle);
			return true;
		})
		.run();
}

/**
 * Serialize the enclosing top-level block to Markdown and dispatch a request
 * for the host app to create a child page from it. Filesystem work is owned by
 * the desktop shell; this helper only extracts content and forwards the block
 * range. Only one block is promoted at a time: if the selection spans multiple
 * top-level blocks, we still pick the one at the selection head so the command
 * remains unambiguous. No-ops when the enclosing block is already a childPage.
 */
function requestTurnIntoPage(editor: Editor) {
	const { state } = editor;
	const { $from } = state.selection;
	if ($from.depth < 1) return;
	const blockStart = $from.before(1);
	const blockEnd = $from.after(1);
	const block = state.doc.nodeAt(blockStart);
	if (!block) return;
	if (block.type.name === "childPage") return;
	const blockMarkdown = tiptapDocToMarkdown({
		type: "doc",
		content: [block.toJSON()],
	});
	window.dispatchEvent(
		new CustomEvent<TurnIntoPageDetail>(TURN_INTO_PAGE_EVENT, {
			detail: { blockStart, blockEnd, blockMarkdown },
		}),
	);
}
