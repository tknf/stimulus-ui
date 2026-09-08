# Do Not Extract Roving Tabindex as an Internal Utility

Keep the roving tabindex implementations in grid, treegrid, calendar, and toolbar separate. Their target sets, removal fallbacks, and empty-state cleanup differ, so the small shared statements do not represent a shared invariant.

## Reasons

1. Only a single line is identical. The only exact string-level matches are the tabindex synchronization loop (the for loop for `setAttribute("tabindex", x === current ? "0" : "-1")` across 4 components) and the single line that restores an existing tabindex=0 as the current item (3 components). This falls under the AGENTS.md rule: Do not extract logic for mere line-level similarities.
2. Component-specific logic cannot be shared. There are 3 different fallback rules when an item is removed (first item / collapsed ancestor cell / selected date), 4 different definitions for the target set (all cells / visible cells / enabled day / all controls), and 2 different cleanup behaviors when the set is empty (grid retains tabindex, while treegrid and calendar set all to -1). Even if made into a utility, each rule would need to be passed separately as a callback, leaving only a few lines in common.
3. tabs cannot act as a caller. tabs derives roving navigation from the selected value rather than holding a field for the current item, making it incompatible with a utility pattern that injects current.
4. RTL delta will not be consolidated. The ternary operator `getComputedStyle(...).direction === "rtl" ? 1 : -1` is duplicated across grid, treegrid, and calendar. However, sharing it via the existing `horizontalArrowDelta` (designed for wrap-based callers) would require updating grid's negative control find logic, resulting in a reduction of only one line.

## Guidance

- Differences in roving implementations across components have been documented in `docs/notes/intentional-differences.md` as intentional. Read that document before attempting to unify them.
- Do not change the contract for placing mutations in existing utilities (`roving_navigation.ts` for tabs, `listbox_navigation.ts` for listbox).

## Conditions for Reconsideration

When a new roving implementation emerges that shares both the fallback rules and target set definitions, creating a concrete case that should be updated simultaneously upon changes. At that point, follow the steps in AGENTS.md under Extracting Internal Utilities (list all usage locations and differences -> batch migration by a single owner).
