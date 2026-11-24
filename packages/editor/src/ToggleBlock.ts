import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import {
	type EditorState,
	Plugin,
	PluginKey,
	TextSelection,
	type Transaction,
} from "@tiptap/pm/state";

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		toggleBlock: {
			setToggleBlock: () => ReturnType;
			unsetToggleBlock: () => ReturnType;
		};
	}
}

const CHEVRON_PLUGIN_KEY = new PluginKey("ToggleBlockChevron");

/**
 * Notion-style collapsible block. Rendered as <details>/<summary>.
 * Persisted to Markdown as an Obsidian "foldable callout" (`> [!note]-`) by
 * the Markdown converters.
 */
export const ToggleBlock = Node.create({
	name: "toggleBlock",
	group: "block",
	content: "toggleSummary toggleContent",
	defining: true,
	isolating: true,

	addAttributes() {
		return {
			open: {
				default: false,
				parseHTML: (el) => el.hasAttribute("open"),
				renderHTML: (attrs) => (attrs.open ? { open: "" } : {}),
			},
			level: {
				default: 0,
				parseHTML: (el) => {
					const value = Number(el.getAttribute("data-level") ?? 0);
					return value >= 1 && value <= 3 ? value : 0;
				},
				renderHTML: (attrs) =>
					attrs.level ? { "data-level": String(attrs.level) } : {},
			},
		};
	},

	parseHTML() {
		return [{ tag: "details" }, { tag: 'div[data-type="toggle-block"]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, { "data-type": "toggle-block" }),
			0,
		];
	},

	addNodeView() {
		return ({ node, HTMLAttributes, getPos, editor }) => {
			const dom = document.createElement("div");
			dom.dataset.type = "toggle-block";
			for (const [k, v] of Object.entries(HTMLAttributes)) {
				if (k === "open" || k === "data-type") continue;
				dom.setAttribute(k, v as string);
			}
			if (node.attrs.open) dom.setAttribute("data-open", "true");
			else dom.setAttribute("data-open", "false");
			if (node.attrs.level)
				dom.setAttribute("data-level", String(node.attrs.level));

			const chevron = document.createElement("span");
			chevron.setAttribute("data-toggle-chevron", "");
			chevron.setAttribute("contenteditable", "false");
			chevron.setAttribute("aria-hidden", "true");
			if (isToggleContentEmpty(node.lastChild))
				chevron.setAttribute("data-empty", "");
			chevron.addEventListener("mousedown", (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (typeof getPos !== "function") return;
				const pos = getPos();
				if (pos == null) return;
				const current = editor.state.doc.nodeAt(pos);
				if (!current || current.type.name !== "toggleBlock") return;
				editor.view.dispatch(
					editor.state.tr.setNodeAttribute(pos, "open", !current.attrs.open),
				);
			});

			// `contentDOM` is a separate child; PM mounts summary + content inside
			// it and leaves our chevron sibling alone.
			const content = document.createElement("div");
			content.setAttribute("data-toggle-inner", "");

			dom.appendChild(chevron);
			dom.appendChild(content);

			return {
				dom,
				contentDOM: content,
				update(updatedNode) {
					if (updatedNode.type.name !== "toggleBlock") return false;
					dom.setAttribute(
						"data-open",
						updatedNode.attrs.open ? "true" : "false",
					);
					if (updatedNode.attrs.level)
						dom.setAttribute("data-level", String(updatedNode.attrs.level));
					else dom.removeAttribute("data-level");
					if (isToggleContentEmpty(updatedNode.lastChild))
						chevron.setAttribute("data-empty", "");
					else chevron.removeAttribute("data-empty");
					return true;
				},
			};
		};
	},

	addCommands() {
		return {
			setToggleBlock:
				() =>
				({ chain, state }) => {
					const { $from } = state.selection;
					const text = $from.parent.textContent;
					return chain()
						.insertContentAt(
							{ from: $from.before($from.depth), to: $from.after($from.depth) },
							{
								type: this.name,
								attrs: { open: false },
								content: [
									{
										type: "toggleSummary",
										content: text ? [{ type: "text", text }] : undefined,
									},
									{
										type: "toggleContent",
										content: [{ type: "paragraph" }],
									},
								],
							},
						)
						.run();
				},
			unsetToggleBlock:
				() =>
				({ chain, state }) => {
					const { $from } = state.selection;
					// Walk up to find the toggleBlock
					for (let depth = $from.depth; depth > 0; depth--) {
						if ($from.node(depth).type.name === "toggleBlock") {
							const block = $from.node(depth);
							const summaryText = block.firstChild?.textContent ?? "";
							const from = $from.before(depth);
							const to = $from.after(depth);
							return chain()
								.insertContentAt(
									{ from, to },
									summaryText
										? {
												type: "paragraph",
												content: [{ type: "text", text: summaryText }],
											}
										: { type: "paragraph" },
								)
								.run();
						}
					}
					return false;
				},
		};
	},

	addKeyboardShortcuts() {
		return {};
	},

	addInputRules() {
		return [
			new InputRule({
				find: /^>>\s$/,
				handler: ({ state, chain }) => {
					const { $from } = state.selection;
					const start = $from.before($from.depth);
					const end = $from.after($from.depth);
					chain()
						.deleteRange({ from: start, to: end })
						.insertContentAt(start, {
							type: this.name,
							attrs: { open: true },
							content: [
								{ type: "toggleSummary" },
								{
									type: "toggleContent",
									content: [{ type: "paragraph" }],
								},
							],
						})
						.command(({ tr, dispatch }) => {
							if (!dispatch) return true;
							const pos = start + 1;
							const sel = TextSelection.near(tr.doc.resolve(pos));
							tr.setSelection(sel);
							return true;
						})
						.run();
				},
			}),
		];
	},

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: CHEVRON_PLUGIN_KEY,
				props: {
					handleKeyDown: (view, event) => {
						const { state } = view;
						const { $from } = state.selection;
						const isMod = event.metaKey || event.ctrlKey;

						// Mod+Alt+T → toggle this Toggle and all its descendants
						if (
							isMod &&
							event.altKey &&
							(event.key === "t" || event.key === "T")
						) {
							const found = findEnclosingToggle($from);
							if (!found) return false;
							const target = !found.node.attrs.open;
							const tr = state.tr.setNodeAttribute(found.pos, "open", target);
							found.node.descendants((child, relPos) => {
								if (child.type.name !== "toggleBlock") return true;
								tr.setNodeAttribute(found.pos + 1 + relPos, "open", target);
								return true;
							});
							view.dispatch(tr);
							event.preventDefault();
							return true;
						}

						if (event.key === "Enter") {
							// Mod+Enter → toggle open state without moving caret
							if (isMod) {
								const found = findEnclosingToggle($from);
								if (!found) return false;
								view.dispatch(
									state.tr.setNodeAttribute(
										found.pos,
										"open",
										!found.node.attrs.open,
									),
								);
								event.preventDefault();
								return true;
							}
							// Enter on an empty trailing paragraph inside toggleContent →
							// pop the empty paragraph out of the Toggle so the user can
							// resume writing below it.
							if (
								$from.parent.type.name === "paragraph" &&
								$from.parent.content.size === 0
							) {
								let contentDepth = -1;
								for (let depth = $from.depth - 1; depth >= 0; depth--) {
									if ($from.node(depth).type.name === "toggleContent") {
										contentDepth = depth;
										break;
									}
								}
								if (contentDepth >= 0) {
									const contentNode = $from.node(contentDepth);
									const indexInContent = $from.index(contentDepth);
									const isLastChild =
										indexInContent === contentNode.childCount - 1;
									if (isLastChild) {
										const toggleBlockDepth = contentDepth - 1;
										const toggleEnd = $from.after(toggleBlockDepth);
										const paraStart = $from.before($from.depth);
										const paraEnd = $from.after($from.depth);
										const paragraphType = state.schema.nodes.paragraph;
										if (paragraphType) {
											const tr = state.tr;
											tr.delete(paraStart, paraEnd);
											const insertAt = tr.mapping.map(toggleEnd);
											tr.insert(insertAt, paragraphType.create());
											tr.setSelection(
												TextSelection.near(tr.doc.resolve(insertAt)),
											);
											view.dispatch(tr);
											event.preventDefault();
											return true;
										}
									}
								}
							}
							// Enter inside summary → jump into the content; open if needed
							if ($from.parent.type.name !== "toggleSummary") return false;
							let blockDepth = -1;
							for (let depth = $from.depth - 1; depth >= 0; depth--) {
								if ($from.node(depth).type.name === "toggleBlock") {
									blockDepth = depth;
									break;
								}
							}
							if (blockDepth < 0) return false;
							const block = $from.node(blockDepth);
							const blockStart = $from.before(blockDepth);
							const summarySize = block.firstChild?.nodeSize ?? 2;
							const target = blockStart + 1 + summarySize + 2;
							const tr = state.tr;
							if (!block.attrs.open) {
								tr.setNodeAttribute(blockStart, "open", true);
							}
							tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
							view.dispatch(tr);
							event.preventDefault();
							return true;
						}

						// Tab / Shift+Tab inside a Toggle structure
						if (event.key === "Tab") {
							if (
								event.shiftKey &&
								isInsideToggleContent($from) &&
								liftOutOfToggleAt(view)
							) {
								event.preventDefault();
								return true;
							}
							if (!event.shiftKey && nestIntoPreviousToggleAt(view)) {
								event.preventDefault();
								return true;
							}
						}

						return false;
					},
				},
			}),
		];
	},
});

