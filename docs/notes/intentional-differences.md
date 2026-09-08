# Intentional differences between components

This records things that may appear inconsistent in a cross-cutting audit but **must not be made uniform**. Do not report the items listed here as inconsistencies. Read this document before trying to make them uniform.

It records decision principles, **not a list of component names**. Judge new components by these principles; adding every component as it is created would lead to omissions.

## Whether a controller has a method

### Some components do not have `applyStructure`

`applyStructure` writes static structure that the controller completes (`role`, relationship ARIA attributes, and generated IDs). **Components with no structure to complete do not have it.**

This applies to components that only add behavior to a native element: `disclosure`, which uses `<details>`, and `password-field` and `slider`, whose root is a native `<input>`. `clipboard` has no structure at all.

### Some components do not have `scheduleReconcile`

`scheduleReconcile` tracks dynamic target changes. **Components whose root is itself the controlled element and whose targets do not change do not have it.**

`password-field` has an `<input>` as its root, and `slider` delegates to native semantics. `splitter` and `clipboard` have a fixed target structure.

## State output

### `toolbar` does not emit `data-state`

Its contract explicitly states that it has no state. It only manages roving tabindex and has no discrete state for CSS to read.

**Unlike other components, an empty `stateOutputs` is intentional and is not an omission.**

### Roving tabindex is implemented independently for each component

Roving in toolbar, tabs, grid, treegrid, and calendar is not extracted into a utility (as decided in `docs/plans/decision-roving-utility.md`). The `for` loops that synchronize tabindex have the same shape, but **the fallback when an item disappears (first item / collapsed ancestor cell / selected day), the definition of the target set (all cells / visible cells / enabled days / all controls), and cleanup for an empty set (grid retains tabindex, while treegrid and calendar set all values to -1) differ by component**. Making them uniform would change behavior.

**The repeated `for` loops are the result of these decisions, not duplication.** A new component with roving also owns its own fallback rules.

### Whether arrow navigation wraps differs by component

toolbar wraps at both ends, while tag-input stops at the ends. toolbar's focus targets consist only of controls, so wrapping is unambiguous. tag-input's focus targets include the chip list and a text input; moving from one end to the other would make input caret operations indistinguishable from arrow navigation, so it does not wrap. Apply the same principle to new components with roving.

### Key increments for native controls and direct manipulation

The range controls in image-cropper retain native keyboard behavior and increments, while selection and resize on the image use direct manipulation through `step` and `zoomStep`. The ranges use `step=any` so native controls do not round fractional rectangles produced by pointer input. Even when two paths change the same value, do not make native range key increments match the controller's step. Follow the relevant section of `browser-engine-differences.md` for RTL differences in native ranges.

## Focus and announcements during reordering

For a native list without selection state, reordering does not use listbox roving tabindex or `aria-activedescendant`. list-reorder focuses a candidate `li` only during the operation and delegates ordinary Tab navigation to each native button. It uses the list's own live region and the user's operation instructions, and does not generate announcement text or elements. Always provide previous/next buttons as equivalent operations that do not require dragging.

## IME guard

### combobox has a `composing` flag; typeahead does not

The detection of IME-originated keydown events is shared through `isImeKeydown` (`isComposing || keyCode 229`) in `src/internal/ime.ts`. In addition, combobox has a `composing` flag that subscribes to compositionstart / compositionend. On specification-compliant engines, this flag does not change the result of `isImeKeydown`. The combobox contract and tests nevertheless verify this flag, so it remains; removing it would require changes to the contract, implementation, and tests without changing behavior.

**Do not add a flag to typeahead (listbox / tree) just to make the implementation look uniform.** Typeahead needs only `isComposing` and `keyCode 229`.

## isTrusted guard

### toolbar and grid keydown handlers do not have an isTrusted guard

An isTrusted guard implements the rule that custom events are emitted and state is committed only when user interaction is the source (the "Reject synthetic events with `isTrusted`" rule in `AGENTS.md`). Put it at the start of a handler that emits a custom event or commits state. toolbar and grid emit no custom events and have no state (as their `events.none` / `stateOutputs` contracts specify), and their keydown only moves DOM focus, so they have no guard.

