# Do Not Create scroll-area

Do not create scroll-area, which serves as the foundation for custom scrollbars, as a component.

## Reasons

1. **CSS scroll-driven animations now provides output for scroll position and ratio on the CSS side, which was the only candidate difference.** Through `animation-timeline: scroll()` / `view()`, CSS can read the scroll progress without JS intervention. In the tested versions, Chromium 151 and WebKit 26.5 worked (the animation updated the computed style according to the scroll amount). The controller will not redundantly output values that CSS can derive.
2. **The unsupported state is limited to a single engine, Firefox 153, and a controller that fills in for a single engine's missing implementation is considered a polyfill, which we do not provide.** (Same judgment as the WebKit focus restoration in decision-popover.md)
3. **The appearance of the scrollbar is the domain of CSS.** `overflow`, `scrollbar-width`, and `scrollbar-color` are determined by the user's CSS. As a result of this division of responsibilities, there are no remaining behaviors for this library to handle.

## Guidance

- We will guide users who need visual changes based on scroll position to use scroll-driven animations. Whether to supplement with JS if the same presentation is required in Firefox is left to the user's discretion.

## Conditions for Reconsideration

When Firefox support for scroll-driven animations remains unimplemented for a long time, and synchronized scroll state output consistent across 3 engines becomes essential for TK&F products.

## Actual Measurement Records

Tested with Playwright headless (Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5).

| Item                                                                                          | Chromium      | Firefox | WebKit        |
| --------------------------------------------------------------------------------------------- | ------------- | ------- | ------------- |
| `animation-timeline: scroll()` supports                                                       | ✓             | ✗       | ✓             |
| `animation-timeline: view()` supports                                                         | ✓             | ✗       | ✓             |
| `ScrollTimeline` in window                                                                    | ✓             | ✗       | ✓             |
| Functional verification (animation with `scroll(self)` updates values according to scrollTop) | ✓ (0.25→0.75) | ✗       | ✓ (0.25→0.75) |

- For the functional verification, an animation that changes opacity from 0.25 to 0.75 in `@keyframes` was applied to `animation-timeline: scroll(self)`, and the computed opacity was compared between scrollTop 0 and the very bottom.
- In Firefox, the timeline declaration was ignored, remaining fixed at the to value of `fill: both` (0.75) without following the scroll.

## Primary Sources

- CSS scroll-driven animations specification: https://www.w3.org/TR/scroll-animations-1/
- MDN CSS scroll-driven animations: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations
