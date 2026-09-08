# Record of the Decision Not to Distribute `switch`

Although the `switch` controller was once implemented, it was deleted because actual measurements confirmed that what it added to the native `<input type="checkbox">` was merely supplementing `role="switch"` (static ARIA). This aligns with the criteria in `AGENTS.md`: "Do not create components that consist solely of behaviors already provided by native elements" and "Whether to create it in the first place."

## Observed native behavior (Playwright 1.62.1: Chromium 151 / Firefox 153 / WebKit 26.5)

- **The cancelable pre-change event is adequately handled by the native `click`.** In all 3 engines, a cancelable trusted `click` fires before `change` upon keyboard activation with Space, and calling `preventDefault()` reverts `checked`. `switch:beforechange` was nothing more than a rewrap of the native `click`.
- **`data-state="on" | "off"` can be replaced by `input:checked` / `input:not(:checked)`.**
- **The equivalent of `toggle()` exists natively.** Assigning to `input.checked` and calling `input.click()` is sufficient.
- The keyboard support relied solely on the native activation of Space, and the controller originally added nothing (it was designed not to add custom activation for Enter).

All that remains is supplementing `role="switch"`, which is static ARIA and not a behavior.

## Unconfirmed Items

How the `checked` state of a native checkbox with `role="switch"` is exposed to the accessibility tree (whether explicit `aria-checked` is required) has not been verified on actual screen readers. Since the component was deleted without making this verification, users writing switch markup must verify it themselves using primary sources and actual devices. This repository does not define specifications for it.

- https://www.w3.org/TR/html-aria/#allowed-descendants-of-aria-roles (role specification for `input[type=checkbox]` in ARIA in HTML)
- https://w3c.github.io/html-aam/ (how native checked states are exposed)
- https://www.w3.org/WAI/ARIA/apg/patterns/switch/ (APG Switch Pattern, including examples using native checkboxes)

## Correct Markup Instructions Are Not Written Here

Per the conventions of this repository, instructions for components that are not distributed will not be duplicated here. Please refer to the primary sources above.

## Conditions for Resubmission

When engine differences that this repository ought to correct arise in native checkboxes, or when behaviors not present in native elements become necessary. Even if requirements to handle mixed / indeterminate states emerge, decisions will be made only after measuring actual native `indeterminate` and real AT behavior.
