import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Apply contract negativeControls.mutation to source and run Chromium tests.
 * Compare the outcome with expectedFailure. Always restore each original file
 * in finally, and verify restored content matches the original after any failure.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");

const filesBelow = (relativePath) =>
  readdirSync(resolve(root, relativePath), { withFileTypes: true }).flatMap((entry) => {
    const entryPath = `${relativePath}/${entry.name}`;
    return entry.isDirectory() ? filesBelow(entryPath) : [entryPath];
  });

const contractPaths = filesBelow("design/contracts").filter((path) =>
  path.endsWith(".contract.json"),
);

/** Replace only after verifying find occurs exactly once in the current content. */
const applyReplacement = (content, { find, replace }, context) => {
  const occurrences = content.split(find).length - 1;
  if (occurrences === 0) {
    throw new Error(`${context}: find does not match -> ${JSON.stringify(find)}`);
  }
  if (occurrences > 1) {
    throw new Error(`${context}: find matches ${occurrences} locations -> ${JSON.stringify(find)}`);
  }
  return content.replace(find, replace);
};

/** Extract every [testId] from a title, matching check_contracts.mjs. */
const bracketIds = (title) =>
  Array.from(title.matchAll(/\[([a-z0-9]+(?:-[a-z0-9]+)*)\]/g), ([, id]) => id);

/**
 * Run Chromium tests importing the mutated file. Vitest determines scope
 * from its module graph, so no manual mapping is needed. Controllers do not
 * import one another; cross-component coverage comes from shared test imports.
 */
const runChromiumTests = (workDir, mutatedFile) => {
  const outputFile = join(workDir, "result.json");
  // Remove prior results first so a run that cannot write results cannot
  // accidentally reuse the preceding mutation's outcome.
  rmSync(outputFile, { force: true });
  const run = spawnSync(
    "vp",
    [
      "test",
      "related",
      mutatedFile,
      "--browser.name",
      "chromium",
      "--reporter",
      "json",
      "--outputFile",
      outputFile,
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
  );
  if (!existsSync(outputFile)) {
    // Missing results indicate a launch failure, permission denial, or interrupted
    // Vitest execution, rather than an ordinary test failure. Distinguish these
    // cases so environment problems are not mistaken for harness defects.
    const cause = [
      run.error ? `could not spawn (${run.error.message})` : null,
      run.error === undefined && run.status !== 0 ? `vp exited with code ${run.status}` : null,
      run.stderr?.trim() ? `stderr: ${run.stderr.trim().split("\n").slice(-3).join(" / ")}` : null,
    ]
      .filter((part) => part !== null)
      .join(", ");
    throw new Error(
      `Chromium tests related to ${mutatedFile} did not write results. ${cause === "" ? "cause unknown" : cause}`,
    );
  }
  const report = JSON.parse(readFileSync(outputFile, "utf8"));
  if (report.numTotalTests === 0 || report.testResults.length === 0) {
    throw new Error(`No Chromium tests related to ${mutatedFile} ran`);
  }
  return report.testResults.flatMap((suite) => suite.assertionResults);
};

// Entries without mutations declare intended faults before source exists.
// Add executable mutations with implementation to include these entries in checks.
const allControls = contractPaths.flatMap((contractPath) => {
  const value = JSON.parse(read(contractPath));
  return (value.negativeControls ?? []).map((control) => ({ contractPath, control }));
});
const plannedControls = allControls.filter(({ control }) => control.mutation === undefined);
const negativeControls = allControls.filter(({ control }) => control.mutation !== undefined);
// Accept repeated and comma-separated --test-id options so focused batches
// run under one lock instead of requiring a shell loop.
const requestedTestIds = [];
for (const [index, argument] of process.argv.entries()) {
  if (argument !== "--test-id") continue;
  const value = process.argv[index + 1];
  if (value === undefined) throw new Error("--test-id requires a test ID");
  requestedTestIds.push(
    ...value
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== ""),
  );
}

const missingTestIds = requestedTestIds.filter(
  (id) => !negativeControls.some(({ control }) => control.testId === id),
);
if (missingTestIds.length > 0) {
  throw new Error(`Unknown negative controls: ${missingTestIds.join(", ")}`);
}

const controlsToRun =
  requestedTestIds.length > 0
    ? negativeControls.filter(({ control }) => requestedTestIds.includes(control.testId))
    : negativeControls;

