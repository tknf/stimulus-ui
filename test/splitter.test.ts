import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import SplitterController from "../src/splitter_controller";

type PublicSplitterController = Controller & {
	value: number;
	collapse: () => void;
	expand: () => void;
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

const rangeMarkup =
	'<input type="range" aria-label="Primary ratio" data-splitter-target="range" style="position:absolute;top:110px;width:100px">';

const mount = async (
	attributes = "",
	handleAttributes = "",
	primaryAttributes = "",
	range = rangeMarkup,
) => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<div data-controller="splitter" style="position:relative;display:flex;width:100px;height:100px" ${attributes}>` +
			`<div data-splitter-target="handle" aria-label="境界" style="width:10px;height:100px" ${handleAttributes}></div>` +
			range +
			`<div data-splitter-target="primary" style="width:90px;height:100px" ${primaryAttributes}></div>` +
			"</div>",
	);
	await settle();
	const root = document.body.lastElementChild;
	const handle = root?.firstElementChild;
	const primary = root?.lastElementChild;
	if (
		!(root instanceof HTMLElement) ||
		!(handle instanceof HTMLElement) ||
		!(primary instanceof HTMLElement)
	) {
		throw new Error("splitter markup を作成できませんでした");
	}
	return { root, handle, primary };
};

const rangeFor = (root: HTMLElement) => {
	const range = root.querySelector('[data-splitter-target="range"]');
	if (!(range instanceof HTMLInputElement)) throw new Error("Missing native range");
	return range;
};

const mountRaw = async (markup: string) => {
	document.body.insertAdjacentHTML("beforeend", markup);
	await settle();
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"splitter",
	) as PublicSplitterController | null;
	if (controller === null) throw new Error("splitter controller が接続されていません");
	return controller;
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("splitter", SplitterController);
});

afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("splitter", () => {
	test("[splitter-range][splitter-range-sync-negative] Native track clicks and keyboard changes synchronize the pane and preserve cancellation", async () => {
		const { root, handle } = await mount('data-splitter-value-value="20"');
		const controller = controllerFor(root);
		const range = rangeFor(root);
		const events: ChangeDetail[] = [];
		root.addEventListener("splitter:change", (event) =>
			events.push((event as CustomEvent<ChangeDetail>).detail),
		);
		expect(range.valueAsNumber).toBe(20);
		await userEvent.click(range);
		expect(controller.value).toBeGreaterThan(20);
		expect(range.valueAsNumber).toBe(controller.value);
		expect(handle.getAttribute("aria-valuenow")).toBe(range.value);
		expect(events).toHaveLength(1);
		expect(events[0]?.reason).toBe("pointer");
		range.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(events.at(-1)?.reason).toBe("keyboard");
		const previous = controller.value;
		root.addEventListener("splitter:beforechange", (event) => event.preventDefault(), {
			once: true,
		});
		await userEvent.keyboard("{ArrowRight}");
		expect(controller.value).toBe(previous);
		expect(range.valueAsNumber).toBe(previous);
		expect(events).toHaveLength(2);
		controller.value = 42.25;
		expect(range.valueAsNumber).toBe(42.25);
		expect(range.defaultValue).toBe("42.25");
		expect(events).toHaveLength(2);
	});

	test("[splitter-range][splitter-range-trusted-negative] Synthetic range changes are restored without events", async () => {
		const { root } = await mount('data-splitter-value-value="20"');
		const range = rangeFor(root);
		const events: Event[] = [];
		root.addEventListener("splitter:change", (event) => events.push(event));
		range.value = "70";
		range.dispatchEvent(new Event("change", { bubbles: true }));
		expect(controllerFor(root).value).toBe(20);
		expect(range.valueAsNumber).toBe(20);
		expect(events).toHaveLength(0);
	});

	test("[splitter-range] Missing, unnamed, disabled, and non-range controls disable enhancement", async () => {
		console.warn = () => {};
		for (const markup of [
			"",
			rangeMarkup.replace('type="range"', 'type="text"'),
			rangeMarkup.replace('aria-label="Primary ratio"', ""),
			rangeMarkup.replace("<input ", "<input disabled "),
			rangeMarkup + rangeMarkup,
		]) {
			const { root } = await mount("", "", "", markup);
			expect(root.dataset.state).toBeUndefined();
			controllerFor(root).value = 70;
			expect(root.style.getPropertyValue("--splitter-value")).toBe("");
		}
	});

	test("[splitter-range][splitter-primary-reentry-negative] Before listeners retain precedence and replacement removes old range listeners", async () => {
		const { root, primary } = await mount('data-splitter-value-value="20"');
		const controller = controllerFor(root);
		let range = rangeFor(root);
		const events: Event[] = [];
		root.addEventListener("splitter:change", (event) => events.push(event));
		root.addEventListener(
			"splitter:beforechange",
			() => {
				controller.value = 75;
			},
			{ once: true },
		);
		await userEvent.click(range);
		expect(controller.value).toBe(75);
		expect(events).toHaveLength(0);
		root.addEventListener(
			"splitter:beforechange",
			() => primary.replaceWith(primary.cloneNode(true)),
			{ once: true },
		);
		await userEvent.click(range);
		await settle();
		expect(controller.value).toBe(75);
		expect(events).toHaveLength(0);
		root.addEventListener(
			"splitter:beforechange",
			() => {
				range.outerHTML = rangeMarkup;
			},
			{ once: true },
		);
		await userEvent.click(range);
		await settle();
		expect(controller.value).toBe(75);
		expect(events).toHaveLength(0);
		range = rangeFor(root);
		expect(range.valueAsNumber).toBe(75);
		await userEvent.click(range);
		expect(events).toHaveLength(1);
		controller.disconnect();
		Reflect.set(controller, "connected", true);
		await userEvent.click(range);
		expect(events).toHaveLength(1);
		Reflect.set(controller, "connected", false);
	});

	test("[splitter-state-sync] Synchronizes role, value ARIA, state, custom properties, IDs, and authored attributes", async () => {
		const { root, handle, primary } = await mount(
			'data-splitter-value-value="35"',
			'role="presentation" tabindex="-1" aria-controls="authored-primary"',
			'id="splitter-primary-1"',
		);
		const controller = controllerFor(root);

		expect(controller.value).toBe(35);
		expect(handle.getAttribute("role")).toBe("presentation");
		expect(handle.getAttribute("tabindex")).toBe("-1");
		expect(handle.getAttribute("aria-controls")).toBe("authored-primary");
		expect(handle.getAttribute("aria-valuenow")).toBe("35");
		expect(handle.getAttribute("aria-valuemin")).toBe("0");
		expect(handle.getAttribute("aria-valuemax")).toBe("100");
		expect(handle.getAttribute("aria-orientation")).toBe("vertical");
		expect(primary.id).toBe("splitter-primary-1");
		expect(root.dataset.state).toBe("expanded");
		expect(handle.dataset.state).toBe("idle");
		expect(root.style.getPropertyValue("--splitter-value")).toBe("35");
		expect(root.style.width).toBe("100px");
	});

	test("[splitter-keyboard][splitter-clamp-negative][splitter-direction-negative] Checks orientation, step, clamping, Home/End, and RTL reversal", async () => {
		const { root, handle } = await mount(
			'data-splitter-value-value="50" data-splitter-step-value="30" data-splitter-min-value="20" data-splitter-max-value="80"',
		);
		handle.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(root.style.getPropertyValue("--splitter-value")).toBe("80");
		await userEvent.keyboard("{ArrowRight}");
		expect(root.style.getPropertyValue("--splitter-value")).toBe("80");
		await userEvent.keyboard("{ArrowLeft}");
		expect(root.style.getPropertyValue("--splitter-value")).toBe("50");
		await userEvent.keyboard("{Home}");
		expect(root.style.getPropertyValue("--splitter-value")).toBe("20");
		await userEvent.keyboard("{End}");
		expect(root.style.getPropertyValue("--splitter-value")).toBe("80");

		const rtl = await mount(
			'dir="rtl" data-splitter-value-value="50" data-splitter-step-value="10"',
		);
		rtl.handle.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(rtl.root.style.getPropertyValue("--splitter-value")).toBe("40");
		await userEvent.keyboard("{ArrowLeft}");
		expect(rtl.root.style.getPropertyValue("--splitter-value")).toBe("50");

		const horizontal = await mount(
			'data-splitter-orientation-value="horizontal" data-splitter-value-value="50" data-splitter-step-value="10"',
		);
		horizontal.handle.focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(horizontal.root.style.getPropertyValue("--splitter-value")).toBe("60");
		await userEvent.keyboard("{ArrowUp}");
		expect(horizontal.root.style.getPropertyValue("--splitter-value")).toBe("50");
	});

	test("[splitter-collapse-expand] Enter, collapse(), and expand() remember and restore the ratio", async () => {
		const { root, handle } = await mount('data-splitter-value-value="60"');
		const controller = controllerFor(root);
		handle.focus();
		await userEvent.keyboard("{Enter}");
		expect(controller.value).toBe(0);
		expect(root.dataset.state).toBe("collapsed");
		await userEvent.keyboard("{Enter}");
		expect(controller.value).toBe(60);

		controller.collapse();
		expect(controller.value).toBe(0);
		controller.expand();
		expect(controller.value).toBe(60);
		controller.expand();
		expect(controller.value).toBe(60);
	});

	test("[splitter-pointer-drag][splitter-drag-silence-negative] Checks pointer capture, root coordinates and width, grab offset, and no events during dragging", async () => {
		const { root, handle, primary } = await mount('data-splitter-value-value="40"');
		const events: string[] = [];
		root.addEventListener("splitter:beforechange", () => events.push("before"));
		root.addEventListener("splitter:change", () => events.push("change"));

		await userEvent.dragAndDrop(handle, primary);
		expect(events).toEqual(["before", "change"]);
		expect(Number(root.style.getPropertyValue("--splitter-value"))).toBeGreaterThan(40);
		expect(handle.dataset.state).toBe("idle");
		expect(handle.getAttribute("aria-valuenow")).toBe(
			root.style.getPropertyValue("--splitter-value"),
		);
	});

	test("[splitter-beforechange-cancel][splitter-beforechange-cancel-negative] Checks cancellation, event order, detail, and bubbling", async () => {
		const { root, handle } = await mount('data-splitter-value-value="50"');
		const controller = controllerFor(root);
		const events: Array<{ type: string; detail: ChangeDetail; target: EventTarget | null }> = [];
		let cancel = true;
		root.addEventListener("splitter:beforechange", (event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<ChangeDetail>).detail,
				target: event.target,
			});
			if (cancel) event.preventDefault();
		});
		root.addEventListener("splitter:change", (event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<ChangeDetail>).detail,
				target: event.target,
			});
		});

		handle.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(controller.value).toBe(50);
		expect(events.map(({ type }) => type)).toEqual(["splitter:beforechange"]);
		expect(events[0]?.detail).toEqual({ value: 51, previousValue: 50, reason: "keyboard" });

		cancel = false;
		await userEvent.keyboard("{ArrowRight}");
		expect(controller.value).toBe(51);
		expect(events.map(({ type }) => type)).toEqual([
			"splitter:beforechange",
			"splitter:beforechange",
			"splitter:change",
		]);
		expect(events[2]?.detail).toEqual({ value: 51, previousValue: 50, reason: "keyboard" });
		expect(events[2]?.target).toBe(root);
	});

	test("[splitter-programmatic-silence][splitter-programmatic-silence-negative] Value setters and APIs change only state without emitting events", async () => {
		const { root } = await mount('data-splitter-value-value="30"');
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("splitter:beforechange", (event) => events.push(event));
		root.addEventListener("splitter:change", (event) => events.push(event));

		controller.value = 70;
		controller.collapse();
		controller.expand();
		expect(controller.value).toBe(70);
		expect(root.dataset.state).toBe("expanded");
		expect(events).toEqual([]);
	});

	test("[splitter-disconnect-cleanup][splitter-disconnect-cleanup-negative] Releases capture and avoids duplicate listeners across disconnect and reconnect", async () => {
		const { root, handle } = await mount();
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("splitter:change", (event) => events.push(event));
		controller.disconnect();
		const internals = controller as unknown as { connected: boolean; validMarkup: boolean };
		internals.connected = true;
		internals.validMarkup = true;
		handle.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(events).toHaveLength(0);
		internals.connected = false;
		internals.validMarkup = false;
		root.removeAttribute("data-controller");

		const reconnected = await mount();
		const reconnectedEvents: Event[] = [];
		reconnected.root.addEventListener("splitter:change", (event) => reconnectedEvents.push(event));
		reconnected.handle.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(reconnectedEvents).toHaveLength(1);
		reconnected.root.removeAttribute("data-controller");
		await settle();
		await userEvent.keyboard("{ArrowRight}");
		expect(reconnectedEvents).toHaveLength(1);
	});

	test("[splitter-completion-warning][splitter-completion-warning-negative] Warns once per connection when completing role and aria-controls and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("splitter controller");
			expect(warnings[0]).toContain('role="separator"');
			expect(warnings[0]).toContain("aria-controls");

			warnings.length = 0;
			await mount("", 'role="separator" aria-controls="complete-primary"', 'id="complete-primary"');
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			await mountRaw(
				'<div data-controller="splitter"><div data-splitter-target="handle" aria-label="境界"></div></div>',
			);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(warnings[0]).not.toContain("Added ");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[splitter-semantic-validation][splitter-semantic-validation-negative] Disables invalid markup with one warning", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="splitter"><div data-splitter-target="handle"></div></div>',
		);
		await settle();
		const root = document.body.lastElementChild;
		if (!(root instanceof HTMLElement)) throw new Error("invalid root がありません");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("splitter controller");
		expect(root.dataset.state).toBeUndefined();
		expect(root.style.getPropertyValue("--splitter-value")).toBe("");
		const invalidValues = await mount('data-splitter-min-value="80" data-splitter-max-value="20"');
		expect(warnings).toHaveLength(2);
		expect(invalidValues.root.dataset.state).toBeUndefined();
	});
});
