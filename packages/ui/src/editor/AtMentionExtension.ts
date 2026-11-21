import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

export const AT_MENTION_REQUESTED_EVENT = "hubble:at-mention-requested";

export type AtMentionRequestedDetail = {
	/** Position of the `@` character (or caret, when triggered without `@`). */
	pos: number;
	/** When true, the picker should insert plain `[[target]]` rather than `[[target|alias]]`. */
	insertPlain?: boolean;
};

export const AtMentionExtension = Extension.create({
	name: "atMentionTrigger",
	priority: 1000,
	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					handleTextInput(view, from, _to, text) {
						if (text !== "@") return false;
						// Only trigger at block start or after whitespace/newline so we
						// don't hijack email addresses or mid-word `@`.
						if (from > 0) {
							const prev = view.state.doc.textBetween(from - 1, from);
							if (prev && !/\s/.test(prev)) return false;
						}
						// Defer dispatch until after this transaction commits so listeners
						// can read the document state that includes the typed `@`.
						queueMicrotask(() => {
							window.dispatchEvent(
								new CustomEvent<AtMentionRequestedDetail>(
									AT_MENTION_REQUESTED_EVENT,
									{
										detail: { pos: from },
									},
								),
							);
						});
						return false;
					},
				},
			}),
		];
	},
});
