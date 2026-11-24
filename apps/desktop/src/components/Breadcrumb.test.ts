// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { FileEntry } from "../store/state";
import { type BreadcrumbSegment, buildBreadcrumbSegments } from "./Breadcrumb";

function file(path: string): FileEntry {
	return { path, modified_at: 0 };
}

describe("buildBreadcrumbSegments", () => {
	it("labels ancestor folders by their paired .md file (SP-06)", () => {
		const files = [file("/ws/A.md"), file("/ws/A/B.md")];
		const segments = buildBreadcrumbSegments("/ws/A/B.md", "/ws", files);
		expect(segments).toEqual<BreadcrumbSegment[]>([
			{ label: "A", target: "/ws/A.md" },
			{ label: "B", target: null },
		]);
	});

	it("falls back to a non-clickable folder name when no sibling .md exists", () => {
		const files = [file("/ws/plain/note.md")];
		const segments = buildBreadcrumbSegments("/ws/plain/note.md", "/ws", files);
		expect(segments).toEqual<BreadcrumbSegment[]>([
			{ label: "plain", target: null },
			{ label: "note", target: null },
		]);
	});

	it("marks the current segment non-clickable even when a paired file exists", () => {
		const files = [file("/ws/A.md"), file("/ws/A/B.md"), file("/ws/A/B/C.md")];
		const segments = buildBreadcrumbSegments("/ws/A/B/C.md", "/ws", files);
		expect(segments).toEqual<BreadcrumbSegment[]>([
			{ label: "A", target: "/ws/A.md" },
			{ label: "B", target: "/ws/A/B.md" },
			{ label: "C", target: null },
		]);
	});

	it("renders only the basename for files outside the workspace", () => {
		const segments = buildBreadcrumbSegments("/elsewhere/other.md", "/ws", []);
		expect(segments).toEqual<BreadcrumbSegment[]>([
			{ label: "other.md", target: null },
		]);
	});

	it("renders only the basename when no workspace is open", () => {
		const segments = buildBreadcrumbSegments("/anywhere/file.md", null, []);
		expect(segments).toEqual<BreadcrumbSegment[]>([
			{ label: "file.md", target: null },
		]);
	});

	it("handles a file directly at the workspace root", () => {
		const segments = buildBreadcrumbSegments("/ws/top.md", "/ws", []);
		expect(segments).toEqual<BreadcrumbSegment[]>([
			{ label: "top", target: null },
		]);
	});
});
