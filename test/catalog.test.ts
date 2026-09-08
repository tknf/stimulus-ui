/// <reference types="vite-plus/client" />

import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { registerAll } from "../catalog/register";

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

const catalogPages = Object.entries(pageModules)
	.map(([path, html]) => ({ filename: path.split("/").at(-1) ?? "", html }))
	.filter(({ filename }) => filename !== "index.html")
	.sort((left, right) => left.filename.localeCompare(right.filename));

let application: Application;

beforeEach(() => {
	document.body.innerHTML = "";
	application = Application.start();
	registerAll(application);
});

afterEach(async () => {
	document.body.removeAttribute("data-controller");
	await settle();
	application.stop();
	document.body.innerHTML = "";
});

for (const { filename, html } of catalogPages) {
	const name = filename.slice(0, -".html".length);

	test(`catalog/${filename} connects without warnings`, async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));

		try {
			const parsed = new DOMParser().parseFromString(html, "text/html");
			const main = parsed.querySelector("main");
			if (main === null) throw new Error(`Missing main element in catalog/${filename}`);
			const bodyController = parsed.body.getAttribute("data-controller");
			if (bodyController !== null) document.body.setAttribute("data-controller", bodyController);

			for (const child of main.children) {
				document.body.append(document.importNode(child, true));
			}

			await settle();

			const roots = [
				...(document.body.matches("[data-controller]") ? [document.body] : []),
				...Array.from(document.body.querySelectorAll<HTMLElement>("[data-controller]")),
			];
			expect(roots, `No data-controller elements in catalog/${filename}`).not.toHaveLength(0);

			for (const root of roots) {
				for (const identifier of root.dataset.controller?.split(/\s+/) ?? []) {
					const controller = application.getControllerForElementAndIdentifier(root, identifier);
					expect(
						controller,
						`${identifier} controller is not connected: ${root.outerHTML.slice(0, 200)}`,
					).not.toBeNull();
				}
			}

			expect(warnings, `Warnings from catalog/${name}.html:\n${warnings.join("\n")}`).toEqual([]);
		} finally {
			console.warn = previousWarn;
		}
	});
}
