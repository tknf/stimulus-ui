import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import AccordionController from "../src/accordion_controller";

type AccordionPublicController = Controller & {
	open: number[];
	show: (index: number) => void;
	hide: (index: number) => void;
	toggle: (index: number) => void;
};

type ToggleDetail = {
	index: number;
	open: boolean;
	previousOpen: boolean;
	reason: "pointer" | "keyboard";
};

let application: Application;
let originalWarn: typeof console.warn;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const mount = async (rootAttributes = "", panelAttributes = ["", ""]) => {
	const panels = panelAttributes
		.map(
			(attributes, index) =>
				`<section data-accordion-target="panel" ${attributes}>パネル${index + 1}</section>`,
		)
		.join("");
	document.body.insertAdjacentHTML(
		"beforeend",
		`<div data-controller="accordion" ${rootAttributes}>` +
			'<h2><button type="button" data-accordion-target="trigger">項目1</button></h2>' +
			'<h2><button type="button" data-accordion-target="trigger">項目2</button></h2>' +
			panels +
			"</div>",
	);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("accordion root がありません");
	const triggers = Array.from(
		root.querySelectorAll<HTMLButtonElement>("[data-accordion-target=trigger]"),
	);
	const panelsInRoot = Array.from(
		root.querySelectorAll<HTMLElement>("[data-accordion-target=panel]"),
	);
	return { root, triggers, panels: panelsInRoot };
};

const mountRaw = async (html: string) => {
	document.body.insertAdjacentHTML("beforeend", html);
	await settle();
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"accordion",
	) as AccordionPublicController | null;
	if (controller === null) throw new Error("accordion controller が接続されていません");
	return controller;
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("accordion", AccordionController);
});

