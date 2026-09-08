import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const results = join(root, "test-results");
mkdirSync(results, { recursive: true });
const temporary = mkdtempSync(join(results, "package-check-"));
const tarball = join(temporary, "package.tgz");

try {
  execFileSync("vp", ["pm", "pack", "--out", tarball], { cwd: root, stdio: "pipe" });
  const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
  const allowed = /^package\/(?:package\.json|README\.md|LICENSE|dist\/[a-zA-Z0-9_.-]+)$/;
  for (const entry of entries) assert.match(entry, allowed, `Unexpected package entry: ${entry}`);
  for (const required of [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/index.mjs",
    "dist/index.d.mts",
  ]) {
    assert.ok(entries.includes(`package/${required}`), `Missing package entry: ${required}`);
  }
  execFileSync("tar", ["-xzf", tarball, "-C", temporary]);
  const manifest = JSON.parse(readFileSync(join(temporary, "package/package.json"), "utf8"));
  assert.equal(manifest.name, "@tknf/stimulus-ui");
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.publishConfig?.access, "public");
  assert.equal(manifest.repository?.url, "git+https://github.com/tknf/stimulus-ui.git");
  assert.equal(manifest.peerDependencies?.["@hotwired/stimulus"], "^3.2.2");
  assert.deepEqual(manifest.exports?.["."], {
    types: "./dist/index.d.mts",
    import: "./dist/index.mjs",
  });
  const entry = pathToFileURL(join(temporary, "package/dist/index.mjs"));
  const exported = Object.keys(await import(entry.href)).sort((a, b) => a.localeCompare(b));
  const expected = Array.from(
    readFileSync(join(root, "src/index.ts"), "utf8").matchAll(/default\s+as\s+(\w+Controller)/g),
    ([, name]) => name,
  ).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(exported, expected, "Packed controllers must match source exports");
  if (process.env.GITHUB_REF_TYPE === "tag") {
    assert.equal(
      process.env.GITHUB_REF_NAME,
      `v${manifest.version}`,
      "Release tag must match package version",
    );
  }
  console.log(
    `Package verified: ${manifest.name}@${manifest.version}, ${exported.length} controllers, ${entries.length} files`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
