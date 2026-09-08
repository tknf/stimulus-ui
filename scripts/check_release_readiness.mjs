import { readFileSync, readdirSync } from "node:fs";

const schemaOnly = process.argv.includes("--schema-only");
const errors = [];
const pending = [];
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const files = readdirSync("design/contracts").filter((file) => file.endsWith(".contract.json"));
if (files.length === 0) errors.push("No component contracts found");

for (const file of files) {
  const contract = JSON.parse(readFileSync(`design/contracts/${file}`, "utf8"));
  const criteria = contract.acceptanceCriteria;
  if (!Array.isArray(criteria) || !criteria.every(hasText)) {
    errors.push(`${file}: acceptanceCriteria must contain nonempty strings`);
  } else {
    const text = criteria.join("\n");
    for (const [label, pattern] of [
      ["WCAG 2.2 Level AA", /WCAG 2\.2(?: Level)? AA/],
      ["AAA 2.1.3", /2\.1\.3/],
      ["AAA 3.2.5", /3\.2\.5/],
    ]) {
      if (!pattern.test(text))
        errors.push(`${file}: missing required ${label} acceptance criterion`);
    }
  }
  const verification = contract.manualVerification;
  if (!isRecord(verification)) {
    errors.push(`${file}: missing manualVerification classification`);
    continue;
  }
  for (const key of Object.keys(verification)) {
    if (key !== "blocking" && key !== "observations") {
      errors.push(`${file}: unknown manualVerification classification ${key}`);
    }
  }
  for (const category of ["blocking", "observations"]) {
    const entries = verification[category];
    if (!Array.isArray(entries)) {
      errors.push(`${file}: manualVerification.${category} must be an array`);
      continue;
    }
    for (const [index, entry] of entries.entries()) {
      const label = `${file}: manualVerification.${category}[${index}]`;
      if (!isRecord(entry)) {
        errors.push(`${label} must be an object`);
        continue;
      }
      for (const key of ["environment", "item", "impact"]) {
        if (!hasText(entry[key])) errors.push(`${label}: missing ${key}`);
      }
      if (entry.status !== "verified" && entry.status !== "unverified") {
        errors.push(`${label}: status must be verified or unverified`);
      }
      if (entry.status === "verified" && !hasText(entry.evidence)) {
        errors.push(`${label}: verified checks require evidence`);
      }
      if (category === "blocking" && entry.status !== "verified") {
        pending.push(`${file}: ${entry.item ?? "unnamed blocking check"}`);
      }
    }
  }
}

if (errors.length > 0 || (!schemaOnly && pending.length > 0)) {
  console.error(
    [...errors, ...(!schemaOnly ? pending.map((item) => `Release blocked: ${item}`) : [])].join(
      "\n",
    ),
  );
  process.exit(1);
}
console.log(
  `Release readiness ${schemaOnly ? "classification" : "gate"} passed: ${files.length} contracts, ${pending.length} pending blocking checks`,
);
