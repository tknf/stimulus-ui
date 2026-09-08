# Record of Decision Not to Ship rating

Do not create a rating controller. Native radio inputs provide discrete star-rating selection, keyboard navigation, and form participation. The [radio-group rationale](decision-radio-group.md) applies: a component must add behavior beyond native elements, as required by `AGENTS.md`.

## rating Is an Application of Radio Group

The W3C APG does not have rating as an independent pattern, but instead illustrates it as examples of the Radio Group Pattern and Slider Pattern. Both examples are custom widgets (SVG/div-based) explicitly marked as reference implementations not intended for production use. There is no reason for this repository to choose a structure that does not use native inputs (a convention assuming semantic HTML). As shown in the actual measurements in `decision-radio-group.md`, building it with native radio elements ensures that selection, navigation with arrow keys, form participation, and CSS with `:checked` all work natively.

## Candidates Specific to rating Also Do Not Provide a Reason to Add a Controller

| Candidate                                          | Reason Not to Add a Controller                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hover preview (filling up to the pointer position) | Can be written using CSS `:hover` and sibling selectors, requiring no JS state. Not handled in this library, which does not hold visual styling.                                           |
| Half-star (0.5 increments)                         | Can be expressed natively by arranging radio options in 0.5 increments. The increment size is determined by markup, not behavior.                                                          |
| Deselection (returning to unrated)                 | This is a general property of radio groups and not unique to rating. Since users can implement this by setting `checked` to false on a checked radio, we will not add a controller for it. |

## Correct Markup Guidance Will Not Be Written Here

- APG Example (radio structure): https://www.w3.org/WAI/ARIA/apg/patterns/radio/examples/radio-rating/
- APG Example (slider structure): https://www.w3.org/WAI/ARIA/apg/patterns/slider/examples/slider-rating/
- Reading and writing values per group: https://developer.mozilla.org/en-US/docs/Web/API/RadioNodeList/value

## Conditions for Re-proposing

Same as the re-proposal conditions in `decision-radio-group.md` (when engine differences emerge that require correcting native radio keyboard behavior, or when behavior not present in native elements becomes necessary). Specific to rating, if continuous value rating input that cannot be expressed with radio options becomes a requirement, start by considering whether it can be handled as a structural variation of a slider using native range inputs.
