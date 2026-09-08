import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const read = (path) => readFileSync(resolve(root, path), "utf8");

const expectedAgents = ["researcher.toml", "reviewer.toml", "worker.toml"];
const actualAgents = readdirSync(resolve(root, ".codex/agents"))
  .filter((path) => path.endsWith(".toml"))
  .sort();
if (JSON.stringify(actualAgents) !== JSON.stringify(expectedAgents)) {
  errors.push("Unexpected agent catalog: " + actualAgents.join(", "));
}

for (const file of expectedAgents) {
  const source = read(".codex/agents/" + file);
  const name = file.slice(0, -".toml".length);
  if (!source.includes('name = "' + name + '"')) errors.push(file + ": invalid name");
  const sandbox = file === "worker.toml" ? "workspace-write" : "read-only";
  if (!source.includes('sandbox_mode = "' + sandbox + '"')) {
    errors.push(file + ": sandbox_mode must be " + sandbox + "");
  }
}

const expectedSkills = ["impl", "issue", "plan"];
const actualSkills = readdirSync(resolve(root, ".agents/skills"))
  .filter((name) => existsSync(resolve(root, ".agents/skills", name, "SKILL.md")))
  .sort();
if (JSON.stringify(actualSkills) !== JSON.stringify(expectedSkills)) {
  errors.push("Unexpected skill catalog: " + actualSkills.join(", "));
}

for (const name of expectedSkills) {
  const skill = read(".agents/skills/" + name + "/SKILL.md");
  const metadata = read(".agents/skills/" + name + "/agents/openai.yaml");
  if (!skill.startsWith("---\nname: " + name + "\n")) {
    errors.push(name + "/SKILL.md: invalid frontmatter");
  }
  if (!/^\s*allow_implicit_invocation:\s*false\s*$/m.test(metadata)) {
    errors.push(name + ": must require explicit invocation");
  }
}

const forbiddenPaths = [
  ".codex/agents/planner.toml",
  ".codex/agents/implementer.toml",
  ".codex/agents/integrator.toml",
  ".agents/skills/review/SKILL.md",
  ".agents/skills/wrapup/SKILL.md",
  ".agents/skills/issue/references/phase-handoff.md",
  "scripts/check_agent_harness.mjs",
  "scripts/issue_context.sh",
  "scripts/issue_remote_head.mjs",
  "scripts/issue_workflow_evidence.mjs",
  "docs/reviews/agent-harness-prompt-evaluation.md",
  "docs/reviews/agent-harness.codex-audit-brief.md",
];
for (const path of forbiddenPaths) {
  if (existsSync(resolve(root, path))) errors.push("Unexpected workflow file: " + path);
}

const issueSource = read(".agents/skills/issue/SKILL.md");
for (const skill of ["$plan", "$impl", "$review", "$wrapup"]) {
  if (issueSource.includes(skill)) errors.push("$issue references an internal phase: " + skill);
}

const packageJson = read("package.json");
for (const marker of ["workflow:remote-head", "workflow:evidence", "check:agent-harness"]) {
  if (packageJson.includes(marker)) errors.push("Unexpected package script: " + marker);
}

const agentsMd = read("AGENTS.md");
for (const marker of ["phase-handoff", "contentFingerprint", "PHASE_RESULT"]) {
  if (agentsMd.includes(marker)) errors.push("Obsolete workflow reference in AGENTS.md: " + marker);
}
if (!agentsMd.includes("vp run check:workflow-safety")) {
  errors.push("AGENTS.md does not document workflow safety checks");
}

const viteConfig = read("vite.config.ts");
if (/staged[\s\S]*vp (?:run )?check --fix/.test(viteConfig)) {
  errors.push("The pre-commit hook must not apply automatic fixes");
}
if (/"\*"\s*:\s*"vp (?:run )?check"/.test(viteConfig)) {
  errors.push(
    "The catch-all staged rule passes filenames to vp check. Return a repository-wide check from a function so documentation-only changes also run lint",
  );
}

const isIgnored = (path) => {
  try {
    execFileSync("git", ["check-ignore", "--no-index", "--quiet", path], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};
for (const path of [".env", ".dev.vars", "secrets/example"]) {
  if (!isIgnored(path)) errors.push("Sensitive path is not ignored: " + path);
}
if (isIgnored(".env.example")) errors.push(".env.example must not be ignored");

if (errors.length > 0) {
  console.error(errors.map((error) => "- " + error).join("\n"));
  process.exit(1);
}

console.log("Agent, skill, and sensitive-path configuration verified");
