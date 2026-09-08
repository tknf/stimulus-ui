# Do not create a feed

Do not create a component that implements the APG Feed Pattern's keyboard interactions (role=feed / article, PageDown / PageUp focus movement between articles, and aria-posinset / aria-setsize / aria-busy). The behavior it could add does not meet this library's criteria for a separate component.

## Rationale

1. **It cannot implement article loading and removal.** Under the APG division of responsibilities, the page owns scrolling based on focus position and loading or removing articles based on focus position. Loading cannot belong to the controller because `AGENTS.md` says not to generate content. It has no knowledge of fetch or endpoints.
2. **Additional key handling by a controller is unnecessary.** The APG itself labels feed keyboard interactions as "recommended" because there are no well-established conventions, and its interoperability agreement states that AT in reading mode provides its own keys for moving between articles.
3. **Ctrl+End / Ctrl+Home would require computing tab order for the whole document.** Finding the "first focusable outside the feed" requires document-wide tab-order computation, and the repository has no existing utility for it. Because feed would be the only component using this operation, it also fails the internal-utility extraction threshold of sharing across at least two locations.
4. **The controller cannot know the ARIA values.** Only the server knows the total article count required for aria-setsize, and DOM-order aria-posinset is wrong when earlier articles have not loaded. The controller cannot observe the start and end of multi-step DOM updates required for aria-busy; subscribing to Turbo events would conflict with the policy of not depending on the user's environment.
5. **There is no state the controller can output.** busy / idle cannot be determined without knowing the start and end of multi-step DOM updates, so the controller cannot emit it as data-state.
6. **role=feed is also positioned as a proposal by the APG.** The APG says it is "intended to serve as a proposal" and explicitly notes combinations of browsers and AT that do not support it.

## Conditions for reconsideration

Reconsider when a TK&F product actually needs keyboard support for a feed. Even then, do not include loading; consider only focus movement between articles and a custom event when the end is reached. Decide whether to use roving tabindex or 0 for every item (the APG example uses 0 for every item).

## Primary sources

- APG Feed Pattern (division of responsibilities, key interactions, and the "recommended" status): https://www.w3.org/WAI/ARIA/apg/patterns/feed/
- APG feed example ("proposal", AT support gaps, and `tabindex=0` on every article): https://www.w3.org/WAI/ARIA/apg/patterns/feed/examples/feed/
- MDN feed role (`aria-setsize=-1` and prohibition of mid-feed insertion): https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/feed_role