export const ToggleSummary = Node.create({
	name: "toggleSummary",
	content: "inline*",
	defining: true,
	selectable: false,

	parseHTML() {
		return [{ tag: "summary" }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["summary", mergeAttributes(HTMLAttributes), 0];
	},
});

export const ToggleContent = Node.create({
	name: "toggleContent",
	content: "block+",
	defining: true,
	selectable: false,

	parseHTML() {
		return [{ tag: "div[data-toggle-content]" }];
	},

	renderHTML({ HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, { "data-toggle-content": "" }),
			0,
		];
	},
});

export const toggleExtensions = [ToggleBlock, ToggleSummary, ToggleContent];

function findEnclosingToggle(
	$from: ResolvedPos,
): { pos: number; node: PMNode } | null {
	for (let depth = $from.depth; depth >= 0; depth--) {
		const node = $from.node(depth);
		if (node.type.name === "toggleBlock") {
			return { pos: $from.before(depth), node };
		}
	}
	return null;
}

function isToggleContentEmpty(contentNode: PMNode | null | undefined): boolean {
	if (!contentNode) return true;
	if (contentNode.childCount === 0) return true;
	if (contentNode.childCount === 1) {
		const only = contentNode.firstChild;
		return !!only && only.type.name === "paragraph" && only.content.size === 0;
	}
	return false;
}

