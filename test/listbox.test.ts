import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import { ensureElementId } from "../src/internal/ensure_element_id";
import ListboxController from "../src/listbox_controller";

type PublicController = Controller & {
	values: string[];
	select: (value: string) => void;
	deselect: (value: string) => void;
	selectAll: () => void;
	clear: () => void;
	disconnect: () => void;
};
type Detail = { values: string[]; previousValues: string[]; reason: "pointer" | "keyboard" };
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
		`<ul data-controller="listbox" aria-label="設定" ${attributes}><li data-listbox-target="option" data-listbox-value="one">一</li><li data-listbox-target="option" data-listbox-value="two">二</li><li data-listbox-target="option" data-listbox-value="three" aria-disabled="true">三</li></ul>`,
	);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLUListElement)) throw new Error("listbox root がありません");
	return { root, options: Array.from(root.querySelectorAll<HTMLLIElement>("li")) };
};
const mountRaw = async (markup: string) => {
	document.body.insertAdjacentHTML("beforeend", markup);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("listbox root がありません");
	return root;
};
const captureWarnings = async (markup: string) => {
	const warnings: string[] = [];
	console.warn = (message?: unknown) => warnings.push(String(message));
	const root = await mountRaw(markup);
	return { root, warnings };
};
const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"listbox",
	) as PublicController | null;
	if (!controller) throw new Error("listbox controller がありません");
	return controller;
};
beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("listbox", ListboxController);
});
afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("listbox", () => {
	test("[listbox-state-sync] Synchronizes roles, names, tabindex, ARIA, IDs, and state", async () => {
		const { root, options } = await mount(
			'data-listbox-value-value="two" data-listbox-multiple-value="true"',
		);
		expect(root.getAttribute("role")).toBe("listbox");
		expect(root.tabIndex).toBe(0);
		expect(root.getAttribute("aria-multiselectable")).toBe("true");
		expect(options[1]?.getAttribute("aria-selected")).toBe("true");
		// No option is active while unfocused; selected options expose selected state.
		expect(options[1]?.dataset.state).toBe("selected");
		expect(root.hasAttribute("aria-activedescendant")).toBe(false);
		expect(options[2]?.dataset.state).toBe("disabled");
		expect(options.every((option) => option.id !== "")).toBe(true);

		// Keyboard interaction starts from the selected option; active then takes precedence.
		root.focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(root.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
		expect(options[0]?.dataset.state).toBe("active");
		expect(options[1]?.dataset.state).toBe("selected");
	});

	test("[listbox-navigation][listbox-navigation-wrap-negative] Checks Arrow/Home/End, wrapping, disabled/hidden exclusions, and aria-activedescendant", async () => {
		const { root, options } = await mount();
		root.focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(root.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
		await userEvent.keyboard("{ArrowDown}");
		expect(root.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
		await userEvent.keyboard("{ArrowDown}");
		expect(root.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
		await userEvent.keyboard("{End}");
		expect(root.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
		await userEvent.keyboard("{Home}");
		expect(root.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
	});

	test("[listbox-selection][listbox-beforechange-cancel-negative] Checks pointer/Space before/change events, cancellation, and reasons", async () => {
		const { root, options } = await mount('data-listbox-multiple-value="true"');
		const events: Array<{ type: string; detail: Detail }> = [];
		let cancel = true;
		root.addEventListener("listbox:beforechange", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<Detail>).detail });
			if (cancel) event.preventDefault();
		});
		root.addEventListener("listbox:change", (event) =>
			events.push({ type: event.type, detail: (event as CustomEvent<Detail>).detail }),
		);
		await userEvent.click(options[0]!);
		expect(events).toHaveLength(1);
		expect(events[0]?.detail.values ?? []).toEqual(["one"]);
		cancel = false;
		await userEvent.click(options[0]!);
		expect(events.map((event) => event.type)).toEqual([
			"listbox:beforechange",
			"listbox:beforechange",
			"listbox:change",
		]);
		expect(events[2]?.detail).toEqual({ values: ["one"], previousValues: [], reason: "pointer" });
		root.focus();
		await userEvent.keyboard("{ArrowDown}");
		await userEvent.keyboard(" ");
		expect(events.at(-1)?.detail.reason).toBe("keyboard");
	});

	test("[listbox-programmatic-silence][listbox-programmatic-silence-negative] values, select, deselect, selectAll, and clear emit no events", async () => {
		const { root } = await mount('data-listbox-multiple-value="true"');
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("listbox:change", (event) => events.push(event));
		controller.select("one");
		controller.select("two");
		controller.deselect("one");
		controller.selectAll();
		controller.clear();
		expect(controller.values).toEqual([]);
		expect(events).toEqual([]);
	});

	test("[listbox-dynamic-targets] Tracks option additions/removals and reconnect", async () => {
		const { root, options } = await mount();
		root.insertAdjacentHTML(
			"beforeend",
			'<li data-listbox-target="option" data-listbox-value="four">四</li>',
		);
		await settle();
		expect(root.lastElementChild?.getAttribute("role")).toBe("option");
		options[0]?.remove();
		await settle();
		root.removeAttribute("data-controller");
		await settle();
		root.setAttribute("data-controller", "listbox");
		await settle();
		expect(root.getAttribute("role")).toBe("listbox");
	});

	test("[listbox-completion-warning][listbox-completion-warning-negative] Warns once per connection when completing roles and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("listbox controller");
			expect(warnings[0]).toContain('role="listbox"');
			expect(warnings[0]).toContain('role="option"');

			warnings.length = 0;
			await mountRaw(
				'<ul data-controller="listbox" aria-label="設定" role="listbox">' +
					'<li data-listbox-target="option" data-listbox-value="one" role="option">一</li>' +
					'<li data-listbox-target="option" data-listbox-value="two" role="option">二</li>' +
					"</ul>",
			);
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			await mountRaw(
				'<div data-controller="listbox" aria-label="不正"><span data-listbox-target="option" data-listbox-value="x">X</span></div>',
			);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(warnings[0]).not.toContain("Added ");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[listbox-semantic-validation][listbox-semantic-validation-negative] Disables invalid markup with a warning", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="listbox" aria-label="不正"><span data-listbox-target="option" data-listbox-value="x">X</span></div>',
		);
		await settle();
		const root = document.body.lastElementChild;
		expect(warnings).toHaveLength(1);
		expect(root?.getAttribute("role")).toBeNull();
	});

	test("[listbox-root-validity-negative] Requires a native ul/ol root", async () => {
		const { root, warnings } = await captureWarnings(
			'<div data-controller="listbox" aria-label="設定"><li data-listbox-target="option" data-listbox-value="one">一</li></div>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.getAttribute("role")).toBeNull();
		expect(root.hasAttribute("tabindex")).toBe(false);
	});

	test("[listbox-name-validity-negative] Requires an accessible name", async () => {
		const { root, warnings } = await captureWarnings(
			'<ul data-controller="listbox"><li data-listbox-target="option" data-listbox-value="one">一</li></ul>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.getAttribute("role")).toBeNull();
	});

	test("[listbox-role-validity-negative] Requires authored root roles to match listbox", async () => {
		const { root, warnings } = await captureWarnings(
			'<ul data-controller="listbox" aria-label="設定" role="menu"><li data-listbox-target="option" data-listbox-value="one">一</li></ul>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.getAttribute("role")).toBe("menu");
		expect(root.hasAttribute("tabindex")).toBe(false);
	});

	test("[listbox-option-count-negative] Requires at least one option", async () => {
		const { root, warnings } = await captureWarnings(
			'<ul data-controller="listbox" aria-label="設定"></ul>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.getAttribute("role")).toBeNull();
	});

	test("[listbox-option-li-negative] Requires native li options", async () => {
		const { root, warnings } = await captureWarnings(
			'<ul data-controller="listbox" aria-label="設定"><span data-listbox-target="option" data-listbox-value="one">一</span></ul>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.getAttribute("role")).toBeNull();
	});

	test("[listbox-option-contains-negative] Checks options are contained in the root", async () => {
		const { root, warnings } = await captureWarnings(
			'<ul data-controller="listbox" aria-label="設定"><li data-listbox-target="option" data-listbox-value="one">一</li></ul>',
		);
		const option = root.querySelector("li");
		if (!(option instanceof HTMLLIElement)) throw new Error("option がありません");
		const nativeContains = root.contains.bind(root);
		root.contains = ((candidate: Node | null) =>
			candidate === option ? false : nativeContains(candidate)) as typeof root.contains;
		option.dataset.listboxValue = "changed";
		await settle();
		expect(warnings).toHaveLength(2);
	});

	test("[listbox-option-role-negative] Requires option roles to match native li options", async () => {
		const { root, warnings } = await captureWarnings(
			'<ul data-controller="listbox" aria-label="設定"><li role="menuitem" data-listbox-target="option" data-listbox-value="one">一</li></ul>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.getAttribute("role")).toBeNull();
	});

	test("[listbox-option-value-negative] Rejects empty option values", async () => {
		const { root, warnings } = await captureWarnings(
			'<ul data-controller="listbox" aria-label="設定"><li data-listbox-target="option" data-listbox-value="">一</li></ul>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.getAttribute("role")).toBeNull();
	});

	test("[listbox-value-uniqueness-negative] Rejects duplicate option values", async () => {
		const { root, warnings } = await captureWarnings(
			'<ul data-controller="listbox" aria-label="設定"><li data-listbox-target="option" data-listbox-value="same">一</li><li data-listbox-target="option" data-listbox-value="same">同じ</li></ul>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.getAttribute("role")).toBeNull();
	});

	test("[listbox-semantic-validation-root-contains-negative] Detects simultaneous violations of independent rootValid and option containment guards", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="listbox" aria-label="設定"><li data-listbox-target="option" data-listbox-value="one">一</li></div>',
		);
		const root = document.body.lastElementChild;
		if (!(root instanceof HTMLDivElement)) throw new Error("listbox root がありません");
		const option = root.querySelector("li");
		if (!(option instanceof HTMLLIElement)) throw new Error("option がありません");
		await settle();
		const nativeContains = root.contains.bind(root);
		root.contains = ((candidate: Node | null) =>
			candidate === option ? false : nativeContains(candidate)) as typeof root.contains;
		option.dataset.listboxValue = "changed";
		await settle();
		expect(warnings).toHaveLength(1);
		expect(root.getAttribute("role")).toBeNull();
	});

	test("[listbox-tabindex-preservation-negative] Preserves authored tabindex", async () => {
		const { root } = await mount('role="listbox" tabindex="-1"');
		expect(root.tabIndex).toBe(-1);
	});

	test("[listbox-initial-aria-selected-negative] Uses aria-selected initially when no value attribute exists", async () => {
		const root = await mountRaw(
			'<ul data-controller="listbox" aria-label="設定"><li data-listbox-target="option" data-listbox-value="one" aria-selected="true">一</li><li data-listbox-target="option" data-listbox-value="two">二</li></ul>',
		);
		const options = Array.from(root.querySelectorAll<HTMLLIElement>("li"));
		expect(options[0]?.getAttribute("aria-selected")).toBe("true");
		expect(options[1]?.getAttribute("aria-selected")).toBe("false");
	});

	test("[listbox-state-priority-active-negative] Active state takes precedence over selected", async () => {
		const { root, options } = await mount('data-listbox-value-value="one"');
		root.focus();
		await userEvent.keyboard("{Home}");
		expect(options[0]?.getAttribute("aria-selected")).toBe("true");
		expect(options[0]?.dataset.state).toBe("active");
	});

	test("[listbox-state-priority-disabled-negative] Disabled state takes precedence over selected", async () => {
		const { options } = await mount(
			'data-listbox-value-value="three" data-listbox-multiple-value="true"',
		);
		expect(options[2]?.getAttribute("aria-selected")).toBe("true");
		expect(options[2]?.dataset.state).toBe("disabled");
	});

	test("[listbox-state-priority-selected-negative] Selected state takes precedence over inactive", async () => {
		const { options } = await mount('data-listbox-value-value="one"');
		expect(options[0]?.dataset.state).toBe("selected");
	});

	test("[listbox-click-trusted-negative] Synthetic clicks do not change selection", async () => {
		const { root, options } = await mount();
		const events: Event[] = [];
		root.addEventListener("listbox:change", (event) => events.push(event));
		options[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		await settle();
		expect(controllerFor(root).values).toEqual([]);
		expect(options[0]?.getAttribute("aria-selected")).toBe("false");
		expect(events).toEqual([]);
	});

	test("[listbox-keydown-trusted-negative] Synthetic keydown does not change navigation", async () => {
		const { root } = await mount();
		root.focus();
		root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
		await settle();
		expect(root.hasAttribute("aria-activedescendant")).toBe(false);
	});

	test("[listbox-keydown-target-negative] Ignores keydown originating outside the root", async () => {
		const { root, options } = await mount();
		const option = options[0]!;
		option.tabIndex = 0;
		option.focus();
		await userEvent.keyboard("{ArrowDown}");
		await settle();
		expect(root.hasAttribute("aria-activedescendant")).toBe(false);
	});

	test("[listbox-disabled-guard-negative] Excludes aria-disabled options from pointer selection", async () => {
		const { root, options } = await mount();
		const child = document.createElement("span");
		child.textContent = "三";
		options[2]!.replaceChildren(child);
		await userEvent.click(child);
		expect(controllerFor(root).values).toEqual([]);
		expect(options[2]?.dataset.state).toBe("disabled");
	});

	test("[listbox-hidden-guard-negative] Excludes hidden options from navigation", async () => {
		const root = await mountRaw(
			'<ul data-controller="listbox" aria-label="設定"><li data-listbox-target="option" data-listbox-value="one">一</li><li data-listbox-target="option" data-listbox-value="two" hidden>二</li><li data-listbox-target="option" data-listbox-value="three">三</li></ul>',
		);
		const options = Array.from(root.querySelectorAll<HTMLLIElement>("li"));
		root.focus();
		await userEvent.keyboard("{ArrowDown}");
		await userEvent.keyboard("{ArrowDown}");
		expect(root.getAttribute("aria-activedescendant")).toBe(options[2]?.id);
		expect(options[1]?.dataset.state).toBe("disabled");
	});

	test("[listbox-api-option-guard-negative] Excludes disabled options from the select API", async () => {
		const { root } = await mount();
		controllerFor(root).select("three");
		expect(controllerFor(root).values).toEqual([]);
	});

	test("[listbox-select-all-filter-negative] selectAll selects only enabled visible options", async () => {
		const { root, options } = await mount('data-listbox-multiple-value="true"');
		options[1]!.hidden = true;
		await settle();
		controllerFor(root).selectAll();
		expect(controllerFor(root).values).toEqual(["one"]);
	});

	test("[listbox-selection-noop-negative] Requests for the same selection do nothing and emit no event", async () => {
		const { root } = await mount('data-listbox-value-value="one"');
		const events: Event[] = [];
		root.addEventListener("listbox:beforechange", (event) => events.push(event));
		root.addEventListener("listbox:change", (event) => events.push(event));
		root.focus();
		await userEvent.keyboard("{Home}");
		await userEvent.keyboard(" ");
		expect(events).toEqual([]);
	});

	test("[listbox-activedescendant-clears-negative] Clears relationships when the active option becomes hidden", async () => {
		const { root, options } = await mount();
		root.focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(root.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
		options[0]!.hidden = true;
		await settle();
		expect(root.hasAttribute("aria-activedescendant")).toBe(false);
	});

	test("[listbox-id-preservation-negative] Preserves authored option IDs", async () => {
		const root = await mountRaw(
			'<ul data-controller="listbox" aria-label="設定"><li id="authored-option" data-listbox-target="option" data-listbox-value="one">一</li></ul>',
		);
		expect(root.querySelector("li")?.id).toBe("authored-option");
	});

	test("[listbox-id-uniqueness-negative] ensureElementId avoids ID collisions in the document", () => {
		const existing = document.createElement("div");
		existing.id = "listbox-negative-collision-1";
		const candidate = document.createElement("div");
		document.body.append(existing, candidate);
		expect(ensureElementId(candidate, "listbox-negative-collision")).toBe(
			"listbox-negative-collision-2",
		);
	});

	test("[listbox-disconnect-cleanup-negative] Removes listeners and observers on disconnect", async () => {
		const { root, options } = await mount();
		const controller = controllerFor(root);
		controller.disconnect();
		await settle();
		const events: Event[] = [];
		root.addEventListener("listbox:change", (event) => events.push(event));
		const child = document.createElement("span");
		child.textContent = "一";
		options[0]!.replaceChildren(child);
		await userEvent.click(child);
		options[1]!.hidden = true;
		await settle();
		expect(controller.values).toEqual([]);
		expect(events).toEqual([]);
		expect(options[1]?.dataset.state).toBe("inactive");
	});

	test("[listbox-typeahead] Checks printable-prefix matching, successive input, wrapping, and Space selection", async () => {
		const root = await mountRaw(
			'<ul data-controller="listbox" aria-label="Fruits" role="listbox">' +
				'<li data-listbox-target="option" data-listbox-value="alpha" role="option">Alpha</li>' +
				'<li data-listbox-target="option" data-listbox-value="beta" role="option">Beta</li>' +
				'<li data-listbox-target="option" data-listbox-value="bravo" role="option">Bravo</li>' +
				'<li data-listbox-target="option" data-listbox-value="charlie" role="option">Charlie</li>' +
				"</ul>",
		);
		const options = Array.from(root.querySelectorAll<HTMLLIElement>("li"));
		root.focus();

		await userEvent.keyboard("b");
		expect(root.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
		await userEvent.keyboard("b");
		expect(root.getAttribute("aria-activedescendant")).toBe(options[2]?.id);

		await new Promise<void>((resolve) => setTimeout(resolve, 550));
		await userEvent.keyboard("b");
		expect(root.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
		await userEvent.keyboard(" ");
		expect(options[1]?.getAttribute("aria-selected")).toBe("true");
		expect(options[1]?.dataset.state).toBe("active");
	});

	test("[listbox-typeahead-timer-negative] The typeahead reset timer does not change active state or outputs", async () => {
		const root = await mountRaw(
			'<ul data-controller="listbox" aria-label="Fruits" role="listbox">' +
				'<li data-listbox-target="option" data-listbox-value="alpha" role="option">Alpha</li>' +
				'<li data-listbox-target="option" data-listbox-value="beta" role="option">Beta</li>' +
				'<li data-listbox-target="option" data-listbox-value="charlie" role="option">Charlie</li>' +
				"</ul>",
		);
		const options = Array.from(root.querySelectorAll<HTMLLIElement>("li"));
		root.focus();
		await userEvent.keyboard("b");
		await userEvent.keyboard("{ArrowDown}");
		const before = {
			active: root.getAttribute("aria-activedescendant"),
			states: options.map((option) => option.dataset.state),
			focused: document.activeElement === root,
		};

		await new Promise<void>((resolve) => setTimeout(resolve, 550));
		expect({
			active: root.getAttribute("aria-activedescendant"),
			states: options.map((option) => option.dataset.state),
			focused: document.activeElement === root,
		}).toEqual(before);
	});
});
