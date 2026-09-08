# Do not create navigation-menu

Build a UI that opens and closes groups of site links by composing disclosure. Optional mouse hover, closing on Escape, and closing when focus leaves can be added with three user-side methods and Stimulus actions. Because opening and closing state, Tab navigation, link activation, and ARIA do not need to be reimplemented, do not create a navigation-menu controller for this scope.

## Composition example

- [HTML](../../test/compositions/navigation_menu.html): Place two disclosures and native links in a named nav.
- [User controller](../../test/compositions/navigation_menu_controller.ts): Call show() / hide() on a disclosure outlet and close after checking focus.
- [Browser test](../../test/navigation_menu_composition.test.ts): The entry point that registers and operates the example in the Application.

This is a verification example for judging composition complexity, not a distributed component. Use outlets for references between controllers and [Stimulus actions](https://stimulus.hotwired.dev/reference/actions) for event subscription and removal; do not add custom listener management.

## Division of behavior

| Concern                                          | Handling in the composition                                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Opening, closing, and state output               | Native details / summary and disclosure handle them.                                                                       |
| Focus between the trigger and links in the panel | Use native sequential navigation. Do not add roving tabindex or arrow keys.                                                |
| Escape                                           | Each disclosure receives the window key and closes when open. Return to summary only when focus is inside that disclosure. |
| Hover                                            | Open on mouse pointerenter. Keep the panel adjacent to summary inside details and do not close when moving into the panel. |
| Pointer exit and focus                           | Do not close when the pointer leaves while focus is inside. Close when focus moves outside the disclosure.                 |
| Keyboard equivalence                             | Enter / Space activation of summary reaches the same links. Hover itself does not move focus.                              |

Even when focus is outside nav, Escape can close a hover display. After closing, do not steal external focus or reopen until the pointer enters again.

## Distinction from menubar and scope

The [APG Disclosure Navigation Menu](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/) demonstrates disclosure with Tab and Escape for ordinary site navigation without using the menu role. Arrow keys, Home, and End are optional additions.

The [menubar decision](decision-menubar.md) concerns a desktop-application-style bar with role="menubar" and hierarchical submenu keyboard interactions. This example preserves the native semantics of nav, summary, and links and does not add a menu / menubar role.

The verification scope is one level of links adjacent to each summary. It excludes pointer paths to a popup at a separate location, delayed hover, multiple submenu levels, animation between panels, and exclusive control of all panels. If they become concrete requirements, reconsider the difference that the existing component composition cannot provide.

## Verification

Run `vp run test run test/navigation_menu_composition.test.ts` to check five cases each in Chromium / Firefox / WebKit. Test opening and closing, keyboard movement to links, focus return on Escape, hover retention and closing, external focus retention, and exclusion of synthetic events and IME keydown. Also verify that markup completion and disabling produce no warnings.

Use Option+Tab to navigate to links in WebKit. The difference from ordinary Tab and its basis are recorded in [browser engine differences](../notes/browser-engine-differences.md). In tests, move the pointer outside nav each time so hover from the previous operation is not carried over.

Apply negative controls separately by breaking internal focus retention on pointer exit, external focus retention on Escape, and IME keyCode 229 exclusion, then verify in Chromium that the corresponding tests fail. Restore each mutation after testing.

Compatibility of the composition with a screen reader and touch interaction on real devices is unverified (observation). Native semantics and the existing contract are unchanged, and the range of real-device compatibility that has been verified is not expanded.
