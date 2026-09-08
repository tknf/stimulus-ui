# stimulus-ui Project Rules

## What Is This Repository?

Headless Stimulus components shared across TK&F products. **They provide only behavior and accessibility, and have no visual appearance whatsoever.**

They provide four things:

| Provided Item       | Example                  | What It Represents             |
| ------------------- | ------------------------ | ------------------------------ |
| Controller          | `data-controller="tabs"` | Behavior                       |
| `data-*` attribute  | `data-state="active"`    | Discrete state (read by CSS)   |
| CSS custom property | `--splitter-value: 42`   | Continuous value (read by CSS) |
| Custom event        | `tabs:change`            | Extension point for consumers  |

**No class names are provided.** Visual appearance is written by the consumer or held by a CSS design system (in a separate repository). This library does not assume specific CSS, nor does it let the CSS side hold dependencies specific to this library. Whether to combine them is decided by the consumer.

**Output discrete states via `data-*` and continuous values via custom properties.** Dimensions and positions cannot be expressed with `data-*`. This is because CSS `attr()` cannot be used as a numeric value, making it unreadable unless the consumer writes JS. Names follow the pattern `--<component-name>-<meaning>`.

**Output only values to custom properties.** How to use that value (whether to put it in `flex-basis` or `width`) is decided by the consumer's CSS. Do not write layout properties directly to `element.style`. Writing them means the controller decides the layout method, which contradicts the policy of having no visual appearance.

There are three priorities for specifications. Read the relevant sections before starting work. If a component lacks a contract, do not implement it; report the deficiency instead.

| Document              | What Is Written                                |
| --------------------- | ---------------------------------------------- |
| `AGENTS.md`           | Repository-wide rules and work procedures      |
| `design/authority.md` | Order of priority when specifications conflict |
| `design/contracts/`   | Contract per component                         |

Terminology definitions are in `docs/glossary.md`. **This is not a document that determines specifications.** When definitions and rules appear to conflict, prioritize this document and the contract, and fix the glossary.

Consumer-facing documentation shall consist of a single file: `README.md`. Write the four provided items, installation, registration procedures to `Application`, component list, and CSS usage. **Do not write per-component APIs; instead, direct users to contracts as the specification.** Do not handwrite the same content in two places. Inconsistencies between the component list in the README and exports in `src/index.ts` are detected by `vp run check:contracts`. Pages in `catalog/` are for developer verification and are not counted as consumer documentation. Do not direct users there from the README (read "Component Catalog").

**Do not generate the README from contracts.** Because `check:contracts` does not inspect the contract's shape (the shape of `api` / `keyboard` / `stateOutputs`), generation processing relying on the current shape cannot detect contract changes. Registration procedures and HTML examples do not exist in contracts and cannot be created by generation processing. If adopting generation, pair it with adding shape inspection.

**Publish `@tknf/stimulus-ui` to npm under the MIT license from the public `tknf/stimulus-ui` repository.** Keep the package name, repository metadata, `license: "MIT"`, `LICENSE`, and README installation instructions consistent. Do not set `private: true`. Version tags use `v<package version>` and trigger the release workflow, which runs the CI checks, builds the library, and inspects the package before publishing. Configure npm Trusted Publishing for the `release.yml` workflow and the `npm` environment.

Every contract classifies manual checks in `manualVerification.blocking` and `manualVerification.observations` arrays. Each entry records `environment`, `item`, `impact`, and `status` (`verified` or `unverified`); verified entries also record `evidence`. Preserve the distinction between completion requirements and compatibility observations. `vp run check:release-readiness --schema-only` validates these records and the required accessibility criteria in CI. `vp run check:release-readiness` additionally rejects unverified blocking checks before publication. Test this guard with `vp run test:release-readiness`. Do not change a blocking check to an observation merely to publish.

## Technical Prerequisites

- **Dependency is Stimulus only.** Has no other runtime dependencies (Stimulus 3.2.2 itself also has zero dependencies)
- **Specify `@hotwired/stimulus` as `^3.2.2` in `peerDependencies` and exact `3.2.2` in `devDependencies`.** Manage integration scope with consumers and reproducibility during development separately
- **Write in TypeScript and create build artifacts with `vp pack`** (includes DTS generation and package exports generation)
- **Do not use Shadow DOM.** Stimulus attaches behavior to consumer-written HTML
- **Do not generate inner content.** Controllers retrieve consumer markup via targets and set listeners or attributes. Do not assemble `innerHTML`
- **Do not depend on the consumer's environment.** Regardless of what the server is, the same code runs with or without Turbo

