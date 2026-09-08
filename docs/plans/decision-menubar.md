# Do not create menubar

Do not create a component for the APG Menubar Pattern (a horizontal role=menubar bar, row roving, and submenu hierarchy). Its application-menu use cases are limited, and APG and MDN discourage using it for ordinary site navigation.

## Rationale

1. **It must not be used for site navigation.** The APG explicitly says, "The menubar pattern requires complex functionality that is unnecessary for typical site navigation," and recommends the Disclosure Pattern. MDN makes the same point: use a native `<nav>` and links for primary site navigation, and reserve the menu role for composite widgets that require focus management. Distributing menubar would make its most likely use an incorrect one.
2. **An action menu is already available.** dropdown-menu implements the APG Menu Button Pattern (trigger + menu popup, roving, Escape, and light dismiss). What menubar adds is a persistent desktop-application-style bar and submenu hierarchy, and demand for that has not been established in TK&F products.
3. **The implementation would be large.** Roving in the menubar row, a state machine that moves to an adjacent item while keeping the menu open, hierarchical submenu opening and closing (Right opens and Left closes, staged Escape closing, and closing all menus when leaving with Tab), and synchronizing aria-haspopup / aria-expanded on menuitems are all new and absent from the existing 23 components.

## Guidance

- **For site navigation,** direct users to a native `<nav>` plus links. For collapsible groups, disclosure (native `<details>`/`<summary>`) is available.
- **If it is created, make it a separate component rather than extending dropdown-menu.** Its role changes from menu to menubar (a menu subclass in ARIA), and its keyboard model changes from one-dimensional wrapping to a two-dimensional state machine. It is also incompatible with dropdown-menu's "one trigger, one menu" markup contract.

## Conditions for reconsideration

Reconsider when a TK&F product needs a menubar for a desktop-application-style UI (an editor or a business-application command bar). Decide whether to include submenus (full APG compliance or one level only), whether to support typeahead / menuitemcheckbox / menuitemradio (dropdown-menu excludes both), and which focus model to use (the APG explicitly specifies roving tabindex for menubar).

## Primary sources

- APG Menubar Pattern (keyboard interactions and submenu rules): https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
- APG menubar-navigation example (discouraging it for site navigation and recommending the Disclosure Pattern): https://www.w3.org/WAI/ARIA/apg/patterns/menubar/examples/menubar-navigation/
- MDN menu role (nav and links for site navigation): https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/menu_role
- WAI-ARIA 1.2 menubar (menu subclass and persistent display): https://www.w3.org/TR/wai-aria-1.2/#menubar
