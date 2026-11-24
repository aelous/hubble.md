import { mergeAttributes, Node } from "@tiptap/core";
import { wikiDisplayNameForTarget } from "./markdownPath.js";

export const CHILD_PAGE_CREATE_EVENT = "hubble:create-child-page-requested";

export type ChildPageCreateDetail = {
	/** The position of the containing block when the slash command fired. */
	blockStart: number;
	blockEnd: number;
};

export const TURN_INTO_PAGE_EVENT = "hubble:turn-into-page-requested";

export type TurnIntoPageDetail = {
	/** The bounds of the top-level block being promoted into a child page. */
	blockStart: number;
	blockEnd: number;
	/** The Markdown content of that block, already serialized. */
	blockMarkdown: string;
};

/**
 * Inline "child page" reference, like Notion's sub-page block. Renders as a
 * compact row (icon + title derived from the resolved target basename) and
 * opens the referenced note on click, via the same wiki-link click handler.
 *
 * Markdown round-trip: serialized as a lone-paragraph wiki link `[[path]]`
 * so files remain readable and Backlinks keep working. A paragraph whose
 * only content is a single wiki link is promoted back to a `childPage`
 * block by the Markdown-to-ProseMirror converter.
 */
export const ChildPage = Node.create({
	name: "childPage",
	group: "block",
	atom: true,
	defining: true,
	selectable: true,
	draggable: false,

	addAttributes() {
		return {
			href: {
				default: "",
				parseHTML: (el) => (el as HTMLElement).getAttribute("data-href") ?? "",
				renderHTML: (attrs) => ({ "data-href": String(attrs.href ?? "") }),
			},
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-type="child-page"]' }];
	},

	renderHTML({ HTMLAttributes }) {
		const href =
			typeof HTMLAttributes.href === "string" ? HTMLAttributes.href : "";
		const title = wikiDisplayNameForTarget(href);
		return [
			"div",
			mergeAttributes(HTMLAttributes, { "data-type": "child-page" }),
			[
				"span",
				{
					"data-href": href,
					"data-link-kind": "wiki",
					"data-link": "true",
					"data-child-page-link": "true",
				},
				["span", { "data-child-page-icon": "", "aria-hidden": "true" }, ""],
				["span", { "data-child-page-title": "" }, title],
			],
		];
	},

	addNodeView() {
		return ({ node, HTMLAttributes }) => {
			const dom = document.createElement("div");
			dom.dataset.type = "child-page";
			for (const [k, v] of Object.entries(HTMLAttributes)) {
				if (k === "data-type") continue;
				if (v != null) dom.setAttribute(k, String(v));
			}

			// Inner wrapper carries the data-href + data-link-kind that
			// LinkClickExtension already looks for on mousedown/click. Reusing that
			// path means Cmd-click, hover, and all existing link behaviors apply.
			const link = document.createElement("span");
			link.setAttribute("data-href", String(node.attrs.href ?? ""));
			link.setAttribute("data-link-kind", "wiki");
			link.setAttribute("data-link", "true");
			link.setAttribute("data-child-page-link", "true");
			link.setAttribute("contenteditable", "false");

			const icon = document.createElement("span");
			icon.setAttribute("data-child-page-icon", "");
			icon.setAttribute("aria-hidden", "true");

			const title = document.createElement("span");
			title.setAttribute("data-child-page-title", "");
			title.textContent = wikiDisplayNameForTarget(
				String(node.attrs.href ?? ""),
			);

			link.appendChild(icon);
			link.appendChild(title);
			dom.appendChild(link);

			return {
				dom,
				update(updatedNode) {
					if (updatedNode.type.name !== "childPage") return false;
					const nextHref = String(updatedNode.attrs.href ?? "");
					link.setAttribute("data-href", nextHref);
					title.textContent = wikiDisplayNameForTarget(nextHref);
					return true;
				},
			};
		};
	},
});
