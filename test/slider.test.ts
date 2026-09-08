import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import SliderController from "../src/slider_controller";

type SliderPublicController = Controller & { value: number };
type RangeSliderPublicController = Controller & { value: number; start: number; end: number };

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
		`<input type="range" data-controller="slider" aria-label="音量" min="10" max="30" step="5" value="20" ${attributes}>`,
	);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLInputElement)) throw new Error("slider root がありません");
	return root;
};

const mountWrapper = async (inputs: string, attributes = "") => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<div data-controller="slider" ${attributes}>${inputs}</div>`,
	);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("slider wrapper root がありません");
	return root;
};

const controllerFor = (root: HTMLInputElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"slider",
	) as SliderPublicController | null;
	if (controller === null) throw new Error("slider controller が接続されていません");
	return controller;
};

const controllerForWrapper = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"slider",
	) as RangeSliderPublicController | null;
	if (controller === null) throw new Error("slider wrapper controller が接続されていません");
	return controller;
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("slider", SliderController);
});

afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("slider", () => {
	test("[slider-state-sync][slider-custom-property-negative][slider-aria-untouched-negative] Synchronizes state, normalization, ARIA, and authored attributes", async () => {
		const root = await mount(
			'id="authored-slider" name="volume" aria-valuetext="静か" data-state="authored" style="--custom: preserved"',
		);

		expect(root.id).toBe("authored-slider");
		expect(root.name).toBe("volume");
		expect(root.min).toBe("10");
		expect(root.max).toBe("30");
		expect(root.step).toBe("5");
		expect(root.value).toBe("20");
		expect(root.getAttribute("aria-valuetext")).toBe("静か");
		expect(root.hasAttribute("aria-valuenow")).toBe(false);
		expect(root.dataset.state).toBe("between");
		expect(root.style.getPropertyValue("--slider-value")).toBe("0.5");
		expect(root.style.getPropertyValue("--custom")).toBe("preserved");

		root.value = "10";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		await settle();
		expect(root.dataset.state).toBe("min");
		expect(root.style.getPropertyValue("--slider-value")).toBe("0");
	});

	test("[slider-beforechange-cancel][slider-beforechange-cancel-negative] Checks event order for canceled and committed keyboard changes", async () => {
		const root = await mount();
		const events: Array<{ type: string; detail: ChangeDetail; target: EventTarget | null }> = [];
		let cancel = true;
		root.addEventListener("slider:beforechange", (event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<ChangeDetail>).detail,
				target: event.target,
			});
			expect(event.bubbles).toBe(true);
			expect(event.cancelable).toBe(true);
			if (cancel) event.preventDefault();
		});
		root.addEventListener("slider:change", (event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<ChangeDetail>).detail,
				target: event.target,
			});
			expect(event.bubbles).toBe(true);
			expect(event.cancelable).toBe(false);
		});

		root.focus();
		await userEvent.keyboard("{ArrowRight}");
		await settle();
		expect(root.value).toBe("20");
		expect(root.dataset.state).toBe("between");
		expect(root.style.getPropertyValue("--slider-value")).toBe("0.5");
		expect(events.map(({ type }) => type)).toEqual(["slider:beforechange"]);

		cancel = false;
		events.length = 0;
		root.blur();
		await settle();
		root.focus();
		await userEvent.keyboard("{ArrowRight}");
		await settle();
		expect(root.value).toBe("25");
		expect(events.map(({ type }) => type)).toEqual(["slider:beforechange", "slider:change"]);
		expect(events[0]?.detail).toEqual({ value: 25, previousValue: 20, reason: "keyboard" });
		expect(events[1]?.detail).toEqual({ value: 25, previousValue: 20, reason: "keyboard" });
		expect(events[1]?.target).toBe(root);
	});

	test("[slider-keyboard-reason] Delegates arrows, Home, and End to native ranges", async () => {
		const root = await mount();
		root.min = "0";
		root.max = "100";
		root.step = "10";
		root.value = "50";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		const details: ChangeDetail[] = [];
		root.addEventListener("slider:change", (event) => {
			details.push((event as CustomEvent<ChangeDetail>).detail);
		});

		root.focus();
		await userEvent.keyboard("{ArrowUp}");
		await userEvent.keyboard("{Home}");
		await userEvent.keyboard("{End}");
		await settle();
		expect(root.value).toBe("100");
		expect(details.map(({ reason }) => reason)).toEqual(["keyboard", "keyboard", "keyboard"]);
		expect(details.map(({ value, previousValue }) => [value, previousValue])).toEqual([
			[60, 50],
			[0, 60],
			[100, 0],
		]);
	});

	test("Reports native changes after pointer interaction with pointer reason", async () => {
		const root = await mount('style="width: 200px"');
		root.value = "10";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		const details: ChangeDetail[] = [];
		root.addEventListener("slider:change", (event) => {
			details.push((event as CustomEvent<ChangeDetail>).detail);
		});

		await userEvent.click(root);
		await settle();
		expect(root.valueAsNumber).not.toBe(10);
		expect(details).toHaveLength(1);
		expect(details[0]?.reason).toBe("pointer");
		expect(details[0]?.previousValue).toBe(10);
	});

	test("[slider-drag-silence][slider-drag-silence-negative] Updates only state outputs without custom events during continuous input", async () => {
		const root = await mount();
		const events: Event[] = [];
		root.addEventListener("slider:beforechange", (event) => events.push(event));
		root.addEventListener("slider:change", (event) => events.push(event));

		root.value = "25";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		root.value = "30";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		await settle();
		expect(root.value).toBe("30");
		expect(root.dataset.state).toBe("max");
		expect(root.style.getPropertyValue("--slider-value")).toBe("1");
		expect(events).toEqual([]);

		root.dispatchEvent(new Event("change", { bubbles: true }));
		await settle();
		expect(events).toEqual([]);
	});

	test("[slider-programmatic-silence][slider-programmatic-silence-negative] Synchronizes state without events for value setters and synthetic input/change", async () => {
		const root = await mount();
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("slider:beforechange", (event) => events.push(event));
		root.addEventListener("slider:change", (event) => events.push(event));

		controller.value = 30;
		expect(controller.value).toBe(30);
		expect(root.dataset.state).toBe("max");
		expect(root.style.getPropertyValue("--slider-value")).toBe("1");
		root.value = "10";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		root.dispatchEvent(new Event("change", { bubbles: true }));
		await settle();
		expect(controller.value).toBe(10);
		expect(root.dataset.state).toBe("min");
		expect(events).toEqual([]);
	});

	test("[slider-disabled-guard] Disabled native activation does nothing while public APIs can change values", async () => {
		const root = await mount("disabled");
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("slider:beforechange", (event) => events.push(event));
		root.addEventListener("slider:change", (event) => events.push(event));

		root.focus();
		await userEvent.keyboard("{ArrowRight}");
		await settle();
		expect(root.value).toBe("20");
		expect(events).toEqual([]);

		controller.value = 30;
		expect(root.value).toBe("30");
		expect(root.dataset.state).toBe("max");
		expect(events).toEqual([]);
	});

	test("[slider-form-semantics] Preserves native FormData and form-reset semantics", async () => {
		document.body.insertAdjacentHTML(
			"beforeend",
			'<form><input type="range" data-controller="slider" name="volume" min="0" max="100" step="10" value="40" aria-label="音量"></form>',
		);
		await settle();
		const form = document.body.lastElementChild;
		if (!(form instanceof HTMLFormElement)) throw new Error("form がありません");
		const root = form.querySelector<HTMLInputElement>('input[type="range"]');
		if (root === null) throw new Error("slider input がありません");

		expect(new FormData(form).get("volume")).toBe("40");
		root.value = "80";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(new FormData(form).get("volume")).toBe("80");
		form.reset();
		await settle();
		expect(root.value).toBe("40");
		expect(root.dataset.state).toBe("between");
		expect(root.style.getPropertyValue("--slider-value")).toBe("0.4");
	});

	test("[slider-disconnect-cleanup][slider-disconnect-cleanup-negative] Prevents duplicate listeners and events across disconnect and reconnect", async () => {
		const root = await mount();
		const events: Event[] = [];
		root.addEventListener("slider:change", (event) => events.push(event));

		root.removeAttribute("data-controller");
		await settle();
		root.focus();
		await userEvent.keyboard("{ArrowRight}");
		await settle();
		expect(events).toHaveLength(0);

		root.setAttribute("data-controller", "slider");
		await settle();
		await userEvent.keyboard("{ArrowRight}");
		await settle();
		expect(events).toHaveLength(1);
		expect(root.value).toBe("30");
		expect(root.dataset.state).toBe("max");

		root.removeAttribute("data-controller");
		await settle();
		await userEvent.keyboard("{ArrowLeft}");
		await settle();
		expect(events).toHaveLength(1);
	});

	test("[slider-semantic-validation][slider-semantic-validation-negative] Disables invalid roots with one warning", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		document.body.insertAdjacentHTML("beforeend", '<button data-controller="slider">音量</button>');
		await settle();
		const root = document.body.lastElementChild;
		if (!(root instanceof HTMLButtonElement)) throw new Error("invalid root がありません");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("slider controller");
		expect(warnings[0]).toContain('<input type="range">');
		expect(root.dataset.state).toBeUndefined();
		expect(root.style.getPropertyValue("--slider-value")).toBe("");
	});

	test("Delegates RTL arrows to native ranges", async () => {
		const root = await mount('dir="rtl"');
		root.min = "0";
		root.max = "100";
		root.step = "10";
		root.value = "50";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		root.focus();
		await userEvent.keyboard("{ArrowRight}");
		await settle();
		const expectedValue =
			navigator.userAgent.includes("AppleWebKit") && !navigator.userAgent.includes("Chrome")
				? 60
				: 40;
		expect(root.valueAsNumber).toBe(expectedValue);
	});

	test("[slider-range-structure][slider-range-structure-negative] Checks one/two input counts and warnings for invalid wrappers", async () => {
		const singleWrapper = await mountWrapper(
			'<input data-slider-target="input" type="range" aria-label="音量" min="10" max="30" step="5" value="20">',
		);
		expect(singleWrapper.dataset.state).toBe("between");
		expect(singleWrapper.style.getPropertyValue("--slider-value")).toBe("0.5");
		const singleController = controllerForWrapper(singleWrapper);
		expect(singleController.value).toBe(20);
		expect(Number.isNaN(singleController.start)).toBe(true);

		const rangeWrapper = await mountWrapper(
			'<input data-slider-target="input" type="range" aria-label="下限" min="0" max="100" step="10" value="20"><input data-slider-target="input" type="range" aria-label="上限" min="0" max="100" step="10" value="80">',
		);
		const rangeInputs = Array.from(
			rangeWrapper.querySelectorAll<HTMLInputElement>('input[type="range"]'),
		);
		expect(rangeInputs).toHaveLength(2);
		expect(rangeWrapper.dataset.state).toBe("partial");
		expect(rangeInputs[0]?.dataset.state).toBe("between");
		expect(rangeInputs[1]?.dataset.state).toBe("between");
		expect(controllerForWrapper(rangeWrapper).value).toBe(Number.NaN);

		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		const invalidMarkups = [
			'<div data-controller="slider" data-test-case="zero"></div>',
			'<div data-controller="slider" data-test-case="three"><input data-slider-target="input" type="range" min="0" max="100" value="10"><input data-slider-target="input" type="range" min="0" max="100" value="20"><input data-slider-target="input" type="range" min="0" max="100" value="30"></div>',
			'<div data-controller="slider" data-test-case="non-range"><input data-slider-target="input" type="number" value="10"></div>',
			'<div data-controller="slider" data-test-case="bounds"><input data-slider-target="input" type="range" min="0" max="100" value="10"><input data-slider-target="input" type="range" min="1" max="100" value="20"></div>',
		];
		document.body.insertAdjacentHTML("beforeend", invalidMarkups.join(""));
		await settle();

		expect(warnings).toHaveLength(invalidMarkups.length);
		for (const root of document.querySelectorAll<HTMLElement>("[data-test-case]")) {
			expect(root.dataset.state).toBeUndefined();
			expect(root.style.getPropertyValue("--slider-value")).toBe("");
			expect(root.style.getPropertyValue("--slider-range-start")).toBe("");
			expect(root.style.getPropertyValue("--slider-range-span")).toBe("");
		}
		expect(warnings.every((warning) => warning.includes("one or two"))).toBe(true);
	});

	test("[slider-range-constraint][slider-range-constraint-negative] Clamps crossing range values during trusted interaction, connection, APIs, and synthetic synchronization", async () => {
		const crossed = await mountWrapper(
			'<input data-slider-target="input" type="range" aria-label="下限" min="0" max="100" step="10" value="80"><input data-slider-target="input" type="range" aria-label="上限" min="0" max="100" step="10" value="20">',
		);
		const crossedInputs = Array.from(
			crossed.querySelectorAll<HTMLInputElement>('input[type="range"]'),
		);
		expect(crossedInputs.map((input) => input.valueAsNumber)).toEqual([20, 20]);

		const root = await mountWrapper(
			'<input data-slider-target="input" type="range" aria-label="下限" min="0" max="100" step="10" value="20"><input data-slider-target="input" type="range" aria-label="上限" min="0" max="100" step="10" value="60">',
		);
		const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="range"]'));
		const start = inputs[0];
		const end = inputs[1];
		if (start === undefined || end === undefined) throw new Error("range input がありません");
		const events: Event[] = [];
		root.addEventListener("slider:beforechange", (event) => events.push(event));
		root.addEventListener("slider:change", (event) => events.push(event));

		start.focus();
		await userEvent.keyboard("{End}");
		await settle();
		expect(start.valueAsNumber).toBe(60);
		expect(end.valueAsNumber).toBe(60);
		expect(events).toHaveLength(2);
		expect((events[1] as CustomEvent).detail.value).toBe(60);

		events.length = 0;
		await userEvent.keyboard("{End}");
		await settle();
		expect(start.valueAsNumber).toBe(60);
		expect(end.valueAsNumber).toBe(60);
		expect(events).toEqual([]);

		const controller = controllerForWrapper(root);
		controller.start = 90;
		expect(start.valueAsNumber).toBe(60);
		expect(controller.end).toBe(60);
		controller.end = 10;
		expect(end.valueAsNumber).toBe(60);
		expect(controller.start).toBe(60);
		expect(events).toEqual([]);

		start.value = "90";
		start.dispatchEvent(new Event("input", { bubbles: true }));
		end.value = "10";
		end.dispatchEvent(new Event("input", { bubbles: true }));
		await settle();
		expect(start.valueAsNumber).toBe(60);
		expect(end.valueAsNumber).toBe(60);
		expect(events).toEqual([]);
	});

	test("[slider-range-state-sync][slider-range-state-sync-negative] Synchronizes range state and custom properties and switching to a single input", async () => {
		const root = await mountWrapper(
			'<input data-slider-target="input" type="range" aria-label="下限" min="0" max="100" value="20"><input data-slider-target="input" type="range" aria-label="上限" min="0" max="100" value="80">',
		);
		const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="range"]'));
		const start = inputs[0];
		const end = inputs[1];
		if (start === undefined || end === undefined) throw new Error("range input がありません");

		expect(root.dataset.state).toBe("partial");
		expect(start.dataset.state).toBe("between");
		expect(end.dataset.state).toBe("between");
		expect(root.style.getPropertyValue("--slider-range-start")).toBe("0.2");
		expect(root.style.getPropertyValue("--slider-range-span")).toBe("0.6");
		expect(root.style.getPropertyValue("--slider-value")).toBe("");

		start.value = "0";
		start.dispatchEvent(new Event("input", { bubbles: true }));
		end.value = "100";
		end.dispatchEvent(new Event("input", { bubbles: true }));
		await settle();
		expect(root.dataset.state).toBe("full");
		expect(start.dataset.state).toBe("min");
		expect(end.dataset.state).toBe("max");
		expect(root.style.getPropertyValue("--slider-range-start")).toBe("0");
		expect(root.style.getPropertyValue("--slider-range-span")).toBe("1");

		end.removeAttribute("data-slider-target");
		await settle();
		expect(root.dataset.state).toBe("min");
		expect(start.hasAttribute("data-state")).toBe(false);
		expect(end.hasAttribute("data-state")).toBe(false);
		expect(root.style.getPropertyValue("--slider-value")).toBe("0");
		expect(root.style.getPropertyValue("--slider-range-start")).toBe("");
		expect(root.style.getPropertyValue("--slider-range-span")).toBe("");
	});

	test("[slider-range-events][slider-range-events-negative] Checks range-event thumbs, values, reasons, cancellation restoration, and single-input detail", async () => {
		const root = await mountWrapper(
			'<input data-slider-target="input" type="range" aria-label="下限" min="0" max="100" step="10" value="20"><input data-slider-target="input" type="range" aria-label="上限" min="0" max="100" step="10" value="60">',
		);
		const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="range"]'));
		const end = inputs[1];
		if (end === undefined) throw new Error("end input がありません");
		const events: Array<{ type: string; detail: ChangeDetail & { thumb?: "start" | "end" } }> = [];
		let cancel = true;
		root.addEventListener("slider:beforechange", (event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<ChangeDetail & { thumb?: "start" | "end" }>).detail,
			});
			if (cancel) event.preventDefault();
		});
		root.addEventListener("slider:change", (event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<ChangeDetail & { thumb?: "start" | "end" }>).detail,
			});
		});

		end.focus();
		await userEvent.keyboard("{ArrowLeft}");
		await settle();
		expect(end.valueAsNumber).toBe(60);
		expect(events).toHaveLength(1);
		expect(events[0]?.detail).toEqual({
			value: 50,
			previousValue: 60,
			reason: "keyboard",
			thumb: "end",
		});

		cancel = false;
		events.length = 0;
		end.blur();
		await settle();
		end.focus();
		await userEvent.keyboard("{ArrowLeft}");
		await settle();
		expect(end.valueAsNumber).toBe(50);
		expect(events.map(({ type }) => type)).toEqual(["slider:beforechange", "slider:change"]);
		expect(events[1]?.detail).toEqual({
			value: 50,
			previousValue: 60,
			reason: "keyboard",
			thumb: "end",
		});

		const single = await mount();
		let singleDetail: ChangeDetail | undefined;
		single.addEventListener("slider:change", (event) => {
			singleDetail = (event as CustomEvent<ChangeDetail>).detail;
		});
		single.focus();
		await userEvent.keyboard("{ArrowRight}");
		await settle();
		expect(singleDetail).toEqual({ value: 25, previousValue: 20, reason: "keyboard" });
		expect(Object.prototype.hasOwnProperty.call(singleDetail, "thumb")).toBe(false);
	});
});
