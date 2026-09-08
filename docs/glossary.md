# Glossary

Definitions of terms used by this repository's documents and contracts.

**This file contains definitions only.** Rules are in `AGENTS.md`, and component specifications are in `design/contracts/<name>.contract.json`. When a definition appears to conflict with a rule, follow `AGENTS.md` and the contract.

## Design terms

### Component

A controller that corresponds to one concept, together with its specification. A component consists of the following four locations.

| File                                    | Role           |
| --------------------------------------- | -------------- |
| `design/contracts/<name>.contract.json` | Specification  |
| `src/<name>_controller.ts`              | Implementation |
| `test/<name>.test.ts`                   | Tests          |
| One line in `src/index.ts`              | Public export  |

`<name>` is the component name and matches the Stimulus identifier. Naming rules are in the "Component naming" section of `AGENTS.md`.

### Behavior

Something that changes over time and that a controller adds to the user's markup. The term applies only to something that meets at least one of the following conditions.

- It has state that changes over time.
- Key input moves focus or changes a selection.
- It opens or closes something.
- It calculates a value that CSS cannot read.

Something that only adds static attributes is not behavior. This distinction determines whether a component should be created at all.

### Enhancement

The state in which a controller is connected and has added behavior.

When markup does not satisfy its contract, the controller **disables enhancement**. It does not register listeners, write ARIA, emit state output, or operate the native control. It only calls `console.warn`, does not throw, and leaves the user's markup unchanged.

This means that the controller chooses to do nothing, rather than that the controller is broken and cannot work.

### State output

A **discrete** state emitted by a controller for the user's CSS to read. It takes the form `data-state="active"`.

Continuous values such as dimensions and positions are not state output. CSS cannot use `attr()` as a number, so users could not read such values without writing JavaScript. Continuous values are emitted as CSS custom properties (for example, `--splitter-value`).

The contract's `stateOutputs` defines the values for each component.

### Controller-owned

An attribute whose value is determined by the controller and normalized to match the state even when the user has authored a value. The contract's `stateOutputs.ownership` lists these attributes for each component.

For attributes outside this category, the controller respects an existing user-authored value and does not overwrite it.

### Specification precedence

The order that determines which source prevails when documents or implementations conflict. `design/authority.md` orders them as `AGENTS.md`, the contract, and then the implementation and tests. The implementation and tests follow `AGENTS.md` and the contract.

### Contract

A component's specification written in JSON. It is written before the implementation. Its main keys are as follows.

| Key                  | Defines                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `authorMarkup`       | User-authored markup: root, targets, and relationships                                   |
| `contractValidation` | Conditions the markup must satisfy and rules for disabling enhancement when it does not  |
| `api`                | `values`, `properties`, `methods`, and `events`                                          |
| `keyboard`           | Focus model and key input, including the APG pattern followed                            |
| `managedMarkup`      | Attributes written by the controller, preservation of existing values, and ID generation |
| `stateOutputs`       | Values available through `data-*` and custom properties, and ownership                   |
| `lifecycle`          | Tracking dynamic target changes and preventing duplicate registration after reconnection |
| `acceptanceCriteria` | Acceptance criteria, including WCAG 2.2 AA and unverified items                          |
| `testMatrix`         | Items to verify                                                                          |
| `negativeControls`   | Mutations that break the implementation to verify test detection power                   |

### Plan

A work plan stored in `docs/plans/`. Plans are divided into three types by prefix.

| Prefix       | Plan type                                    | When it is removed                                          |
| ------------ | -------------------------------------------- | ----------------------------------------------------------- |
| `component-` | Plan for writing a component contract        | Once the contract is complete and the implementation passes |
| `chore-`     | Cross-cutting work plan                      | Keep until the work is complete                             |
| `decision-`  | Record of a decision not to create something | Never remove                                                |

The plan's "Decisions" section lists issues to resolve before handing work to implementation. If unresolved issues are handed over, the design can be overturned after implementation is complete.

## ARIA terms

ARIA is divided into three categories. **Determine the category in the contract before implementing it.** Check the contract's `contractValidation.completion` and `completionExempt` to identify the category.

### State-synchronized ARIA

Attributes such as `aria-expanded` and `aria-selected` that directly reflect state held by the controller. **Always write them and do not warn.** Synchronizing them is the controller's responsibility.

