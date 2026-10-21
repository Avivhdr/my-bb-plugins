// Small presentational pieces shared by the board, the cards, and the dialogs.
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Fragment } from "react";
import type { LinkedPullRequest } from "../core/board";
import { LABEL_SWATCHES } from "../core/labelColors";
import { highlightSegments, type SearchTerms } from "../core/search";
import { valueBandColor } from "../core/valueColor";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const HEX6 = /^[0-9a-fA-F]{6}$/;

function alphaHex(fraction: number): string {
  return Math.round(fraction * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * Tint an element with a GitHub label color. GitHub colors are data, not theme
 * tokens, so the tint is a translucent layer over the element's own theme
 * background (set by its classes) rather than a replacement for it. That keeps
 * the result legible in light and dark palettes alike.
 */
export function tintStyle(
  color: string | null,
  options: { fill: number; border: number },
): CSSProperties | undefined {
  if (!color || !HEX6.test(color)) return undefined;
  const fill = `#${color}${alphaHex(options.fill)}`;
  return {
    backgroundImage: `linear-gradient(${fill}, ${fill})`,
    borderColor: `#${color}${alphaHex(options.border)}`,
  };
}

/** A solid swatch of a label color. */
export function swatchStyle(color: string | null): CSSProperties | undefined {
  return color && HEX6.test(color) ? { backgroundColor: `#${color}` } : undefined;
}

/** The value badge, tinted by priority band so high-value issues stand out. */
export function valueBadgeStyle(value: number): CSSProperties {
  const hex = valueBandColor(value);
  return { ...tintStyle(hex, { fill: 0.18, border: 0.5 }), color: `#${hex}` };
}

export function HighlightedText({ text, terms }: { text: string; terms: SearchTerms }) {
  const segments = highlightSegments(text, terms);
  return (
    <>
      {segments.map((segment, i) =>
        segment.match ? (
          <mark key={i} className="rounded-sm bg-primary/25 text-inherit">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

/** One small outlined chip, the shared look of PR and thread links on a card. */
export function MetaChip({
  children,
  title,
  onActivate,
  ariaLabel,
}: {
  children: ReactNode;
  title: string;
  ariaLabel: string;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1.5 py-px text-[11px] leading-4 text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        onActivate();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  );
}

export function LinkedPullRequestLinks({
  pullRequests,
  onOpenUrl,
}: {
  pullRequests: LinkedPullRequest[];
  onOpenUrl: (url: string) => void;
}) {
  return (
    <>
      {pullRequests.map((pr) => (
        <MetaChip
          key={pr.number}
          title={pr.title || `Pull request #${pr.number}`}
          ariaLabel={pr.title ? `Open pull request #${pr.number}: ${pr.title}` : `Open pull request #${pr.number}`}
          onActivate={() => onOpenUrl(pr.htmlUrl)}
        >
          <Icon name="GitPullRequest" className="size-3" />#{pr.number}
        </MetaChip>
      ))}
    </>
  );
}

const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** A 1..10 grid plus Clear. `current` is highlighted. */
export function ValueGrid({
  current,
  onPick,
  disabled,
  className,
}: {
  current: number | null;
  onPick: (value: number | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="listbox" aria-label="Set value" className={cn("grid grid-cols-5 gap-1", className)}>
      {VALUES.map((n) => (
        <button
          key={n}
          type="button"
          role="option"
          aria-selected={current === n}
          aria-label={`Set value ${n}`}
          disabled={disabled}
          className={cn(
            "h-7 rounded-md border text-xs font-medium tabular-nums transition-colors disabled:opacity-50",
            current === n
              ? "border-transparent bg-foreground text-background"
              : "border-border hover:bg-state-hover",
          )}
          onClick={() => onPick(n)}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        className="col-span-5 h-7 rounded-md text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50"
        onClick={() => onPick(null)}
      >
        Clear
      </button>
    </div>
  );
}

/** GitHub's label swatches. */
export function ColorGrid({
  current,
  onPick,
}: {
  current: string | null;
  onPick: (color: string) => void;
}) {
  const active = current?.toLowerCase().replace(/^#/, "") ?? "";
  return (
    <div role="listbox" aria-label="Choose label color" className="grid grid-cols-8 gap-1.5">
      {LABEL_SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          role="option"
          aria-selected={active === color}
          aria-label={`Use color #${color}`}
          className={cn(
            "size-5 rounded-md border border-foreground/20 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active === color && "ring-2 ring-ring",
          )}
          style={swatchStyle(color)}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}

/** A toggleable label chip, tinted with the label color when on. */
export function LabelChip({
  name,
  color,
  on,
  disabled,
  onToggle,
}: {
  name: string;
  color: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors disabled:opacity-50",
        on ? "bg-card text-foreground" : "border-border text-muted-foreground hover:bg-state-hover",
      )}
      style={on ? tintStyle(color, { fill: 0.2, border: 1 }) : undefined}
      onClick={onToggle}
    >
      {on ? <Icon name="Check" className="size-3" /> : null}
      {name}
    </button>
  );
}

/** The small uppercase heading over each dialog section. */
export function SectionLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  const className = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  return htmlFor ? (
    <label className={className} htmlFor={htmlFor}>
      {children}
    </label>
  ) : (
    <span className={className}>{children}</span>
  );
}
