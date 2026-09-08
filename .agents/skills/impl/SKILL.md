---
name: impl
description: Used when the GPT-6 Astra primary session implements stimulus-ui within the scope of a finalized plan, issue, or request, and completes through target verification.
---

# impl

Use this Skill only for explicit implementation requests. If the target plan is omitted and there is one ongoing plan, use it. If there are multiple, confirm the target. For small tasks without a plan, treat the issue or user request as the implementation specification.

## Steps

1. Read the target plan or issue, AGENTS.md, design/authority.md, the target contract, package.json scripts, targets to change, and existing implementations to mimic.
2. If there is no contract for a component addition, or if specifications are insufficient or contradictory so that the implementation approach cannot be uniquely determined, stop implementation and report the necessary decisions specifically.
3. Check git status and target files. Do not edit if there are changes of unknown provenance or another write-enabled agent.
4. Implement only the targets to change and acceptance criteria from the plan, contract, issue, or request. Do not weaken requirements to match the implementation.
5. For changes in runtime or browser behavior, run the target tests or scenarios in Chromium, Firefox, and WebKit, and verify vp run check:contracts and the relevant negative controls. For tooling-only or documentation-only changes, limit execution to scripts that verify those changes and vp check.
6. Run repository-wide tests only once on a stable final diff when required for cross-cutting runtime changes or by explicit request. Do not rerun successful results for the same content solely because of a phase name or stage change.
7. Do not perform stage, commit, push, or issue operations; report changed paths, verification results, unconfirmed items, and deviations from the plan. However, if the user explicitly specifies any of these, execute them after standard Git confirmation.

## Boundaries

- Do not rewrite contracts to match implementation. Stop if a specification decision is required.
- Do not modify files not permitted by the plan, issue, or request. If required targets are missing, report the reason for scope change.
- The primary session handles regular implementation and fixes. Delegation to workers is limited to large-volume tasks where exclusive paths and mechanical instructions can be explicitly provided.
- Even when using a reviewer, conclude with an initial audit and at most one focused re-audit.
- Do not read secret information. Do not force push, stage out-of-scope items, or perform unauthorized external operations.