### Completable ARIA

Static attributes such as `role` whose correct value is known to the library. **Complete them and call `console.warn`.** Respect an existing user-authored value and do not warn in that case.

Completing them without a warning would prevent users from noticing the missing markup, leaving HTML without required attributes when this library is removed.

### Unknown ARIA

Values such as the content of `aria-label` and heading levels that the library cannot determine. **Do not complete them.** If they are missing, warn and disable enhancement.

## Verification terms

### Negative control

A mechanism that deliberately breaks an implementation guard to verify that **the intended test fails**. Without this check, it is impossible to determine whether a test can detect a guard violation.

Record it in the contract's `negativeControls` and run it with `vp run check:negative-controls`. Add `--test-id <testId>` to run only one case.

It runs **only tests that import the mutated file**, with the scope determined from the module graph by `vitest related`. If the intended test is outside that scope, stop without producing a result. Confusing "did not fail" with "did not run" could mark a run as successful while omitting the required test.

### Mutation

A rewrite applied mechanically to source by a negative control. Each case has the following shape.

| Key               | Content                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `testId`          | Identifier of the test that should fail                                                      |
| `guard`           | The guard being broken                                                                       |
| `mutation`        | `description`, `file`, and `replacements` (pairs of `find` and `replace`)                    |
| `expectedFailure` | What actually fails; when several tests fail, record here that they check the same invariant |

`find` must match the target file **exactly once**. The check fails for zero matches or multiple matches.

Make the mutation's `description` match its actual behavior. A mutation described as "stop at the edge" that actually throws a TypeError can fail unrelated tests, making it difficult to determine which condition was tested.

### Independent multiple guards

Two or more guards that separately protect the same result. **Breaking them one at a time cannot be detected** because the other guard still protects it. Record the pair that must be broken together as one mutation, and keep separate mutations that break each one individually (to show that either one alone does not fail).

### testId

An identifier embedded in a test title in the form `[listbox-root-validity-negative]`. The contract's `testMatrix` and `negativeControls` use it to refer to tests. `vp run check:contracts` verifies the correspondence.

### Three engines

Chromium, Firefox, and WebKit. Browser automated tests run all three with Vitest Browser Mode + Playwright. **Do not draw conclusions from Chromium alone.**

`vp run check:negative-controls` runs on Chromium alone. It measures mutation detection power, not differences between engines.

### Scoped validation / full validation

Scoped validation verifies the changed behavior and its direct dependencies. Full validation verifies the entire repository. Use scoped validation normally; run full validation once against the stable final diff only for cross-cutting runtime changes or when explicitly requested. Determine completion from the file state and command results.

### Unverified

Something that has not been checked. **Do not claim that it worked.** Record it as "unverified" in the contract's `acceptanceCriteria` and in the plan. Screen reader checks on real devices, engine differences, and verification against primary specifications commonly belong here.

When removing a plan, verify that every unverified item found only in the plan is recorded in the contract's `acceptanceCriteria`.

## Work terms

### Primary session

The GPT-6 Astra primary session is the task owner and handles ordinary research, planning, implementation, fixes, verification, and integration as one continuous effort. `$issue` advances through these activities without splitting them into phases. Use `$plan` when only planning is requested, and `$impl` when implementing an approved plan or request.

### Codex implementation procedure

The implementation procedure executed by `$impl`. It includes the goal, files that may and may not be touched, existing patterns to follow, completion conditions, prohibitions, and reporting requirements. Do not use deadlines, heartbeats, or phase handoffs.

### Review

An independent audit performed by a read-only reviewer for an explicit user request, a complex public specification change, or a high-risk security or accessibility change. It ends after the initial audit and, when needed, one focused re-audit of the original findings. The primary session performs ordinary diff review and makes the final decision.

### Ownership

Instructions list the files that may be touched so that multiple contributors do not edit the same file. **Owned paths** are the files that only that contributor may edit. Other contributors do not edit or revert them.

### Shared worktree

The primary session and subagents use the same worktree. They do not write at the same time. Normally only the primary session edits; when an exclusive path is delegated to a worker, the primary session does not edit that path until the worker finishes. Audits begin after the writer finishes and the diff is stable.

### Provenance

Information that identifies who or what made a change. **Stop writing when an update has unknown provenance.** Do not edit or revert it; identify whose work it is before resuming.
