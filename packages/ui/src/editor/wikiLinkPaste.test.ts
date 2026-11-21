// @vitest-environment happy-dom

import { LinkExtension } from "@hubble.md/editor";
import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors) editor.destroy();
	editors.length = 0;
});

describe("wiki link paste rule", () => {
	it("converts a pasted [[target]] into a wiki link mark", () => {
		const editor = createEditor(docWithParagraph(""));
		setCaret(editor, 1);

		simulatePaste(editor, "[[Notes/Project.md]]");

		expect(editor.getJSON()).toMatchObject({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "Project",
							marks: [
								{
									type: "link",
									attrs: {
										href: "Notes/Project.md",
										kind: "wiki",
										target: "Notes/Project.md",
									},
								},
							],
						},
					],
				},
			],
		});
	});

	it("uses the alias as visible text when present", () => {
		const editor = createEditor(docWithParagraph(""));
		setCaret(editor, 1);

		simulatePaste(editor, "[[Notes/Project.md|Spec]]");

		const paragraph = editor.getJSON().content?.[0];
		expect(paragraph).toMatchObject({
			content: [
				{
					type: "text",
					text: "Spec",
					marks: [
						{
							type: "link",
							attrs: {
								href: "Notes/Project.md",
								kind: "wiki",
								target: "Notes/Project.md",
							},
						},
					],
				},
			],
		});
	});

	it("converts a [[target]] embedded in surrounding text", () => {
		const editor = createEditor(docWithParagraph(""));
		setCaret(editor, 1);

		simulatePaste(editor, "See [[Notes/Project.md]] for details");

		const paragraph = editor.getJSON().content?.[0];
		expect(paragraph?.content).toEqual([
			{ type: "text", text: "See " },
			{
				type: "text",
				text: "Project",
				marks: [
					{
						type: "link",
						attrs: {
							href: "Notes/Project.md",
							kind: "wiki",
							target: "Notes/Project.md",
						},
					},
				],
			},
			{ type: "text", text: " for details" },
		]);
	});

	it("leaves plain URLs untouched", () => {
		const editor = createEditor(docWithParagraph(""));
		setCaret(editor, 1);

		simulatePaste(editor, "https://example.com");

		const paragraph = editor.getJSON().content?.[0];
		expect(paragraph?.content).toEqual([
			{ type: "text", text: "https://example.com" },
		]);
	});
});

function createEditor(content: JSONContent) {
	const editor = new Editor({
		element: document.createElement("div"),
		extensions: [StarterKit.configure({ link: false }), LinkExtension],
		content,
	});
	editors.push(editor);
	return editor;
}

function setCaret(editor: Editor, pos: number) {
	editor.view.dispatch(
		editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
	);
}

function docWithParagraph(text: string): JSONContent {
	return {
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: text ? [{ type: "text", text }] : undefined,
			},
		],
	};
}

/**
 * Insert `text` at the current selection via a transaction tagged
 * `uiEvent: "paste"`, which is how Tiptap's PasteRule plugin decides a
 * change was a paste. This drives the LinkExtension's rule without going
 * through a synthetic ClipboardEvent, which happy-dom cannot build with a
 * populated DataTransfer.
 */
function simulatePaste(editor: Editor, text: string) {
	const { state } = editor;
	const tr = state.tr.insertText(text);
	tr.setMeta("uiEvent", "paste");
	editor.view.dispatch(tr);
}