/**
 * This check mutates worktree source. Concurrent runs could execute tests
 * against each other's mutations. Shared files would fail find matching,
 * but mutations in different files could silently invalidate results.
 * Reject a second run with a lock.
 */
const lockPath = join(tmpdir(), `negative-controls-${root.replaceAll("/", "_")}.lock`);
const acquireLock = () => {
  try {
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    return;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const holder = Number(readFileSync(lockPath, "utf8").trim());
  const holderAlive = (() => {
    try {
      process.kill(holder, 0);
      return true;
    } catch {
      return false;
    }
  })();
  if (holderAlive) {
    throw new Error(
      `Negative controls are already running under PID ${holder}; wait for completion or stop that run`,
    );
  }
  // Replace locks left by terminated processes. Before rerunning, check git status
  // to ensure source was not left in a mutated state.
  writeFileSync(lockPath, String(process.pid));
};

acquireLock();

const workDir = mkdtempSync(join(tmpdir(), "negative-controls-"));
const results = [];
let hardFailure = null;

try {
  for (const [index, { contractPath, control }] of controlsToRun.entries()) {
    const { testId, mutation } = control;
    const sourcePath = resolve(root, mutation.file);
    const original = read(mutation.file);

    // Full runs take several minutes. Report progress so callers can distinguish
    // ongoing mutations from a stalled process. Write progress to stderr to keep
    // it separate from results on stdout.
    process.stderr.write(`[${index + 1}/${controlsToRun.length}] ${testId}\n`);

    let mutated;
    try {
      mutated = mutation.replacements.reduce(
        (content, replacement, index) =>
          applyReplacement(content, replacement, `${testId} replacements[${index}]`),
        original,
      );
    } catch (error) {
      hardFailure = error instanceof Error ? error.message : String(error);
      break;
    }

    let assertions;
    try {
      writeFileSync(sourcePath, mutated);
      assertions = runChromiumTests(workDir, mutation.file);
    } catch (error) {
      hardFailure = error instanceof Error ? error.message : String(error);
    } finally {
      writeFileSync(sourcePath, original);
      const restored = read(mutation.file);
      if (restored !== original) {
        hardFailure = `${testId}: restored content of ${mutation.file} differs from the original`;
      }
    }
    if (hardFailure) break;

    // Verify the intended test is included. A test that did not run is otherwise
    // indistinguishable from a test that failed to detect the mutation.
    if (!assertions.some((assertion) => bracketIds(assertion.title).includes(testId))) {
      hardFailure = `${testId}: no related test for ${mutation.file} contains this ID; check the related scope and spelling`;
      break;
    }

    const failed = assertions.filter((assertion) => assertion.status === "failed");
    const targetFailed = failed.filter((assertion) => bracketIds(assertion.title).includes(testId));
    const otherFailed = failed.filter((assertion) => !bracketIds(assertion.title).includes(testId));

    results.push({
      contractPath,
      testId,
      description: mutation.description,
      expectedFailure: control.expectedFailure,
      targetHit: targetFailed.length > 0,
      otherFailed: otherFailed.map((assertion) => assertion.title),
    });
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(lockPath, { force: true });
}

if (hardFailure) {
  console.error(`Negative controls aborted: ${hardFailure}`);
  process.exitCode = 1;
} else {
  let allPassed = true;
  // Keep successful controls to one line. Expand only failures and collateral
  // test failures needed to assess expectedFailure.
  for (const result of results) {
    // Permit collateral failures of shared invariants; require detection by the target test.
    if (!result.targetHit) allPassed = false;
    const verdict = result.targetHit ? "PASS" : "FAIL (the intended test did not fail)";
    const collateral =
      result.otherFailed.length === 0 ? "" : `, ${result.otherFailed.length} collateral failures`;
    console.log(`[${result.testId}] ${verdict}${collateral} — ${result.description}`);
    for (const title of result.otherFailed) console.log(`    - ${title}`);
  }

  console.log(
    `Negative controls: ${results.filter((result) => result.targetHit).length}/${results.length} passed`,
  );
  if (plannedControls.length > 0) {
    const planned = plannedControls.map(({ control }) => control.testId ?? control.guard);
    console.log(
      `Declarations pending implementation (${plannedControls.length}): ${planned.toSorted((a, b) => a.localeCompare(b)).join(", ")}`,
    );
  }
  if (!allPassed) process.exitCode = 1;
}
