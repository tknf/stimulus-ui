---
name: issue
description: Use this when the GPT-6 Astra primary session takes end-to-end charge from investigation to verification for an issue or request without phase splitting.
---

# issue

The GPT-6 Astra primary session is the task owner. It directly performs investigation, necessary planning, implementation, fixes, verification, and integration, and does not invoke other Skills as internal phases.

Calling this Skill alone does not permit creating, editing, or closing issues, staging, committing, pushing, or releasing. Perform each of these actions only when explicitly instructed by the user. Do not perform out-of-scope changes or access secrets. npm publishing and production changes require explicit user authorization. Avoid force pushes when a normal push can complete the authorized task.

## Process

1. Read the specified issue or request, AGENTS.md, design/authority.md, target contracts, target code, tests, and package.json scripts to verify assumptions against the current implementation.
2. Check git status, branch, existing diffs, and outgoing commits. If there are changes of unknown provenance or out-of-scope changes, stop without editing.
3. Plan only as much as necessary for safe implementation. For component additions, finalize the contract first. A persistent plan is required only for major design decisions or multi-location work.
4. The primary session decides matters uniquely determined by conventions and evidence. Ask the user only when choices, public APIs, acceptance criteria, security or privacy policies, or the scope of work change.
5. The primary session implements the task and performs verification proportional to the risk of changes. For runtime or browser behavior changes, verify target tests across 3 engines and perform the relevant negative control and contract checks. Do not run application-wide tests solely because of workflow or documentation-only changes.
6. Hand off to a fresh reviewer only for explicit requests, complex public spec changes, or high-risk security or accessibility changes. The primary session reviews the findings, fixes them, and, if necessary, re-audits only the original findings and direct dependencies once.
7. Reuse successful verifications for the same content if the relevant inputs have not changed. Re-run only the target verifications required by fixes, and do not repeat overall tests unconditionally.
8. If the reviewer and verification alternate back and forth on the same design decision, organize the contradictions and stop without bouncing the implementation back and forth. The primary session holds the final judgment and will not iterate agents repeatedly until passing.
9. Stage and commit explicit paths only when individually authorized by the user. Before pushing, verify remote and base using standard Git procedures and push without force. Perform issue operations only within the individually authorized scope.

Use researchers only for large-scale factual investigations, and workers only for mechanical bulk work where exclusive paths can be specified. Do not delegate standard planning, implementation, fixes, or integration. Do not launch multiple write-enabled agents simultaneously.

Stop and report the necessary decisions or operations if there are unresolved critical spec decisions, changes of unknown provenance, relevant verification failures, or unresolvable mandatory review findings.