Turbo is not assumed, but **operating under Turbo is a requirement**. Do not omit removal of listeners or subscriptions in `disconnect()`.

## How to Use Stimulus

- **Use `targets` to retrieve elements.** Do not write `querySelector` directly. Do not rewrite by hand what Stimulus manages for connection and disconnection
- **Use `values` to receive settings.** `static values = { orientation: { type: String, default: "horizontal" } }`. Do not parse attributes by hand
- **Use `outlets` for cross-controller references**
- **Track dynamically added/removed elements with `[name]TargetConnected` / `[name]TargetDisconnected`.** These are called **before** `connect()`
- **`initialize()` is called once; `connect()` / `disconnect()` are called on every connection.** To prevent double registration on reconnection, register subscriptions in `connect()` and always unsubscribe in `disconnect()`

## Whether to Create in the First Place

**Do not create components that have no client-side behavior.**

This library attaches behavior to consumer-written HTML and does not generate markup. Therefore, correct markup itself does not become a distributed artifact. A controller that only attaches static attributes merely executes via JavaScript at runtime what the consumer could simply write directly in HTML.

Create only when it falls under any of the following:

- There is state that changes over time
- Focus or selection moves via key operations
- It opens and closes
- It calculates and outputs values unreadable by CSS (such as `<input>` value)

If it fits none of these, do not create a controller. **Record the decision not to create it in `docs/plans/decision-<name>.md`.** Breadcrumb and pagination were decided not to be created based on this judgment. `decision-<name>.md` is limited to records after individual proposals and discussions. Things mechanically excluded from criteria by matching against external library lists should not have files created; record the reason for judgment in the issue where matching was performed.

**Do not rewrite how to write correct markup in this repository.** Explaining how to write non-distributed components merely duplicates APG or MDN and cannot keep up with APG or MDN updates. Point to primary information from decision records.

**Do not create components that consist solely of behaviors natively provided.** Do not use browser-implemented features, like arrow key navigation in native `<input type="radio">`, as a reason to create a controller. Create a controller only when adding behaviors not present natively.

**Things that can be written using only features already provided by the Stimulus dependency itself are treated the same as native and are not created.** App-wide shortcut assignment can be written using Stimulus KeyboardEvent filters (with modifier keys) and global listeners (`@window`), so hotkey was decided not to be created based on this judgment.

**When the argument is whether a composite of existing components can serve as a substitute, actually write the composite and judge based on "whether it is a complexity consumers can write by hand."** If it is a complexity writeable by hand, do not create it; record combination examples in decision. If it is too complex, identify unique differences not in the composite and create it.

### Whether to Make a Separate Component or Extend an Existing Component

**If the role changes, make it a separate component; if it does not change, extend the existing component.**

If the role changes, AT handling changes, making it a different thing from the consumer's perspective. `grid` enters application mode in AT with `role="grid"`, but `table-sort` can be read through as a native `table`. These two should be separate components.

On the other hand, whether a slider has one thumb or two, the role remains `slider`, and it does not become a different thing from the AT perspective. This is a configuration difference of the same component, so extend it.

Making a separate component requires consumers to decide which to use before implementation. When requirements expand later, the entire component must be replaced. **Separate only when roles are truly different.**

### How to Name Components

The component name becomes the Stimulus identifier and expands into `data-<identifier>-<name>-value` and `data-<identifier>-target`. **Decide after confirming generated attribute names as well.**

- **If there is a role, match it.** `listbox`, `toolbar`, `tree`, `grid`, `slider`, and `dialog` all share the same name as their role. The role written in markup by the consumer and the controller name match
- **Things extending native elements should be `<target>-<type>`.** `password-field`, `number-field`. Native holds the role, so do not use it in the name. This form is limited to when the component's state is the value itself of that native element. If state is outside the element (the state of `tag-input` is a chip sequence, and input is a means to add tags), do not use `*-field`; decide by "what controller it is attached to"
- **Do not start with `data-`.** If identifier is `data-grid`, attributes become `data-data-grid-...`
- **Do not use APG pattern names as-is.** Especially so when actual state differs. A component extending `<input type="number">` is different from the APG Spinbutton Pattern pointing to a custom widget with `role="spinbutton"`, so it was named `number-field`
- **Prioritize clarity on what controller it is attached to over brevity.** However, take into account the extra length of attribute names. `sort` leaves it unclear what is being sorted, while `sortable-table` is longer than `table-sort`

