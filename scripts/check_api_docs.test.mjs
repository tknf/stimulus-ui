import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const checker = join(dirname(fileURLToPath(import.meta.url)), "check_api_docs.mjs");
const fixture = `
/** Numeric sample in percentages. */
type DemoValue = {
  /** Percentage from the start. */
  x: number;
};
/** Demo controller. */
declare class DemoController {
  /** Current sample. */
  get value(): DemoValue;
  /** Select a sample without events. */
  select: (value: DemoValue) => void;
}
`;
const runFixture = (source = fixture, published = fixture) => {
  const directory = mkdtempSync(join(tmpdir(), "stimulus-api-docs-"));
  try {
    for (const path of ["design/contracts", "src", "dist"])
      mkdirSync(join(directory, path), { recursive: true });
    writeFileSync(
      join(directory, "design/contracts/demo.contract.json"),
      JSON.stringify({
        controller: "demo",
        api: {
          properties: { value: { type: "DemoValue" } },
          methods: { "select(value)": { returns: "void" } },
        },
      }),
    );
    writeFileSync(join(directory, "src/demo_controller.ts"), source);
    writeFileSync(join(directory, "dist/index.d.mts"), published);
    return spawnSync(process.execPath, [checker], { cwd: directory, encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("Accept matching source and published class, API, and value-field documentation", () => {
  const result = runFixture();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 controllers, 2 API declarations, 1 numeric value types, 1 fields/);
});

for (const [name, text, location, expected] of [
  [
    "Reject missing source class documentation",
    "/** Demo controller. */",
    "source",
    /Missing JSDoc: source:DemoController/,
  ],
  [
    "Reject missing source value-field documentation",
    "/** Percentage from the start. */",
    "source",
    /Missing JSDoc: source:DemoValue.x/,
  ],
  [
    "Reject missing published class documentation",
    "/** Demo controller. */",
    "published",
    /Missing JSDoc: dist\/index.d.mts:DemoController/,
  ],
  [
    "Reject missing published method documentation",
    "/** Select a sample without events. */",
    "published",
    /Missing JSDoc: dist\/index.d.mts:DemoController.member select/,
  ],
  [
    "Reject missing published value-type documentation",
    "/** Numeric sample in percentages. */",
    "published",
    /Missing JSDoc: dist\/index.d.mts:DemoValue/,
  ],
  [
    "Reject missing published value-field documentation",
    "/** Percentage from the start. */",
    "published",
    /Missing JSDoc: dist\/index.d.mts:DemoValue.x/,
  ],
]) {
  test(name, () => {
    const mutated = fixture.replace(text, "");
    assert.notEqual(mutated, fixture);
    const result = location === "source" ? runFixture(mutated) : runFixture(fixture, mutated);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  });
}

test("Reject published documentation that changes the source meaning", () => {
  const result = runFixture(
    fixture,
    fixture.replace("Percentage from the start.", "Pixels from the end."),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Published JSDoc differs from source: DemoValue.x/);
});
