# Do not create a command palette

Build a modal UI that searches for and executes one command by combining the existing combobox and dialog. The user adds search, empty-result display, command execution, and search reset when reopening; it does not need to reimplement option navigation, selection, or dialog opening and closing. This is a complexity users can write themselves, so do not create a command palette controller.

## Composition example

- [HTML](../../test/compositions/command_palette.html): Place a combobox, named option groups, an empty result, and a close button inside the dialog.
- [User controller](../../test/compositions/command_palette_controller.ts): Reference the existing controllers through Stimulus outlets and perform search, initialization, and execution with three methods.
- [Browser test](../../test/command_palette_composition.test.ts): The entry point that registers the example with the Application and operates it.

This example is for comparison and verification; it is not a distributed component. Displaying the executed command ID in output is application-specific processing. The user-side command handler receives `combobox:change` after selection is committed.

## Why no component-specific difference is needed

| Concern                                | Handling in the composition                                                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Option navigation and heading skipping | Only option targets are navigable, so headings are skipped by not making group names targets. combobox also excludes disabled options.                                                 |
| Search and empty results               | The user toggles each option's `hidden` and decides whether to show a group or the empty result from that state. Filtering is also the user's responsibility in the existing contract. |
| Escape                                 | combobox handles the first Escape and closes the options. On the next Escape, the dialog controller handles the native dialog cancel.                                                  |
| Initial focus and return               | Use input autofocus and dialog. After executing a command, the user calls the public `close()` and returns focus to the trigger button.                                                |
| Re-execution                           | Clear the search value on `dialog:open` and show it again. The same command can be selected again.                                                                                     |

The [APG Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) allows a configuration that runs a value's default action when an option is accepted with Enter. Use the [grouped listbox example](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/examples/listbox-grouped/) as the reference for named option groups. [Bits UI Command](https://bits-ui.com/docs/components/command) also shows combining it with Dialog for modal display.

## Scope

The example handles a static set of options and partial matching against labels. It separates the command ID from the displayed label and does not search the ID itself. Because combobox does not dispatch change when the selected value is unchanged, do not use this example as-is when an arbitrary search term can equal a command ID.

History across multiple pages, races in asynchronous search, option virtualization, and shortcut conflicts within an application are outside the verification scope. If they become necessary, reconsider from the concrete difference that the existing combobox composition or user-side processing cannot handle.

## Verification

Run `vp run test run test/command_palette_composition.test.ts` to check three cases each in Chromium / Firefox / WebKit. Test keyboard and pointer execution, skipping headings and disabled options, recovery from an empty result, re-execution, Escape, and focus return. Also verify that markup completion and disabling produce no warnings.

Apply negative controls separately by removing search-value initialization from the user controller and by making the filter display every option, then verify in Chromium that the re-execution and empty-result tests fail respectively. Restore each mutation after testing.

Announcements for the composition with a screen reader on a real device are unverified (observation). This decision does not change the existing contract's public API, ARIA, or markup requirements, and does not expand the range of real-device compatibility that has been verified.