## Who Writes ARIA

Divide attribute handling into four categories. **Decide which category applies in the contract before implementation.** Treat static attributes that consumers should write (`scope`, `popover`), not limited to ARIA, under the same rules.

| Type                                                                                                                        | Controller Behavior                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Attributes synchronized with state/settings (`aria-expanded`, `aria-selected`, `aria-orientation` derived from value, etc.) | **Write them.** Do not issue warnings. Reflecting state and setting values to attributes is the controller's responsibility               |
| Static attributes whose meaning the library knows (`role`, ARIA representing relationships, `scope`, `popover`)             | **Supplement and issue `console.warn`.** If the consumer has written them, respect them and do not issue warnings                         |
| Attributes necessary for controller operation (`id` assignment, `tabindex`, composition into `aria-describedby`)            | **Write them without issuing warnings.** Attributes that have meaning only when using the controller, not a deficiency in consumer markup |
| Information the library cannot know (content of `aria-label`, heading levels)                                               | **Do not supplement.** If missing, issue a warning and disable enhancement                                                                |

The presence or absence of `hasAttribute` guards alone cannot distinguish types. Reflecting setting values and attributes necessary for controller operation also have guards (respecting values written earlier by consumers). Which attributes fall into which category is held by `completion` / `completionExempt` of `contractValidation` in each contract.

**Issue warnings only once per connection.** Track completion warnings separately from enhancement-disabling warnings so consumers can distinguish them. **Write warning messages in English, preserving identifiers, attribute names, and values.** Use `<identifier> controller: Added <attributes>. Include them in your markup.` for completion and `<identifier> controller: <expected markup and violation>. Enhancement has been disabled.` for invalid markup.

## How to Build Components

- **Write the contract before implementation.** The component contract is `design/contracts/<name>.contract.json`
- **Add `catalog/<name>.html` and `test/catalog_scenarios/<name>.ts` in the same task as implementation.** `vp run check:contracts` detects deficiencies. Read "Component Catalog" for how to write them
- **1 concept = 1 controller = 1 definition**
- **Output state via `data-*` attributes** (e.g., `data-state="active"`). Consumer CSS reads this to change visual appearance. Do not add or remove class names
- **Output `data-state` to root only when the entire component assumes a single state.** For details, read "Whether to Output State to Root" below
- **Set ARIA within the scope defined as controller responsibility in the contract. When supplementing static attributes, convey via `console.warn`.** Supplementing without issuing warnings prevents consumers from noticing markup deficiencies, leaving HTML lacking required attributes when removing this library. For details, read "Who Writes ARIA"
- **Do not overwrite attributes and `id` written earlier by consumers.** Respect existing values and supplement only what is missing
- **When assigning `id`, ensure no collisions within the page.** Ensure it does not break even if two or more of the same component exist
- **Assume semantic HTML.** Pressable elements are `<button>`. Attaching `role="tab"` to a `<div>` will not restore focus, key operations, or `disabled` natively
- **`disabled` reads native attributes.** CSS can be written with `:disabled`, so do not add extra `data-*`
- **Handle direction logically.** In `dir="rtl"`, invert horizontal arrow keys to match visuals
- **Align internal names across all components.** Do not assign different names to the same role

| Role                                    | Name                      |
| --------------------------------------- | ------------------------- |
| Connected flag                          | `connected`               |
| Enhancement enabled flag                | `enhanced`                |
| Warned flag (disabled)                  | `warningIssued`           |
| Warned flag (completion)                | `completionWarningIssued` |
| State output                            | `syncState`               |
| State commit without dispatching events | `commit*`                 |

`isValidMarkup()` is a method inspecting markup, while `enhanced` is a field holding the result; they are different things. Do not use the same name for both.

### Whether to Output State to Root

**Output `data-state` to root if the entire component assumes a single state. If state is divided per item, output to items and not to root.**

| Output to Root                       | Do Not Output to Root               |
| ------------------------------------ | ----------------------------------- |
| Opens/closes (dialog, disclosure)    | Which item is selected (tabs)       |
| On / off (switch)                    | Which item is open (tree)           |
| Whether value is at extreme (slider) | Which cell it is in (grid)          |
| Displaying or not (toast, tooltip)   | Holds no state (toolbar, clipboard) |

