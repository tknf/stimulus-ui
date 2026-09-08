import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");

const filesBelow = (relativePath) =>
  readdirSync(resolve(root, relativePath), { withFileTypes: true }).flatMap((entry) => {
    const entryPath = `${relativePath}/${entry.name}`;
    return entry.isDirectory() ? filesBelow(entryPath) : [entryPath];
  });

// Read each source file once when checking mutation find strings. Many controls
// share the same source files, so reading per control would repeat the work.
const sourceCache = new Map();
const sourceFor = (relativePath) => {
  if (!sourceCache.has(relativePath)) sourceCache.set(relativePath, read(relativePath));
  return sourceCache.get(relativePath);
};

const contracts = filesBelow("design/contracts")
  .filter((path) => path.endsWith(".contract.json"))
  .map((path) => ({ path, value: JSON.parse(read(path)) }));
const contractsByController = new Map(
  contracts.map(({ path, value }) => [value.controller, { path, value }]),
);

const indexSource = read("src/index.ts");
const controllerPattern =
  /export\s+\{\s*default\s+as\s+\w+Controller\s*\}\s+from\s+"\.\/([^"\n]+)_controller"/g;
const publicControllers = Array.from(indexSource.matchAll(controllerPattern), ([, sourceName]) =>
  sourceName.replaceAll("_", "-"),
);
const publicControllerSet = new Set(publicControllers);

const readmeSource = read("README.md");
const readmeComponentPattern =
  /^- `([a-z0-9]+(?:-[a-z0-9]+)*)` — ([^\n]+) \(\[contract\]\(([^)\n]+)\)\)$/gm;
const readmeComponents = Array.from(
  readmeSource.matchAll(readmeComponentPattern),
  ([, identifier, , contractPath]) => ({ identifier, contractPath }),
);
const readmeControllers = readmeComponents.map(({ identifier }) => identifier);
const readmeControllerSet = new Set(readmeControllers);

for (const { identifier, contractPath } of readmeComponents) {
  const expectedContractPath = `design/contracts/${identifier}.contract.json`;
  if (contractPath !== expectedContractPath) {
    errors.push(`README contract link for ${identifier} must be ${expectedContractPath}`);
  }
}

for (const identifier of readmeControllers) {
  if (readmeControllers.filter((controller) => controller === identifier).length > 1) {
    errors.push(`Duplicate controller in README: ${identifier}`);
  }
}

for (const controller of publicControllers) {
  if (!readmeControllerSet.has(controller)) {
    errors.push(`Public controller missing from README: ${controller}`);
  }
}

for (const controller of readmeControllers) {
  if (!publicControllers.includes(controller)) {
    errors.push(`README lists a controller not exported from src/index.ts: ${controller}`);
  }
}

for (const controller of publicControllers) {
  if (!contractsByController.has(controller)) {
    errors.push(`Missing contract for public controller: ${controller}`);
  }
}

const catalogPages = filesBelow("catalog")
  .filter((path) => path.endsWith(".html") && path !== "catalog/index.html")
  .map((path) => path.slice("catalog/".length, -".html".length));
const catalogControllerSet = new Set(catalogPages);
const catalogIndexSource = read("catalog/index.html");

for (const controller of publicControllers) {
  if (!catalogControllerSet.has(controller)) {
    errors.push(`Missing catalog/${controller}.html for public controller: ${controller}`);
  }
  if (!catalogIndexSource.includes(`href="./${controller}.html"`)) {
    errors.push(`Missing link to ${controller} in catalog/index.html`);
  }
}

for (const controller of catalogPages) {
  if (!publicControllerSet.has(controller)) {
    errors.push(`No public controller for catalog/${controller}.html`);
  }
}

const catalogCssSource = read("catalog/catalog.css");
const catalogDeclarationNames = [
  "data-catalog-states",
  "data-catalog-properties",
  "data-catalog-events",
];
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokensFrom = (value) => value.split(/\s+/).filter(Boolean);
let catalogCoveragePages = 0;

