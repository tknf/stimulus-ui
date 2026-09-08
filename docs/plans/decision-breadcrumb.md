# Decision not to create a breadcrumb controller

## Conclusion

**Do not create one.** The investigation found no behavior for a controller to take on.

## Rationale

The APG Breadcrumb Pattern has only three requirements, all of which are satisfied by static markup ([APG: Breadcrumb Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/breadcrumb/)).

1. Place it inside `<nav>`.
2. Label that `<nav>` with `aria-label` or `aria-labelledby`.
3. Add `aria-current="page"` to the link representing the current page (optional when it is not a link).

**There is no keyboard-interaction requirement.** Ordinary Tab navigation between links is sufficient; no focus management or state synchronization is needed.

This library provides three things—behavior, `data-*` state, and custom events—but breadcrumbs need none of them. A controller could complete `aria-current`, but **the server or user knows which page is current**, and the library cannot determine it. Since it cannot determine that, the only possible addition would be to validate a user-authored `aria-current`.

`AGENTS.md` requires "one concept = one controller = one definition," but it does not establish a reason to add a controller when native behavior is sufficient. `switch` and `radio group` have `data-state` output and events with a `reason`, whereas breadcrumbs have neither state nor change.

## What would be required to create one

To overturn this decision in the future, one of the following would be required.

- Behavior that collapses intermediate items when there is insufficient width. Collapse is a visual decision that requires measuring dimensions, which conflicts with the no-appearance policy just as it does for `splitter`.
- A mechanism for the controller to determine the current page. This would compare against `location.pathname`, conflicting with the policy of not depending on the user's environment. Routing rules differ by application.

Both are outside this repository's scope.

## What to do instead

**Write nothing.** The correct markup is in [APG: Breadcrumb Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/breadcrumb/). Re-explaining markup for an undistributed component here would duplicate the APG and would not track APG updates.

Do not create a contract either. A contract defines a component that has a controller; do not make a controller-less item into a contract.

**Keep this record.** It answers the question "Is there no breadcrumb?"