**Do not aggregate item states into root.** Aggregations like "is one or more open" can be derived by consumers using CSS `:has()`.

```css
.accordion:has([data-state="open"]) {
  border-color: var(--accent);
}
```

Controllers output only what CSS cannot derive. This standard is identical to the standard for outputting continuous values via custom properties. If the controller writes even what CSS can derive, output merely increases while consumer choices decrease.

## API for External Usage

Enable consumer JS to manipulate components.

| Layer              | Purpose                                                | Example                           |
| ------------------ | ------------------------------------------------------ | --------------------------------- |
| `values`           | Provide initial values from HTML                       | `data-tabs-value-value="plan"`    |
| Properties/Methods | Read and write from JS                                 | `controller.value = "log"`        |
| Custom events      | Notify changes / allow cancellation immediately before | `tabs:change` `tabs:beforechange` |

- **Event names are `<component-name>:<verb>`.** Switching tabs is `tabs:change`; closing dialog is `dialog:close`. Follow Stimulus conventions (`clipboard:copy`). Since component name is included in the name, nested components of different types can be identified
- **However, when nesting components of the same type, inner events also reach outer listeners.** If receiving on the outer side, narrow down with `event.target === event.currentTarget`. For Stimulus actions, use the `:self` option
- **Make events with `before` cancelable.** Operation itself can be stopped with `preventDefault()`
- **Align characteristics across all components.** `<component-name>:before<verb>` is cancelable; `<component-name>:<verb>` is notification. Both have `bubbles: true`
- **Dispatch `before` events only when initiated by user operation.** Method calls and property assignments execute commit only and do not dispatch `before` events. Dispatching them would cause infinite loops when called inside listeners
- **Do not dispatch events on programmatic changes.** Follow the same rule as `input.value`. The caller already knows the change result
- **Put the trigger in `detail.reason`.** `"pointer"` (click), `"keyboard"` (key operation), `"timer"` (time elapsed). Method calls and property assignments do not dispatch events themselves, so they hold no value representing them
- **Judge synthetic events via `isTrusted` and ignore them.** The rule of dispatching events only when initiated by user operation cannot be maintained without looking at `event.isTrusted`. `HTMLElement.click()` also results in `isTrusted` being false
- **Export `detail` types prefixed with the component name.** `TabsChangeDetail`, `ClipboardCopyDetail`. Export from `src/index.ts` in the form `export type { TabsChangeDetail } from "./tabs_controller"`. Names like `ChangeDetail` collide between components. **If `before` and normal `detail` share the same shape, a single type suffices** (`tabs:beforechange` and `tabs:change` both use `TabsChangeDetail`)
- **Enumerate values, methods, and events in the contract's `api`**

## Extracting Internal Utilities

- **Do not over-abstract.** Do not extract mere few-line similarities. Extract into an internal utility only when two or more places share the same invariants and failure conditions, needing bulk fixes upon modification
- Place utilities not meant as public APIs under `src/internal/`. Do not collect operations with different purposes and invariants into a generic `dom_utils`
- Enumerate all usage locations and differences per location before extraction. A single owner creates the utility and migrates all callers in 1 task, removing old implementations after migration
- Maintain existing behavior during extraction, confirming detection of common invariants via unit tests of each caller, tests targeting multiple components, and `negative control`
- Common invariants for ID assignment utilities are: retaining existing `id`, using the target element's `ownerDocument`, and avoiding collisions with existing IDs within that document
- Locally update only necessary parts when modifying existing files; do not replace by Delete+Add of all contents. When moving files, verify contents before and after move are identical
- If loss of source or unintended full replacement is detected during work, suspend editing. Verify immediately preceding contents, restore them, and then resume

## Accessibility

**This library bears implementation of ARIA and keyboard navigation.** Consumers can write mere behavior, but properly implementing ARIA and keyboard navigation is difficult.

- **Make WCAG 2.2 AA a mandatory requirement for all components.** Do not create exceptions. Write in contract acceptance criteria
- **Explicitly state items to achieve for AAA.** W3C itself states "It is not recommended that Level AAA conformance be required as a general policy for entire sites" (since certain content cannot theoretically satisfy criteria). Merely stating "aiming for AAA" cannot be verified

The two AAA criteria to achieve are as follows. **Both are mandatory requirements for all components, written in contract `acceptanceCriteria`.**

