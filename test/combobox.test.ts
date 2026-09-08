import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import ComboboxController from "../src/combobox_controller";

type ComboboxPublicController = Controller & {
	value: string;
	open: boolean;
	show: () => void;
	hide: () => void;
	toggle: () => void;
	select: (value: string) => void;
};

type ChangeDetail = {
	value: string;
	previousValue: string;
	reason: "pointer" | "keyboard";
};

type MultipleComboboxPublicController = ComboboxPublicController & {
	selected: string[];
	deselect: (value: string) => void;
};

type MultipleChangeDetail = {
	value: string;
	previousValue?: string;
	reason: "pointer" | "keyboard";
	selected?: string[];
	previousSelected?: string[];
};

let application: Application;
let originalWarn: typeof console.warn;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const mount = async (rootAttributes = "", inputAttributes = "", listboxAttributes = "") => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<div data-controller="combobox" ${rootAttributes}>` +
			`<label for="combobox-authored-input">プラン</label>` +
			`<input id="combobox-authored-input" data-combobox-target="input" ${inputAttributes}>` +
			`<ul data-combobox-target="listbox" ${listboxAttributes}>` +
			'<li data-combobox-target="option" data-combobox-value="account">アカウント</li>' +
			'<li data-combobox-target="option" data-combobox-value="security">セキュリティ</li>' +
			'<li data-combobox-target="option" data-combobox-value="billing" aria-disabled="true">請求</li>' +
			'<li data-combobox-target="option" data-combobox-value="notifications">通知</li>' +
			"</ul></div>",
	);
	await settle();
	const root = document.body.lastElementChild;
	const input = root?.querySelector('[data-combobox-target="input"]');
	const listbox = root?.querySelector('[data-combobox-target="listbox"]');
	const options = root?.querySelectorAll('[data-combobox-target="option"]');
	if (
		!(root instanceof HTMLElement) ||
		!(input instanceof HTMLInputElement) ||
		!(listbox instanceof HTMLUListElement) ||
		!options ||
		options.length !== 4
	) {
		throw new Error("combobox を作成できませんでした");
	}
	return {
		root,
		input,
		listbox,
		options: Array.from(options).filter(
			(option): option is HTMLLIElement => option instanceof HTMLLIElement,
		),
	};
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"combobox",
	) as ComboboxPublicController | null;
	if (!controller) throw new Error("combobox controller が接続されていません");
	return controller;
};

const keydown = async (input: HTMLInputElement, key: string) => {
	input.focus();
	const keyMap: Record<string, string> = {
		ArrowDown: "{ArrowDown}",
		ArrowUp: "{ArrowUp}",
		End: "{End}",
		Enter: "{Enter}",
		Escape: "{Escape}",
		Home: "{Home}",
	};
	await userEvent.keyboard(keyMap[key] ?? key);
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("combobox", ComboboxController);
});

afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("combobox", () => {
	test("[combobox-state-sync][combobox-root-state-negative][combobox-input-expanded-negative][combobox-listbox-hidden-negative][combobox-option-selected-negative][combobox-option-disabled-state-negative][combobox-option-active-state-negative][combobox-input-controls-preservation-negative] Synchronizes roles, names, relationships, IDs, and state", async () => {
		const { root, input, listbox, options } = await mount(
			'data-combobox-value-value="security" data-combobox-open-value="true"',
			'aria-autocomplete="none" aria-controls="other-listbox"',
			'id="authored-listbox" aria-label="プラン候補"',
		);

		expect(input.getAttribute("role")).toBe("combobox");
		expect(input.getAttribute("aria-controls")).toBe("other-listbox");
		expect(input.getAttribute("aria-expanded")).toBe("true");
		expect(input.getAttribute("aria-autocomplete")).toBe("list");
		expect(input.value).toBe("security");
		expect(listbox.getAttribute("role")).toBe("listbox");
		expect(listbox.hidden).toBe(false);
		expect(root.dataset.state).toBe("open");
		expect(input.dataset.state).toBe("open");
		expect(listbox.dataset.state).toBe("open");
		expect(options[1]?.getAttribute("role")).toBe("option");
		expect(options[1]?.getAttribute("aria-selected")).toBe("true");
		expect(options[1]?.dataset.state).toBe("selected");
		expect(options[2]?.getAttribute("aria-selected")).toBe("false");
		expect(options[2]?.dataset.state).toBe("disabled");
		expect(new Set([input.id, listbox.id, ...options.map((option) => option.id)]).size).toBe(6);
		controllerFor(root).hide();
		expect(listbox.hidden).toBe(true);
	});

	test("[combobox-programmatic-silence][combobox-programmatic-event-negative] Synchronizes state and values through public APIs without events or focus changes", async () => {
		const { root, input, options } = await mount();
		const controller = controllerFor(root);
		const outside = document.createElement("button");
		document.body.append(outside);
		outside.focus();
		const events: Event[] = [];
		for (const name of [
			"combobox:beforechange",
			"combobox:change",
			"combobox:open",
			"combobox:close",
		])
			root.addEventListener(name, (event) => events.push(event));

		controller.show();
		controller.select("security");
		controller.hide();
		controller.toggle();
		controller.value = "custom";
		controller.open = false;
		input.dispatchEvent(new Event("input", { bubbles: true }));

		expect(controller.value).toBe("custom");
		expect(input.value).toBe("custom");
		expect(controller.open).toBe(false);
		expect(root.dataset.state).toBe("closed");
		expect(options[1]?.getAttribute("aria-selected")).toBe("false");
		expect(document.activeElement).toBe(outside);
		expect(events).toEqual([]);
	});

	test("[combobox-keyboard-navigation][combobox-navigation-wrap][combobox-open-event-guard-negative][combobox-option-active-state-negative] Checks arrows, Home, End, Enter, Escape, and aria-activedescendant", async () => {
		const { root, input, options } = await mount();
		const events: string[] = [];
		root.addEventListener("combobox:open", (event) => events.push(event.type));
		root.addEventListener("combobox:close", (event) => events.push(event.type));
		input.focus();

		await keydown(input, "ArrowDown");
		expect(root.dataset.state).toBe("open");
		expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
		expect(document.activeElement).toBe(input);
		await keydown(input, "ArrowDown");
		expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
		await keydown(input, "ArrowUp");
		expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
		await keydown(input, "End");
		expect(input.getAttribute("aria-activedescendant")).toBe(options[3]?.id);
		expect(options[3]?.dataset.state).toBe("active");
		await keydown(input, "ArrowDown");
		expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
		await keydown(input, "Home");
		expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
		await keydown(input, "ArrowDown");
		await keydown(input, "Enter");
		expect(input.value).toBe("security");
		expect(events).toEqual(["combobox:open"]);
		await keydown(input, "Escape");
		expect(root.dataset.state).toBe("closed");
		expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
		expect(events).toEqual(["combobox:open", "combobox:close"]);
	});

	test("[combobox-option-guards][combobox-option-click-guard-negative][combobox-dynamic-targets] Tracks hidden or disabled options and dynamic target changes", async () => {
		const { root, input, listbox, options } = await mount('data-combobox-value-value="account"');
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("combobox:change", (event) => events.push(event));
		options[0]!.hidden = true;
		options[1]!.setAttribute("aria-disabled", "true");
		await settle();
		controller.show();
		await userEvent.click(options[1]!, { force: true });
		expect(controller.value).toBe("account");
		expect(events).toEqual([]);
		input.focus();
		await keydown(input, "ArrowDown");
		expect(input.getAttribute("aria-activedescendant")).toBe(options[3]?.id);

		listbox.insertAdjacentHTML(
			"beforeend",
			'<li data-combobox-target="option" data-combobox-value="archive">保存</li>',
		);
		await settle();
		const added = listbox.lastElementChild;
		if (!(added instanceof HTMLLIElement)) throw new Error("dynamic option がありません");
		expect(added.getAttribute("role")).toBe("option");
		expect(added.dataset.state).toBe("inactive");

		options[3]!.remove();
		await settle();
		expect(input.hasAttribute("aria-activedescendant")).toBe(false);
	});

	test("[combobox-selection-events][combobox-click-trusted-negative][combobox-beforechange-cancel-negative] Checks selection order, detail, and cancellation for trusted pointer and keyboard interaction", async () => {
		const { root, input, options } = await mount('data-combobox-value-value="account"');
		const controller = controllerFor(root);
		const events: Array<{ type: string; detail: ChangeDetail }> = [];
		let cancel = true;
		root.addEventListener("combobox:beforechange", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
			if (cancel) event.preventDefault();
		});
		root.addEventListener("combobox:change", (event) =>
			events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail }),
		);

		controller.show();
		await settle();
		options[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		expect(events).toEqual([]);
		await userEvent.click(options[1]!);
		await settle();
		expect(input.value).toBe("account");
		expect(events.map(({ type }) => type)).toEqual(["combobox:beforechange"]);
		cancel = false;
		await userEvent.click(options[1]!);
		expect(input.value).toBe("security");
		expect(events.map(({ type }) => type)).toEqual([
			"combobox:beforechange",
			"combobox:beforechange",
			"combobox:change",
		]);
		expect(events[2]?.detail).toEqual({
			value: "security",
			previousValue: "account",
			reason: "pointer",
		});

		input.focus();
		await keydown(input, "ArrowDown");
		await keydown(input, "ArrowDown");
		await keydown(input, "ArrowDown");
		await keydown(input, "Enter");
		expect(events[4]?.detail.reason).toBe("keyboard");
	});

	test("[combobox-ime-guard][combobox-composition-guard-negative] Suppresses keyboard interaction during composition and resumes after compositionend", async () => {
		const { root, input } = await mount();
		const events: Event[] = [];
		root.addEventListener("combobox:open", (event) => events.push(event));
		input.focus();
		input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		await keydown(input, "ArrowDown");
		await keydown(input, "Enter");
		expect(root.dataset.state).toBe("closed");
		expect(events).toEqual([]);
		input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
		await keydown(input, "ArrowDown");
		expect(root.dataset.state).toBe("open");
	});

	test("[combobox-focusout-disconnect][combobox-focusout-containment-negative][combobox-document-focus-containment-negative] Closes and removes listeners on focusout and disconnect/reconnect", async () => {
		const { root, input, listbox, options } = await mount();
		const controller = controllerFor(root);
		const outside = document.createElement("button");
		document.body.append(outside);
		controller.show();
		input.focus();
		options[0]?.focus();
		input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: options[0] }));
		expect(root.dataset.state).toBe("open");
		input.focus();
		expect(root.dataset.state).toBe("open");
		outside.focus();
		expect(root.dataset.state).toBe("closed");

		const changes: Event[] = [];
		root.addEventListener("combobox:change", (event) => changes.push(event));
		root.removeAttribute("data-controller");
		await settle();
		listbox.hidden = false;
		await userEvent.click(options[1]!);
		expect(changes).toEqual([]);
		root.setAttribute("data-controller", "combobox");
		await settle();
		controllerFor(root).show();
		await userEvent.click(options[1]!);
		expect(changes).toHaveLength(1);
	});

	test("[combobox-initial-value-attribute-guard-negative] Preserves the authored input value when no data value exists", async () => {
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="combobox"><label for="typed-input">プラン</label><input id="typed-input" value="typed" data-combobox-target="input"><ul data-combobox-target="listbox"><li data-combobox-target="option" data-combobox-value="typed">入力済み</li></ul></div>',
		);
		await settle();
		const root = document.body.lastElementChild;
		const input = root?.querySelector<HTMLInputElement>('[data-combobox-target="input"]');
		if (!(root instanceof HTMLElement) || !input) throw new Error("typed combobox がありません");
		expect(input.value).toBe("typed");
	});

	test("[combobox-selection-noop-negative] Emits no event when the user selects the same value", async () => {
		const { root, options } = await mount('data-combobox-value-value="account"');
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("combobox:beforechange", (event) => events.push(event));
		root.addEventListener("combobox:change", (event) => events.push(event));
		controller.show();
		await userEvent.click(options[0]!);
		expect(controller.value).toBe("account");
		expect(events).toEqual([]);
	});

	test("[combobox-keydown-target-negative] Does not move selection for keydown originating outside the input", async () => {
		const { root, input, options } = await mount();
		controllerFor(root).show();
		options[0]?.focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(input.hasAttribute("aria-activedescendant")).toBe(false);
		expect(document.activeElement).toBe(options[0]);
	});

	test("[combobox-disconnect-cleanup-negative] Leaves no option listeners after direct disconnect", async () => {
		const { root, listbox, options } = await mount('data-combobox-value-value="account"');
		const controller = controllerFor(root) as ComboboxPublicController & {
			disconnect: () => void;
		};
		const changes: Event[] = [];
		root.addEventListener("combobox:change", (event) => changes.push(event));
		controller.disconnect();
		listbox.hidden = false;
		await userEvent.click(options[1]!);
		expect(controller.value).toBe("account");
		expect(changes).toEqual([]);
	});

	test("[combobox-semantic-validation-negative] Warns once and disables invalid elements, roles, or values", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="combobox"><input data-combobox-target="input" role="listbox"><div data-combobox-target="listbox"><span data-combobox-target="option" data-combobox-value="x">X</span></div></div>',
		);
		await settle();
		const invalidRoot = document.body.lastElementChild;
		if (!(invalidRoot instanceof HTMLElement)) throw new Error("invalid root がありません");
		expect(warnings).toHaveLength(1);
		expect(invalidRoot.dataset.state).toBeUndefined();
		invalidRoot.insertAdjacentHTML(
			"beforeend",
			'<ul data-combobox-target="listbox"><li data-combobox-target="option" data-combobox-value="x">X</li></ul>',
		);
		await settle();
		expect(warnings).toHaveLength(1);
	});

	test("[combobox-completion-warning][combobox-completion-warning-negative] Warns once per connection when completing role and aria-controls and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("combobox controller");
			expect(warnings[0]).toContain('role="combobox"');
			expect(warnings[0]).toContain("aria-controls");

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div data-controller="combobox"><label for="complete-combobox-input">候補</label>' +
					'<input id="complete-combobox-input" data-combobox-target="input" type="text" role="combobox" aria-controls="complete-combobox-listbox">' +
					'<ul id="complete-combobox-listbox" data-combobox-target="listbox" role="listbox">' +
					'<li id="complete-combobox-option" data-combobox-target="option" data-combobox-value="one" role="option">一</li>' +
					"</ul></div>",
			);
			await settle();
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div data-controller="combobox"><input data-combobox-target="input" type="text"><ul data-combobox-target="listbox"><li data-combobox-target="option" data-combobox-value="x">X</li></ul></div>',
			);
			await settle();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(warnings[0]).not.toContain("Added ");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[combobox-accessible-name-negative] Warns and disables inputs without accessible names", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="combobox"><input type="text" data-combobox-target="input"><ul data-combobox-target="listbox"><li data-combobox-target="option" data-combobox-value="x">X</li></ul></div>',
		);
		await settle();
		const root = document.body.lastElementChild;
		if (!(root instanceof HTMLElement)) throw new Error("nameなし root がありません");
		expect(warnings).toHaveLength(1);
		expect(root.dataset.state).toBeUndefined();
	});

	test("[combobox-synthetic-keyboard-silence] Does not treat synthetic keydown as keyboard interaction", async () => {
		const { root, input } = await mount();
		const events: Event[] = [];
		root.addEventListener("combobox:open", (event) => events.push(event));
		root.addEventListener("combobox:change", (event) => events.push(event));
		input.focus();
		input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
		input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
		expect(root.dataset.state).toBe("closed");
		expect(events).toEqual([]);
	});

	test("[combobox-duplicate-value-negative] Disables enhancement for duplicate values", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="combobox"><input data-combobox-target="input" aria-label="候補"><ul data-combobox-target="listbox"><li data-combobox-target="option" data-combobox-value="same">A</li><li data-combobox-target="option" data-combobox-value="same">B</li></ul></div>',
		);
		await settle();
		const root = document.body.lastElementChild;
		if (!(root instanceof HTMLElement)) throw new Error("duplicate root がありません");
		expect(warnings).toHaveLength(1);
		expect(root.dataset.state).toBeUndefined();
	});

	test("[combobox-nested-events] Uses the originating root as event target even for nested events", async () => {
		const outer = await mount();
		outer.root.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="combobox"><label>内側<input data-combobox-target="input" aria-label="内側"></label><ol data-combobox-target="listbox"><li data-combobox-target="option" data-combobox-value="inner">内側</li></ol></div>',
		);
		await settle();
		const inner = outer.root.lastElementChild;
		if (!(inner instanceof HTMLElement)) throw new Error("inner root がありません");
		const innerOption = inner.querySelector<HTMLLIElement>('[data-combobox-target="option"]');
		if (!innerOption) throw new Error("inner option がありません");
		controllerFor(inner).show();
		const received: EventTarget[] = [];
		outer.root.addEventListener("combobox:change", (event) => {
			if (event.target) received.push(event.target);
		});
		await userEvent.click(innerOption);
		expect(received).toEqual([inner]);
	});

	test("[combobox-multiple-toggle][combobox-multiple-toggle-negative] Preserves popup, input, and active state when Enter or click toggles multiple selection", async () => {
		const { root, input, options } = await mount(
			'data-combobox-multiple-value="true"',
			'value="filter"',
		);
		const controller = controllerFor(root);
		controller.show();
		await keydown(input, "ArrowDown");
		const activeId = input.getAttribute("aria-activedescendant");

		await keydown(input, "Enter");
		expect(input.value).toBe("filter");
		expect(root.dataset.state).toBe("open");
		expect(input.getAttribute("aria-activedescendant")).toBe(activeId);
		expect(options[0]?.getAttribute("aria-selected")).toBe("true");

		await keydown(input, "Enter");
		expect(input.value).toBe("filter");
		expect(root.dataset.state).toBe("open");
		expect(input.getAttribute("aria-activedescendant")).toBe(activeId);
		expect(options[0]?.getAttribute("aria-selected")).toBe("false");

		await userEvent.click(options[1]!);
		expect(input.value).toBe("filter");
		expect(root.dataset.state).toBe("open");
		expect(input.getAttribute("aria-activedescendant")).toBe(activeId);
		expect(options[1]?.getAttribute("aria-selected")).toBe("true");
		await userEvent.click(options[1]!);
		expect(input.value).toBe("filter");
		expect(root.dataset.state).toBe("open");
		expect(input.getAttribute("aria-activedescendant")).toBe(activeId);
		expect(options[1]?.getAttribute("aria-selected")).toBe("false");
	});

	test("[combobox-multiple-state][combobox-multiple-state-negative] Synchronizes aria-multiselectable and each option state in multiple mode", async () => {
		const multiple = await mount('data-combobox-multiple-value="true"');
		const controller = controllerFor(multiple.root) as MultipleComboboxPublicController;
		expect(multiple.listbox.getAttribute("aria-multiselectable")).toBe("true");

		controller.selected = ["account", "security"];
		await settle();
		expect(multiple.options[0]?.getAttribute("aria-selected")).toBe("true");
		expect(multiple.options[0]?.dataset.state).toBe("selected");
		expect(multiple.options[1]?.getAttribute("aria-selected")).toBe("true");
		expect(multiple.options[1]?.dataset.state).toBe("selected");

		controller.selected = ["security"];
		await settle();
		expect(multiple.options[0]?.getAttribute("aria-selected")).toBe("false");
		expect(multiple.options[0]?.dataset.state).toBe("inactive");
		expect(multiple.options[1]?.getAttribute("aria-selected")).toBe("true");
		expect(multiple.options[1]?.dataset.state).toBe("selected");

		const single = await mount();
		expect(single.listbox.hasAttribute("aria-multiselectable")).toBe(false);
	});

	test("[combobox-multiple-api][combobox-multiple-api-negative] Normalizes selected, deselect, and select in multiple mode without emitting events", async () => {
		const multiple = await mount(
			`data-combobox-multiple-value="true" data-combobox-selected-value='["security","unknown","security"]'`,
			'value="filter"',
		);
		const controller = controllerFor(multiple.root) as MultipleComboboxPublicController;
		const events: Event[] = [];
		for (const name of ["combobox:beforechange", "combobox:change"])
			multiple.root.addEventListener(name, (event) => events.push(event));

		expect(controller.selected).toEqual(["security"]);
		expect(multiple.input.value).toBe("filter");
		controller.selected = ["account", "unknown", "account", "security"];
		expect(controller.selected).toEqual(["account", "security"]);
		controller.deselect("account");
		expect(controller.selected).toEqual(["security"]);
		controller.select("notifications");
		expect(controller.selected).toEqual(["security", "notifications"]);
		expect(multiple.input.value).toBe("filter");
		expect(events).toEqual([]);

		const single = await mount();
		const singleController = controllerFor(single.root) as MultipleComboboxPublicController;
		singleController.selected = ["security"];
		singleController.deselect("account");
		expect(singleController.selected).toEqual([]);
	});

	test("[combobox-multiple-events][combobox-multiple-events-negative] Checks event detail, cancellation, and synthetic interaction in multiple mode", async () => {
		const { root, input, options } = await mount(
			`data-combobox-multiple-value="true" data-combobox-selected-value='["account"]'`,
			'value="filter"',
		);
		const controller = controllerFor(root) as MultipleComboboxPublicController;
		const events: Array<{ type: string; detail: MultipleChangeDetail }> = [];
		let cancel = false;
		root.addEventListener("combobox:beforechange", (event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<MultipleChangeDetail>).detail,
			});
			if (cancel) event.preventDefault();
		});
		root.addEventListener("combobox:change", (event) =>
			events.push({
				type: event.type,
				detail: (event as CustomEvent<MultipleChangeDetail>).detail,
			}),
		);

		controller.show();
		await userEvent.click(options[1]!);
		expect(events.map(({ type }) => type)).toEqual(["combobox:beforechange", "combobox:change"]);
		expect(events[1]?.detail).toEqual({
			value: "security",
			reason: "pointer",
			selected: ["account", "security"],
			previousSelected: ["account"],
		});
		expect(events[1]?.detail).not.toHaveProperty("previousValue");

		input.focus();
		await keydown(input, "ArrowDown");
		await keydown(input, "ArrowDown");
		await keydown(input, "ArrowDown");
		await keydown(input, "Enter");
		expect(events[3]?.detail).toEqual({
			value: "notifications",
			reason: "keyboard",
			selected: ["account", "security", "notifications"],
			previousSelected: ["account", "security"],
		});

		cancel = true;
		await userEvent.click(options[0]!);
		expect(events).toHaveLength(5);
		expect(events[4]?.detail.selected).toEqual(["security", "notifications"]);
		expect(controller.selected).toEqual(["account", "security", "notifications"]);

		options[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
		expect(events).toHaveLength(5);
		expect(controller.selected).toEqual(["account", "security", "notifications"]);
	});
});
