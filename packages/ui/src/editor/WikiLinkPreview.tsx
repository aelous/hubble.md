import { cn } from "../lib/utils";

export type WikiLinkPreviewContent = {
	title: string;
	excerpt: string;
};

export function WikiLinkPreview({
	position,
	loading,
	title,
	excerpt,
}: {
	position: { x: number; y: number };
	loading: boolean;
	title: string;
	excerpt: string;
}) {
	return (
		<div
			role="tooltip"
			aria-hidden={loading ? "true" : undefined}
			className={cn(
				"pointer-events-none absolute z-10 w-[280px] max-w-[85vw]",
				"rounded-[var(--radius-popover)] border border-border bg-popover text-popover-foreground",
				"shadow-overlay",
			)}
			style={{
				insetInlineStart: `${position.x}px`,
				insetBlockStart: `${position.y}px`,
			}}
		>
			<div className="flex flex-col gap-1 px-3 py-2">
				<div className="truncate text-[12px] font-medium leading-4 text-foreground">
					{title}
				</div>
				{loading ? (
					<div className="text-[11px] leading-4 text-muted-foreground">
						Loading preview…
					</div>
				) : excerpt ? (
					<div
						className={cn(
							"whitespace-pre-wrap break-words text-[11px] leading-4 text-muted-foreground",
							"line-clamp-5",
						)}
					>
						{excerpt}
					</div>
				) : (
					<div className="text-[11px] leading-4 text-muted-foreground italic">
						(empty file)
					</div>
				)}
			</div>
		</div>
	);
}
