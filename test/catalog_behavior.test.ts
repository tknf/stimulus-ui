/// <reference types="vite-plus/client" />

import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { server, userEvent } from "vite-plus/test/browser/context";
import "../catalog/catalog.css";
import { registerAll } from "../catalog/register";
import type { CatalogEngine, CatalogScenario } from "./catalog_scenarios/types";

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const pageModules = import.meta.glob<string>("../catalog/*.html", {
	eager: true,
	import: "default",
	query: "?raw",
});
const scenarioModules = import.meta.glob<{ scenario: CatalogScenario }>(
	"./catalog_scenarios/*.ts",
	{
		eager: true,
	},
);
const catalogPages = Object.entries(pageModules)
	.map(([path, html]) => ({ filename: path.split("/").at(-1) ?? "", html }))
	.filter(({ filename }) => filename !== "index.html")
	.sort((left, right) => left.filename.localeCompare(right.filename));
const engines: readonly CatalogEngine[] = ["chromium", "firefox", "webkit"];

const tokensFrom = (value: string | undefined) => value?.split(/\s+/).filter(Boolean) ?? [];

type ObservedOutputs = {
	dataAttributes: Set<string>;
	properties: Set<string>;
	states: Set<string>;
};

const collectOutputs = (
	element: HTMLElement,
	dataAttributes: readonly string[],
	outputs: ObservedOutputs,
) => {
	const state = element.getAttribute("data-state");
	if (state !== null) outputs.states.add(state);
	for (const attribute of dataAttributes) {
		if (element.hasAttribute(attribute)) outputs.dataAttributes.add(attribute);
	}
	for (let index = 0; index < element.style.length; index += 1) {
		const property = element.style.item(index);
		if (property.startsWith("--")) outputs.properties.add(property);
	}
};

const collectInitialOutputs = (
	main: HTMLElement,
	dataAttributes: readonly string[],
	outputs: ObservedOutputs,
) => {
	collectOutputs(main, dataAttributes, outputs);
	for (const element of main.querySelectorAll<HTMLElement>("*")) {
		collectOutputs(element, dataAttributes, outputs);
	}
};

let application: Application;
let previousWarn: typeof console.warn;
let warnings: string[];

beforeEach(() => {
	document.body.innerHTML = "";
	warnings = [];
	previousWarn = console.warn;
	console.warn = (message?: unknown) => warnings.push(String(message));
	application = Application.start();
	registerAll(application);
});

afterEach(async () => {
	try {
		const roots = [
			...(document.body.matches("[data-controller]") ? [document.body] : []),
			...Array.from(document.body.querySelectorAll<HTMLElement>("[data-controller]")),
		];
		for (const root of roots) {
			root.removeAttribute("data-controller");
		}
		await settle();
		application.stop();
		await settle();
		document.body.innerHTML = "";
		await settle();
	} finally {
		console.warn = previousWarn;
	}
});

for (const { filename, html } of catalogPages) {
	const name = filename.slice(0, -".html".length);

	test(`catalog/${filename} reproduces its declared behavior`, async () => {
		const parsed = new DOMParser().parseFromString(html, "text/html");
		const parsedMain = parsed.querySelector("main");
		if (parsedMain === null) throw new Error(`Missing main element in catalog/${filename}`);
		const bodyController = parsed.body.getAttribute("data-controller");
		if (bodyController !== null) document.body.setAttribute("data-controller", bodyController);
		const main = document.importNode(parsedMain, true) as HTMLElement;
		const states = tokensFrom(main.dataset.catalogStates);
		const properties = tokensFrom(main.dataset.catalogProperties);
		const events = tokensFrom(main.dataset.catalogEvents);
		const dataAttributes = states.filter((token) => token.startsWith("data-"));
		const stateValues = states.filter((token) => !token.startsWith("data-"));
		const outputs: ObservedOutputs = {
			dataAttributes: new Set(),
			properties: new Set(),
			states: new Set(),
		};
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				if (record.attributeName === "data-state" && record.oldValue !== null) {
					outputs.states.add(record.oldValue);
				}
				if (record.attributeName !== null && dataAttributes.includes(record.attributeName)) {
					outputs.dataAttributes.add(record.attributeName);
				}
				if (record.target instanceof HTMLElement) {
					collectOutputs(record.target, dataAttributes, outputs);
				}
			}
		});
		observer.observe(document.body, {
			attributeFilter: ["data-state", "style", ...dataAttributes],
			attributeOldValue: true,
			attributes: true,
			subtree: true,
		});

		const observedEvents = new Set<string>();
		const listeners = events.map((eventName) => {
			const listener = (event: Event) => {
				if (event.target instanceof Node && main.contains(event.target)) {
					observedEvents.add(event.type);
				}
			};
			document.addEventListener(eventName, listener, true);
			return { eventName, listener };
		});

		try {
			document.body.append(main);
			await settle();
			collectInitialOutputs(main, dataAttributes, outputs);

			const scenario = scenarioModules[`./catalog_scenarios/${name}.ts`]?.scenario;
			if (scenario === undefined) throw new Error(`Missing scenario for catalog/${filename}`);
			for (const skip of scenario.skips) {
				expect(engines).toContain(skip.engine);
				expect([...states, ...properties, ...events]).toContain(skip.token);
				expect(skip.reason.trim()).not.toBe("");
			}

			await scenario.run({ main, settle, userEvent });
			await settle();
			await settle();
			collectInitialOutputs(main, dataAttributes, outputs);

			const engine = server.browser as CatalogEngine;
			if (!engines.includes(engine)) throw new Error(`Unknown browser: ${server.browser}`);
			const skippedTokens = new Set(
				scenario.skips.filter((skip) => skip.engine === engine).map((skip) => skip.token),
			);
			const missing = [
				...stateValues.filter((token) => !skippedTokens.has(token) && !outputs.states.has(token)),
				...dataAttributes.filter(
					(token) => !skippedTokens.has(token) && !outputs.dataAttributes.has(token),
				),
				...properties.filter(
					(token) => !skippedTokens.has(token) && !outputs.properties.has(token),
				),
				...events.filter((token) => !skippedTokens.has(token) && !observedEvents.has(token)),
			];

			expect(
				missing,
				`Unobserved declarations in catalog/${filename}: ${missing.join(", ")}`,
			).toEqual([]);
			expect(warnings, `Warnings from catalog/${filename}:\n${warnings.join("\n")}`).toEqual([]);
		} finally {
			for (const { eventName, listener } of listeners) {
				document.removeEventListener(eventName, listener, true);
			}
			observer.disconnect();
		}
	});
}