function isInsideToggleContent($from: ResolvedPos): boolean {
	for (let depth = $from.depth; depth > 0; depth--) {
		if ($from.node(depth).type.name === "toggleContent") return true;
	}
	return false;
}

/**
 * Tab inside a top-level block whose previous sibling is a Toggle: move this
 * block into the Toggle's content area.
 */
function nestIntoPreviousToggleAt(view: {
	state: EditorState;
	dispatch: (tr: Transaction) => void;
}): boolean {
	const { state } = view;
	const { $from } = state.selection;
	if ($from.depth !== 1) return false;
	const index = $from.index(0);
	if (index === 0) return false;
	const prev = state.doc.child(index - 1);
	if (prev.type.name !== "toggleBlock") return false;
	const blockStart = $from.before(1);
	const blockEnd = $from.after(1);
	const current = state.doc.nodeAt(blockStart);
	if (!current) return false;
	const prevStart = blockStart - prev.nodeSize;
	const summarySize = prev.firstChild?.nodeSize ?? 2;
	const insertAt =
		prevStart + 1 + summarySize + (prev.lastChild?.content.size ?? 0) + 1;
	const tr = state.tr;
	tr.delete(blockStart, blockEnd);
	tr.insert(tr.mapping.map(insertAt), current);
	tr.setNodeAttribute(prevStart, "open", true);
	tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(insertAt))));
	view.dispatch(tr);
	return true;
}

/**
 * Shift+Tab inside a toggleContent: lift the current block out of its
 * enclosing toggleContent, placing it directly after the parent Toggle.
 */
function liftOutOfToggleAt(view: {
	state: EditorState;
	dispatch: (tr: Transaction) => void;
}): boolean {
	const { state } = view;
	const { $from } = state.selection;
	let contentDepth = -1;
	for (let depth = $from.depth; depth > 0; depth--) {
		if ($from.node(depth).type.name === "toggleContent") {
			contentDepth = depth;
			break;
		}
	}
	if (contentDepth < 0) return false;
	const blockDepth = contentDepth + 1;
	if ($from.depth < blockDepth) return false;
	const toggleBlockDepth = contentDepth - 1;
	const toggleEnd = $from.after(toggleBlockDepth);
	const blockStart = $from.before(blockDepth);
	const blockEnd = $from.after(blockDepth);
	const current = state.doc.nodeAt(blockStart);
	if (!current) return false;
	const tr = state.tr;
	tr.delete(blockStart, blockEnd);
	const insertAt = tr.mapping.map(toggleEnd);
	tr.insert(insertAt, current);
	tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt)));
	view.dispatch(tr);
	return true;
}