Adding a guard would protect no condition. A synthetic keydown only moves focus, and user JavaScript can do the same directly with `control.focus()`. Without a guard, a component that emits custom events could have its invariants broken by a synthetic event, but toolbar and grid have no such invariant. Focus movement caused by a synthetic keydown is a call from the user's JavaScript, so it also complies with 3.2.5 Change on Request (focus moves only in response to user interaction or a call from the user's JavaScript).

**Whether a guard exists is determined by whether the handler emits a custom event or commits state; its absence is not an omission.** Apply the same principle to new components with keydown handlers.

## Repetition among components that extend native inputs

### `number-field`, `date-field`, and `time-field` share processing but are not unified

All three use one native input as the root and have the same forms of pending interaction capture, cancelable `before<verb>` dispatch and restoration on cancel, an `isTrusted` guard, form reset subscription, `data-state` min / max / between output, and disconnect cleanup. **This may look like duplication in a cross-cutting audit, but it is not unified.**

The differences are substantial. `number-field` supports PageUp / PageDown and `pageStep`, while the other two have no keyboard behavior at all. `date-field` compares `value` as a string, whereas `time-field` compares `valueAsNumber` (a time value can be `HH:MM`, `HH:MM:SS`, or `HH:MM:SS.sss` and therefore has varying lengths, so string comparison would be wrong). The `type` checks and event names also differ by component.

Unifying them would require a base class or factory, with markup validation for the three components determined by type branches in shared code. Then the markup accepted by each controller could not be understood from each implementation alone.

**Reconsider when:** a fourth component extending a native input is added and its only differences are the type check and event name. Decide whether to unify them in a separate issue at that point. As long as these differences remain, the similar code is the result of a decision, not duplication.

### `table-select` and `checkbox-group` have the same master three-state synchronization but are not unified

Their `syncMaster` methods have the same shape (master `checked` means all enabled items are selected, `indeterminate` means a partial selection, and the denominator is the set of enabled items), but are not extracted into an internal utility.

Each contract defines the three-state rules independently, and either contract may change on its own. While the contracts remain independent, the shared shape is not a shared invariant and does not meet the extraction criterion of "should be fixed together when changed." Event semantics, markup validation, and click handling differ by component (`table-select` also has range selection and `tr` validation).

**Reconsider when:** a third component with three-state synchronization appears and the three-state rules are judged to be shared across contracts and should be fixed together. Decide whether to unify them in a separate issue at that point.

## Type patterns

### `disabled` detection differs by target element

The detection method is determined by the element and cannot be made uniform.

| Target                                           | Detection                                      |
| ------------------------------------------------ | ---------------------------------------------- |
| Native controls such as `<button>` and `<input>` | `element.disabled`                             |
| Elements without `disabled`, such as `<li>`      | `aria-disabled`                                |
| Any element when only attribute presence matters | `hasAttribute("disabled")`                     |
| An element of unknown type                       | Use `Reflect.get`, then `typeof === "boolean"` |

An element without `disabled` cannot use `element.disabled`, while using `aria-disabled` on a native control duplicates native behavior.

### `event as ToggleEvent` is unavoidable

The handler argument type for `addEventListener("toggle")` is fixed as `Event`. Reading `ToggleEvent`'s `newState` / `oldState` requires a cast. This occurs in `tooltip` and `toast`.

**This cast is required by the DOM type definitions.**

### Distinguish `?: T` from `T | null = null`

`Array.prototype.find` returns `T | undefined`, so use `?: T`. A helper written to "return only when there is one" returns `T | null`. They have different origins and should not be made uniform.

### Controllers that reject invalid JSON values do not define a Changed callback

Stimulus 3.2.2 parses JSON before calling a Changed callback for an Array / Object value and throws for invalid JSON or a type mismatch. The contracts for toggle-group's `selected`, timer's `milestones`, and color-picker's `value` reject invalid values with a warning, so they handle the exception when the getter is read and use MutationObserver only to observe attribute changes. They use Stimulus values to parse and write values.

### color-picker ranges use `step=any`

The four ranges use `step=any` so native range `step` does not round fractional HSVA values. The controller handles the direct-manipulation area's `step` and the wheel's `hueStep`, while native controls handle range keyboard increments. Do not reimplement native keyboard behavior just to make the two increments match.

### toggle-group `disabled` includes an ancestor fieldset

The toggle-group contract includes being disabled by an ancestor fieldset, so item detection uses `matches(":disabled")`. The button's own `disabled` property cannot detect this inherited state. The controller also observes attribute changes on ancestor fieldsets and corrects the Tab stop.
