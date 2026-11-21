import { stripMarkdownExtension } from "@hubble.md/editor";
import { relativeWorkspacePath } from "./filePath";

/**
 * Format a workspace-relative wiki link target for a file path:
 * forward slashes, no `.md` extension, and no leading slash.
 * For a file outside the workspace, returns the absolute path unchanged
 * (callers may still want to copy that so the user sees the raw location).
 */
export function pageLinkTarget(
	path: string,
	workspacePath: string | null,
): string {
	const relative = relativeWorkspacePath(path, workspacePath);
	const forwardSlashed = relative.replace(/\\/g, "/");
	const trimmed = forwardSlashed.replace(/^\/+/, "");
	return stripMarkdownExtension(trimmed);
}

/** Wraps the link target in `[[...]]` for pasting as a wiki link. */
export function pageLinkMarkup(
	path: string,
	workspacePath: string | null,
): string {
	return `[[${pageLinkTarget(path, workspacePath)}]]`;
}