| Criterion                         | Meaning in This Library                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **2.1.3 Keyboard (No Exception)** | Has no features reachable only via pointer. Components with drag must provide keyboard operation equivalents |
| **3.2.5 Change on Request**       | Controller moves focus only via user operation and calls from consumer JS. Do not move focus via timer       |

2.1.3 removes the exception of "path-dependent input" from AA 2.1.1. Splitter can be dragged via pointer capture, but identical operations are possible with arrow keys, Home, End, and Enter. Carousel excludes swiping.

"Changes of context" in 3.2.5 refers to four things: user agent, viewport, focus, and content changing page meaning. **WCAG explicitly states that content changes like tab control are not context changes unless these four change**, so automatic activation in tabs does not apply.

Do not make AAA other than these mandatory. 1.4.6, 1.4.8, 1.4.9, 2.4.13, and 2.5.5 are decided by CSS; this library, lacking visual appearance, can neither satisfy nor violate them. 2.4.8, 2.4.9, 2.4.10, and 3.1.x are decided by content; this library does not generate inner content.

- **Write keyboard operations in contract.** If following APG patterns, explicitly state which pattern
- **For features executable by drag, provide paths executable by click/tap alone (WCAG 2.2 AA 2.5.7).** Keyboard equivalent operations alone do not satisfy this criterion. Explicitly state necessary native control and consumer markup conditions in contract, directly testing non-drag pointer paths via catalog and browser tests
- **Do not let ARIA attributes be used as CSS selectors.** Output state separately via `data-*`. ARIA attributes and values are fixed by specifications; ensure accessibility-related changes do not affect visual appearance
- Do not conclude screen reader verification in Chromium devtools. Real screen reader verification takes place on `catalog/` pages ("Component Catalog"). Classify verifications unexecutable by automated tests as `blocking` or `observation` in plans and contracts. `blocking`, whose results alter adoption, public APIs, ARIA, markup, or acceptance criteria, shall not be completed until real device results are obtained. Treat compatibility observations whose public specifications do not depend on results as `observation` only; if proceeding unverified, leave in contract and completion report

## Verification

- **Always take `negative control`.** Break implementation guards and verify **targeted tests fail**. Tests without this cannot be judged on their ability to detect guard violations
- **Failing tests are not limited to one.** Shared invariants (state output, id assignment, etc.) are legitimately detected by multiple tests. If all failing tests monitor the same invariant, consider it passed. Revisit test implementation only when unrelated tests fail
- **Independent multiple guards cannot be detected by breaking one at a time.** Because removing one leaves the other protecting. Write sets to break simultaneously as mutations
- **Even if it starts failing independently, do not delete mutations that break simultaneously.** That guards are independent is a property of implementation and does not change even if test implementation changes
- **When a mutation fails to break targeted tests, suspect the test rather than implementation.** Detection leaks have typical causes

| Cause of Detection Leak                                                                   | How to Fix                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disconnecting via `root.remove()` or removal of `data-controller`                         | Stimulus cleans up along with target, so test succeeds even if `disconnect()` is empty. Call controller methods directly while keeping element in DOM |
| Verifying retention of existing attributes with the same value supplemented by controller | Value does not change even if guard is broken. Place values **different** from controller-written values in authored attributes                       |
| Sending trusted click to disabled element                                                 | Browser does not deliver click, failing to reach controller guards. Make `disabled` during click capture phase                                        |
| Creating synthetic click via `element.click()`                                            | `detail` becomes 0, and guards checking `detail` reject earlier, never executing `isTrusted` guards. Use `new MouseEvent("click", { detail: 1 })`     |

- **Align mutation description with actual behavior.** Mutations crashing due to out-of-bounds access fail unrelated tests, obscuring judgment of "whether monitoring the same invariant." If "stopping at boundary," clamp it
- **Mutations breaking shared utilities fail together across a scope of tests sharing the same invariant; write to `expectedFailure` after measuring actual scope.** What fails cannot be known at the time of writing
- **Place shared utility mutations in only one consumer contract.** Placing in both causes duplication where two mutations break the exact same line. Placements are: `ensure_element_id.ts` in tabs, `listbox_navigation.ts` in listbox, `roving_navigation.ts` in tabs, `typeahead.ts` in listbox, and `ime.ts` in listbox
- **Place verification in the repository.** Do not end after running in temporary areas. Maintain a state where the next rule violation can be detected
- **Automated browser tests execute 3 engines (Chromium, Firefox, WebKit) via Vitest Browser Mode + Playwright.**
- **Do not draw conclusions from Chromium alone.** Verify across multiple engines
- **Collect engine-specific behavior differences and workarounds in `docs/notes/browser-engine-differences.md`.** Read before deleting workarounds
- **Among unaligned implementations per component, collect intentional ones in `docs/notes/intentional-differences.md`.** Read before attempting alignment
- **Write "unverified" for unconfirmed items.** Do not pretend it worked

