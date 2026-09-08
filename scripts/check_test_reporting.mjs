import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultsDirectory = join(root, "test-results");
mkdirSync(resultsDirectory, { recursive: true });
const workDirectory = mkdtempSync(join(resultsDirectory, "reporting-"));
const fixture = join(workDirectory, "reporting.test.ts");
const engineFile = join(resultsDirectory, "engine-results.json");
const previousReport = existsSync(engineFile) ? readFileSync(engineFile) : undefined;
const engines = ["chromium", "firefox", "webkit"];
const testName = "Reporter verification assertion";

/** @returns {Record<string, unknown>} */
const readReport = (path) => {
  /** @type {unknown} */
  const value = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value;
};

const run = (name, additionalArguments = []) => {
  const jsonFile = join(workDirectory, `${name}.json`);
  const result = spawnSync(
    "vp",
    ["run", "test", "run", fixture, "--outputFile", jsonFile, ...additionalArguments],
    { cwd: root, encoding: "utf8" },
  );
  writeFileSync(join(workDirectory, `${name}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  assert.equal(result.error, undefined, "Could not start vp");
  assert.ok(existsSync(jsonFile), `No results at CLI --outputFile: ${jsonFile}`);
  return { result, json: readReport(jsonFile) };
};

try {
  const collectionFile = join(workDirectory, "collection.json");
  const collection = spawnSync(
    "vp",
    ["run", "test", "list", "--filesOnly", "--json", collectionFile],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(collection.status, 0, collection.stderr);
  /** @type {unknown} */
  const modules = JSON.parse(readFileSync(collectionFile, "utf8"));
  assert.ok(Array.isArray(modules), "ブラウザテストの収集結果が配列ではありません");
  for (const engine of engines) {
    assert.ok(
      modules.some(
        (module) => module.projectName === engine && module.file.endsWith("/test/tabs.test.ts"),
      ),
      `${engine} のコンポーネントテストが収集されていません`,
    );
  }
  assert.ok(
    modules.every((module) => !module.file.startsWith(join(root, "scripts") + "/")),
    "Node用のscriptテストがブラウザに収集されています",
  );
  writeFileSync(
    fixture,
    `import { expect, test } from "vite-plus/test";
import { server } from "vite-plus/test/browser/context";
test(${JSON.stringify(testName)}, () => {
  expect(server.browser).toBe("deliberate failure");
});
`,
  );
  rmSync(engineFile, { force: true });
  const failure = run("failure");
  assert.equal(failure.result.status, 1);
  assert.equal(failure.json.numFailedTests, 3);
  assert.ok(failure.result.stdout.includes(testName), "Missing default reporter output");
  const report = readReport(engineFile);
  assert.equal(report.reason, "failed");
  assert.ok(Array.isArray(report.modules));
  assert.deepEqual(report.modules.map((module) => module.engine).sort(), engines);
  for (const module of report.modules) {
    assert.equal(module.project, module.engine);
    assert.ok(module.file.endsWith("reporting.test.ts"));
    assert.equal(module.tests.length, 1);
    const test = module.tests[0];
    assert.equal(test.name, testName);
    assert.equal(test.result.state, "failed");
    assert.ok(test.result.errors.some((error) => error.message.includes("deliberate failure")));
  }

  // Verify negative-control CLI arguments take precedence for JSON and --outputFile.
  rmSync(engineFile);
  const override = run("override", ["--browser.name", "chromium", "--reporter", "json"]);
  assert.equal(override.result.status, 1);
  assert.equal(override.json.numFailedTests, 1);
  assert.equal(
    existsSync(engineFile),
    false,
    "CLI reporter selection did not exclude the custom reporter",
  );

  writeFileSync(
    fixture,
    `import { expect, test } from "vite-plus/test";
test(${JSON.stringify(testName)}, () => { expect(true).toBe(true); });
`,
  );
  const success = run("success");
  assert.equal(success.result.status, 0);
  assert.equal(success.json.numPassedTests, 3);
  const successReport = readReport(engineFile);
  assert.equal(successReport.reason, "passed");
  assert.deepEqual(successReport.unhandledErrors, []);
  assert.ok(Array.isArray(successReport.modules));
  assert.equal(successReport.modules.length, 3);
  for (const module of successReport.modules) {
    assert.ok(module.tests.every((test) => test.result.state === "passed"));
  }
  console.log(
    "Verified test names, engines, and assertions from deliberate failures on three engines",
  );
  console.log(
    "Verified default output, CLI JSON/output selection, and successful result recording",
  );
} finally {
  // Preserve prior diagnostic artifacts instead of leaving deliberate failures behind.
  if (previousReport === undefined) rmSync(engineFile, { force: true });
  else writeFileSync(engineFile, previousReport);
  rmSync(fixture, { force: true });
}
