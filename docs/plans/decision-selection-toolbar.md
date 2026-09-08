# Do not create selection-toolbar

Do not create a controller for an action bar that appears only during text selection. Native selection APIs provide the required observations; the remaining behavior belongs to application actions and must remain reachable without selecting text.

## Reasons

1. **There are no engine differences for a controller to correct.** In all 3 engines, `selectionchange` fires continuously during drag (throttling is a common issue for all engines) and fires once upon collapse. `Range.getBoundingClientRect()` is defined by CSSOM View §9 (https://drafts.csswg.org/cssom-view/#extensions-to-the-range-interface) and returns the same rectangle across all 3 engines. No engine branching is required for users to subscribe to `selectionchange` and write containment and throttling.
2. **Chromium / WebKit do not allow selecting non-editable text using only the keyboard.** Keyboard selection of non-editable text (Shift+Arrow) works by default only in Firefox, and does not work in Chromium / WebKit unless caret browsing is enabled. This component cannot satisfy 2.1.3 Keyboard (No Exception), which is a mandatory requirement for all contracts, and making just one an exception is not allowed.
3. **Configurations operable by keyboard can be implemented with existing components.** If configured to display a `toolbar` controller at all times and toggle `disabled` based on whether text is selected, users who cannot select text can also move focus to each action and execute it.

## Guidance

- **Do not add selection monitoring to clipboard.** Clipboard is solely responsible for writing to the clipboard. Do not attach selection monitoring for users who only copy input values.
- Only Firefox actually supports multiple Ranges (`rangeCount > 1`). Pay attention to this difference when writing code that handles selection.

## Primary Information

- selectionchange: https://developer.mozilla.org/en-US/docs/Web/API/Document/selectionchange_event
- Selection API (single Range requirement and Gecko's multiple Ranges): https://developer.mozilla.org/en-US/docs/Web/API/Selection
- Range.getBoundingClientRect: https://developer.mozilla.org/en-US/docs/Web/API/Range/getBoundingClientRect
