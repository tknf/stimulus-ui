import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import TimeFieldController from "../src/time_field_controller";

type TimeFieldPublicController = Controller & {
	value: string;
};

type ChangeDetail = {
	value: string;
	previousValue: string;
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
		`<form><input type="time" data-controller="time-field" aria-label="時刻" min="09:00" max="18:00" value="12:00" ${attributes}></form>`,
	);
	await settle();

	const form = document.body.lastElementChild;
	const root = form?.firstElementChild;
	if (!(form instanceof HTMLFormElement) || !(root instanceof HTMLInputElement)) {
		throw new Error("time-field root を作成できませんでした");
	}
	return { form, root };
};

const controllerFor = (root: HTMLInputElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"time-field",
	) as TimeFieldPublicController | null;
	if (controller === null) throw new Error("time-field controller が接続されていません");
	return controller;
};

const changeDetails = (root: HTMLInputElement) => {
	const events: Array<{ type: string; detail: ChangeDetail }> = [];
	root.addEventListener("time-field:beforechange", (event) => {
		events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
	});
	root.addEventListener("time-field:change", (event) => {
		events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
	});
	return events;
};

const focusAway = async () => {
	const sentinel = document.createElement("button");
	sentinel.type = "button";
	document.body.append(sentinel);
	sentinel.focus();
	await settle();
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("time-field", TimeFieldController);
});

afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("time-field", () => {
	test("[time-field-state-sync][time-field-state-sync-negative] Synchronizes min, max, between, and authored attributes", async () => {
		const { root } = await mount(
			'id="authored-time" name="time" aria-valuetext="時刻" data-state="authored" style="--custom: preserved"',
		);

		expect(root.id).toBe("authored-time");
		expect(root.name).toBe("time");
		expect(root.getAttribute("aria-valuetext")).toBe("時刻");
		expect(root.hasAttribute("role")).toBe(false);
		expect(root.dataset.state).toBe("between");
		expect(root.style.getPropertyValue("--custom")).toBe("preserved");

		root.value = "09:00";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("min");

		root.value = "18:00";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("max");

		root.removeAttribute("min");
		root.value = "12:00";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");

		root.removeAttribute("max");
		root.value = "18:00";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");

		root.value = "";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");

		const { form } = await mount();
		const resetRoot = form.firstElementChild;
		if (!(resetRoot instanceof HTMLInputElement)) throw new Error("reset root がありません");
		resetRoot.value = "18:00";
		resetRoot.dispatchEvent(new Event("input", { bubbles: true }));
		expect(resetRoot.dataset.state).toBe("max");
		form.reset();
		await settle();
		expect(resetRoot.dataset.state).toBe("between");
	});

	test("[time-field-bound-resolution][time-field-bound-resolution-negative] Checks min/max, values with seconds, and invalid bounds through valueAsNumber", async () => {
		const { root } = await mount();
		root.step = "1";
		root.min = "10:30";
		root.max = "18:00";
		root.value = "10:30:00";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("min");

		root.value = "18:00:00";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("max");

		root.value = "10:30:15";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");

		root.min = "abc";
		root.value = "12:00";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");

		root.min = "10:30";
		root.max = "abc";
		root.value = "12:00";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");
	});

	test("[time-field-native-change] Checks trusted native changes and PageUp", async () => {
		const { root } = await mount();
		const events = changeDetails(root);
		const previousValue = root.value;

		root.focus();
		await userEvent.keyboard("{ArrowUp}");
		await focusAway();

		expect(root.value).not.toBe(previousValue);
		expect(events.map(({ type }) => type)).toEqual([
			"time-field:beforechange",
			"time-field:change",
		]);
		expect(events[0]?.detail.previousValue).toBe(previousValue);
		expect(events[1]?.detail.previousValue).toBe(previousValue);
		expect(events[1]?.detail.value).toBe(root.value);
		expect(events[0]?.detail.reason).toBe("keyboard");
		expect(events[1]?.detail.reason).toBe("keyboard");

		const pageField = await mount();
		const pageEvents = changeDetails(pageField.root);
		const pagePreviousValue = pageField.root.value;
		const defaultPrevented: boolean[] = [];
		pageField.root.addEventListener("keydown", (event) => {
			if (event.key === "PageUp") defaultPrevented.push(event.defaultPrevented);
		});

		pageField.root.focus();
		await userEvent.keyboard("{PageUp}");
		await focusAway();

		expect(defaultPrevented).toEqual([false]);
		if (pageEvents.some(({ type }) => type === "time-field:change")) {
			expect(pageField.root.value).not.toBe(pagePreviousValue);
			expect(pageEvents.map(({ type }) => type)).toEqual([
				"time-field:beforechange",
				"time-field:change",
			]);
			expect(pageEvents[1]?.detail.previousValue).toBe(pagePreviousValue);
			expect(pageEvents[1]?.detail.reason).toBe("keyboard");
		} else {
			expect(pageField.root.value).toBe(pagePreviousValue);
		}
	});

	test("[time-field-beforechange-cancel][time-field-beforechange-cancel-negative] Checks canceled and committed values, state, detail, order, and bubbling", async () => {
		const { root } = await mount();
		const events: Array<{ type: string; detail: ChangeDetail }> = [];
		let cancel = true;
		root.addEventListener("time-field:beforechange", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
			expect(event.bubbles).toBe(true);
			expect(event.cancelable).toBe(true);
			if (cancel) event.preventDefault();
		});
		root.addEventListener("time-field:change", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
			expect(event.bubbles).toBe(true);
			expect(event.cancelable).toBe(false);
		});

		const previousValue = root.value;
		root.focus();
		await userEvent.keyboard("{ArrowUp}");
		await focusAway();
		expect(root.value).toBe(previousValue);
		expect(root.dataset.state).toBe("between");
		expect(events).toHaveLength(1);
		expect(events[0]?.detail.previousValue).toBe(previousValue);
		expect(events[0]?.detail.value).not.toBe(previousValue);
		expect(events[0]?.detail.reason).toBe("keyboard");

		cancel = false;
		events.length = 0;
		root.focus();
		await userEvent.keyboard("{ArrowUp}");
		await focusAway();
		expect(root.value).not.toBe(previousValue);
		expect(events.map(({ type }) => type)).toEqual([
			"time-field:beforechange",
			"time-field:change",
		]);
		expect(events[1]?.detail.previousValue).toBe(previousValue);
		expect(events[1]?.detail.value).toBe(root.value);
		expect(events[1]?.detail.reason).toBe("keyboard");
	});

	test("[time-field-programmatic-silence][time-field-programmatic-silence-negative] Synchronizes without events for value setters or synthetic events", async () => {
		const { form, root } = await mount();
		const controller = controllerFor(root);
		const customEvents: Event[] = [];
		const nativeEvents: Event[] = [];
		root.addEventListener("time-field:beforechange", (event) => customEvents.push(event));
		root.addEventListener("time-field:change", (event) => customEvents.push(event));
		root.addEventListener("input", (event) => nativeEvents.push(event));
		root.addEventListener("change", (event) => nativeEvents.push(event));

		controller.value = "18:00";
		expect(controller.value).toBe("18:00");
		expect(root.dataset.state).toBe("max");
		expect(customEvents).toEqual([]);
		expect(nativeEvents).toEqual([]);

		root.value = "09:00";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		root.dispatchEvent(new Event("change", { bubbles: true }));
		await settle();
		expect(root.dataset.state).toBe("min");
		expect(customEvents).toEqual([]);

		root.value = "18:00";
		form.reset();
		await settle();
		expect(root.dataset.state).toBe("between");
		expect(customEvents).toEqual([]);
	});

	test("[time-field-semantic-validation][time-field-semantic-validation-negative] Disables invalid roots with one warning", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		const invalidMarkups = [
			'<button data-controller="time-field">時刻</button>',
			'<input type="text" data-controller="time-field" value="12:00">',
			'<input type="datetime-local" data-controller="time-field" value="2026-08-20T12:00">',
		];

		for (const [index, markup] of invalidMarkups.entries()) {
			document.body.insertAdjacentHTML("beforeend", markup);
			await settle();
			const root = document.body.lastElementChild;
			if (!(root instanceof HTMLElement)) throw new Error(`invalid root ${index} がありません`);
			expect(warnings).toHaveLength(index + 1);
			expect(warnings[index]).toBe(
				'time-field controller: Use an <input type="time"> root. Enhancement has been disabled.',
			);
			expect(root.dataset.state).toBeUndefined();
		}
	});

	test("[time-field-disconnect-cleanup][time-field-disconnect-cleanup-negative] Resynchronizes state without duplicate listeners across disconnect and reconnect", async () => {
		const { root } = await mount();
		const events: Event[] = [];
		root.addEventListener("time-field:change", (event) => events.push(event));

		root.removeAttribute("data-controller");
		await settle();
		root.value = "09:00";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");

		root.setAttribute("data-controller", "time-field");
		await settle();
		expect(root.dataset.state).toBe("min");
		root.focus();
		await userEvent.keyboard("{ArrowUp}");
		await focusAway();
		expect(events).toHaveLength(1);

		root.removeAttribute("data-controller");
		await settle();
		await userEvent.keyboard("{ArrowDown}");
		await settle();
		expect(events).toHaveLength(1);
	});
});
