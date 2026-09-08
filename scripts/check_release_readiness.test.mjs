import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const checker = join(dirname(fileURLToPath(import.meta.url)), "check_release_readiness.mjs");
const createCheck = (status = "unverified") => ({
  environment: "Safari + VoiceOver",
  item: "Verify roles and keyboard interaction",
  impact: "Completion requires this result",
  status,
  ...(status === "verified" ? { evidence: "Recorded observed roles and keyboard results" } : {}),
});
const createContract = () => ({
  acceptanceCriteria: ["WCAG 2.2 Level AA; AAA 2.1.3 and 3.2.5 are required."],
  manualVerification: { blocking: [], observations: [createCheck()] },
});
const runFixture = (contract, args = []) => {
  const directory = mkdtempSync(join(tmpdir(), "stimulus-release-readiness-"));
  try {
    mkdirSync(join(directory, "design/contracts"), { recursive: true });
    writeFileSync(join(directory, "design/contracts/demo.contract.json"), JSON.stringify(contract));
    return spawnSync(process.execPath, [checker, ...args], { cwd: directory, encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("Allow unverified compatibility observations", () => {
  const result = runFixture(createContract());
  assert.equal(result.status, 0, result.stderr);
});
test("Allow verified blocking checks with recorded evidence", () => {
  const contract = createContract();
  contract.manualVerification.blocking.push(createCheck("verified"));
  const result = runFixture(contract);
  assert.equal(result.status, 0, result.stderr);
});
test("Reject unverified blocking checks at release, but permit classification checks in CI", () => {
  const contract = createContract();
  contract.manualVerification.blocking.push(createCheck());
  const release = runFixture(contract);
  assert.notEqual(release.status, 0);
  assert.match(release.stderr, /Release blocked: demo.contract.json/);
  const ci = runFixture(contract, ["--schema-only"]);
  assert.equal(ci.status, 0, ci.stderr);
});
for (const [name, mutate, expected] of [
  [
    "Reject missing classification",
    (c) => delete c.manualVerification,
    /missing manualVerification/,
  ],
  [
    "Reject a missing blocking list",
    (c) => delete c.manualVerification.blocking,
    /blocking must be an array/,
  ],
  [
    "Reject misspelled categories",
    (c) => {
      c.manualVerification.blockng = [];
    },
    /unknown manualVerification classification/,
  ],
  [
    "Reject an unknown status",
    (c) => {
      c.manualVerification.observations[0].status = "done";
    },
    /status must be verified or unverified/,
  ],
  [
    "Reject verification without evidence",
    (c) => {
      c.manualVerification.observations[0].status = "verified";
    },
    /verified checks require evidence/,
  ],
  [
    "Reject a missing impact rationale",
    (c) => delete c.manualVerification.observations[0].impact,
    /missing impact/,
  ],
  [
    "Reject missing AA criteria",
    (c) => {
      c.acceptanceCriteria = ["AAA 2.1.3 and 3.2.5"];
    },
    /missing required WCAG 2.2 Level AA/,
  ],
  [
    "Reject missing required AAA criteria",
    (c) => {
      c.acceptanceCriteria = ["WCAG 2.2 Level AA"];
    },
    /missing required AAA 2.1.3/,
  ],
]) {
  test(name, () => {
    const contract = createContract();
    mutate(contract);
    const result = runFixture(contract, ["--schema-only"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  });
}
