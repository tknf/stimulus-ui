import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import CharacterCountController from "../src/character_count_controller";

type CharacterCountField = HTMLInputElement | HTMLTextAreaElement;

type CharacterCountPublicController = Controller & {
	length: number;
	max: number;
	over: boolean;
	maxValue: number;
};

let application: Application;
let originalWarn: typeof console.warn;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const mount = async (
	fieldMarkup = '<input type="text" data-character-count-target="field" aria-label="本文" value="hello">',
	counterMarkup = '<span data-character-count-target="counter"></span>',
	rootAttributes = "",
) => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<form><div data-controller="character-count" ${rootAttributes}>${fieldMarkup}${counterMarkup}</div></form>`,
	);
	await settle();

	const form = document.body.lastElementChild;
	const root = form?.firstElementChild;
	const field = root?.querySelector('[data-character-count-target="field"]');
	const counter = root?.querySelector('[data-character-count-target="counter"]');
	if (
		!(form instanceof HTMLFormElement) ||
		!(root instanceof HTMLElement) ||
		!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
	) {
		throw new Error("character-count root と field target を作成できませんでした");
	}
	return {
		form,
		root,
		field: field as CharacterCountField,
		counter: counter instanceof HTMLElement ? counter : null,
	};
};

const mountRaw = async (markup: string) => {
	document.body.insertAdjacentHTML("beforeend", markup);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("character-count root がありません");
	return root;
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"character-count",
	) as CharacterCountPublicController | null;
	if (controller === null) throw new Error("character-count controller が接続されていません");
	return controller;
};

beforeEach(() => {
	document.body.replaceChildren();
	originalWarn = console.warn;
	application = Application.start();
	application.register("character-count", CharacterCountController);
});

afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	document.body.replaceChildren();
});

describe("character-count", () => {
	test("[character-count-value-output][character-count-value-output-negative] Checks initial synchronization, input tracking, UTF-16 code units, newlines, and unlimited values", async () => {
		const input = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" value="👍a">',
			"",
		);
		expect(input.root.style.getPropertyValue("--character-count-value")).toBe("3");
		expect(input.root.style.getPropertyValue("--character-count-max")).toBe("");
		expect(controllerFor(input.root).length).toBe(3);

		input.field.value = "👍ab";
		input.field.dispatchEvent(new Event("input", { bubbles: true }));
		expect(input.root.style.getPropertyValue("--character-count-value")).toBe("4");
		expect(controllerFor(input.root).length).toBe(4);

		const textarea = await mount(
			'<textarea data-character-count-target="field" aria-label="本文">a\nb</textarea>',
			"",
		);
		expect(textarea.root.style.getPropertyValue("--character-count-value")).toBe("3");
		expect(controllerFor(textarea.root).length).toBe(3);
	});

	test("[character-count-max-resolution][character-count-max-resolution-negative] Checks maxlength and max precedence and removal of limits", async () => {
		const both = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" maxlength="4" value="hello">',
			"",
			'data-character-count-max-value="9"',
		);
		expect(both.root.style.getPropertyValue("--character-count-max")).toBe("4");
		expect(controllerFor(both.root).max).toBe(4);

		const valueOnly = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" value="hello">',
			"",
			'data-character-count-max-value="6"',
		);
		expect(valueOnly.root.style.getPropertyValue("--character-count-max")).toBe("6");
		expect(controllerFor(valueOnly.root).max).toBe(6);

		const noMax = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" value="hello">',
			"",
		);
		expect(noMax.root.style.getPropertyValue("--character-count-max")).toBe("");
		expect(controllerFor(noMax.root).max).toBe(0);

		const zero = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" value="hello">',
			"",
			'data-character-count-max-value="0"',
		);
		expect(zero.root.style.getPropertyValue("--character-count-max")).toBe("");

		const negative = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" value="hello">',
			"",
			'data-character-count-max-value="-1"',
		);
		expect(negative.root.style.getPropertyValue("--character-count-max")).toBe("");

		const controller = controllerFor(valueOnly.root);
		controller.maxValue = 0;
		await settle();
		expect(valueOnly.root.style.getPropertyValue("--character-count-max")).toBe("");
		expect(controller.max).toBe(0);
	});

	test("[character-count-over-state][character-count-over-state-negative] Adds and clears overflow state", async () => {
		const maxValue = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" value="abcd">',
			"",
			'data-character-count-max-value="3"',
		);
		expect(maxValue.root.dataset.state).toBe("over");
		expect(controllerFor(maxValue.root).over).toBe(true);

		maxValue.field.value = "ab";
		maxValue.field.dispatchEvent(new Event("input", { bubbles: true }));
		expect(maxValue.root.dataset.state).toBeUndefined();
		expect(controllerFor(maxValue.root).over).toBe(false);

		const noMax = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" value="abcd">',
			"",
		);
		expect(noMax.root.dataset.state).toBeUndefined();

		const maxlength = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" maxlength="3" value="abcd">',
			"",
			'data-character-count-max-value="9"',
		);
		expect(maxlength.root.dataset.state).toBe("over");
	});

	test("[character-count-describedby-wiring][character-count-describedby-wiring-negative] Assigns the counter ID and references it through aria-describedby", async () => {
		const authored = await mount(
			'<input type="text" data-character-count-target="field" id="authored-field" aria-label="本文" aria-describedby="field-help" value="hello">',
			'<span data-character-count-target="counter" id="authored-counter"></span>',
		);
		expect(authored.field.id).toBe("authored-field");
		expect(authored.counter?.id).toBe("authored-counter");
		expect(authored.field.getAttribute("aria-describedby")?.split(" ")).toEqual([
			"field-help",
			"authored-counter",
		]);

		const first = await mount();
		const second = await mount();
		if (first.counter === null || second.counter === null)
			throw new Error("counter target がありません");
		expect(first.counter.id).not.toBe("");
		expect(second.counter.id).not.toBe("");
		expect(first.counter.id).not.toBe(second.counter.id);
		expect(first.field.getAttribute("aria-describedby")).toBe(first.counter.id);
		expect(second.field.getAttribute("aria-describedby")).toBe(second.counter.id);

		const withoutCounter = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" value="hello">',
			"",
		);
		expect(withoutCounter.field.hasAttribute("aria-describedby")).toBe(false);
	});

	test("[character-count-event-silence] Emits no custom events for input, public APIs, reconnection, or form reset", async () => {
		const mounted = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" value="hello">',
			"",
			'data-character-count-max-value="8"',
		);
		const customEvents: Event[] = [];
		const collect = (event: Event) => customEvents.push(event);
		mounted.root.addEventListener("character-count:beforechange", collect);
		mounted.root.addEventListener("character-count:change", collect);

		mounted.field.value = "changed";
		mounted.field.dispatchEvent(new Event("input", { bubbles: true }));
		const controller = controllerFor(mounted.root);
		void controller.length;
		void controller.max;
		void controller.over;
		controller.maxValue = 3;
		await settle();
		mounted.form.reset();
		await settle();

		mounted.root.removeAttribute("data-controller");
		await settle();
		mounted.root.setAttribute("data-controller", "character-count");
		await settle();
		expect(customEvents).toEqual([]);
	});

	test("[character-count-aria-live-absence][character-count-aria-live-absence-negative] Preserves authored values without generating aria-live attributes", async () => {
		const absent = await mount();
		if (absent.counter === null) throw new Error("counter target がありません");
		for (const element of [absent.root, absent.counter]) {
			expect(element.hasAttribute("aria-live")).toBe(false);
			expect(element.hasAttribute("aria-atomic")).toBe(false);
			expect(element.getAttribute("role")).not.toBe("status");
		}

		const authored = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" value="hello">',
			'<span data-character-count-target="counter" aria-live="assertive" aria-atomic="true" role="status"></span>',
			'aria-live="polite" aria-atomic="false" role="status"',
		);
		expect(authored.root.getAttribute("aria-live")).toBe("polite");
		expect(authored.root.getAttribute("aria-atomic")).toBe("false");
		expect(authored.root.getAttribute("role")).toBe("status");
		expect(authored.counter?.getAttribute("aria-live")).toBe("assertive");
		expect(authored.counter?.getAttribute("aria-atomic")).toBe("true");
		expect(authored.counter?.getAttribute("role")).toBe("status");
	});

	test("[character-count-semantic-validation][character-count-semantic-validation-negative] Warns once and disables enhancement for invalid markup", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		const invalidMarkups = [
			'<div data-controller="character-count"><span data-character-count-target="counter"></span></div>',
			'<div data-controller="character-count"><input type="text" data-character-count-target="field"><textarea data-character-count-target="field"></textarea></div>',
			'<div data-controller="character-count"><input type="number" data-character-count-target="field"><span data-character-count-target="counter"></span></div>',
			'<div data-controller="character-count"><input type="date" data-character-count-target="field"><span data-character-count-target="counter"></span></div>',
			'<div data-controller="character-count"><input type="checkbox" data-character-count-target="field"><span data-character-count-target="counter"></span></div>',
			'<div data-controller="character-count"><input type="text" data-character-count-target="field"><span data-character-count-target="counter"></span><span data-character-count-target="counter"></span></div>',
		];

		for (const [index, markup] of invalidMarkups.entries()) {
			const root = await mountRaw(markup);
			expect(warnings).toHaveLength(index + 1);
			expect(warnings[index]).toContain("character-count controller");
			expect(warnings[index]).toContain("Provide exactly one");
			expect(warnings[index]).toContain("Enhancement has been disabled");
			expect(root.style.getPropertyValue("--character-count-value")).toBe("");
			expect(root.style.getPropertyValue("--character-count-max")).toBe("");
			expect(root.dataset.state).toBeUndefined();
			const field = root.querySelector('[data-character-count-target="field"]');
			if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
				expect(field.hasAttribute("aria-describedby")).toBe(false);
			}
		}

		const invalid = document.body.lastElementChild;
		if (!(invalid instanceof HTMLElement)) throw new Error("invalid root がありません");
		controllerFor(invalid).maxValue = 5;
		await settle();
		expect(warnings).toHaveLength(invalidMarkups.length);
	});

	test("[character-count-disconnect-cleanup][character-count-disconnect-cleanup-negative] Removes listeners on disconnect and reconnect while retaining outputs", async () => {
		const mounted = await mount(
			'<input type="text" data-character-count-target="field" aria-label="本文" value="hello">',
			"",
			'data-character-count-max-value="10"',
		);
		expect(mounted.root.style.getPropertyValue("--character-count-value")).toBe("5");

		mounted.field.value = "changed";
		mounted.field.dispatchEvent(new Event("input", { bubbles: true }));
		expect(mounted.root.style.getPropertyValue("--character-count-value")).toBe("7");

		mounted.root.removeAttribute("data-controller");
		await settle();
		mounted.field.value = "detached";
		mounted.field.dispatchEvent(new Event("input", { bubbles: true }));
		mounted.form.reset();
		await settle();
		expect(mounted.root.style.getPropertyValue("--character-count-value")).toBe("7");

		mounted.field.value = "reconnected";
		mounted.root.setAttribute("data-controller", "character-count");
		await settle();
		expect(mounted.root.style.getPropertyValue("--character-count-value")).toBe("11");

		mounted.root.removeAttribute("data-controller");
		await settle();
		mounted.root.setAttribute("data-controller", "character-count");
		await settle();
		mounted.field.value = "again";
		mounted.field.dispatchEvent(new Event("input", { bubbles: true }));
		expect(mounted.root.style.getPropertyValue("--character-count-value")).toBe("5");
	});
});
