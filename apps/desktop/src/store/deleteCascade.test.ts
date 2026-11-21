import type { SidebarDeleteItem } from "@hubble.md/ui";
import { describe, expect, it } from "vitest";
import { pairedFolderPath, withCascadedPairs } from "./deleteCascade";

const folders = (paths: string[]) =>
	new Set(paths.map((p) => p.toLocaleLowerCase()));

describe("pairedFolderPath", () => {
	it("returns the sibling folder for a markdown file", () => {
		expect(pairedFolderPath("/ws/A.md")).toBe("/ws/A");
	});

	it("returns null for non-markdown files", () => {
		expect(pairedFolderPath("/ws/A.html")).toBeNull();
	});
});

describe("withCascadedPairs", () => {
	it("adds the paired folder when it exists", () => {
		const input: SidebarDeleteItem[] = [{ kind: "file", path: "/ws/A.md" }];
		expect(withCascadedPairs(input, folders(["/ws/A"]))).toEqual([
			{ kind: "file", path: "/ws/A.md" },
			{ kind: "folder", folderId: "/ws/A" },
		]);
	});

	it("skips the paired folder when it does not exist", () => {
		const input: SidebarDeleteItem[] = [{ kind: "file", path: "/ws/A.md" }];
		expect(withCascadedPairs(input, folders([]))).toEqual([
			{ kind: "file", path: "/ws/A.md" },
		]);
	});

	it("does not reach for a paired file from a folder", () => {
		const input: SidebarDeleteItem[] = [{ kind: "folder", folderId: "/ws/A" }];
		expect(withCascadedPairs(input, folders(["/ws/A"]))).toEqual([
			{ kind: "folder", folderId: "/ws/A" },
		]);
	});

	it("drops descendants already covered by a selected folder", () => {
		const input: SidebarDeleteItem[] = [
			{ kind: "folder", folderId: "/ws/A" },
			{ kind: "file", path: "/ws/A/child.md" },
		];
		expect(withCascadedPairs(input, folders(["/ws/A"]))).toEqual([
			{ kind: "folder", folderId: "/ws/A" },
		]);
	});

	it("dedupes repeated items", () => {
		const input: SidebarDeleteItem[] = [
			{ kind: "file", path: "/ws/A.md" },
			{ kind: "file", path: "/ws/A.md" },
			{ kind: "folder", folderId: "/ws/A" },
		];
		expect(withCascadedPairs(input, folders(["/ws/A"]))).toEqual([
			{ kind: "file", path: "/ws/A.md" },
			{ kind: "folder", folderId: "/ws/A" },
		]);
	});
});
