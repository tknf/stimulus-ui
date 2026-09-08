# Specification precedence

In this repository, `AGENTS.md` defines repository-wide conventions and procedures, while `design/contracts/<name>.contract.json` defines each component's public API, behavior, accessibility, and acceptance criteria.

When sources conflict, use the following order.

1. The repository-wide conventions and procedures in `AGENTS.md`
2. The target component's contract
3. The implementation in `src/` and tests in `test/`

The implementation and tests follow `AGENTS.md` and the contract. If `AGENTS.md` and the contract conflict, update the contract to preserve the repository-wide conventions before implementing it. Do not implement a component when its contract does not exist.
