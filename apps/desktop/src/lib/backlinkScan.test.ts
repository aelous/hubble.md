import { describe, expect, it } from "vitest";
import { extractWikiLinks } from "./backlinkScan";

describe("extractWikiLinks", () => {
	it("extracts a single reference", () => {
		const results = extractWikiLinks("See [[Foo]] for context.");
		expect(results).toHaveLength(1);
		expect(results[0].target).toBe("Foo");
		expect(results[0].snippet.line).toBe(0);
		expect(results[0].snippet.text).toBe("See [[Foo]] for context.");
	});

	it("extracts multiple references on different lines", () => {
		const results = extractWikiLinks(
			"[[Alpha]] opens the door.\nLater, [[Beta]] joins [[Gamma]].",
		);
		expect(results.map((r) => r.target)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(results[1].snippet.line).toBe(1);
		expect(results[2].snippet.line).toBe(1);
	});

	it("strips aliases but keeps the target", () => {
		const [hit] = extractWikiLinks("[[Projects/Design|Design brief]]");
		expect(hit.target).toBe("Projects/Design");
	});

	it("skips malformed links", () => {
		expect(extractWikiLinks("[single] [[open")).toEqual([]);
	});
});
