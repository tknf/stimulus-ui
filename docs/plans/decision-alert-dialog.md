# Decision not to create an alert-dialog controller

## Conclusion

**Do not create one.** Add a `description` target to `dialog`.

## Rationale

After checking each requirement that the APG Alert Dialog Pattern adds to the Modal Dialog Pattern, **there was no behavior for a controller to implement**.

| APG requirement                               | Current situation                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add `role="alertdialog"`                      | **It works as written by the user.** The `dialog` controller does not write any role (`design/contracts/dialog.contract.json:142`). `test/dialog.test.ts:77` already checks preservation of `role="alertdialog"`.                                                        |
| Keyboard interaction                          | **There is no custom definition.** The APG delegates to the modal-dialog section.                                                                                                                                                                                        |
| Put initial focus on a non-destructive action | **The native `showModal()` focus-decision algorithm does not consult `role`** (confirmed in WHATWG HTML). The library cannot know which action is destructive, so the user specifies it with `autofocus`. The existing contract already uses this design (`focus.open`). |
| Associate the body with `aria-describedby`    | **This is the only mechanical difference.** It can be represented by a `description` target symmetrical to the existing `title` target.                                                                                                                                  |

In ARIA 1.2, `role="alertdialog"` is a subclass of `dialog`, not a live region. No announcement logic is needed.

**Under the "Whether to create a component at all" criteria in `AGENTS.md`, changing state over time, focus movement by key input, opening and closing, and calculating values that CSS cannot read are all already provided by `dialog`.** Alert-dialog-specific behavior is zero.

## What to do instead

Add a `description` target to the `dialog` contract.

- Add `data-dialog-target="description"` to `authorMarkup`.
- Add to `managedMarkup` that the controller points `aria-describedby` to the description target's ID only when it is not specified. Unlike the `title` target, it can be completed independently of whether a label exists.
- State in `acceptanceCriteria` that, when used as an alert dialog, the user specifies initial focus with `autofocus`.

ID generation uses `ensureElementId`, in the same form as the `title` target.

## Unresolved question

**The APG does not say whether Escape should close an alert dialog.** Existing dialog always registers Escape-to-close behavior (`behavior.escape`). Allowing Escape in a confirmation dialog for a destructive action could close it accidentally.

However, this is not specific to alert dialogs: **the user can stop it by canceling `beforeclose`**. The existing mechanism is sufficient, so it does not need special handling.

## Unverified

- Whether implicit / explicit role mapping for `<dialog role="alertdialog">` agrees across the three engines
- How an alert dialog's accessible name and description are announced by a screen reader on a real device

Both are already within the scope that `dialog.contract.json`'s `acceptanceCriteria` requires to be reported as unverified.