afterEach(() => {
	vi.restoreAllMocks();
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("accordion", () => {
	test("[accordion-state-sync][accordion-preservation-negative] Synchronizes ARIA, IDs, hidden, data-state, and authored attributes", async () => {
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="accordion" data-state="authored" data-accordion-open-value="[0]">' +
				'<h2><button type="button" data-accordion-target="trigger" aria-controls="external-panel">項目1</button></h2>' +
				'<h2><button type="button" data-accordion-target="trigger">項目2</button></h2>' +
				'<section id="authored-panel" role="group" data-accordion-target="panel">内容1</section>' +
				'<section data-accordion-target="panel">内容2</section>' +
				"</div>",
		);
		await settle();
		const root = document.body.lastElementChild as HTMLElement;
		const triggers = Array.from(
			root.querySelectorAll<HTMLButtonElement>("[data-accordion-target=trigger]"),
		);
		const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-accordion-target=panel]"));

		expect(panels[0]?.dataset.state).toBe("open");
		expect(triggers[0]?.getAttribute("aria-controls")).toBe("external-panel");
		expect(triggers[0]?.getAttribute("aria-expanded")).toBe("true");
		expect(triggers[1]?.getAttribute("aria-controls")).toBe(panels[1]?.id);
		expect(panels[0]?.getAttribute("role")).toBe("group");
		expect(panels[0]?.hidden).toBe(false);
		expect(panels[1]?.hidden).toBe(true);
		expect(triggers[0]?.dataset.state).toBe("open");
		expect(triggers[1]?.dataset.state).toBe("closed");
		expect(panels[0]?.dataset.state).toBe("open");
		expect(panels[1]?.dataset.state).toBe("closed");

		// Do not add panel roles; accordions with many open panels would create too many landmarks.
		expect(panels[1]?.hasAttribute("role")).toBe(false);
		// Preserve the native tab order.
		expect(triggers.some((trigger) => trigger.hasAttribute("tabindex"))).toBe(false);
	});

	test("[accordion-initial-open] Prioritizes hidden and applies the open value only when no state is authored", async () => {
		const fromValue = await mount(
			'data-accordion-multiple-value="true" data-accordion-open-value="[0]"',
		);
		expect(fromValue.panels[0]?.dataset.state).toBe("open");
		expect(fromValue.panels[0]?.hidden).toBe(false);
		expect(fromValue.panels[1]?.hidden).toBe(true);

		const authored = await mount(
			'data-accordion-multiple-value="true" data-accordion-open-value="[0]"',
			["hidden", ""],
		);
		expect(authored.panels[0]?.hidden).toBe(true);
		expect(authored.panels[1]?.hidden).toBe(false);

		const controller = controllerFor(authored.root);
		authored.root.removeAttribute("data-controller");
		await settle();
		authored.root.setAttribute("data-controller", "accordion");
		await settle();
		expect(controller.open).toEqual([1]);

		// Exclude duplicate, noninteger, and out-of-range entries before applying open.
		const normalized = await mount(
			'data-accordion-multiple-value="true" data-accordion-open-value="[1, 1, 0.5, 9, -1, 0]"',
		);
		expect(controllerFor(normalized.root).open).toEqual([0, 1]);

		// Keep only the first entry when multiple is false.
		const single = await mount('data-accordion-open-value="[1, 0]"');
		expect(controllerFor(single.root).open).toEqual([1]);
		expect(single.panels[0]?.hidden).toBe(true);
		expect(single.panels[1]?.hidden).toBe(false);
	});

	test("[accordion-beforetoggle-cancel][accordion-beforetoggle-cancel-negative] Checks cancelable event order, detail, and bubbling", async () => {
		const { root, triggers, panels } = await mount();
		const events: Array<{ type: string; detail: ToggleDetail; target: EventTarget | null }> = [];
		let cancel = true;
		const onBefore = (event: Event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<ToggleDetail>).detail,
				target: event.target,
			});
			if (cancel) event.preventDefault();
		};
		root.addEventListener("accordion:beforetoggle", onBefore);
		root.addEventListener("accordion:toggle", (event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<ToggleDetail>).detail,
				target: event.target,
			});
		});

		await userEvent.click(triggers[0]!);
		expect(panels[0]?.hidden).toBe(true);
		expect(events.map(({ type }) => type)).toEqual(["accordion:beforetoggle"]);

		cancel = false;
		events.length = 0;
		await userEvent.click(triggers[0]!);
		expect(panels[0]?.hidden).toBe(false);
		expect(events.map(({ type }) => type)).toEqual(["accordion:beforetoggle", "accordion:toggle"]);
		expect(events[0]?.detail).toEqual({
			index: 0,
			open: true,
			previousOpen: false,
			reason: "pointer",
		});
		expect(events[1]?.detail).toEqual(events[0]?.detail);
		expect(events[1]?.target).toBe(root);

		root.removeEventListener("accordion:beforetoggle", onBefore);
	});

	test("[accordion-exclusive][accordion-exclusive-negative] Closes other panels without close events when multiple is false", async () => {
		const { root, triggers, panels } = await mount(undefined, ["", "hidden"]);
		const events: ToggleDetail[] = [];
		root.addEventListener("accordion:toggle", (event) =>
			events.push((event as CustomEvent<ToggleDetail>).detail),
		);
		await userEvent.click(triggers[1]!);
		expect(panels[0]?.hidden).toBe(true);
		expect(panels[1]?.hidden).toBe(false);
		expect(events).toEqual([{ index: 1, open: true, previousOpen: false, reason: "pointer" }]);

		// Keep only the first open panel when authored markup opens two with multiple=false.
		// Any panel with hidden establishes authored state, so the open value is not applied.
		await mountRaw(
			'<div data-controller="accordion">' +
				'<h2><button type="button" data-accordion-target="trigger">項目1</button></h2>' +
				'<h2><button type="button" data-accordion-target="trigger">項目2</button></h2>' +
				'<h2><button type="button" data-accordion-target="trigger">項目3</button></h2>' +
				'<section data-accordion-target="panel">パネル1</section>' +
				'<section data-accordion-target="panel">パネル2</section>' +
				'<section data-accordion-target="panel" hidden>パネル3</section>' +
				"</div>",
		);
		const authored = document.body.lastElementChild;
		if (!(authored instanceof HTMLElement)) throw new Error("accordion root がありません");
		const authoredPanels = Array.from(
			authored.querySelectorAll<HTMLElement>("[data-accordion-target=panel]"),
		);
		expect(authoredPanels.map((panel) => panel.hidden)).toEqual([false, true, true]);
		expect(controllerFor(authored).open).toEqual([0]);
	});

	test("[accordion-keyboard-reason] Uses keyboard reason for Enter and Space and ignores arrow keys", async () => {
		const { root, triggers, panels } = await mount();
		const reasons: string[] = [];
		root.addEventListener("accordion:toggle", (event) =>
			reasons.push((event as CustomEvent<ToggleDetail>).detail.reason),
		);
		triggers[0]!.focus();
		await userEvent.keyboard("{Enter}");
		await settle();
		expect(reasons).toEqual(["keyboard"]);
		await userEvent.keyboard(" ");
		await settle();
		expect(reasons).toEqual(["keyboard", "keyboard"]);
		expect(panels[0]?.dataset.state).toBe("closed");
		await userEvent.keyboard("{ArrowRight}{ArrowLeft}{Home}{End}");
		await settle();
		expect(document.activeElement).toBe(triggers[0]);
		expect(reasons).toHaveLength(2);
	});

	test("[accordion-programmatic-silence][accordion-programmatic-silence-negative] Changes state through the open setter, show, hide, and toggle without emitting events", async () => {
		const { root, panels } = await mount('data-accordion-multiple-value="true"');
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("accordion:beforetoggle", (event) => events.push(event));
		root.addEventListener("accordion:toggle", (event) => events.push(event));

		controller.open = [0, 1];
		expect(controller.open).toEqual([0, 1]);
		controller.hide(0);
		controller.toggle(1);
		controller.show(0);
		expect(controller.open).toEqual([0]);
		expect(panels[0]?.hidden).toBe(false);
		expect(events).toEqual([]);
	});

	test("[accordion-disabled-guard][accordion-disabled-guard-negative] Blocks disabled trigger activation while allowing public API changes", async () => {
		const { root, triggers, panels } = await mount();
		triggers[0]!.disabled = true;
		const events: Event[] = [];
		root.addEventListener("accordion:toggle", (event) => events.push(event));
		triggers[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(panels[0]?.hidden).toBe(true);
		expect(events).toEqual([]);

		controllerFor(root).show(0);
		expect(panels[0]?.hidden).toBe(false);

		// APG recommends aria-disabled for noncollapsible headers; suppress activation as with disabled.
		const aria = await mount();
		aria.triggers[0]!.setAttribute("aria-disabled", "true");
		const ariaEvents: Event[] = [];
		aria.root.addEventListener("accordion:toggle", (event) => ariaEvents.push(event));
		// Playwright actionability rejects aria-disabled elements, so use a synthetic click here.
		// The implementation checks disabled before isTrusted, so this still reaches the guard.
		aria.triggers[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(aria.panels[0]?.hidden).toBe(true);
		expect(ariaEvents).toEqual([]);
		controllerFor(aria.root).show(0);
		expect(aria.panels[0]?.hidden).toBe(false);
	});

	test("[accordion-dynamic-targets] Tracks added and removed triggers and panels", async () => {
		const { root, triggers, panels } = await mount();
		root.insertAdjacentHTML(
			"beforeend",
			'<h2><button type="button" data-accordion-target="trigger">項目3</button></h2>' +
				'<section data-accordion-target="panel" hidden>パネル3</section>',
		);
		await settle();
		const addedTrigger = root.querySelectorAll<HTMLButtonElement>(
			"[data-accordion-target=trigger]",
		)[2];
		const addedPanel = root.querySelectorAll<HTMLElement>("[data-accordion-target=panel]")[2];
		if (!addedTrigger || !addedPanel) throw new Error("dynamic target がありません");
		expect(addedTrigger.getAttribute("aria-controls")).toBe(addedPanel.id);
		expect(addedPanel.hidden).toBe(true);

		addedTrigger.click();
		await settle();
		expect(addedPanel.hidden).toBe(false);
		triggers[0]?.remove();
		panels[0]?.remove();
		await settle();
		expect(root.querySelectorAll("[data-accordion-target=trigger]")).toHaveLength(2);
		expect(root.querySelectorAll("[data-accordion-target=panel]")).toHaveLength(2);
		expect(addedPanel.dataset.state).toBe("open");

		// Adding targets preserves current visibility instead of reapplying initial open.
		const kept = await mount(
			'data-accordion-multiple-value="true" data-accordion-open-value="[0]"',
		);
		controllerFor(kept.root).show(1);
		expect(controllerFor(kept.root).open).toEqual([0, 1]);
		kept.root.insertAdjacentHTML(
			"beforeend",
			'<h2><button type="button" data-accordion-target="trigger">項目3</button></h2>' +
				'<section data-accordion-target="panel">パネル3</section>',
		);
		await settle();
		expect(controllerFor(kept.root).open).toEqual([0, 1, 2]);
	});

	test("[accordion-id-uniqueness] Avoids ID collisions across instances and preserves authored IDs", async () => {
		document.body.insertAdjacentHTML("beforeend", '<div id="accordion-panel-1"></div>');
		const first = await mount();
		const second = await mount();
		first.panels[0]!.id = "authored-panel";
		await settle();
		const ids = [...first.panels, ...second.panels].map((panel) => panel.id);
		expect(first.panels[0]?.id).toBe("authored-panel");
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).not.toContain("accordion-panel-1");
	});

	test("[accordion-disconnect-cleanup][accordion-disconnect-cleanup-negative] Preserves state without duplicate listeners after disconnect and reconnect", async () => {
		const { root, triggers, panels } = await mount();
		const removeListenerSpy = vi.spyOn(root, "removeEventListener");
		const events: Event[] = [];
		root.addEventListener("accordion:toggle", (event) => events.push(event));
		// Do not warn about invalid markup when targets disappear during disconnection.
		// This depends on disconnect() setting connected=false first.
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		root.removeAttribute("data-controller");
		await settle();
		console.warn = originalWarn;
		expect(warnings).toEqual([]);
		expect(removeListenerSpy.mock.calls.some(([type]) => type === "click")).toBe(true);
		// Keep managed ARIA, IDs, data-state, and hidden after disconnect.
		expect(triggers[0]?.getAttribute("aria-expanded")).toBe("false");
		expect(triggers[0]?.getAttribute("aria-controls")).toBe(panels[0]?.id);
		expect(panels[0]?.id).not.toBe("");
		expect(panels[0]?.dataset.state).toBe("closed");
		triggers[0]!.click();
		expect(events).toHaveLength(0);
		expect(panels[0]?.hidden).toBe(true);
		root.setAttribute("data-controller", "accordion");
		await settle();
		triggers[0]!.click();
		expect(events).toHaveLength(0);
		triggers[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(events).toHaveLength(0);
		await userEvent.click(triggers[0]!);
		expect(events).toHaveLength(1);
		expect(panels[0]?.hidden).toBe(false);
	});

	test("[accordion-completion-warning][accordion-completion-warning-negative] Warns once per connection when completing aria-controls and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("accordion controller");
			expect(warnings[0]).toContain("aria-controls");

			warnings.length = 0;
			await mountRaw(
				'<div data-controller="accordion">' +
					'<h2><button type="button" data-accordion-target="trigger" aria-controls="accordion-panel-a">項目</button></h2>' +
					'<section id="accordion-panel-a" data-accordion-target="panel" hidden>内容</section>' +
					"</div>",
			);
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			await mountRaw(
				'<div data-controller="accordion"><div data-accordion-target="trigger">項目</div><section data-accordion-target="panel">内容</section></div>',
			);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(warnings[0]).not.toContain("Added ");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[accordion-semantic-validation][accordion-semantic-validation-negative] Warns once and disables enhancement for invalid markup", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		await mountRaw(
			'<div data-controller="accordion"><div data-accordion-target="trigger">項目</div><section data-accordion-target="panel">内容</section></div>',
		);
		const root = document.body.lastElementChild as HTMLElement;
		const trigger = root.querySelector<HTMLElement>("[data-accordion-target=trigger]");
		const panel = root.querySelector<HTMLElement>("[data-accordion-target=panel]");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("accordion controller");

		// Also disable markup with mismatched trigger and panel counts.
		warnings.length = 0;
		await mountRaw(
			'<div data-controller="accordion">' +
				'<h2><button type="button" data-accordion-target="trigger">項目1</button></h2>' +
				'<h2><button type="button" data-accordion-target="trigger">項目2</button></h2>' +
				'<section data-accordion-target="panel">内容</section>' +
				"</div>",
		);
		const mismatched = document.body.lastElementChild as HTMLElement;
		expect(warnings).toHaveLength(1);
		expect(mismatched.querySelector("[data-accordion-target=trigger]")).not.toHaveAttribute(
			"aria-expanded",
		);
		// Disabled enhancement must change neither panel hidden nor aria-controls.
		expect(panel?.hidden).toBe(false);
		expect(trigger).not.toHaveAttribute("aria-controls");
		trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(panel?.hidden).toBe(false);
	});
});