for (const controller of publicControllers) {
  if (!catalogControllerSet.has(controller)) continue;

  const catalogPath = `catalog/${controller}.html`;
  const catalogSource = read(catalogPath);
  const mainMatch = catalogSource.match(/<main\b([^>]*)>/);
  if (mainMatch === null) {
    errors.push(`Missing main element in ${catalogPath}`);
    continue;
  }

  const mainAttributes = mainMatch[1];
  const declarations = new Map();
  let hasAllDeclarations = true;
  for (const declarationName of catalogDeclarationNames) {
    const declarationMatch = mainAttributes.match(new RegExp(`\\b${declarationName}="([^"]*)"`));
    if (declarationMatch === null) {
      errors.push(`Missing ${declarationName} on main in ${catalogPath}`);
      hasAllDeclarations = false;
      continue;
    }
    declarations.set(declarationName, tokensFrom(declarationMatch[1]));
  }
  if (!hasAllDeclarations) continue;

  const contract = contractsByController.get(controller)?.value;
  if (contract === undefined) continue;
  const contractSource = JSON.stringify(contract);
  const states = declarations.get("data-catalog-states") ?? [];
  const properties = declarations.get("data-catalog-properties") ?? [];
  const events = declarations.get("data-catalog-events") ?? [];

  for (const token of [...states, ...properties, ...events]) {
    const occurs =
      token.startsWith("--") || token.startsWith("data-")
        ? contractSource.includes(token)
        : new RegExp(`\\b${escapeRegExp(token)}\\b`).test(contractSource);
    if (!occurs) {
      errors.push(`${catalogPath} declares ${token}, which is absent from its contract`);
    }
  }

  const contractEvents = new Set(
    Object.keys(contract.api?.events ?? {}).filter((eventName) =>
      eventName.startsWith(`${controller}:`),
    ),
  );
  for (const eventName of contractEvents) {
    if (!events.includes(eventName)) {
      errors.push(`Missing contract event ${eventName} in ${catalogPath} data-catalog-events`);
    }
  }

  const customPropertySource = JSON.stringify({
    api: contract.api ?? {},
    managedMarkup: contract.managedMarkup ?? {},
    stateOutputs: contract.stateOutputs ?? {},
  });
  const contractProperties = new Set(
    Array.from(
      customPropertySource.matchAll(new RegExp(`--${escapeRegExp(controller)}-[a-z-]+`, "g")),
      ([propertyName]) => propertyName,
    ),
  );
  for (const propertyName of contractProperties) {
    if (!properties.includes(propertyName)) {
      errors.push(
        `Missing contract custom property ${propertyName} in ${catalogPath} data-catalog-properties`,
      );
    }
  }

  for (const state of states) {
    const selector = state.startsWith("data-") ? `[${state}]` : `[data-state="${state}"]`;
    if (!catalogCssSource.includes(selector)) {
      errors.push(`Missing CSS selector ${selector} for state ${state} in ${catalogPath}`);
    }
  }
  for (const propertyName of properties) {
    if (!catalogCssSource.includes(`var(${propertyName}`)) {
      errors.push(`Missing CSS var() for custom property ${propertyName} in ${catalogPath}`);
    }
  }

  const scenarioPath = `test/catalog_scenarios/${controller}.ts`;
  let scenarioSource;
  try {
    scenarioSource = read(scenarioPath);
  } catch {
    errors.push(`Missing scenario ${scenarioPath} for ${catalogPath}`);
    continue;
  }
  const keyboardSource = JSON.stringify(contract.keyboard ?? {});
  const keyboardKeys = new Set(
    keyboardSource.match(
      /ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|Enter|Escape|Space|Tab|PageUp|PageDown|Backspace|Delete|F10|Shift|Control|Alt|Meta/g,
    ) ?? [],
  );
  for (const key of keyboardKeys) {
    if (!scenarioSource.includes(key)) {
      errors.push(`Missing contract keyboard key ${key} in ${scenarioPath}`);
    }
  }

  catalogCoveragePages += 1;
}

