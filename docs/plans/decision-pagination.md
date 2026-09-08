# Decision not to create a pagination controller

## Conclusion

**Do not create one.** In addition to the reasons for breadcrumb, there is no primary norm to rely on.

## Rationale

**The APG has no pagination pattern.** Pagination is not among the 33 patterns listed in the APG patterns index (Accordion, Alert, Alert Dialog, Breadcrumb, Button, Carousel, Checkbox, Combobox, Dialog, Disclosure, Feed, Grid, Landmarks, Link, Listbox, Menu / Menubar, Menu Button, Meter, Radio Group, Slider, Slider Multi-Thumb, Spinbutton, Switch, Table, Tabs, Toolbar, Tooltip, Tree View, Treegrid, Window Splitter) ([APG: Patterns](https://www.w3.org/WAI/ARIA/apg/patterns/)).

Only the Link and Button patterns are related, and neither defines pagination-specific ARIA or keyboard requirements.

In practice, it needs the same two things as breadcrumb.

1. Label `<nav>` with `aria-label`.
2. Add `aria-current="page"` to the current page number.

**Both are satisfied by static markup, and there is no behavior for a controller to add.** The server or user knows the current page number; the library cannot determine it.

`AGENTS.md` requires keyboard interactions to be written in the contract and the APG pattern to be named when one is followed. However, **there is no APG pattern for pagination**. Without a basis for what constitutes a correct implementation, a contract could not have verifiable acceptance criteria.

## What would be required to create one

To overturn this decision in the future, one of the following would be required.

- Tracking dynamically added or removed page numbers. `TargetConnected` / `TargetDisconnected` would be sufficient, and this is less complex than tabs.
- Automatic detection of the current page. As with breadcrumb, this conflicts with the policy of not depending on the user's environment.
- Omitting page numbers with an ellipsis (`…`). This would make the controller decide which numbers to display and conflict with the policy not to generate content.

The third item is especially outside this repository's scope. Generating "1 2 3 … 10," as pagination libraries commonly do, generates markup and **is not included in components created by this repository**.

## What to do instead

**Write nothing.** Treat it the same as `decision-breadcrumb.md`. The correct markup is in the APG; do not re-explain markup for an undistributed component here.

**Keep this record.** It answers the question "Is there no component that builds 1 2 3 … 10?"
