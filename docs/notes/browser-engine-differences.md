# Browser engine differences and workarounds

Automated tests run on the three engines Chromium, Firefox, and WebKit. Workarounds for engine-specific behavior belong here. **Read this document before removing a workaround.**

## Reverse Tab navigation from a non-modal dialog

With the native `dialog.show()` and the first button inside it in `test/dialog_panel.test.ts`, Firefox and WebKit include the dialog itself as a stopping point for Shift+Tab. Chromium moves to the outer button. Both allow navigation to the background, so the controller does not adjust Tab navigation. The test sends another Shift+Tab only when focus stops on the dialog itself, then verifies that the background can be reached.

The pointer-test helper `dialogPointer` specifies a position as a ratio of the Playwright bounding box, including the Browser Mode iframe's display scale. Because pointer coordinates are rounded, movement is checked with a tolerance rather than exact fractional equality, while preview and committed values are checked for exact equality.

## Native `ol` markers with moveBefore and focus after DOM movement

In Chrome 152.0.7977.76, moving the first item of the catalog `ol` to the second position with moveBefore leaves the DOM order and `aria-posinset` correct but makes the native markers "2・3・4". list-reorder moves the existing node with insertBefore and lets the native marker numbers be recalculated. It does not add user-agent branches or CSS counter corrections.

`test/list_reorder.test.ts` verifies the actual insertBefore call and preservation of input values and focus on all three engines, and detects replacement with moveBefore through a negative control. The displayed numbers are also checked on the catalog page. If movement loses focus, focus is restored to the same element, while an API change or focus on another element performed by a focus listener takes precedence.

