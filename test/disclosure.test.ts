import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import DisclosureController from "../src/disclosure_controller";

type DisclosurePublicController = Controller & {
	open: boolean;
	show: () => void;
	hide: () => void;
	toggle: () => void;
};

type ToggleDetail = {
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

const mount = async (
	rootAttributes = "",
	detailsAttributes = "",
	panelMarkup = "",
	triggerAttributes = "",
) => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<details data-controller="disclosure" ${rootAttributes} ${detailsAttributes}>` +
			`<summary data-disclosure-target="trigger" ${triggerAttributes}>設定</summary>` +
			`<div data-disclosure-target="panel">${panelMarkup || "内容"}</div>` +
			"</details>",
	);
	await settle();
	const root = document.body.lastElementChild;
	const trigger = root?.querySelector('[data-disclosure-target="trigger"]');
	const panel = root?.querySelector('[data-disclosure-target="panel"]');
	if (
		!(root instanceof HTMLDetailsElement) ||
		!(trigger instanceof HTMLElement) ||
		!(panel instanceof HTMLElement)
	) {
		throw new Error("disclosure を作成できませんでした");
	}
	return { root, trigger, panel };
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"disclosure",
	) as DisclosurePublicController | null;
	if (controller === null) throw new Error("disclosure controller が接続されていません");
	return controller;
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("disclosure", DisclosureController);
});

afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("disclosure", () => {
	test("[disclosure-state-sync][disclosure-name-preservation][disclosure-root-state-negative][disclosure-trigger-state-negative][disclosure-panel-state-negative] Preserves native semantics, state, and authored attributes", async () => {
		const { root, trigger, panel } = await mount(
			'id="authored-disclosure" name="settings" role="group" aria-label="設定"',
			"open",
			"",
			'aria-expanded="false" aria-controls="authored-panel"',
		);

		expect(root.open).toBe(true);
		expect(root.id).toBe("authored-disclosure");
		expect(root.getAttribute("name")).toBe("settings");
		expect(root.getAttribute("role")).toBe("group");
		expect(root.getAttribute("aria-label")).toBe("設定");
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(trigger.getAttribute("aria-controls")).toBe("authored-panel");
		expect(root.dataset.state).toBe("open");
		expect(trigger.dataset.state).toBe("open");
		expect(panel.dataset.state).toBe("open");
		expect(panel.hasAttribute("hidden")).toBe(false);
	});

	test("[disclosure-initial-open][disclosure-open-attribute-guard-negative] Applies the initial open value only without an authored open attribute", async () => {
		const fromValue = await mount('data-disclosure-open-value="true"');
		expect(fromValue.root.open).toBe(true);

		const authored = await mount('data-disclosure-open-value="false"', "open");
		expect(authored.root.open).toBe(true);
	});

	test("[disclosure-beforetoggle-cancel][disclosure-visibility-state] Checks cancellation and committed events for trusted pointer interaction", async () => {
		const { root, trigger, panel } = await mount();
		const events: Array<{ type: string; detail: ToggleDetail }> = [];
		let cancel = true;
		root.addEventListener("disclosure:beforetoggle", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ToggleDetail>).detail });
			if (cancel) event.preventDefault();
		});
		root.addEventListener("disclosure:toggle", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ToggleDetail>).detail });
		});

		await userEvent.click(trigger);
		expect(root.open).toBe(false);
		expect(panel.hasAttribute("hidden")).toBe(false);
		expect(root.dataset.state).toBe("closed");
		expect(events.map(({ type }) => type)).toEqual(["disclosure:beforetoggle"]);

		cancel = false;
		events.length = 0;
		await userEvent.click(trigger);
		expect(root.open).toBe(true);
		expect(panel.hasAttribute("hidden")).toBe(false);
		expect(events.map(({ type }) => type)).toEqual([
			"disclosure:beforetoggle",
			"disclosure:toggle",
		]);
		expect(events[0]?.detail).toEqual({ open: true, previousOpen: false, reason: "pointer" });
		expect(events[1]?.detail).toEqual({ open: true, previousOpen: false, reason: "pointer" });
	});

	test("[disclosure-keyboard-reason] Uses keyboard reason for native Enter and Space and preserves trigger focus", async () => {
		const { root, trigger } = await mount();
		const reasons: string[] = [];
		root.addEventListener("disclosure:toggle", (event) => {
			reasons.push((event as CustomEvent<ToggleDetail>).detail.reason);
		});

		trigger.focus();
		await userEvent.keyboard("{Enter}");
		await settle();
		expect(root.open).toBe(true);
		expect(document.activeElement).toBe(trigger);
		await userEvent.keyboard(" ");
		await settle();
		expect(root.open).toBe(false);
		expect(document.activeElement).toBe(trigger);
		expect(reasons).toEqual(["keyboard", "keyboard"]);
	});

	test("[disclosure-programmatic-silence][disclosure-pending-toggle-guard-negative] Public APIs change native open and state without emitting events", async () => {
		const { root, panel } = await mount();
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("disclosure:beforetoggle", (event) => events.push(event));
		root.addEventListener("disclosure:toggle", (event) => events.push(event));

		controller.show();
		expect(controller.open).toBe(true);
		expect(root.dataset.state).toBe("open");
		expect(panel.hasAttribute("hidden")).toBe(false);
		controller.hide();
		controller.toggle();
		controller.open = false;
		await settle();
		expect(controller.open).toBe(false);
		expect(root.dataset.state).toBe("closed");
		expect(panel.hasAttribute("hidden")).toBe(false);
		expect(events).toEqual([]);
	});

	test("[disclosure-synthetic-silence][disclosure-disabled-guard][disclosure-click-trusted-negative] Synthetic clicks and disabled triggers neither emit events nor change state", async () => {
		const synthetic = await mount();
		const syntheticEvents: Event[] = [];
		synthetic.root.addEventListener("disclosure:toggle", (event) => syntheticEvents.push(event));
		synthetic.trigger.click();
		await settle();
		expect(synthetic.root.open).toBe(true);
		expect(syntheticEvents).toEqual([]);

		const disabled = await mount("", "", "", 'aria-disabled="true"');
		const disabledEvents: Event[] = [];
		disabled.root.addEventListener("disclosure:beforetoggle", (event) =>
			disabledEvents.push(event),
		);
		disabled.root.addEventListener("disclosure:toggle", (event) => disabledEvents.push(event));
		await userEvent.click(disabled.trigger);
		expect(disabled.root.open).toBe(false);
		expect(disabledEvents).toEqual([]);
	});

	test("[disclosure-keydown-trusted-negative][disclosure-key-filter-negative] Does not schedule keyboard activation for synthetic events or unsupported keys", async () => {
		const synthetic = await mount();
		const syntheticReasons: string[] = [];
		synthetic.root.addEventListener("disclosure:toggle", (event) =>
			syntheticReasons.push((event as CustomEvent<ToggleDetail>).detail.reason),
		);
		synthetic.trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
		await userEvent.click(synthetic.trigger);
		expect(syntheticReasons).toEqual(["pointer"]);

		const unsupported = await mount();
		const unsupportedReasons: string[] = [];
		unsupported.root.addEventListener("disclosure:toggle", (event) =>
			unsupportedReasons.push((event as CustomEvent<ToggleDetail>).detail.reason),
		);
		unsupported.trigger.focus();
		await userEvent.keyboard("{ArrowDown}");
		await userEvent.click(unsupported.trigger);
		expect(unsupportedReasons).toEqual(["pointer"]);
	});

	test("[disclosure-dynamic-targets] Tracks added, replaced, and removed targets without warnings", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		document.body.insertAdjacentHTML(
			"beforeend",
			'<details data-controller="disclosure" open><summary data-disclosure-target="trigger">設定</summary></details>',
		);
		await settle();
		const root = document.body.lastElementChild;
		if (!(root instanceof HTMLDetailsElement)) throw new Error("root がありません");
		expect(warnings).toHaveLength(1);

		root.insertAdjacentHTML("beforeend", '<div data-disclosure-target="panel">内容</div>');
		await settle();
		const firstPanel = root.querySelector<HTMLElement>('[data-disclosure-target="panel"]');
		if (!firstPanel) throw new Error("panel がありません");
		expect(root.dataset.state).toBe("open");
		expect(firstPanel.dataset.state).toBe("open");
		expect(warnings).toHaveLength(1);

		firstPanel.remove();
		root.insertAdjacentHTML(
			"beforeend",
			'<section data-disclosure-target="panel">交換後</section>',
		);
		await settle();
		const secondPanel = root.querySelector<HTMLElement>('[data-disclosure-target="panel"]');
		if (!secondPanel) throw new Error("交換後 panel がありません");
		expect(secondPanel.dataset.state).toBe("open");
	});

	test("[disclosure-disconnect-cleanup] Retains state without duplicate listeners across disconnect and reconnect", async () => {
		const { root, trigger } = await mount();
		const events: Event[] = [];
		const beforeEvents: Event[] = [];
		root.addEventListener("disclosure:toggle", (event) => events.push(event));
		root.addEventListener("disclosure:beforetoggle", (event) => beforeEvents.push(event));
		root.removeAttribute("data-controller");
		await settle();
		root.setAttribute("data-controller", "disclosure");
		await settle();
		await userEvent.click(trigger);
		expect(events).toHaveLength(1);
		expect(beforeEvents).toHaveLength(1);
		expect(root.dataset.state).toBe("open");

		root.removeAttribute("data-controller");
		await settle();
		await userEvent.click(trigger);
		expect(events).toHaveLength(1);
		expect(beforeEvents).toHaveLength(1);
	});

	test("[disclosure-disconnect-listener-negative] Leaves no root listeners after direct disconnect", async () => {
		const { root, trigger } = await mount();
		const controller = controllerFor(root) as DisclosurePublicController & {
			disconnect: () => void;
		};
		const beforeEvents: Event[] = [];
		root.addEventListener("disclosure:beforetoggle", (event) => beforeEvents.push(event));
		controller.disconnect();
		await userEvent.click(trigger);
		expect(beforeEvents).toHaveLength(0);
	});

	test("[disclosure-semantic-validation][disclosure-semantic-validation-negative] Warns once and disables enhancement for invalid markup", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="disclosure"><button data-disclosure-target="trigger">設定</button><div data-disclosure-target="panel">内容</div></div>',
		);
		await settle();
		const root = document.body.lastElementChild;
		const trigger = root?.querySelector<HTMLElement>('[data-disclosure-target="trigger"]');
		if (!(root instanceof HTMLElement) || !trigger) throw new Error("invalid root がありません");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("disclosure controller");
		expect(root.dataset.state).toBeUndefined();
		trigger.click();
		expect(root.dataset.state).toBeUndefined();
	});
});
