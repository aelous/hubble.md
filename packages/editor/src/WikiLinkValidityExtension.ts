import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { stripMarkdownExtension } from "./markdownPath.js";

/**
 * Marks wiki links and childPage blocks whose target doesn't resolve to a file
 * in the workspace. The plugin owns a set of valid target keys (full path,
 * stem, lowercased); pass it in with the `setValidTargetKeys` meta whenever the
 * workspace file list changes. The decorations then:
 *   - Add `data-link-invalid=""` to wiki link marks that don't resolve. The
 *     LinkClickExtension consults this attribute to no-op on click.
 *   - Add `data-child-page-missing="true"` to childPage atoms that don't
 *     resolve. ChildPage's CSS already styles this hook.
 *
 * The decorations are derived from plugin state, so the whole document
 * re-decorates automatically after each state change — creating the target
 * file flips the style back to valid on the next transaction.
 */

export const wikiLinkValidityKey = new PluginKey<WikiLinkValidityState>(
	"wikiLinkValidity",
);

export type WikiLinkValidityState = {
	validTargetKeys: Set<string>;
};

export type WikiLinkValidityMeta = {
	type: "setValidTargetKeys";
	keys: Set<string>;
};

export function buildWikiLinkValidTargetKeys(
	targets: Iterable<{ target: string }>,
): Set<string> {
	const set = new Set<string>();
	for (const entry of targets) {
		const target = entry.target;
		if (!target) continue;
		addTargetKeys(set, target);
	}
	return set;
}

export function isWikiTargetValid(
	rawTarget: string | null | undefined,
	validKeys: Set<string>,
): boolean {
	if (!rawTarget) return false;
	const path = rawTarget.split("#")[0] ?? "";
	if (!path) return false;
	const keys = targetKeysFor(path);
	for (const key of keys) {
		if (validKeys.has(key)) return true;
	}
	return false;
}

function addTargetKeys(set: Set<string>, target: string) {
	for (const key of targetKeysFor(target)) {
		set.add(key);
	}
}

function targetKeysFor(target: string): string[] {
	const lower = target.toLowerCase();
	const stripped = stripMarkdownExtension(lower);
	const stem = stripped.split(/[\\/]/).pop() ?? "";
	const keys = [lower, stripped];
	if (stem) keys.push(stem);
	return keys;
}

export const WikiLinkValidityExtension = Extension.create<{
	validTargetKeys?: Set<string>;
}>({
	name: "wikiLinkValidity",

	addOptions() {
		return { validTargetKeys: new Set<string>() };
	},

	addProseMirrorPlugins() {
		const initialKeys = this.options.validTargetKeys ?? new Set<string>();
		return [
			new Plugin<WikiLinkValidityState>({
				key: wikiLinkValidityKey,
				state: {
					init: () => ({ validTargetKeys: initialKeys }),
					apply(tr, previous) {
						const meta = tr.getMeta(wikiLinkValidityKey) as
							| WikiLinkValidityMeta
							| undefined;
						if (meta?.type === "setValidTargetKeys") {
							return { validTargetKeys: meta.keys };
						}
						return previous;
					},
				},
				props: {
					decorations(state) {
						const pluginState = wikiLinkValidityKey.getState(state);
						if (!pluginState) return null;
						return buildDecorations(state, pluginState.validTargetKeys);
					},
				},
			}),
		];
	},
});

function buildDecorations(
	state: EditorState,
	validTargetKeys: Set<string>,
): DecorationSet {
	const decorations: Decoration[] = [];
	const linkMarkType = state.schema.marks.link;
	const childPageType = state.schema.nodes.childPage;

	state.doc.descendants((node: ProseMirrorNode, pos: number) => {
		if (childPageType && node.type === childPageType) {
			const href =
				typeof node.attrs.href === "string" ? (node.attrs.href as string) : "";
			if (!isWikiTargetValid(href, validTargetKeys)) {
				decorations.push(
					Decoration.node(pos, pos + node.nodeSize, {
						"data-child-page-missing": "true",
					}),
				);
			}
			return false;
		}
		if (!node.isText || !linkMarkType) return;
		const mark = node.marks.find((m) => m.type === linkMarkType);
		if (!mark) return;
		if (mark.attrs.kind !== "wiki") return;
		const target =
			typeof mark.attrs.target === "string"
				? (mark.attrs.target as string)
				: typeof mark.attrs.href === "string"
					? (mark.attrs.href as string)
					: null;
		if (!isWikiTargetValid(target, validTargetKeys)) {
			decorations.push(
				Decoration.inline(pos, pos + node.nodeSize, {
					"data-link-invalid": "",
				}),
			);
		}
	});

	return DecorationSet.create(state.doc, decorations);
}

export function setWikiLinkValidTargetKeys(
	view: EditorView | null,
	keys: Set<string>,
) {
	if (!view) return;
	const current = wikiLinkValidityKey.getState(view.state);
	if (current && targetKeySetsEqual(current.validTargetKeys, keys)) return;
	const tr = view.state.tr.setMeta(wikiLinkValidityKey, {
		type: "setValidTargetKeys",
		keys,
	} satisfies WikiLinkValidityMeta);
	view.dispatch(tr);
}

function targetKeySetsEqual(a: Set<string>, b: Set<string>): boolean {
	if (a.size !== b.size) return false;
	for (const value of a) {
		if (!b.has(value)) return false;
	}
	return true;
}