### Component Catalog

In `catalog/`, place pages openable and operable in browsers for each published component. Positioned identically to Storybook, **it is for developer verification and not consumer documentation.** Verify items checkable only visually (arrow key direction in `dir="rtl"`, output of `data-state` and custom properties, screen reader readout) here.

- **How to open: `vp dev --open /catalog/`.** Build is unnecessary. Pages directly import `src/index.ts`, avoiding dependency on `dist/` freshness. Do not write `server.open` in `vite.config.ts`. Because Vitest browser mode reads the same config, avoid bringing side effects into `vp test`
- **Pages are handwritten.** Contract `authorMarkup` is prose and does not serve as generation input
- **1 component = 1 page (`catalog/<name>.html`).** Place `<section>` per configuration permitted by contract. Write only component name, configuration heading, and markup on pages; do not write API descriptions. Specifications reside in contract
- **Do not place invalid markup.** Page markup must be complete, triggering neither completion nor disabling. Catalog tests in `test/` inspect root connection and absence of `console.warn` across all pages, while `vp run check:contracts` inspects correspondence between public controllers and pages. Disabling behavior is inspected by per-component tests
- **Pages cover contract state outputs, events, and keyboard.** Declare target coverage in `<main>` via `data-catalog-states`, `data-catalog-properties`, and `data-catalog-events`. `vp run check:contracts` inspects collation between declarations and contracts (event names match keys in contract `api.events`; custom property names are picked from `api`, `managedMarkup`, and `stateOutputs`. Because `data-state` values differ per component in contract writing and cannot be mechanically extracted, declarations are treated as canonical and collated in audits), presence of CSS for declared state outputs, and presence of key names from contract `keyboard` in `test/catalog_scenarios/<name>.ts`. `test/catalog_behavior.test.ts` operates pages via scenarios, verifying across 3 engines that the observed set of states, custom properties, and events encompasses declarations. For items unreproducible in headless mode, write engine and reason in scenario `skips`. Merely connected pages do not count as coverage
- **Perform negative controls manually when altering catalog inspections, recording results in issues.** Contract `negativeControls` are dedicated to `src/` mutations; mutations breaking catalog CSS, declarations, or scenarios cannot be placed there
- **Specify controller method calls from buttons in markup via Stimulus `data-action`.** TS in `catalog/` handles only controller registration and generic event logging (`catalog/event_log.ts`) reading page declarations to record events in `<ul class="catalog-events" role="log">`, writing no per-component processing. `catalog/register.ts` manually enumerates mappings between identifiers and controllers
- **CSS consists of a single file `catalog/catalog.css`, giving visual appearances capable of distinguishing all contract state outputs.** Outputting value names via `::before { content: attr(data-state) }` is sufficient. It is not a recommended style; do not write decorations. Selectors are written with catalog-specific classes. Do not include in `src/` or build artifacts
- **Do not perform processing designated as consumer responsibility.** Items designated by contract as consumer domain, such as combobox filtering or table-sort sorting body, should place static markup only to the extent required

## Tools

- Package operations and script execution treat **`vp` (vite-plus) as primary choice**. Use pnpm only when vp is insufficient. Do not use npm / yarn
- Type checking, linting, and formatting use `vp check`. Library builds use `vp pack`
- Read `package.json` scripts before directly invoking tools

## Common Conventions for Code and Tests

- Write repository documentation, comments, diagnostics, and test names in English. Preserve technical identifiers and genuine locale-specific test data. Respond to the maintainer and write commit messages in Japanese unless explicitly requested otherwise
- Use arrow functions for JavaScript / TypeScript functions. Use Mermaid when diagrams are needed; do not use ASCII art
- Choose minimal solutions. Do not add architecture for hypothetical future requirements or premature abstraction of operations lacking identical invariants
- In TypeScript, do not use `any`, `as unknown as`, or non-null assertions (`!`); resolve via type guards, generics, and null checks
- Add types to external-derived values such as `JSON.parse()`, validating if possible. Use `as const` instead of `enum`, prioritizing `satisfies` over type annotations
- Test functions use `test` instead of `it`, with describe / test names in English. Do not increase mocks when actual dependencies are usable
- Generate test data via factory functions, prioritizing execution of targeted tests over the entire suite during verification

