import { describe, expect, it } from "vitest";
import { pageLinkMarkup, pageLinkTarget } from "./pageLink";

describe("pageLinkTarget", () => {
	it("returns a workspace-relative target with no extension", () => {
		expect(pageLinkTarget("/ws/Projects/Design.md", "/ws")).toBe(
			"Projects/Design",
		);
	});

	it("handles a workspace path that already ends in a slash", () => {
		expect(pageLinkTarget("/ws/Design.md", "/ws/")).toBe("Design");
	});

	it("preserves nested folders and strips the extension", () => {
		expect(pageLinkTarget("/ws/a/b/c.md", "/ws")).toBe("a/b/c");
	});

	it("normalizes backslashes within the relative tail to forward slashes", () => {
		// `relativeWorkspacePath` strips the workspace prefix verbatim, so the
		// tail we care about may still carry Windows separators.
		expect(pageLinkTarget("/ws/a\\b.md", "/ws")).toBe("a/b");
	});

	it("keeps non-markdown extensions intact", () => {
		expect(pageLinkTarget("/ws/manual.pdf", "/ws")).toBe("manual.pdf");
	});
});

describe("pageLinkMarkup", () => {
	it("wraps the target in double brackets", () => {
		expect(pageLinkMarkup("/ws/Projects/Design.md", "/ws")).toBe(
			"[[Projects/Design]]",
		);
	});
});
