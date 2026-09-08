# Do not create a general-purpose popover

Do not create a general-purpose popover component for notification panels, settings popups, and similar uses. Native popover and popovertarget provide opening and closing, light dismiss, Escape, top-layer placement, autofocus, and toggle events; the engine observations below define the tested scope.

## Rationale

1. **Native provides opening and closing, light dismiss, Escape, top layer, and autofocus.** All three engines (Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5, Playwright headless) supported opening and closing from an invoker click, light dismiss from an outside click, closing with Escape, and autofocus inside the popover.
2. **CSS can read the state with `:popover-open`.** It is supported on all three engines. A controller does not duplicate state that CSS can derive.
3. **Native provides `beforetoggle` / `toggle` events.** `beforetoggle` is cancelable in the opening direction (`preventDefault()` stopped opening in measurements on all three engines). Native already provides the same mechanism as this library's "`before<verb>` is cancelable and `<verb>` is notification" rule.
4. **The only remaining difference is that WebKit does not restore focus.** When a popover is closed with Escape while focus is inside it, Chromium / Firefox return focus to the invoker, but WebKit 26.5 does not (the HTML Standard's hide popover algorithm specifies the return). A controller that only corrects one engine's implementation would be a polyfill and is not provided by this library.

## Guidance

- For a popover panel, direct users to native `popover` + `popovertarget`. User CSS, including anchor positioning, determines its position. The dropdown-menu contract also does not provide position or top layer.
- **Hover-triggered interactive previews (hover cards) are outside this decision.** popovertarget starts from a click, and native behavior has no hover intent (delay or safe polygon). Decide how to address it in a separate issue if demand arises.

## Conditions for reconsideration

Reconsider when a TK&F product has a keyboard problem because WebKit does not restore focus. First check user-side workarounds and the status of the WebKit fix; if those do not resolve it, consider implementing a component.

## Observed native behavior

Tested with Playwright headless: Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5.

| Item                                                         | Chromium    | Firefox     | WebKit                                                    |
| ------------------------------------------------------------ | ----------- | ----------- | --------------------------------------------------------- |
| Open with invoker click                                      | ✓           | ✓           | ✓                                                         |
| Close with Escape                                            | ✓           | ✓           | ✓                                                         |
| Light dismiss with an outside click                          | ✓           | ✓           | ✓                                                         |
| `beforetoggle` (open) cancelable / blocked by preventDefault | ✓           | ✓           | ✓                                                         |
| Autofocus inside popover                                     | ✓           | ✓           | ✓                                                         |
| Focus restoration on Escape close (to invoker)               | ✓           | ✓           | **✗ (focus remains on an element in the closed popover)** |
| Invoker `aria-expanded` content attribute                    | Always null | Always null | Always null                                               |

- **`aria-expanded` is not reflected in the content attribute** (null for both open and closed on all three engines). The specification says that the invoker's expanded state is exposed as implicit semantics in the accessibility tree. Because the policy forbids using ARIA as a CSS selector, the missing attribute is not a disadvantage. **Whether screen readers actually announce expanded is unverified** (not tested with real-device AT).
- **The `toggle` event can be coalesced within a task.** In Chromium, light dismiss immediately after opening did not dispatch a separate open `toggle`; only the close `toggle` fired (`beforetoggle` fired synchronously each time). Users subscribing to native events should account for this behavior.
- WebKit does not move focus to a button on click (macOS behavior). The measurements call `button.focus()` so this difference does not affect focus restoration.

## Primary sources

- HTML Standard popover (including focus restoration in the hide popover algorithm): https://html.spec.whatwg.org/multipage/popover.html
- MDN Popover API: https://developer.mozilla.org/en-US/docs/Web/API/Popover_API
