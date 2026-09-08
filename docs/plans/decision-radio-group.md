# Record of the Decision Not to Distribute radio-group

Although the `radio-group` controller was implemented once, it was removed after actual measurements confirmed that its addition to the native `<input type="radio">` amounted only to complementing `role="radiogroup"` (static ARIA). This decision aligns with the principles in `AGENTS.md`: "Do not create components that consist solely of behaviors already provided by native elements" and "The criteria for whether to create it in the first place."

## Observed native behavior (Playwright 1.62.1: Chromium 151 / Firefox 153 / WebKit 26.5)

Items that the contract specified as controller-specific functionality were compared one by one against native behavior.

### Keyboard behavior is entirely native, and the controller originally added nothing

| Item                                                    | Chromium       | Firefox        | WebKit               |
| ------------------------------------------------------- | -------------- | -------------- | -------------------- |
| Focus and selection move simultaneously with arrow keys | Works          | Works          | Works                |
| Skips disabled radios                                   | Skips          | Skips          | Skips                |
| Tab becomes 1 stop for the group                        | Becomes 1 stop | Becomes 1 stop | Becomes 1 stop       |
| Wraps around at edges                                   | Wraps          | Wraps          | **Does not wrap**    |
| Left/Right reverses with `dir="rtl"`                    | Reverses       | Reverses       | **Does not reverse** |

The controller was designed not to compensate for the two WebKit differences (compensating for them would result in double movement alongside native focus navigation; recorded in `docs/notes/browser-engine-differences.md`). For keyboard operation, the controller did not modify native behavior.

### A cancelable pre-change event is adequately served by native `click`

Across all 3 engines, a cancelable trusted `click` fires before `change` not only for pointer interaction but also for **keyboard activation (selection via Space or arrow keys)**, and calling `preventDefault()` restores `checked` to the original radio. The execution order is also consistent across all 3 engines: `click` → `change`. The engine that contract assumed would "notify after native change" did not exist.

Therefore, `radio-group:beforechange` was nothing more than a re-wrapping of the native `click`.

### Group-level JS API exists in native

For the `RadioNodeList` returned by `form.elements.namedItem(name)`, `.value` works identically across all 3 engines for reading, writing (checking the corresponding radio), and handling unknown values as no-ops.

### `data-state` can be substituted with CSS

`data-state="checked"` ≒ `input:checked`, `data-state="unchecked"` ≒ `input:not(:checked)`. The controller was redundantly outputting state that could be derived from native pseudo-classes.

## Remaining Functionality in the Controller and Decision

All that remained was complementing `role="radiogroup"`, which is static ARIA and not a behavior. Rather than loading JavaScript to add it at runtime, users can simply write it directly in HTML.

## Correct Markup Guidance Is Not Written Here

Per the conventions of this repository, markup methods for undistributed components are not duplicated here. Refer to primary sources.

- role: https://www.w3.org/TR/wai-aria-1.2/#radiogroup
- APG pattern: https://www.w3.org/WAI/ARIA/apg/patterns/radio/
- Reading and writing group-level values: https://developer.mozilla.org/en-US/docs/Web/API/RadioNodeList/value

## Conditions for Re-proposing

When a new engine difference arises in native radio keyboard behavior that this repository should compensate for, or when behavior not present in native becomes necessary (such as the native cancelable pre-change event disappearing). It will not be created simply because it is convenient to have as a component.
