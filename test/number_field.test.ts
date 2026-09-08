import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import NumberFieldController from "../src/number_field_controller";

type NumberFieldPublicController = Controller & {
	value: number;
	pageStepValue: number;
};

type ChangeDetail = {
	value: number;
	previousValue: number;
	reason: "pointer" | "keyboard";
};

let application: Application;
let originalWarn: typeof console.warn;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const mount = async (attributes = "") => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<form><input type="number" data-controller="number-field" aria-label="数量" min="10" max="30" step="5" value="20" ${attributes}></form>`,
	);
	await settle();

	const form = document.body.lastElementChild;
	const root = form?.firstElementChild;
	if (!(form instanceof HTMLFormElement) || !(root instanceof HTMLInputElement)) {
		throw new Error("number-field root を作成できませんでした");
	}
	return { form, root };
};

const controllerFor = (root: HTMLInputElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"number-field",
	) as NumberFieldPublicController | null;
	if (controller === null) throw new Error("number-field controller が接続されていません");
	return controller;
};

const changeDetails = (root: HTMLInputElement) => {
	const events: Array<{ type: string; detail: ChangeDetail }> = [];
	root.addEventListener("number-field:beforechange", (event) => {
		events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
	});
	root.addEventListener("number-field:change", (event) => {
		events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
	});
	return events;
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("number-field", NumberFieldController);
});

afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("number-field", () => {
	test("[number-field-state-sync][number-field-state-sync-negative] Synchronizes min, max, between, and authored attributes", async () => {
		const { root } = await mount(
			'id="authored-number" name="quantity" aria-valuetext="個数" data-state="authored" style="--custom: preserved"',
		);

		expect(root.id).toBe("authored-number");
		expect(root.name).toBe("quantity");
		expect(root.getAttribute("aria-valuetext")).toBe("個数");
		expect(root.hasAttribute("aria-valuenow")).toBe(false);
		expect(root.dataset.state).toBe("between");
		expect(root.style.getPropertyValue("--custom")).toBe("preserved");

		root.value = "10";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("min");

		root.value = "30";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("max");

		root.removeAttribute("min");
		root.value = "0";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");

		root.value = "";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");
		expect(root.style.getPropertyValue("--number-field-value")).toBe("");

		const { form } = await mount();
		const resetRoot = form.firstElementChild;
		if (!(resetRoot instanceof HTMLInputElement)) throw new Error("reset root がありません");
		resetRoot.value = "30";
		resetRoot.dispatchEvent(new Event("input", { bubbles: true }));
		form.reset();
		await settle();
		expect(resetRoot.dataset.state).toBe("between");
	});

	test("[number-field-page-keys][number-field-page-keys-negative] Checks PageUp/PageDown, clamping, step any, preventDefault, disabled, readonly, and Home/End", async () => {
		const { root } = await mount('data-number-field-page-step-value="2"');
		root.min = "0";
		root.max = "100";
		root.step = "5";
		root.value = "50";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		const defaultPrevented: boolean[] = [];
		root.addEventListener("keydown", (event) => {
			if (event.key === "PageUp" || event.key === "PageDown") {
				defaultPrevented.push(event.defaultPrevented);
			}
		});

		root.focus();
		await userEvent.keyboard("{PageUp}");
		await settle();
		expect(root.valueAsNumber).toBe(60);
		await userEvent.keyboard("{PageDown}");
		await settle();
		expect(root.valueAsNumber).toBe(50);
		expect(defaultPrevented).toEqual([true, true]);

		root.value = "95";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		await userEvent.keyboard("{PageUp}");
		await settle();
		expect(root.valueAsNumber).toBe(100);
		root.value = "5";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		await userEvent.keyboard("{PageDown}");
		await settle();
		expect(root.valueAsNumber).toBe(0);

		root.value = "50";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		await userEvent.keyboard("{Home}");
		await userEvent.keyboard("{End}");
		await settle();
		expect(root.valueAsNumber).toBe(50);

		const anyField = await mount('data-number-field-page-step-value="3"');
		anyField.root.min = "0";
		anyField.root.max = "100";
		anyField.root.step = "any";
		anyField.root.value = "50";
		anyField.root.dispatchEvent(new Event("input", { bubbles: true }));
		anyField.root.focus();
		await userEvent.keyboard("{PageUp}");
		await settle();
		expect(anyField.root.valueAsNumber).toBe(53);
		await userEvent.keyboard("{PageDown}");
		await settle();
		expect(anyField.root.valueAsNumber).toBe(50);

		anyField.root.blur();
		const disabled = await mount("disabled");
		disabled.root.focus();
		await userEvent.keyboard("{PageUp}");
		await settle();
		expect(disabled.root.valueAsNumber).toBe(20);

		const readOnly = await mount("readonly");
		readOnly.root.focus();
		await userEvent.keyboard("{PageUp}");
		await settle();
		expect(readOnly.root.valueAsNumber).toBe(20);
	});

	test("[number-field-beforechange-cancel][number-field-beforechange-cancel-negative] Checks canceled and committed values, state, detail, order, and bubbling", async () => {
		const { root } = await mount('data-number-field-page-step-value="1"');
		const events: Array<{ type: string; detail: ChangeDetail }> = [];
		let cancel = true;
		root.addEventListener("number-field:beforechange", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
			expect(event.bubbles).toBe(true);
			expect(event.cancelable).toBe(true);
			if (cancel) event.preventDefault();
		});
		root.addEventListener("number-field:change", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
			expect(event.bubbles).toBe(true);
			expect(event.cancelable).toBe(false);
		});

		root.focus();
		await userEvent.keyboard("{PageUp}");
		await settle();
		expect(root.valueAsNumber).toBe(20);
		expect(root.dataset.state).toBe("between");
		expect(events).toHaveLength(1);
		expect(events[0]?.detail).toEqual({ value: 25, previousValue: 20, reason: "keyboard" });

		cancel = false;
		events.length = 0;
		await userEvent.keyboard("{PageUp}");
		await settle();
		expect(root.valueAsNumber).toBe(25);
		expect(root.dataset.state).toBe("between");
		expect(events.map(({ type }) => type)).toEqual([
			"number-field:beforechange",
			"number-field:change",
		]);
		expect(events[1]?.detail).toEqual({ value: 25, previousValue: 20, reason: "keyboard" });
	});

	test("[number-field-native-change] Reports reasons for trusted native changes from typing and ArrowUp", async () => {
		const { root } = await mount();
		root.min = "0";
		root.max = "100";
		root.step = "5";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		const events = changeDetails(root);

		root.value = "";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		root.focus();
		await userEvent.keyboard("25");
		root.blur();
		await settle();
		expect(root.valueAsNumber).toBe(25);
		expect(events.map(({ type }) => type)).toEqual([
			"number-field:beforechange",
			"number-field:change",
		]);
		expect(events[1]?.detail).toEqual({ value: 25, previousValue: Number.NaN, reason: "keyboard" });

		events.length = 0;
		root.focus();
		await userEvent.keyboard("{ArrowUp}");
		await settle();
		expect(root.valueAsNumber).toBe(30);
		expect(events.map(({ type }) => type)).toEqual([
			"number-field:beforechange",
			"number-field:change",
		]);
		expect(events[1]?.detail).toEqual({ value: 30, previousValue: 25, reason: "keyboard" });
	});

	test("[number-field-programmatic-silence][number-field-programmatic-silence-negative] Synchronizes without events for value setters or synthetic events", async () => {
		const { form, root } = await mount();
		const controller = controllerFor(root);
		const customEvents: Event[] = [];
		const nativeEvents: Event[] = [];
		root.addEventListener("number-field:beforechange", (event) => customEvents.push(event));
		root.addEventListener("number-field:change", (event) => customEvents.push(event));
		root.addEventListener("input", (event) => nativeEvents.push(event));
		root.addEventListener("change", (event) => nativeEvents.push(event));

		controller.value = 30;
		expect(controller.value).toBe(30);
		expect(root.dataset.state).toBe("max");
		expect(customEvents).toEqual([]);
		expect(nativeEvents).toEqual([]);

		root.value = "10";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		root.dispatchEvent(new Event("change", { bubbles: true }));
		await settle();
		expect(root.dataset.state).toBe("min");
		expect(customEvents).toEqual([]);

		root.value = "30";
		form.reset();
		await settle();
		expect(root.dataset.state).toBe("between");
		expect(customEvents).toEqual([]);
	});

	test("[number-field-semantic-validation][number-field-semantic-validation-negative] Disables invalid roots or pageStep with one warning", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		const invalidMarkups = [
			'<button data-controller="number-field" data-number-field-page-step-value="1">数量</button>',
			'<input type="text" data-controller="number-field" data-number-field-page-step-value="1" value="20">',
			'<input type="number" data-controller="number-field" data-number-field-page-step-value="0" value="20">',
			'<input type="number" data-controller="number-field" data-number-field-page-step-value="-1" value="20">',
			'<input type="number" data-controller="number-field" data-number-field-page-step-value="1.5" value="20">',
			'<input type="number" data-controller="number-field" data-number-field-page-step-value="NaN" value="20">',
		];

		for (const [index, markup] of invalidMarkups.entries()) {
			document.body.insertAdjacentHTML("beforeend", markup);
			await settle();
			const root = document.body.lastElementChild;
			if (!(root instanceof HTMLElement)) throw new Error(`invalid root ${index} がありません`);
			expect(warnings).toHaveLength(index + 1);
			expect(warnings[index]).toContain("number-field controller");
			expect(warnings[index]).toContain('<input type="number">');
			expect(warnings[index]).toContain("positive integer");
			expect(warnings[index]).toContain("Enhancement has been disabled");
			expect(root.dataset.state).toBeUndefined();
		}

		const valid = await mount('data-number-field-page-step-value="2"');
		const controller = controllerFor(valid.root);
		controller.pageStepValue = 0;
		await settle();
		expect(warnings).toHaveLength(invalidMarkups.length + 1);
		expect(valid.root.dataset.state).toBeUndefined();
		controller.value = 30;
		expect(valid.root.value).toBe("20");

		controller.pageStepValue = 2;
		await settle();
		expect(valid.root.dataset.state).toBe("between");
		expect(warnings).toHaveLength(invalidMarkups.length + 1);
	});

	test("[number-field-disconnect-cleanup][number-field-disconnect-cleanup-negative] Resynchronizes state without duplicate listeners across disconnect and reconnect", async () => {
		const { root } = await mount();
		const events: Event[] = [];
		root.addEventListener("number-field:change", (event) => events.push(event));

		root.removeAttribute("data-controller");
		await settle();
		root.focus();
		await userEvent.keyboard("{ArrowUp}");
		await settle();
		expect(events).toHaveLength(0);

		root.setAttribute("data-controller", "number-field");
		await settle();
		expect(root.dataset.state).toBe("between");
		await userEvent.keyboard("{ArrowUp}");
		await settle();
		expect(events).toHaveLength(1);
		expect(root.valueAsNumber).toBe(30);

		root.removeAttribute("data-controller");
		await settle();
		await userEvent.keyboard("{ArrowDown}");
		await settle();
		expect(events).toHaveLength(1);
	});
});
