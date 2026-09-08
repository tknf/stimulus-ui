# Do Not Create a Select-Only Combobox

We will not create a selection-only combobox that lacks text input (select-only combobox) as a component. We maintain the current state where the combobox contract excludes select-only configurations.

## Reasons

1. **Native `<select>` already possesses all selection-only behaviors.** Opening and closing, selection with arrow keys, typeahead, cancellation with Escape, form participation, and `change` events are implemented by the browser. Following our convention of creating a controller only when adding behaviors not present in native elements, there is no benefit to doing so here.
2. **Customizable select is a visual extension and does not produce differences in behavior.** `appearance: base-select` and `::picker(select)` are mechanisms to replace the rendering of a native `<select>` with the user's CSS and markup, while opening/closing, key operations, and form participation remain native. In the tested versions, Chromium 151 and WebKit 26.5 support it, while Firefox 153 does not. In unsupported engines, the declaration is ignored and it functions as a normal native `<select>`, so users can utilize it as a progressive enhancement. Regardless of how browser support evolves, there is no role for a controller.
3. **The combobox contract explicitly excludes select-only configurations, and there is no reason to change this boundary.**

## Decisions to Apply Going Forward

- We direct users who need a selection-only UI to the native `<select>`. Visual customization falls under the domain of customizable select (CSS that is active only in supported engines), and this library does not get involved.
- When filtering via text input is required, use the published combobox.

## Conditions for Reconsideration

When a TK&F product requires behavior that exists in neither native `<select>` nor combobox (such as outputting states during asynchronous option loading).

## Actual Measurement Records

Tested with Playwright headless (Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5).

| Item                               | Chromium | Firefox | WebKit |
| ---------------------------------- | -------- | ------- | ------ |
| `appearance: base-select` supports | ✓        | ✗       | ✓      |
| `::picker(select)` supports        | ✓        | ✗       | ✓      |

- Evaluation is based on `CSS.supports("appearance", "base-select")` and `CSS.supports("selector(::picker(select))")`.
- **Whether the open/close and key operations when applying customizable select are identical to native `<select>` has not been individually verified even in the 2 supported engines.** As long as the origin of the behavior is native `<select>`, this ruling does not depend on that verification.

## Primary Sources

- Select element in HTML Standard: https://html.spec.whatwg.org/multipage/form-elements.html#the-select-element
- Customizable select (MDN): https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Customizable_select
