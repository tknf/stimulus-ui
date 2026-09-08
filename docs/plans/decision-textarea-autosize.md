# Do not create auto-resizing for textarea

We will not create a component that adjusts the height of a `<textarea>` to fit its content based on input volume. CSS `field-sizing: content` provides this behavior on the Chromium, Firefox, and WebKit versions listed below. Since it works with native CSS alone, we will not add a controller.

## Reasons

1. **CSS already has it.** With `field-sizing: content`, `<textarea>` (as well as text-type `<input>` and `<select>`) follows the content, eliminating the need for JS. Range limitations can also be written using `min-height` / `max-height`.
2. **Even if created, the controller cannot set height.** Due to conventions, layout properties cannot be written to `element.style`, so it would only output values like scrollHeight via custom properties. Users would have to write CSS to read those values anyway, which takes the same effort as writing one line of `field-sizing: content`.
3. **In older, unsupported engines, the textarea simply remains at a fixed height.** This is graceful degradation, and the markup works even without the enhancement. Polyfills for unsupported engines are outside the scope of this library.

## Guidance

- Direct users who need content-following input fields to CSS `field-sizing: content`. The height range can be constrained using `min-height` / `max-height`.

## Conditions for reconsideration

There are currently no conditions for reconsideration. If a requirement arises to output values that CSS cannot read, such as scrollHeight, for another purpose (other than adjusting height to fit content), we will address it in a new issue without changing this decision.

## Observed native behavior

Using Playwright's bundled headless engines (Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5). Inputting 8 lines into a `<textarea>` with `field-sizing: content; width: 20ch` resulted in offsetHeight following from 30 to 198 in Chromium, 32 to 200 in Firefox, and 34 to 202 in WebKit. `CSS.supports("field-sizing", "content")` returned true for all 3 engines.

## Primary information

- CSS Form Control Styling Level 1 (definition of field-sizing): https://drafts.csswg.org/css-forms-1/#propdef-field-sizing
- MDN field-sizing (Baseline 2026 Newly available. Target applications are textarea / text-type input / select): https://developer.mozilla.org/en-US/docs/Web/CSS/field-sizing
