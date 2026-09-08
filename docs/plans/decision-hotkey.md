# Do not create hotkey

Do not create hotkey as a component for assigning application-wide keyboard shortcuts.

## Rationale

1. **Shortcut assignment can be written with Stimulus's standard action syntax.** In the form `data-action="keydown.meta+k@window->palette#open"`, Stimulus 3.2.2 itself provides KeyboardEvent filters (enter / tab / esc / space / arrows / home / end / page_up / page_down / a–z / 0–9), modifier-key combinations (meta / ctrl / alt / shift), and global listeners (`@window` / `@document`) (see `allModifiers` and `keyMappings` in `node_modules/@hotwired/stimulus/dist/stimulus.js`). Features already provided by Stimulus, the library's only dependency, are treated like native behavior and do not justify another component.
2. **The remaining differences are not large enough to form a component.** Suppressing shortcuts while an input is being edited or an IME is composing, absorbing Mac / Windows modifier differences, and synchronizing `aria-keyshortcuts` remain. Each is a decision for the side that receives the shortcut and decides what to do (the user's controller), and none forms a one-concept/one-controller unit.

## Guidance

- For shortcuts, direct users to Stimulus actions + KeyboardEvent filters + `@window`.
- Treat `aria-keyshortcuts` as a static attribute authored in the user's markup. AT support has not been used as a basis for this decision and is unverified.

## Conditions for reconsideration

Reconsider when a TK&F product needs shortcuts that Stimulus key filters cannot express (key sequences or user-configurable key assignments).

## Primary sources

- Stimulus actions and KeyboardEvent filters: https://stimulus.hotwired.dev/reference/actions
- Implementation reference (Stimulus 3.2.2 in devDependencies): `allModifiers` and `keyMappings` in `node_modules/@hotwired/stimulus/dist/stimulus.js`