Because [insertBefore operates as remove and insert](https://developer.chrome.com/blog/movebefore-api), it can reconnect descendant custom elements and Stimulus controllers and can lose native internal state such as that of an iframe or media element. Compatibility and assistive-technology announcements are unverified; do not infer that internal state is preserved from the preservation of the node and input values.

## Trusted reset buttons and microtask ordering

Do not determine completion of asynchronous work solely from the arrival of a rendering frame. The image-cropper reset test waits for a return to the initial snapshot even when the timer task is delayed by 50ms. Waiting only for `requestAnimationFrame` reads values before completion on all three engines, so the result is checked with `expect.poll`. The [HTML event loop](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model) distinguishes timer tasks from rendering.

The native-operation timer test has a duration of one second and uses a three-second wait timeout. Vitest 4.1.11's default `expect.poll` timeout is one second, so a timeout equal to the duration can expire before the final update. [HTML timers](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers) do not guarantee execution at exactly the specified time. Extending the wait timeout does not change the expectations for the transition to finished, value 0, or focus preservation.

During the trusted reset button operation in `test/period_fields_composition.test.ts`, the microtask scheduled by the reset listener runs before the native input value is restored. On Chromium, Firefox, and WebKit, period revalidation in the microtask reads the pre-restoration value and leaves custom validity in place.

`test/form_reset.test.ts` also verifies on all three engines that the state of four native fields, character counts, checkbox masters, and image-cropper controls synchronize to the pre-restoration values, and that editable and password-field change their display state even when a later listener cancels the reset. Calling `form.reset()` only from the test's JavaScript stack does not reproduce this ordering.

`src/internal/form_reset_tasks.ts` schedules synchronization for ten controller types in the next task and clears all scheduled work when the subscription is removed. Each caller checks values, cancellation, form ownership, and revisions. The shared utility's mutation is defined in the date-field contract.

It is used by date-field / time-field / number-field (native value boundary state), slider (state and continuous values for one or more inputs), character-count (character count), checkbox-group / table-select (synchronizing a master from items in multiple forms), editable (checking capture and revision before committing to viewing), password-field (checking form ownership and connection generation before hiding), and image-cropper (checking settings, markup, and revision before applying the initial snapshot). Multiple reset schedules are kept separately so cancellation of a later reset cannot lose synchronization for an earlier reset.

`test/compositions/period_validation_controller.ts` schedules revalidation in the next task with `setTimeout(..., 0)` and reads values after the default action. It checks reset cancellation and clears the timer on disconnect. The date and time reset negative controls detect replacement with a microtask.

## WebKit on macOS uses Option+Tab to move to native links

In the native `<details>` / `<summary>` and link composition in `test/navigation_menu_composition.test.ts`, Chromium / Firefox move to a link in the opened panel with Tab. Playwright WebKit on macOS moves to the next summary with Tab and to the panel link with Option+Tab.

[Apple's [Safari keyboard shortcuts](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac) also specifies Option+Tab for navigation that includes links. Safari settings can swap the behavior of Tab and Option+Tab, so this does not mean that all Safari users must use the same key.

When testing sequential navigation to native links, send Option+Tab to WebKit and Tab to Chromium / Firefox. Do not add custom Tab handling to the controller or treat direct focus on a link as verification of keyboard navigation.

## WebKit native drag is not a test input for pointercancel

In Playwright headless, when `draggable=true` is added to the image-cropper selection button for testing and mouse down, two moves, and mouse up are sent, Chromium and Firefox dispatch trusted `pointercancel`, but WebKit does not. This difference was confirmed by the additional native-drag test in `test/image_cropper.test.ts`.

Additional tests using this input are limited to Chromium and Firefox. Do not treat them as testing trusted `pointercancel` dispatch in WebKit. Interruption by Escape and actual capture release, and rejection of synthetic pointercancel, are tested on all three engines. The ordinary catalog does not add `draggable=true` to the selection button.

## Firefox performs a form default action for untrusted submit / reset events

### Behavior

The result of loading the same form in all three engines through Playwright and calling `dispatchEvent` from a script.

| engine   | After `dispatchEvent(new Event("submit"))`                                               | After `dispatchEvent(new Event("reset"))`                |
| -------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| firefox  | The URL changes and `framenavigated` fires. Form submission runs and the page navigates. | The value returns to its initial value. Form reset runs. |
| chromium | No change                                                                                | No change                                                |
| webkit   | No change                                                                                | No change                                                |

In the HTML Standard, dispatching a submit event is one step of the form submission algorithm, and the event itself has no default action. Because an untrusted event does not trigger a user agent default action, the standard behavior is that `dispatchEvent(new Event("submit"))` does not submit the form. Click is the only exception, and that behavior is shared by all engines. Firefox does not follow this for submit and reset.

- [Bugzilla 1535988 Synthetic submit event should not trigger form submitting](https://bugzilla.mozilla.org/show_bug.cgi?id=1535988)
- [Bugzilla 1477286 Fired submit event should not perform form submission](https://bugzilla.mozilla.org/show_bug.cgi?id=1477286)
- [Bugzilla 1370630 preventDefault() on form.dispatchEvent(new Event('submit'))?](https://bugzilla.mozilla.org/show_bug.cgi?id=1370630)

### Impact

In a test that dispatches an event to a form, only Firefox navigates the entire test page. Navigation destroys Vitest's execution environment, so the test does not finish.

**`testTimeout` cannot detect this hang.** Vitest's timer also stops, so the test neither fails nor responds. It passes when run alone and hangs only when run with other tests, but the cause is navigation rather than the test itself.

### Workaround

Attach a listener that prevents the submit default action to the form returned by `mount()` in `test/password_field.test.ts`.

Make a submit event dispatched to the form cancelable. A non-cancelable event ignores `preventDefault()`, so it cannot stop the default action. Submit events fired by a real browser are also cancelable, making this closer to actual behavior.

**Apply the same workaround when adding a test that handles a form.**

## WebKit does not move focus when a button is clicked

### Behavior

Safari-family engines on macOS do not change `document.activeElement` when a `<button>` is clicked. The click activation behavior (dispatching the `click` event and submitting for `type="submit"`, for example) runs as in the other engines, but focus does not move. Chromium and Firefox move focus to the clicked button.

### Impact

An assertion that `document.activeElement` equals a particular element after a click fails only in WebKit when that equality depends on the browser's default focus behavior.

### Workaround

When testing whether the controller moved focus, check that it does not equal an element that must not receive focus, rather than requiring equality with an expected element. The destination of focus after a button click depends on the engine, so do not make it the subject of an equality assertion.

## WebKit does not wrap at the ends of a radio group with arrow keys

### Behavior

The result of placing three radios with the same `name`, checking and focusing the first, and repeatedly pressing ArrowRight.

| engine   | Transitions after four ArrowRight presses | Number of checked changes |
| -------- | ----------------------------------------- | ------------------------- |
| chromium | 1 → 2 → 3 → 1 → 2                         | 4                         |
| firefox  | 1 → 2 → 3 → 1 → 2                         | 4                         |
| webkit   | 1 → 2 → 3 → 3 → 3                         | 2                         |

Chromium and Firefox wrap from the last item to the first, while WebKit stops at the last item and moves neither the selection nor focus.

No primary specification that explicitly defines arrow-key navigation within a radio group has been found. The radio button state section of WHATWG HTML does not mention arrow keys, and [whatwg/html#5202](https://github.com/whatwg/html/issues/5202) discusses the group definition itself. Engines implement this as de facto conventional behavior.

### Impact

This difference appears directly in UIs that use native radios. A test that assumes movement at the ends fails only in WebKit. The measurements in `docs/plans/decision-radio-group.md` confirm that this difference is not a reason to add a radio controller.

### Workaround

Do not add wrapping in JavaScript. It would duplicate native focus movement.

Do not write assertions that depend on behavior at an end. When testing movement, stay within a range that does not reach an end.

## Arrow direction in native radio groups with dir="rtl" differs between WebKit and the other engines

### Behavior

The result of placing three radios with the same `name` inside an element with `dir="rtl"`, checking and focusing the middle radio, and pressing ArrowRight once (Chromium 151 / Firefox 153 / WebKit 26.5).

| engine   | Checked transition                     |
| -------- | -------------------------------------- |
| chromium | Middle → one **previous** in DOM order |
| firefox  | Middle → one **previous** in DOM order |
| webkit   | Middle → one **next** in DOM order     |

Chromium and Firefox reverse the meaning of the horizontal arrows in RTL, while WebKit does not. This is the same difference as for native ranges.

### Impact

This difference appears directly in UIs that use native radios.

### Workaround

Do not correct the direction in JavaScript. It would double-correct the behavior on some engines. Treat it the same as the native range case.

## ArrowRight direction in native ranges with dir="rtl" differs between WebKit and the other engines

### Behavior

The result of setting up `input[type="range"]` with `dir="rtl"`, `min=0`, `max=100`, `step=10`, and `value=50`, focusing it, and pressing ArrowRight once.

| engine   | Value transition |
| -------- | ---------------- |
| chromium | 50 → 40          |
| firefox  | 50 → 40          |
| webkit   | 50 → 60          |

### Impact

Because the slider controller delegates keyboard handling and direction to the native range, this difference is exposed to users. Correcting it in the controller would double-correct some engines.

### Workaround

Do not reverse direction in the controller. Users who need the meaning of RTL arrow keys to be consistent across engines should check the target engines and adjust their UI or instructions accordingly.

## Non-numeric input in number inputs remains visible as badInput only in Firefox

### Behavior

The result of entering "abc" into `<input type="number">` with a real keyboard on the tested engines.

| engine   | `value` | `validity.badInput` | Display                          |
| -------- | ------- | ------------------- | -------------------------------- |
| chromium | `""`    | false               | Nothing is displayed             |
| firefox  | `""`    | true                | The entered text remains visible |
| webkit   | `""`    | false               | Nothing is displayed             |

### Impact

The DOM `value` and `valueAsNumber` (NaN) are the same on all three engines, so number-field state synchronization can be shared. Only the display and `validity.badInput` differ.

### Workaround

None. Tests do not check the display or `badInput`.

## The mouse wheel changes a number input's value only in Chromium

### Behavior

The result of sending a downward `wheel` event to a focused and hovered `<input type="number" value="50">` on the tested engines.

| engine   | Result    |
| -------- | --------- |
| chromium | 50 → 49   |
| firefox  | No change |
| webkit   | No change |

### Impact

Chromium fires trusted input / change events from the wheel. The number-field controller treats the change as one without a pending pointerdown / keydown capture and only synchronizes state output without emitting a custom event.

### Workaround

Do not use the wheel in tests. Do not specify wheel behavior in a contract.

## Home / End move the caret in a number input on macOS only in Chromium

### Behavior

The result of pressing Home in `<input type="number" value="1234">` and immediately typing "9" on macOS.

| engine   | After Home                                     | After End |
| -------- | ---------------------------------------------- | --------- |
| chromium | 91234 (inserted at the start; the caret moves) | 12349     |
| firefox  | 12349 (does not move)                          | 12349     |
| webkit   | 12349 (does not move)                          | 12349     |

On Windows, moving the caret with Home / End in text fields is conventional (unverified).

### Impact

The number-field controller does not implement Home / End. If the controller intercepted them, caret movement while editing would break in Chromium (and conventionally across Windows). The APG Spinbutton Pattern requires Home / End for a custom widget, which has different assumptions from an editable native input.

### Workaround

Do not include Home / End in the contract. Users can move to a value boundary by entering the `min` or `max` directly.

## Date input segment editing has different interaction models by engine

### Behavior

The result of focusing and operating `<input type="date" value="2026-08-17">` (`lang="en"`) (Playwright: Chromium 151 / Firefox 153 / WebKit 26.5).

| Item                                                                                | chromium                                        | firefox                                                        | webkit                                    |
| ----------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| Active segment immediately after focus                                              | Month                                           | Month                                                          | **Year**                                  |
| Segment order with ArrowRight                                                       | Month → Day → Year                              | Month → Day → Year                                             | **Year → Month → Day**                    |
| Events when changing a segment                                                      | input and change immediately                    | input and change immediately                                   | **input only; change delayed until blur** |
| ArrowUp when only `max` exists and the value month = max month                      | Next month (**exceeds max**)                    | Next month (**exceeds max**)                                   | Next year (**exceeds max**)               |
| ArrowUp when `min` and `max` are fixed to the same month and value is in that month | **No change (neither value nor event changes)** | Next month (**leaves the range**)                              | Next year (**leaves the range**)          |
| PageUp / PageDown                                                                   | No effect                                       | **Segment-based (three months for month, seven days for day)** | No effect                                 |

The three engines agree on segment editing itself (arrow navigation and increments, direct digit entry, and clearing with Backspace), Tab moving between segments, `stepUp(n)` / `stepDown(n)` moving by days, invalid `value` assignments becoming an empty string, and `valueAsDate` / `valueAsNumber`.

### Impact

If the date-field controller implemented PageUp / PageDown as day-based movement of the entire value, it would duplicate and conflict with Firefox's native segment-based behavior. The controller cannot determine which segment has focus (the selection API also does not work inside the shadow DOM), so segment-level behavior cannot be unified.

In WebKit, the change event is delayed, so a change event alone cannot detect a value change immediately after segment operation.

**A test that changes the value with arrow keys produces different results by engine depending on the `min` / `max` values.** When `min` and `max` are fixed to the same month, only Chromium leaves the segment, value, and event unchanged. Firefox and WebKit move even outside the range.

### Workaround

The controller does not implement PageUp / PageDown. It does not correct engine differences in segment editing (doing so would duplicate native editing, as with radio-group wrapping). Detect value changes with input events as well, and do not make tests depend on WebKit's delayed change event.

**Before operating a test that assumes arrows change the value, use a wide enough `min` / `max` range to contain the active segment whether it is the month (Chromium / Firefox) or year (WebKit).** `widenRange` in `test/date_field.test.ts` does this. Leaving `min` / `max` narrow causes only Chromium to fail.

## A Japanese IME does not start composition when focus is on a non-editable element

### Behavior

The result of enabling a Japanese IME (Roman-character input) on macOS, focusing a non-editable `ul[role="listbox"]` (`tabindex="0"`), and typing (Chrome 151 / Firefox 153 / Safari 26.5, manual measurement on real devices).

| engine  | Composition event | Keydown appearance                                |
| ------- | ----------------- | ------------------------------------------------- |
| chrome  | Not dispatched    | `key: "a"` / `keyCode: 65` / `isComposing: false` |
| firefox | Not dispatched    | Same                                              |
| safari  | Not dispatched    | Same                                              |

None of the three engines displays conversion candidates, and keydown arrives as an ordinary printable key without passing through the IME (`keyCode` is also a normal value rather than 229). If focus is moved to an editable `input` while the IME remains in the same state, all three engines start composition.

No primary specification defining whether composition starts has been found. The behavior is left to the OS, IME, and engine implementations; other operating systems and IMEs (such as Windows MS-IME / ATOK) are unverified.

The same result occurs with CDP's `Input.imeSetComposition`. It sends composition events to an editable `input` as specified, but sends no events when focus is on a non-editable element (measured in Chromium 151). CDP also does not generate composition keydowns, so keydowns generated by an actual IME cannot be measured through CDP. Generate CompositionEvent and keydown within the test when reproducing an IME in an automated test.

### Impact

Because the typeahead (listbox / tree) keydown handler receives events on a non-editable root, the IME does not start composition and does not interfere on macOS. At the same time, macOS provides no way to jump to labels written in kana or kanji with typeahead, because only alphabetic keydowns that bypass the IME arrive.

### Workaround

Do not rely on this behavior. Because it is not guaranteed by a specification, the typeahead keydown handler uses a guard that rejects IME-originated keydowns (see the next section). The contract explicitly records that typeahead does not work for Japanese labels.

## IME composition keydowns have engine-specific key and isComposing values; only keyCode 229 is shared

### Behavior

The result of typing into an editable `input` with a Japanese IME on macOS (Chrome 151 / Firefox 153 / Safari 26.5, manual measurement on real devices).

| engine  | Keydown for the first keystroke that starts composition                                               | Keydown during composition                 | Keydown for the commit key                               |
| ------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| chrome  | `key` is the actual character / `keyCode: 229` / `isComposing: false`                                 | `key` is the actual character / 229 / true | Enter: 229 / true; arrives **before** compositionend     |
| firefox | `key: "Process"` / `keyCode: 229` / `isComposing: false`                                              | `key: "Process"` / 229 / true              | The commit key is also "Process" / 229 / true            |
| safari  | The keydown itself arrives **after** compositionstart; `key` is the actual character / 229 / **true** | `key` is the actual character / 229 / true | Enter: 229 / **false**; arrives **after** compositionend |

- UI Events §3.6.5 specifies `isComposing: false` for the keydown that starts composition. Chrome and Firefox follow this. Safari fires the keydown after the composition event, so it is `isComposing: true` from the first keystroke.
- All three engines set `keyCode: 229` on every keydown while the IME is processing input, as stated in UI Events §7.3.1 (Legacy Key Attributes): "If an Input Method Editor is processing key input and the event is keydown, return 229."
- The value of `key` is unspecified and depends on the engine. Chrome and Safari use the actual character; Firefox uses `"Process"`.
- Firefox dispatches one extra `input` (`insertCompositionText`) with `isComposing: false` after compositionend.

### Impact

- A guard based only on `event.isComposing` cannot reject the first keystroke in Chrome / Firefox (`false`).
- A flag that tracks the interval from compositionstart to compositionend cannot reject Safari's commit Enter (which arrives after compositionend).
- A printable check on `key` (`key.length === 1`) cannot reject composition-related keydowns in Chrome / Safari (which use the actual character).
- Chrome's first keystroke (`key` is the actual character / `isComposing: false`) passes all three checks. Only `keyCode: 229` distinguishes it.

### Workaround

For keydown handlers that respond to printable characters, use `event.isComposing || event.keyCode === 229` as the guard. `keyCode` is a legacy attribute, but UI Events §7.3.1 provides 229 as the only explicit way to identify a keydown processed by an IME, and measurements show it on IME-processing keydowns in all three engines.

## Time input segment editing has the same engine differences as date input, with Firefox-specific PageUp behavior

### Behavior

The result of focusing and operating `<input type="time" value="10:30">` (`lang="en"`) (Playwright: Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5).

| Item                                                    | chromium                     | firefox                                               | webkit                                    |
| ------------------------------------------------------- | ---------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| Active segment immediately after focus                  | Hour                         | Hour                                                  | Hour                                      |
| ArrowUp on the hour segment                             | 10 → 11 → 12 → 13            | 10 → 11 → 12 → 13                                     | 10 → 11 → 12 → 13                         |
| Events when changing a segment                          | input and change immediately | input and change immediately                          | **input only; change delayed until blur** |
| ArrowUp when `min` and `max` are fixed to the same hour | **No change**                | Next hour (leaves the range)                          | Next hour (leaves the range)              |
| PageUp on the hour segment                              | No effect                    | **+3 hours, wrapping at 12** (10 → 01 → 04 → 07 → 10) | No effect                                 |
| PageUp on the minute segment                            | No effect                    | **+10 minutes** (10:30 → 10:40)                       | No effect                                 |

The three engines agree that the hour segment is active immediately after focus, ArrowUp advances through 24 hours, `stepUp()` moves one minute without a step and one second with `step="1"`, the canonical `value` forms (`HH:MM` / `HH:MM:SS` / `HH:MM:SS.sss`) are preserved, an invalid `value` assignment becomes an empty string, and `valueAsNumber` returns milliseconds from midnight.

The **same differences as date input** are WebKit's delayed change event, only Chromium respecting min / max during segment editing, and only Firefox having native PageUp behavior. The **difference from date input** is that all three engines agree on the active segment immediately after focus (date starts with the year only in WebKit).

Firefox's PageUp is inconsistent with its own ArrowUp. ArrowUp advances through 24 hours (12 → 13), while PageUp wraps at 12 (10 → 01).

### Impact

For the same reasons as date input, the time-field controller does not implement PageUp / PageDown. It would duplicate and conflict with Firefox's native behavior, and the controller cannot determine which segment has focus.

A test that changes the value with arrow keys fails only in Chromium for some `min` / `max` choices.

### Workaround

The controller does not implement PageUp / PageDown. It does not correct engine differences in segment editing. Detect value changes with input events as well, and do not make tests depend on WebKit's delayed change event.

**Before operating a test that assumes arrows change the value, use `min` / `max` values that allow the hour segment to move.** As with date input's `widenRange`, fixing the hour in `min` and `max` makes only Chromium a no-op.

## A time input's value has variable length and cannot be compared with min / max as strings

### Behavior

An `<input type="time">` `value` can take the forms `HH:MM`, `HH:MM:SS`, or `HH:MM:SS.sss`, and the engine preserves the assigned form. `min` / `max` are read as the strings authored by the user. There is no guarantee that these forms match.

Measurements for `min="10:30"`, `step="1"`, and `value="10:30:00"` (identical on all three engines):

| Comparison                    | Result                                   |
| ----------------------------- | ---------------------------------------- |
| `value === min`               | **false** (despite the same time)        |
| `value > min`                 | **true** (despite the same time)         |
| `validity.rangeUnderflow`     | false (the engine considers it in range) |
| `valueAsNumber` and min in ms | Both 37800000 (equal)                    |

### Impact

The date input's `value` has the fixed length `YYYY-MM-DD`, so string comparison can determine equality with min / max (`date-field`'s `syncState` uses this). **The same approach produces incorrect `data-state` for time input.** In the configuration above, it outputs `between` where it should output `min`.

### Workaround

Compare times with `valueAsNumber` (milliseconds from midnight). Because `min` / `max` are attribute strings, assign each to a detached `<input type="time">` and read `valueAsNumber`, delegating interpretation to the engine. Do not parse `HH:MM:SS.sss` with a custom regular expression. For an empty or invalid value, `valueAsNumber` is `NaN`; use `Number.isNaN` to treat it as having no lower or upper bound.

## Firefox returns `attr()` unresolved from `getComputedStyle(element, "::before").content`

### Behavior

The result of reading `getComputedStyle(element, "::before").content` for a `::before` with `content: attr(data-state)` (Playwright headless, Chromium 151 / Firefox 153 / WebKit 26.5).

| engine   | Returned value                       | Rendering                    |
| -------- | ------------------------------------ | ---------------------------- |
| chromium | `"active"` (resolved string)         | Attribute value is displayed |
| firefox  | `attr(data-state)` (specified value) | Attribute value is displayed |
| webkit   | `"active"`                           | Attribute value is displayed |

Rendering is the same on all three engines; only the computed-style string differs.

### Impact

A test that reads a pseudo-element's `content` from computed style to determine whether an attribute value is displayed fails with a false positive only in Firefox. `catalog/catalog.css` displays `data-state` values with `::before { content: attr(data-state) }`, so it is subject to this kind of test.

### Workaround

Do not determine whether something is displayed from computed-style `content`. Check `data-state` output as an attribute (`test/catalog_behavior.test.ts` does this), and verify rendering with a screenshot.

## Table-of-contents fragment scrolling and assertion boundaries

In Firefox's Vitest Browser Mode, `getBoundingClientRect().top` was 49px after a native link moved to a heading with `scroll-margin-block-start: 48px`. table-of-contents allows a one-pixel boundary difference from native fragment scrolling when determining the current position. The controller does not correct the scroll position.

## Native color alpha and color spaces

### Testing color-picker page interactions

`test/color_picker.test.ts` tests a named group separately from the native picker. DOMRect coordinates inside the Vitest iframe do not match coordinates in Playwright's outer viewport when the iframe is displayed at a scale. `colorPointer` takes a ratio of the target's boundingBox and converts it to actual mouse coordinates. Pixel-rounding differences below one percentage point are allowed.

For modifier-exclusion tests, a capture listener for trusted ArrowLeft sets the modifier flag. Physical Meta+ArrowLeft and similar input also triggers browser history navigation and leaves the test page, so it is kept separate from input that tests only the controller guard.

### Native input measurements

`test/native_color.test.ts` tests keyboard operations on a closed `input[type="color"]`, value normalization, and events from API assignment and form reset in Chromium / Firefox / WebKit through Playwright 1.62.1. Input values and engine-specific measurements are stored in `test/fixtures/native_color_observations.json`.

| Configuration                   | Chromium                | Firefox                    | WebKit                                      |
| ------------------------------- | ----------------------- | -------------------------- | ------------------------------------------- |
| No attribute                    | Six-digit sRGB hex      | Six-digit sRGB hex         | Six-digit sRGB hex                          |
| `alpha`                         | Does not preserve alpha | Does not preserve alpha    | Preserves alpha and returns `color(srgb …)` |
| `alpha colorspace="display-p3"` | Six-digit sRGB hex      | Preserves P3 but not alpha | Preserves P3 and alpha                      |

All three engines interpret CSS color names and `rgb()` and normalize invalid values to black. Conversion from P3 to sRGB has a one-step rounding difference between Chromium and the other engines. Test not only whether the `alpha` and `colorSpace` IDL properties exist, but also what the assigned value preserves.

The four directional keys do not change the color value on any engine when a closed input is focused. `value` assignment and form reset do not dispatch `input` / `change`. These results apply only to the input element on the page. Color selection, keyboard operation, and trusted events after selection inside the OS picker are unverified; do not infer them from these tests.

References: [HTML Color state](<https://html.spec.whatwg.org/multipage/input.html#color-state-(type=color)>), [MDN input type=color](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/color).

## Firefox returns a stale association from input.labels after a label's for changes

After reading `input.labels` for `<label for="x">Name</label><input id="x">` and setting `label.htmlFor = "other"`, Playwright Firefox leaves `input.labels.length` at 1. Chromium and WebKit return 0. `label.control` becomes null on all three engines. Waiting 20ms does not change Firefox's result.

For each `input.labels` candidate, editable also checks `label.control === input` and excludes labels that no longer name the current input. `editable-label-negative` in `test/editable.test.ts` tests enhancement disabling after a for change and recovery after the association is restored on all three engines.

## Native event differences for the ContextMenu key

When Playwright sends the `ContextMenu` key to a focused button, Chromium dispatches `contextmenu` with `button=-1`, `pointerType="mouse"`, and `detail=0`. Firefox and WebKit do not dispatch a native `contextmenu` for the same operation. `pointerType="mouse"` alone cannot identify a pointer origin.

dropdown-menu handles the shortcut directly and prevents the default action of the recognized keydown. `menu-context-shortcut-cancel` verifies that a native event does not reopen the menu after beforeopen is canceled. A directly received contextmenu event keeps the native menu when the open request is canceled. As documented in [MDN contextmenu](https://developer.mozilla.org/en-US/docs/Web/API/Element/contextmenu_event), Firefox does not dispatch the event itself for Shift+right-click, so that input is outside the controller's scope.

## Returning by Tab from a manual popover to a link trigger

`test/native_hover_preview.test.ts` places `popover="manual"` content immediately after a trigger, focuses the trigger, calls `showPopover()`, and tests Tab / Shift+Tab movement with the internal button. In Playwright headless WebKit, attempting to return with Shift+Tab to a link without tabindex makes body the activeElement. Chromium and Firefox return to the link. With a link that explicitly has `tabindex="0"` and with a native button, all three engines return to the trigger.

This measurement is limited to the current headless configuration. A real device with changed Safari keyboard-navigation settings and a screen reader are unverified; it does not mean that every Safari environment skips links.

All three engines keep focus on the trigger when a manual popover without autofocus is shown. If content contains an autofocus descendant, focus moves to that descendant. A manual popover also does not close from Escape or an outside click alone. When designing a hover-triggered interactive preview, verify focus retention on show, Tab order, and closing paths separately.

As a negative control for this native test, adding autofocus to every internal button in the fixture makes the nine focus-retention tests fail while the other six pass.