const testSources = filesBelow("test")
  .filter((path) => path.endsWith(".test.ts"))
  .map((path) => read(path))
  .join("\n");
const executableTestIds = new Set(
  Array.from(testSources.matchAll(/\b(?:test|it)\s*\(\s*(["'`])([\s\S]*?)\1\s*,/g), ([, , title]) =>
    Array.from(title.matchAll(/\[([a-z0-9]+(?:-[a-z0-9]+)*)\]/g), ([, id]) => id),
  ).flat(),
);
const declaredTestIds = new Set();
const pendingContracts = [];

for (const { path, value } of contracts) {
  const expectedName = path.slice("design/contracts/".length, -".contract.json".length);
  if (value.name !== expectedName) {
    errors.push(`${path}: name must match filename ${expectedName}`);
  }
  if (value.controller !== value.name) {
    errors.push(`${path}: controller must match name`);
  }

  // Contracts precede implementation, so unexported controllers do not need
  // matching tests yet. Check duplicate test IDs regardless.
  const implemented = publicControllerSet.has(value.controller);
  if (!implemented) pendingContracts.push(value.controller);

  for (const section of ["testMatrix", "negativeControls"]) {
    for (const entry of value[section] ?? []) {
      if (typeof entry !== "object" || entry === null || !("testId" in entry)) continue;
      const testId = entry.testId;
      if (typeof testId !== "string" || testId === "") {
        errors.push(`${path}: ${section} testId must be a nonempty string`);
        continue;
      }
      if (declaredTestIds.has(testId)) {
        errors.push(`${path}: duplicate testId ${testId}`);
      }
      declaredTestIds.add(testId);
      if (implemented && !executableTestIds.has(testId)) {
        errors.push(`${path}: no executable test for testId ${testId}`);
      }
    }
  }

  // Before implementation, allow a declaration of the intended mutation without find text.
  // Once implemented, every declaration must include a mutation.
  if (implemented) {
    for (const entry of value.negativeControls ?? []) {
      if (typeof entry !== "object" || entry === null) continue;
      const label = `${path}: negativeControls「${entry.testId ?? entry.guard}」`;
      if (entry.mutation === undefined) {
        errors.push(
          `${label} has no mutation; implemented components require executable mutations`,
        );
        continue;
      }

      // Reject mismatched find strings before applying any mutation.
      // check_negative_controls.mjs checks the same condition but starts Chromium
      // per control and aborts remaining controls at the first mismatch.
      let source;
      try {
        source = sourceFor(entry.mutation.file);
      } catch {
        errors.push(`${label}: cannot read mutation.file ${entry.mutation.file}`);
        continue;
      }
      const replacements = entry.mutation.replacements;
      if (!Array.isArray(replacements) || replacements.length === 0) {
        errors.push(`${label}: mutation has no replacements`);
        continue;
      }
      for (const [index, replacement] of replacements.entries()) {
        const occurrences = source.split(replacement.find).length - 1;
        if (occurrences !== 1) {
          errors.push(
            `${label}: replacements[${index}].find occurs ${occurrences} times in ${entry.mutation.file}; expected exactly once`,
          );
        }
      }
    }
  }
}

for (const testId of executableTestIds) {
  if (!declaredTestIds.has(testId)) {
    errors.push(`testId ${testId} is not declared in a contract`);
  }
}

if (errors.length > 0) {
  console.error("Contract checks failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const pending =
    pendingContracts.length > 0
      ? `, pending implementation: ${pendingContracts.toSorted((a, b) => a.localeCompare(b)).join(", ")}`
      : "";
  console.log(
    `Contracts verified (${publicControllers.length} controllers, README ${readmeControllers.length} controllers, catalog ${catalogPages.length} pages, catalog coverage ${catalogCoveragePages} pages, ${declaredTestIds.size} test IDs${pending})`,
  );
}