## Referencing Latest Documentation

- Treat pre-trained knowledge of models as outdated. Do not write APIs/configurations of external libraries (Stimulus, vp, etc.) from memory alone
- Places to verify: type definitions and READMEs of installed packages, official documentation (stimulus.hotwired.dev, viteplus.dev), CLI `--help`
- **This verification obligation applies to Web Platform specifications themselves** (HTML / JS behavior, browser implementation differences). Do not assert "because it is like this per spec" from memory; verify via specification documents or actual browsers
- ARIA and DOM behavior should be verified via WHATWG HTML Standard, W3C specifications, and MDN. Do not take compatibility tables at face value for browser implementation differences; verify on real devices if possible

## Write Facts, Not History, in Comments and Documentation

Write only "how it is now" and "why it is designed so (technical reasons valid today)" in comments and documentation. **Do not write history of changes.** History is borne by git commit messages.

- Keep = Facts: What current code does. Invariants and cautions
- Delete = History: Dates, issue numbers, "Old X -> New Y", "Previously", "Formerly", "Remnants"
- Delete = Defensive explanations against flawed ideas: Explanations of handling situations that would not occur if properly designed
- Write in English. Preserve technical terms and identifiers. Avoid metaphors and ornate paraphrasing
- **Do not use words whose meaning is unclear.** Rather than placing abstract placeholders, list concrete examples
- **Use established technical terminology consistently.** Describe document precedence, decisions, scope, and event emission directly
- Describe listener registration, attribute assignment, and element relationships explicitly rather than combining them under a vague term

**Update documentation rather than appending.** Rewrite relevant sections when specifications change. Rather than appending "... is deprecated", delete deprecated descriptions themselves.

## Work Flow

Set the GPT-6 Astra primary session as the task owner. The primary session handles standard research, planning, implementation, fixes, verification, and integration consistently, without splitting into phase-specific agents or handoffs.

- $issue advances an issue or request from research through target verification. Do not call $plan, $impl, review, and wrapup sequentially internally.
- Use $plan when only planning is requested. For adding components, finalize the contract before implementation.
- Use $impl standalone when implementing an existing plan, issue, or request.
- Do not maintain review or wrapup Skills. The primary session performs standard diff checks, fixes, and final decisions.
- Perform issue creation/editing/closing, staging, committing, pushing, and releasing only when explicitly instructed by the user.

The primary session decides matters uniquely determined by conventions and primary sources. Ask the user only when acceptance, public APIs, acceptance criteria, scope of work, or product/legal/security/privacy policies change. Do not implement public specifications while undecided.

Do not implement components without a contract. Small bug fixes or localized changes do not require a plan file; the request and contract can serve as the implementation specification. Record in docs/plans/ only when architectural decisions span multiple locations or need to be passed to subsequent implementations.

### Handling Verification

Scale verification according to change risk. When runtime or browser behavior is modified, execute the target tests or scenarios in Chromium, Firefox, and WebKit, and perform the corresponding negative control and contract checks. Run the repository-wide 3-engine test only once against a stable final diff when cross-cutting runtime changes or explicit user requests require it.

Reuse successful verifications for identical content if relevant inputs have not changed. Do not rerun tests simply because phase names like stage, commit, or review have changed. After fixes, rerun only the affected target verifications, and do not restart the entire test suite from the beginning. If verification repeatedly toggles the same design decision, do not shuttle changes back and forth; identify the conflicting rule or expectation and halt.

Use a reviewer only for explicit user requests, complex public specification changes, or high-risk security/accessibility changes. When fixing issues after an initial audit, limit re-audits to verifying original findings and direct dependencies exactly once. Do not repeat iterations adding new findings until passing; the primary session retains final judgment.

### Changes to Agent Harness

When modifying AGENTS.md, .agents/skills/, .codex/agents/, or scripts/check_workflow_safety.mjs, run vp run check:workflow-safety and vp check. For harness- or document-only changes, do not run repository-wide product code tests or negative controls.

### Mutual Exclusion in Shared Worktrees

Keep only one write-enabled role at any time. The primary session is the normal writer and must not edit the same paths while delegating to a worker. If an update of unknown provenance is found, neither edit nor revert it; confirm whose work it is before resuming.

