---
name: plan
description: Used when the GPT-6 Astra primary session investigates an issue or request to confirm the policy, contract, and acceptance criteria without implementing.
---

# plan

Use this when only planning is requested. Do not perform implementation, staging, committing, pushing, or issue operations, unless the user explicitly specifies those concrete external operations.

## Procedure

1. Read the specified issue or request, AGENTS.md, design/authority.md, the target contract, target code, tests, and scripts in package.json.
2. Verify assumptions, root causes, identifiers, and external specifications within the current implementation. Do not guess numbers or requirements.
3. Determine the implementation approach yourself if it is uniquely defined by conventions and evidence. Ask the user only about key decision points that affect adoption, public APIs, acceptance criteria, security/privacy policies, or work scope.
4. When adding components, finalize design/contracts/<name>.contract.json before implementation. If it lacks client behavior, create a decision plan according to existing conventions.
5. Create docs/plans/<prefix>-<name>.md only when a persistent design record is necessary for large tasks. For small bug fixes or localized changes, discussing the policy within the conversation is sufficient.
6. Summarize the goal, adopted policy and reason, target changes, out of scope items, verifiable acceptance criteria, required verification, and unverified items. Ensure enough specificity so that the implementer does not need to make new specification decisions.

Confirmations that cannot be conducted via automated tests are treated as blocking only if the results alter adoption or public specifications. Compatibility observations where public specifications do not depend on the results should be documented in the contract as an observation.

Do not read confidential information. Do not expand the design for hypothetical future requirements, and do not duplicate existing contract contents in the plan.
