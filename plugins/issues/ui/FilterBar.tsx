// The row of board filters under the toolbar: linked thread, dependencies, and value.
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { DependencyMode, ThreadAssociationMode, ValueOption } from "./useBoardView";

interface SegmentOption<M extends string> {
  mode: M;
  text: string;
  label: string;
}

const THREAD_OPTIONS: SegmentOption<ThreadAssociationMode>[] = [
  { mode: "all", text: "All", label: "All issues" },
  { mode: "without", text: "No thread", label: "Issues without a linked thread" },
  { mode: "with", text: "Has thread", label: "Issues with a linked thread" },
];

const DEPENDENCY_OPTIONS: SegmentOption<DependencyMode>[] = [
  { mode: "all", text: "All", label: "Show all issues" },
  { mode: "blocked", text: "Blocked", label: "Show blocked issues" },
  { mode: "blocking", text: "Blocking", label: "Show blocking issues" },
  { mode: "unblocked", text: "Unblocked", label: "Show issues that are not blocked" },
];

const VALUE_OPTIONS: ValueOption[] = ["none", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function Segmented<M extends string>({
  label,
  options,
  mode,
  onChange,
}: {
  label: string;
  options: SegmentOption<M>[];
  mode: M;
  onChange: (mode: M) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-md border border-border bg-muted/50 p-0.5">
      {options.map((option) => {
        const checked = option.mode === mode;
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            title={option.label}
            className={cn(
              "h-6 rounded-[5px] px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              checked ? "bg-background font-medium text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(option.mode)}
          >
            {option.text}
          </button>
        );
      })}
    </div>
  );
}

function ValueChips({
  selected,
  onToggle,
  onClear,
}: {
  selected: ReadonlySet<ValueOption>;
  onToggle: (value: ValueOption) => void;
  onClear: () => void;
}) {
  return (
    <div role="group" aria-label="Filter by value" className="flex flex-wrap items-center gap-1">
      {VALUE_OPTIONS.map((value) => {
        const on = selected.has(value);
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            aria-label={value === "none" ? "Filter by no value" : `Filter by value ${value}`}
            className={cn(
              "h-6 min-w-6 rounded-md border px-1.5 text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              on
                ? "border-transparent bg-foreground font-medium text-background"
                : "border-border text-muted-foreground hover:bg-state-hover hover:text-foreground",
            )}
            onClick={() => onToggle(value)}
          >
            {value === "none" ? "No value" : value}
          </button>
        );
      })}
      {selected.size > 0 ? (
        <button
          type="button"
          aria-label="Clear value filter"
          title="Clear value filter"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={onClear}
        >
          <Icon name="X" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function FilterLabel({ children }: { children: string }) {
  return <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</span>;
}

export function FilterBar({
  threadMode,
  onThreadMode,
  dependencyMode,
  onDependencyMode,
  values,
  onToggleValue,
  onClearValues,
}: {
  threadMode: ThreadAssociationMode;
  onThreadMode: (mode: ThreadAssociationMode) => void;
  dependencyMode: DependencyMode;
  onDependencyMode: (mode: DependencyMode) => void;
  values: ReadonlySet<ValueOption>;
  onToggleValue: (value: ValueOption) => void;
  onClearValues: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
      <div className="flex items-center gap-2">
        <FilterLabel>Thread</FilterLabel>
        <Segmented label="Filter issues by linked thread" options={THREAD_OPTIONS} mode={threadMode} onChange={onThreadMode} />
      </div>
      <div className="flex items-center gap-2">
        <FilterLabel>Dependencies</FilterLabel>
        <Segmented
          label="Filter issues by dependency"
          options={DEPENDENCY_OPTIONS}
          mode={dependencyMode}
          onChange={onDependencyMode}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FilterLabel>Value</FilterLabel>
        <ValueChips selected={values} onToggle={onToggleValue} onClear={onClearValues} />
      </div>
    </div>
  );
}