### Naming Plan Files

Distinguish file types in `docs/plans/` using prefixes.

| Prefix       | What kind of plan                                                           | Example                      |
| ------------ | --------------------------------------------------------------------------- | ---------------------------- |
| `component-` | Plan for writing a component contract                                       | `component-number-field.md`  |
| `chore-`     | Plan for cross-cutting work, fixing inconsistencies, expanding verification | `chore-negative-controls.md` |
| `decision-`  | Record of deciding not to build                                             | `decision-breadcrumb.md`     |

Do not use numbers. The order of execution changes depending on decisions and dependencies, causing numbers to desynchronize with actual execution order. Creation order can be checked via git history.

**Delete `component-` plans once the contract is finalized and implementation passes.** Because all decisions are transcribed into the contract, keeping them creates duplicate management. Delete `chore-` plans once work is completed.

**Before deletion, move statements unique to the plan into other documents.** Move unconfirmed items to the contract's `acceptanceCriteria`, conventions applying to multiple components to `AGENTS.md`, and deliberate differences that should not be aligned to `docs/notes/`. Deleting without transcription will cause the same points to be raised again in the next audit.

**Do not delete `decision-` plans.** Records of deciding not to build prevent the same proposals from being repeated.

## Git / GitHub

**Perform standard changes in a working branch and do not push directly to main.** Follow the naming rules below for branch names, and check differences against base and remote before sharing.

Invoking $issue, $plan, or $impl alone does not authorize staging, committing, pushing, PR creation, or issue operations. Perform only explicitly specified user operations, and avoid force pushes in principle even upon explicit request.

**Always explicitly specify paths to stage. Do not use `git add -A` or `git add .`.** In a shared worktree, files you have not touched may be changing simultaneously. Because `check:negative-controls` modifies `src/` while applying mutations, executing `git add -A` at that point will **commit sources with active mutations applied**. Files being modified by other workers will also be staged together.

**Verify that unintended changes are not included after committing.** Check both the working tree and HEAD to ensure that `find` for all contract `negativeControls` appears exactly once in target files. Checking only the working tree is insufficient. Because the inspection's `finally` block restores the disk, mutation changes might remain only in HEAD.

### How to Write Issues

Write issue bodies and comments as self-contained statements that make sense on their own 10 years later to someone who did not witness the live conversation. Follow the order: "What is happening" -> "Why it is a problem" -> "What to do" -> "Rationale". Write file names and identifiers specifically, and do not use relative dates. Read all previous comments before commenting, and do not report previously discussed points as new discoveries. Limit progress comments to five events: commencement, critical decisions, blocking issues, audit results, and completion. Close issues when changes are reflected in `main` and verifiable by the reporter.

### Branch Naming (When Creating)

Use the format `<prefix>/issue-<number>_<name>`. Use the date in `yyyymmdd` format only when there is no issue. Use 2 to 4 hyphen-separated lowercase words for the name to describe the work. Select from 10 prefixes: feat / fix / hotfix / refactor / test / style / docs / chore / revert / release; when spanning multiple, choose by the primary nature of the change. Use alphanumeric characters only (`#` cannot be used, so write issue numbers like `issue-12`).

For $issue, the primary session consistently handles tasks from research through target verification. Use $plan for planning only, and $impl solely for implementing finalized plans.

## In-Session Subagents

Use only three types of subagents: researcher, reviewer, and worker. The GPT-6 Astra primary session handles standard research, planning, implementation, fixes, verification, and integration; do not launch subagents whose necessity cannot be justified.

| Agent      | Use case                                                                                        | Boundaries                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| researcher | Needs to independently research broad codebases, external specs, or browser behavior            | Read-only. Does not edit, launch other agents, or access secrets.                    |
| reviewer   | Explicit user request, complex public spec changes, or high-risk security/accessibility changes | Read-only. Initial audit and at most one focused re-audit.                           |
| worker     | Bulk work where exclusive paths and detailed mechanical instructions can be provided            | Modifies only specified paths; does not make spec decisions, stage, commit, or push. |

Keep only one write-enabled agent at a time. The primary session must not edit the same path while a worker is running. Do not add task-ids, heartbeats, state files, handoff schemas, or result-collection scripts for subagents to the repository.

Restrict reviewer findings to reachable bugs or concrete risks. Separate discretionary improvements as non-blocking. In post-fix re-audits, verify only original findings and direct dependencies, without adding new non-critical points.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
