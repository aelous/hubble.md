import type { OutlineHeading } from "@hubble.md/ui";
import { getActiveEditor } from "@hubble.md/ui";

type Props = {
	headings: OutlineHeading[];
	onClose: () => void;
};

/**
 * Right-rail Table of Contents panel. Clicking a heading scrolls the active
 * editor to the heading's position and moves the caret there.
 */
export function OutlinePanel({ headings, onClose }: Props) {
	const scrollTo = (heading: OutlineHeading) => {
		const editor = getActiveEditor();
		if (!editor) return;
		editor
			.chain()
			.focus()
			.setTextSelection(heading.pos + 1)
			.scrollIntoView()
			.run();
	};

	const minLevel = headings.reduce(
		(acc, h) => Math.min(acc, h.level),
		6,
	);

	return (
		<aside
			aria-label="Outline"
			className="flex w-64 min-w-56 shrink-0 flex-col border-l border-border bg-sidebar text-sm"
		>
			<header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
				<span className="font-medium text-foreground/80">Outline</span>
				<button
					type="button"
					onClick={onClose}
					className="rounded px-1.5 py-0.5 text-xs text-foreground/60 hover:bg-muted hover:text-foreground"
					aria-label="Close outline"
				>
					×
				</button>
			</header>
			<nav className="flex-1 min-h-0 overflow-y-auto px-1 py-2">
				{headings.length === 0 ? (
					<p className="px-3 py-6 text-center text-xs text-foreground/50">
						No headings
					</p>
				) : (
					<ul className="space-y-0.5">
						{headings.map((h) => (
							<li key={h.id}>
								<button
									type="button"
									onClick={() => scrollTo(h)}
									className="block w-full truncate rounded px-2 py-1 text-left text-foreground/80 hover:bg-muted hover:text-foreground"
									style={{
										paddingInlineStart: `${(h.level - minLevel) * 12 + 8}px`,
										fontSize: h.level <= 1 ? "0.875rem" : "0.8125rem",
										fontWeight: h.level <= 2 ? 500 : 400,
									}}
									title={h.text}
								>
									{h.text}
								</button>
							</li>
						))}
					</ul>
				)}
			</nav>
		</aside>
	);
}
