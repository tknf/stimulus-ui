# Do not add editing modes to grid and treegrid

Compose cell editing from editable and a user controller. grid / treegrid handle movement between cells, editable handles the draft, validation, commit, and cancellation, and the user controller selects the cell to edit, updates the display, and returns focus to the cell. Two user-side methods implement this division, so do not add an editing mode to the public grid / treegrid API.

## Relationship to the APG

[Editing and Navigating Inside a Cell in the APG Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/#editingAndNavigatingInsideACell) describes keyboard handling that passes arrow keys used for cell navigation to editing or widget operation inside a cell. Use the configuration that enters the input with Enter and returns to cell navigation with Escape. Do not treat the value store or preview rendering method as requirements to add to grid.

## Composition example

- [Markup](../../test/compositions/grid_editing.html): Put a user controller on the cell to edit and editable inside it.
- [User controller](../../test/compositions/cell_edit_demo_controller.ts): Two methods, `keydown` and `finish`.
- [Browser test](../../test/grid_editing_composition.test.ts): Register and operate both grid and treegrid configurations.

The test sets the controller and role on the same table markup to grid and treegrid respectively. It writes treegrid row and toggle attributes in the markup and does not use them for grid. The example is for evaluating composition complexity and is not a distributed artifact.

| Operation                              | Owner and result                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Enter on the cell to edit              | The user calls editable's public `edit()` and enters the input.                                  |
| Edit button                            | Starts editing as an ordinary user interaction with editable.                                    |
| Arrow keys in the input                | After editable handles them, the cell stops propagation and preserves native caret behavior.     |
| Enter in the input                     | editable commits after native validation.                                                        |
| Escape in the input                    | editable cancels the draft.                                                                      |
| Commit/cancel notification             | The user displays the committed value and returns to the cell only when focus remains inside it. |
| Arrow keys after returning to the cell | grid / treegrid moves between cells.                                                             |

Making the editor and user-controller roots parent and child lets editable stop propagation after its keydown listener handles the event. `preventDefault()` alone cannot stop grid / treegrid movement. Do not stop propagation of custom events or focusin.

Enter from a cell is a public API call, so it does not dispatch `editable:beforeedit` / `editable:edit`. Users who need an edit-start notification or cancellation should use the edit-button path or put that decision in their start handler. Commit and cancellation use trusted input and button interactions and editable's ordinary before / after events.

In treegrid, Enter on the first cell of a row with children opens and closes the row. Do not assign this example's Enter-to-edit behavior to that cell. The example edits the second column to avoid conflict with hierarchy operations.

## Boundaries and reconsideration conditions

The example edits one line of text at a time. It does not cover F2, starting editing by typing, continuous editing in adjacent cells, batch commit across multiple cells, reordering, row removal or collapse during editing, textarea, focus among multiple widgets, or aggregated Tab order. Tab retains native sequential navigation.

Reconsider if rules for ending edits across rows or cells become necessary and an invariant cannot be maintained by cell-level editable and user-side processing. Do not make grid and editable own the same draft merely because they both commit a value.

## Verification

Run `vp run test run test/grid_editing_composition.test.ts` to check eight cases each in Chromium / Firefox / WebKit. Test Enter, caret movement, Escape, display of the committed value, resuming cell navigation, validation, external focus retention, exclusion of synthetic and IME Enter, and absence of markup warnings.

Apply negative controls separately by removing cell keydown propagation stopping, external focus retention, synthetic-event exclusion, and IME keyCode 229 exclusion, then verify in Chromium that the corresponding grid / treegrid tests for each invariant fail. Restore each change after testing.

Compatibility of the composition with a screen reader and touch interaction on real devices is unverified (observation). It does not change the public controller behavior or ARIA, and does not expand the range verified on real devices.
