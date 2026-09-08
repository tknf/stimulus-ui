# Do not add a drawer configuration to dialog

Build a modal panel at the edge of the screen with dialog and user CSS. Combine it with slider when stepped height selection is needed. This does not require another controller, so do not add drawer-specific API to dialog.

## Composition example

- [HTML and CSS](../../test/compositions/drawer.html): Markup that registers dialog and slider, and CSS that places it at the bottom edge of the screen.
- [Browser test](../../test/drawer_composition.test.ts): Application registration, keyboard and click interactions, and verification of height and focus.

The example is for verifying whether users can write the composition themselves; it is not a distributed component. No additional user controller or event listener is needed.

| Concern                           | Handling in the composition                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| Modal opening, closing, and focus | dialog handles the native dialog, trigger, close button, and Escape.                 |
| Placement at the screen edge      | User CSS specifies the position and width.                                           |
| Stepped height                    | Use a native range with min=30, max=90, and step=30 to choose 30/60/90%.             |
| Applying the height               | Convert slider's normalized value in CSS with `30dvh + 60dvh * var(--slider-value)`. |
| Keyboard                          | Use native range key input for height and Escape or the close button to close.       |
| Non-drag pointer interaction      | Use a range track click for height and the close button to close.                    |

Place dialog and slider on separate roots. Both manage root `data-state`, so registering them on the same element would make the open state and value position conflict. Inherit slider's custom property into its descendant dialog. Height changes do not move focus.

## Boundary with swipes and snap points

[Ark UI](https://ark-ui.com/docs/components/drawer) provides settings for swipe direction, snap points, and drag-to-dismiss. [Corvu](https://corvu.dev/docs/primitives/drawer/) determines the snap point at release from distance or velocity and supports a breakpoint. [Base UI](https://base-ui.com/react/components/drawer) exposes swipe distance and snap-point offset to CSS.

This composition provides a choice among fixed heights. It does not move the panel with the finger, snap based on release velocity, close by swiping, or distinguish scrolling from a gesture. It does not reproduce the same interactions as those libraries' drawers.

The reason not to use swiping is not that an equivalent keyboard operation cannot be provided. The close button is equivalent for closing, and the range is equivalent for height. Since the existing composition provides opening, closing, and stepped height selection, dragging the panel itself is not required in addition.

Reconsider if a use case requires direct manipulation of the panel itself. At that point, define in the contract conflicts with the scroll region, pointercancel, commit and cancellation at release, step units and boundaries, and equivalent keyboard and click/tap paths. If the role remains dialog, consider it a dialog configuration difference rather than a separate drawer controller.

## Verification scope

Run `vp run test run test/drawer_composition.test.ts` to test two cases each in Chromium / Firefox / WebKit. Verify the native modal, opening and closing, three height steps, placement at the bottom edge, independent state output, keyboard and track click, focus retention and return, and the absence of markup warnings.

Apply negative controls separately by removing the slider-value reference from the CSS in the HTML and by removing the close target, then verify in Chromium that the two height tests and one pointer-close test fail respectively. Restore each change after testing.

Touch on real devices, mobile-browser viewport changes, and announcements for the Safari + VoiceOver composition are unverified (observation). The existing public contract is unchanged, and mobile-specific compatibility is not considered verified.
