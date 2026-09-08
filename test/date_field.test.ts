import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import DateFieldController from "../src/date_field_controller";

type DateFieldPublicController = Controller & {
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
		`<form><input type="date" data-controller="date-field" aria-label="日付" min="2026-08-10" max="2026-08-30" step="1" value="2026-08-20" ${attributes}></form>`,
	);
	await settle();

	const form = document.body.lastElementChild;
	const root = form?.firstElementChild;
	if (!(form instanceof HTMLFormElement) || !(root instanceof HTMLInputElement)) {
		throw new Error("date-field root を作成できませんでした");
	}
	return { form, root };
};

const controllerFor = (root: HTMLInputElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"date-field",
	) as DateFieldPublicController | null;
	if (controller === null) throw new Error("date-field controller が接続されていません");
	return controller;
};

const changeDetails = (root: HTMLInputElement) => {
	const events: Array<{ type: string; detail: ChangeDetail }> = [];
	root.addEventListener("date-field:beforechange", (event) => {
		events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
	});
	root.addEventListener("date-field:change", (event) => {
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

// Chromium segment editing respects min/max, so mount() bounds fixed to one month
// would make month ArrowUp a no-op. Firefox and WebKit can move outside those bounds.
// Set bounds that contain changes to every engine's active segment before testing arrows:
// the month in Chromium/Firefox and the year in WebKit.
const widenRange = (root: HTMLInputElement) => {
	root.min = "2020-01-01";
	root.max = "2030-12-31";
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("date-field", DateFieldController);
});

afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("date-field", () => {
	test("[date-field-state-sync][date-field-state-sync-negative] Synchronizes min, max, between, and authored attributes", async () => {
		const { root } = await mount(
			'id="authored-date" name="date" aria-valuetext="日付" data-state="authored" style="--custom: preserved"',
		);

		expect(root.id).toBe("authored-date");
		expect(root.name).toBe("date");
		expect(root.getAttribute("aria-valuetext")).toBe("日付");
		expect(root.hasAttribute("role")).toBe(false);
		expect(root.dataset.state).toBe("between");
		expect(root.style.getPropertyValue("--custom")).toBe("preserved");

		root.value = "2026-08-10";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("min");

		root.value = "2026-08-30";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("max");

		root.removeAttribute("min");
		root.value = "2026-08-20";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");

		root.removeAttribute("max");
		root.value = "2026-08-30";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");

		root.value = "";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");

		const { form } = await mount();
		const resetRoot = form.firstElementChild;
		if (!(resetRoot instanceof HTMLInputElement)) throw new Error("reset root がありません");
		resetRoot.value = "2026-08-30";
		resetRoot.dispatchEvent(new Event("input", { bubbles: true }));
		expect(resetRoot.dataset.state).toBe("max");
		form.reset();
		await settle();
		expect(resetRoot.dataset.state).toBe("between");
	});

	test("[date-field-native-change] Checks trusted native changes and PageUp", async () => {
		const { root } = await mount();
		const events = changeDetails(root);
		const previousValue = root.value;

		widenRange(root);
		root.focus();
		await userEvent.keyboard("{ArrowUp}");
		await focusAway();

		expect(root.value).not.toBe(previousValue);
		expect(events.map(({ type }) => type)).toEqual([
			"date-field:beforechange",
			"date-field:change",
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
		if (pageEvents.some(({ type }) => type === "date-field:change")) {
			expect(pageField.root.value).not.toBe(pagePreviousValue);
			expect(pageEvents.map(({ type }) => type)).toEqual([
				"date-field:beforechange",
				"date-field:change",
			]);
			expect(pageEvents[1]?.detail.previousValue).toBe(pagePreviousValue);
			expect(pageEvents[1]?.detail.reason).toBe("keyboard");
		} else {
			expect(pageField.root.value).toBe(pagePreviousValue);
		}
	});

	test("[date-field-beforechange-cancel][date-field-beforechange-cancel-negative] Checks canceled and committed values, state, detail, order, and bubbling", async () => {
		const { root } = await mount();
		const events: Array<{ type: string; detail: ChangeDetail }> = [];
		let cancel = true;
		root.addEventListener("date-field:beforechange", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
			expect(event.bubbles).toBe(true);
			expect(event.cancelable).toBe(true);
			if (cancel) event.preventDefault();
		});
		root.addEventListener("date-field:change", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
			expect(event.bubbles).toBe(true);
			expect(event.cancelable).toBe(false);
		});

		const previousValue = root.value;
		widenRange(root);
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
			"date-field:beforechange",
			"date-field:change",
		]);
		expect(events[1]?.detail.previousValue).toBe(previousValue);
		expect(events[1]?.detail.value).toBe(root.value);
		expect(events[1]?.detail.reason).toBe("keyboard");
	});

	test("[date-field-programmatic-silence][date-field-programmatic-silence-negative] Emits no event from the value setter and synchronizes state for synthetic events", async () => {
		const { form, root } = await mount();
		const controller = controllerFor(root);
		const customEvents: Event[] = [];
		const nativeEvents: Event[] = [];
		root.addEventListener("date-field:beforechange", (event) => customEvents.push(event));
		root.addEventListener("date-field:change", (event) => customEvents.push(event));
		root.addEventListener("input", (event) => nativeEvents.push(event));
		root.addEventListener("change", (event) => nativeEvents.push(event));

		controller.value = "2026-08-30";
		expect(controller.value).toBe("2026-08-30");
		expect(root.dataset.state).toBe("max");
		expect(customEvents).toEqual([]);
		expect(nativeEvents).toEqual([]);

		root.value = "2026-08-10";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		root.dispatchEvent(new Event("change", { bubbles: true }));
		await settle();
		expect(root.dataset.state).toBe("min");
		expect(customEvents).toEqual([]);

		root.value = "2026-08-30";
		form.reset();
		await settle();
		expect(root.dataset.state).toBe("between");
		expect(customEvents).toEqual([]);
	});

	test("[date-field-semantic-validation][date-field-semantic-validation-negative] Warns once and disables an invalid root", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		const invalidMarkups = [
			'<button data-controller="date-field">日付</button>',
			'<input type="text" data-controller="date-field" value="2026-08-20">',
			'<input type="datetime-local" data-controller="date-field" value="2026-08-20T12:00">',
		];

		for (const [index, markup] of invalidMarkups.entries()) {
			document.body.insertAdjacentHTML("beforeend", markup);
			await settle();
			const root = document.body.lastElementChild;
			if (!(root instanceof HTMLElement)) throw new Error(`invalid root ${index} がありません`);
			expect(warnings).toHaveLength(index + 1);
			expect(warnings[index]).toBe(
				'date-field controller: Use a native <input type="date"> root. Enhancement has been disabled.',
			);
			expect(root.dataset.state).toBeUndefined();
		}
	});

	test("[date-field-disconnect-cleanup][date-field-disconnect-cleanup-negative] Prevents duplicate listeners and state updates across disconnect and reconnect", async () => {
		const { root } = await mount();
		const events: Event[] = [];
		root.addEventListener("date-field:change", (event) => events.push(event));

		root.removeAttribute("data-controller");
		await settle();
		root.value = "2026-08-10";
		root.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.dataset.state).toBe("between");

		root.setAttribute("data-controller", "date-field");
		await settle();
		expect(root.dataset.state).toBe("min");
		widenRange(root);
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
