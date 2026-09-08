import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Preserve project and browser names when recording the same test across engines.
export const createEngineReporter = () => {
  let outputFile = "";
  return /** @satisfies {import("vite-plus/test/node").Reporter} */ ({
    onInit: (vitest) => {
      outputFile = resolve(vitest.config.root, "test-results/engine-results.json");
    },
    onTestRunEnd: (modules, unhandledErrors, reason) => {
      const report = {
        reason,
        unhandledErrors,
        modules: modules.map((module) => ({
          file: module.relativeModuleId,
          project: module.project.name,
          engine: module.project.config.browser.name,
          state: module.state(),
          errors: module.errors(),
          tests: Array.from(module.children.allTests(), (test) => ({
            name: test.fullName,
            result: test.result(),
          })),
        })),
      };
      mkdirSync(dirname(outputFile), { recursive: true });
      writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
    },
  });
};
