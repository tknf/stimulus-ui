# Do Not Create a New Tour Component

A modal tour that explains targets on the screen in sequence combines the existing dialog with step progression managed by the consumer. Open/close state, the Escape key, and focus containment are handled by the dialog; switching explanations and focusing headers are handled by the consumer; and alignment with targets is handled by CSS anchor positioning. Since this scope is of a complexity that users can write manually, a new tour controller will not be created.

## Combination Example

- [HTML](../../test/compositions/tour.html): Places two tour targets, explanations, and previous/next/finish buttons
- [Consumer Controller](../../test/compositions/tour_controller.ts): Manages the step to display, the disabled state of end buttons, and focus on the explanation
- [CSS](../../test/compositions/tour.css): Specifies anchors according to the step and the position of the dialog
- [Browser Test](../../test/tour_composition.test.ts): Tests registration, interaction, actual coordinates, and focus

This is a composite example for verification purposes and is not a distributed component. Refer to the files above for HTML, JS, and CSS, as they are not managed redundantly here.

## Rationale for Decision

When moving between steps, the consumer switches the displayed explanation and moves focus to its heading within the handler triggered by pressing the previous/next buttons. Processes that progress or shift focus using timers are not needed. Ending and pressing Escape rely on the existing dialog to return focus to the trigger button, with the consumer only handling step initialization upon restart.

The [APG Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) describes a structure that maintains focus within the modal and specifies tabindex=-1 on headings or similar elements when focusing on the beginning of the content. The target in the background is not operated while the modal is displayed, and only the explanation is read inside the dialog.

[CSS anchor positioning](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Anchor_positioning/Using) associates elements using anchor-name and position-anchor, and specifies relative positions using anchor(). The example places the dialog below the target using this feature. Even if the target moves, it follows without measuring dimensions via JS, and focus is not changed by updating its placement.

## Scope of Application

What was verified is a modal guide that explains two fixed targets that are displayed and within the viewport. Non-modal configurations that allow direct interaction with background targets during the guide, page transitions to find targets, waiting for asynchronously appearing targets, and saving progression history are not included.

Position fallbacks, scrolling, highlighting, and backdrop appearances for targets at viewport edges or off-screen are determined based on consumer requirements. The fixed layout in the example should not be judged as supporting all viewports or target positions. Positioning fallbacks for environments that do not support CSS anchors have also not been verified.

If these become concrete requirements, re-evaluate by identifying the missing differences between the existing dialog and consumer logic. Since the current dialog is dedicated to modals, non-modal functionality is not treated as an existing feature.

## Verification

Run `vp run test run test/tour_composition.test.ts` to execute four tests each for Chromium, Firefox, and WebKit. Confirm progression, completion, and restart via pointer and keyboard, focus on headings and triggers, cancellation of close, background inertness, and actual coordinates and tracking of CSS anchors. Also confirm that there are no markup completion or invalidation warnings.

For negative control, individually break step initialization, focus on headings after moving, and anchor association for the second target, confirming that the corresponding tests fail in Chromium. Mutations are restored after testing.

Reading aloud by actual screen readers during composition has not been confirmed (observation). Public APIs, ARIA, and markup contracts are not changed, and this does not expand the previously confirmed scope of actual device compatibility for the existing dialog.
