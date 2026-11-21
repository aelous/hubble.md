import { describe, expect, it } from "vitest";
import { markdownToTiptapDoc } from "./markdownToProsemirror.js";
import { tiptapDocToMarkdown } from "./prosemirrorToMarkdown.js";

describe("link markdown conversion", () => {
	it("parses markdown links into link marks", () => {
		const doc = markdownToTiptapDoc("[OpenAI](https://openai.com)");
		const paragraph = doc.content?.[0];
		expect(paragraph?.type).toBe("paragraph");
		const textNode = paragraph?.content?.[0];
		expect(textNode?.type).toBe("text");
		expect(textNode?.text).toBe("OpenAI");
		expect(textNode?.marks).toEqual([
			{
				type: "link",
				attrs: { href: "https://openai.com", kind: "url", target: null },
			},
		]);
	});

	it("serializes link marks back to markdown links", () => {
		const markdown = tiptapDocToMarkdown({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "OpenAI",
							marks: [{ type: "link", attrs: { href: "https://openai.com" } }],
						},
					],
				},
			],
		});
		expect(markdown).toBe("[OpenAI](https://openai.com)");
	});
});

describe("link where text equals href", () => {
	it("parses as regular link mark", () => {
		const doc = markdownToTiptapDoc(
			"[https://example.com](https://example.com)",
		);
		const paragraph = doc.content?.[0];
		const textNode = paragraph?.content?.[0];
		expect(textNode?.type).toBe("text");
		expect(textNode?.text).toBe("https://example.com");
		expect(textNode?.marks).toEqual([
			{
				type: "link",
				attrs: { href: "https://example.com", kind: "url", target: null },
			},
		]);
	});

	it("round-trips through markdown", () => {
		const input = "[https://example.com](https://example.com)";
		const doc = markdownToTiptapDoc(input);
		const output = tiptapDocToMarkdown(doc);
		expect(output).toBe(input);
	});
});

describe("wikilink markdown conversion", () => {
	it("parses a lone wikilink into a childPage block", () => {
		const doc = markdownToTiptapDoc("[[Notes/File 2.md]]");
		expect(doc.content?.[0]).toEqual({
			type: "childPage",
			attrs: { href: "Notes/File 2.md" },
		});
	});

	it("parses wikilinks inside paragraphs as wiki link marks", () => {
		const doc = markdownToTiptapDoc("See [[Notes/File 2.md]] for details");
		const paragraph = doc.content?.[0];
		expect(paragraph?.type).toBe("paragraph");
		const linkNode = paragraph?.content?.[1];
		expect(linkNode?.type).toBe("text");
		expect(linkNode?.text).toBe("File 2");
		expect(linkNode?.marks).toEqual([
			{
				type: "link",
				attrs: {
					href: "Notes/File 2.md",
					kind: "wiki",
					target: "Notes/File 2.md",
				},
			},
		]);
	});

	it("round-trips wikilinks with custom titles", () => {
		const input = "[[Notes/File 2.md|My link]]";
		const doc = markdownToTiptapDoc(input);
		const output = tiptapDocToMarkdown(doc);
		expect(output).toBe(input);
	});

	it("serializes auto titles without an alias", () => {
		const markdown = tiptapDocToMarkdown({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "File 2",
							marks: [
								{
									type: "link",
									attrs: {
										href: "/vault/Notes/File 2.md",
										kind: "wiki",
										target: "Notes/File 2.md",
									},
								},
							],
						},
					],
				},
			],
		});
		expect(markdown).toBe("[[Notes/File 2.md]]");
	});
});

describe("childPage markdown round-trip", () => {
	it("serializes a childPage block to a lone wiki link", () => {
		const markdown = tiptapDocToMarkdown({
			type: "doc",
			content: [{ type: "childPage", attrs: { href: "Notes/Sub" } }],
		});
		expect(markdown).toBe("[[Notes/Sub]]");
	});

	it("round-trips a childPage block through markdown", () => {
		const input = "[[Notes/Sub]]";
		const doc = markdownToTiptapDoc(input);
		expect(doc.content?.[0]).toEqual({
			type: "childPage",
			attrs: { href: "Notes/Sub" },
		});
		expect(tiptapDocToMarkdown(doc)).toBe(input);
	});

	it("keeps aliased lone wiki links as inline wiki marks", () => {
		const doc = markdownToTiptapDoc("[[Notes/Sub|Custom]]");
		expect(doc.content?.[0]?.type).toBe("paragraph");
	});
});
