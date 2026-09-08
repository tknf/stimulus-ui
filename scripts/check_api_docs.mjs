import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const parseSource = (path) =>
  ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
const declarationPath = "dist/index.d.mts";
const declarations = parseSource(declarationPath);
const normalize = (text) => text.replace(/\s+/g, " ").trim();
const documentation = (node, label) => {
  const docs = node.jsDoc ?? [];
  const summary = docs.map((doc) => ts.getTextOfJSDocComment(doc.comment) ?? "").join("\n");
  assert.ok(summary.trim(), `Missing JSDoc: ${label}`);
  return normalize(
    docs
      .map((doc) =>
        [
          ts.getTextOfJSDocComment(doc.comment) ?? "",
          ...(doc.tags ?? []).map(
            (tag) => `@${tag.tagName.text} ${ts.getTextOfJSDocComment(tag.comment) ?? ""}`,
          ),
        ].join("\n"),
      )
      .join("\n"),
  );
};
const matchingDocumentation = (source, published, label) => {
  assert.ok(published, `Missing published declaration: ${label}`);
  assert.equal(
    documentation(published, `${declarationPath}:${label}`),
    documentation(source, `source:${label}`),
    `Published JSDoc differs from source: ${label}`,
  );
};
const instanceMembers = (controller, name, source) =>
  controller.members.filter(
    (member) =>
      member.name?.getText(source) === name &&
      !(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static),
  );
const memberKind = (member) =>
  ts.isGetAccessorDeclaration(member)
    ? "get"
    : ts.isSetAccessorDeclaration(member)
      ? "set"
      : "member";

let controllers = 0;
let checked = 0;
let valueTypes = 0;
let fields = 0;
for (const file of readdirSync("design/contracts")) {
  const contract = JSON.parse(readFileSync(`design/contracts/${file}`, "utf8"));
  const path = `src/${contract.controller.replaceAll("-", "_")}_controller.ts`;
  const source = parseSource(path);
  const controller = source.statements.find(ts.isClassDeclaration);
  assert.ok(controller?.name, `Missing named controller: ${path}`);
  const publishedController = declarations.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === controller.name.text,
  );
  matchingDocumentation(controller, publishedController, controller.name.text);
  controllers++;
  const names = [
    ...Object.keys(contract.api?.properties ?? {}),
    ...Object.keys(contract.api?.methods ?? {})
      .filter((key) => key.includes("("))
      .map((key) => key.slice(0, key.indexOf("("))),
  ];
  for (const name of names) {
    const members = instanceMembers(controller, name, source);
    const publishedMembers = instanceMembers(publishedController, name, declarations);
    assert.ok(members.length, `Missing public API: ${path}:${name}`);
    assert.equal(
      publishedMembers.length,
      members.length,
      `Published API shape differs: ${path}:${name}`,
    );
    for (const member of members) {
      const published = publishedMembers.find(
        (candidate) => memberKind(candidate) === memberKind(member),
      );
      matchingDocumentation(
        member,
        published,
        `${controller.name.text}.${memberKind(member)} ${name}`,
      );
      checked++;
    }
  }
  const propertyTypes = Object.values(contract.api?.properties ?? {})
    .map((property) => property.type ?? "")
    .join(" ");
  const numericValueTypes = source.statements.filter(
    (node) =>
      ts.isTypeAliasDeclaration(node) &&
      new RegExp(`\\b${node.name.text}\\b`).test(propertyTypes) &&
      ts.isTypeLiteralNode(node.type) &&
      node.type.members.some((member) => member.type?.kind === ts.SyntaxKind.NumberKeyword),
  );
  for (const type of numericValueTypes) {
    const publishedType = declarations.statements.find(
      (node) => ts.isTypeAliasDeclaration(node) && node.name.text === type.name.text,
    );
    matchingDocumentation(type, publishedType, type.name.text);
    assert.ok(
      ts.isTypeLiteralNode(publishedType.type),
      `Published value type changed: ${type.name.text}`,
    );
    assert.equal(publishedType.type.members.length, type.type.members.length);
    for (const field of type.type.members) {
      const name = field.name?.getText(source);
      assert.ok(name, `Unnamed value field: ${type.name.text}`);
      const publishedField = publishedType.type.members.find(
        (candidate) => candidate.name?.getText(declarations) === name,
      );
      matchingDocumentation(field, publishedField, `${type.name.text}.${name}`);
      fields++;
    }
    valueTypes++;
  }
}
console.log(
  `API documentation verified in source and published declarations: ${controllers} controllers, ${checked} API declarations, ${valueTypes} numeric value types, ${fields} fields`,
);
