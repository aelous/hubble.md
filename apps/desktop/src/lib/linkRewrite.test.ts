import { describe, expect, it } from "vitest";
import { rewriteWikiLinksInContent } from "./linkRewrite";

describe("rewriteWikiLinksInContent", () => {
	it("rewrites a plain [[Foo]] when the mapper returns a new target", () => {
		const out = rewriteWikiLinksInContent("see [[Foo]] here", (target) =>
			target === "Foo" ? "Bar" : null,
		);
		expect(out).toBe("see [[Bar]] here");
	});

	it("preserves the alias when rewriting [[Foo|display]]", () => {
		const out = rewriteWikiLinksInContent("[[Foo|display]]", (target) =>
			target === "Foo" ? "Bar" : null,
		);
		expect(out).toBe("[[Bar|display]]");
	});

	it("rewrites nested folder targets", () => {
		const out = rewriteWikiLinksInContent(
			"[[notes/Foo]] and [[notes/Foo|kept]]",
			(target) => (target === "notes/Foo" ? "archive/Foo" : null),
		);
		expect(out).toBe("[[archive/Foo]] and [[archive/Foo|kept]]");
	});

	it("rewrites multiple occurrences on one line", () => {
		const out = rewriteWikiLinksInContent(
			"[[Foo]] [[Foo]] [[Bar]]",
			(target) => (target === "Foo" ? "Qux" : null),
		);
		expect(out).toBe("[[Qux]] [[Qux]] [[Bar]]");
	});

	it("leaves content unchanged when the mapper returns null", () => {
		const input = "[[Foo]] [[Bar|alias]] [[baz/Qux]]";
		expect(rewriteWikiLinksInContent(input, () => null)).toBe(input);
	});

	it("leaves the target unchanged when the mapper returns the same string", () => {
		const input = "[[Foo]]";
		expect(rewriteWikiLinksInContent(input, (t) => t)).toBe(input);
	});

	it("does not rewrite escaped brackets (\\[[Foo]])", () => {
		const input = "escaped \\[[Foo]] and real [[Foo]]";
		const out = rewriteWikiLinksInContent(input, () => "Bar");
		expect(out).toBe("escaped \\[[Foo]] and real [[Bar]]");
	});

	it("still rewrites when preceded by an even number of backslashes", () => {
		// `\\[[Foo]]` is a literal backslash followed by a real wiki link.
		const out = rewriteWikiLinksInContent("\\\\[[Foo]]", (t) =>
			t === "Foo" ? "Bar" : null,
		);
		expect(out).toBe("\\\\[[Bar]]");
	});

	it("does not match single brackets or other markdown link syntax", () => {
		const input = "[Foo](./foo.md) and [regular link]";
		expect(rewriteWikiLinksInContent(input, () => "Bar")).toBe(input);
	});
});
