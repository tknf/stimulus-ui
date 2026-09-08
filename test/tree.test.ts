import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import TreeController from "../src/tree_controller";

type TreeApi = Controller & {
	value: string;
	expanded: string[];
	select: (value: string) => void;
	expand: (value: string) => void;
	collapse: (value: string) => void;
};

type ChangeDetail = { value: string; previousValue: string; reason: "pointer" | "keyboard" };
type ToggleDetail = {
	value: string;
	expanded: boolean;
	previousExpanded: boolean;
	reason: "pointer" | "keyboard";
};

let application: Application;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const mount = async (markup: string) => {
	document.body.insertAdjacentHTML("beforeend", markup);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLUListElement || root instanceof HTMLOListElement)) {
		throw new Error("tree root がありません");
	}
	return root;
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"tree",
	) as TreeApi | null;
	if (!controller) throw new Error("tree controller がありません");
	return controller;
};

beforeEach(() => {
	document.body.innerHTML = "";
	application = Application.start();
	application.register("tree", TreeController);
});

afterEach(() => {
	application.stop();
	document.body.innerHTML = "";
});

describe("tree", () => {
	test("[tree-state-sync] Synchronizes roles, ARIA, IDs, tabindex, data-state, and authored attributes", async () => {
		const root = await mount(`
			<ul data-controller="tree" aria-label="設定" data-tree-value-value="child" data-tree-expanded-value='["parent"]' role="tree" tabindex="4">
				<li id="authored-parent" data-tree-target="item" data-tree-value="parent">
					親
					<button type="button" data-tree-target="toggle">展開</button>
					<ol role="group">
						<li data-tree-target="item" data-tree-value="child">子</li>
					</ol>
				</li>
			</ul>
		`);
		const parent = root.querySelector<HTMLLIElement>('[data-tree-value="parent"]');
		const child = root.querySelector<HTMLLIElement>('[data-tree-value="child"]');
		const group = root.querySelector<HTMLOListElement>("ol");
		if (!parent || !child || !group) throw new Error("tree state の要素がありません");

		expect(root.getAttribute("role")).toBe("tree");
		expect(root.tabIndex).toBe(4);
		expect(parent.id).toBe("authored-parent");
		expect(parent.getAttribute("role")).toBe("treeitem");
		expect(child.getAttribute("role")).toBe("treeitem");
		expect(group.getAttribute("role")).toBe("group");
		expect(parent.getAttribute("aria-expanded")).toBe("true");
		expect(parent.getAttribute("aria-selected")).toBe("false");
		expect(child.getAttribute("aria-selected")).toBe("true");
		expect(parent.getAttribute("tabindex")).toBe("-1");
		expect(child.getAttribute("tabindex")).toBe("-1");
		expect(parent.dataset.state).toBe("inactive");
		expect(child.dataset.state).toBe("selected");
		expect(child.getAttribute("aria-level")).toBeNull();
		expect(child.getAttribute("aria-posinset")).toBeNull();
		expect(child.getAttribute("aria-setsize")).toBeNull();
		expect(root.hasAttribute("aria-activedescendant")).toBe(false);
	});

	test("[tree-navigation][tree-expanded-navigation-negative] Checks four-direction arrows, Home/End, and the visible item list", async () => {
		const root = await mount(`
			<ul data-controller="tree" aria-label="設定">
				<li data-tree-target="item" data-tree-value="parent">
					親
					<ol><li data-tree-target="item" data-tree-value="hidden-child">隠し子</li></ol>
				</li>
				<li data-tree-target="item" data-tree-value="sibling">兄弟</li>
			</ul>
		`);
		const parent = root.querySelector<HTMLLIElement>('[data-tree-value="parent"]');
		const child = root.querySelector<HTMLLIElement>('[data-tree-value="hidden-child"]');
		const sibling = root.querySelector<HTMLLIElement>('[data-tree-value="sibling"]');
		if (!parent || !child || !sibling) throw new Error("tree navigation の要素がありません");

		root.focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(root.getAttribute("aria-activedescendant")).toBe(parent.id);
		await userEvent.keyboard("{ArrowDown}");
		expect(root.getAttribute("aria-activedescendant")).toBe(sibling.id);
		await userEvent.keyboard("{ArrowUp}");
		expect(root.getAttribute("aria-activedescendant")).toBe(parent.id);
		await userEvent.keyboard("{ArrowRight}");
		expect(parent.getAttribute("aria-expanded")).toBe("true");
		await userEvent.keyboard("{ArrowRight}");
		expect(root.getAttribute("aria-activedescendant")).toBe(child.id);
		await userEvent.keyboard("{ArrowLeft}");
		expect(root.getAttribute("aria-activedescendant")).toBe(parent.id);
		await userEvent.keyboard("{ArrowLeft}");
		expect(parent.getAttribute("aria-expanded")).toBe("false");
		await userEvent.keyboard("{ArrowRight}");
		expect(parent.getAttribute("aria-expanded")).toBe("true");
		await userEvent.keyboard("{End}");
		expect(root.getAttribute("aria-activedescendant")).toBe(sibling.id);
		await userEvent.keyboard("{Home}");
		expect(root.getAttribute("aria-activedescendant")).toBe(parent.id);
	});

	test("[tree-activedescendant][tree-activedescendant-negative] Checks active descendants, root focus, and state after removal", async () => {
		const root = await mount(`
			<ul data-controller="tree" aria-label="設定" data-tree-expanded-value='["parent"]'>
				<li data-tree-target="item" data-tree-value="parent">
					親
					<ol><li data-tree-target="item" data-tree-value="child">子</li></ol>
				</li>
			</ul>
		`);
		const child = root.querySelector<HTMLLIElement>('[data-tree-value="child"]');
		if (!child) throw new Error("active descendant の要素がありません");

		root.focus();
		await userEvent.click(child);
		expect(document.activeElement).toBe(root);
		expect(root.getAttribute("aria-activedescendant")).toBe(child.id);
		expect(child.dataset.state).toBe("active");
		child.remove();
		await settle();
		expect(root.hasAttribute("aria-activedescendant")).toBe(false);
	});

	test("[tree-selection] Checks pointer/Enter beforechange, change detail, cancellation, and absence of synthetic notifications", async () => {
		const root = await mount(`
			<ul data-controller="tree" aria-label="設定">
				<li data-tree-target="item" data-tree-value="one">一</li>
				<li data-tree-target="item" data-tree-value="two">二</li>
			</ul>
		`);
		const items = Array.from(root.querySelectorAll<HTMLLIElement>("li"));
		const events: Array<{ type: string; detail: ChangeDetail }> = [];
		let cancel = true;
		root.addEventListener("tree:beforechange", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail });
			if (cancel) event.preventDefault();
		});
		root.addEventListener("tree:change", (event) =>
			events.push({ type: event.type, detail: (event as CustomEvent<ChangeDetail>).detail }),
		);

		await userEvent.click(items[1]!);
		expect(events).toHaveLength(1);
		expect(events[0]?.detail).toEqual({ value: "two", previousValue: "", reason: "pointer" });
		expect(items[1]?.getAttribute("aria-selected")).toBe("false");
		cancel = false;
		await userEvent.click(items[1]!);
		expect(events.map((event) => event.type)).toEqual([
			"tree:beforechange",
			"tree:beforechange",
			"tree:change",
		]);
		expect(events[2]?.detail).toEqual({ value: "two", previousValue: "", reason: "pointer" });

		root.focus();
		await userEvent.keyboard("{ArrowUp}");
		await userEvent.keyboard("{Enter}");
		expect(events.at(-1)?.detail).toEqual({
			value: "one",
			previousValue: "two",
			reason: "keyboard",
		});

		const eventCount = events.length;
		items[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(events).toHaveLength(eventCount);
	});

	test("[tree-toggle][tree-beforetoggle-cancel-negative] Checks toggle-click and ArrowRight/Left cancellation, detail, and separation of selection from toggling", async () => {
		const root = await mount(`
			<ul data-controller="tree" aria-label="設定" data-tree-value-value="child">
				<li data-tree-target="item" data-tree-value="parent">
					<span data-tree-label="parent">親</span> <button type="button" data-tree-target="toggle">切替</button>
					<ol><li data-tree-target="item" data-tree-value="child">子</li></ol>
				</li>
			</ul>
		`);
		const parent = root.querySelector<HTMLLIElement>('[data-tree-value="parent"]');
		const child = root.querySelector<HTMLLIElement>('[data-tree-value="child"]');
		const toggle = root.querySelector<HTMLButtonElement>('[data-tree-target="toggle"]');
		const controller = controllerFor(root);
		if (!parent || !child || !toggle) throw new Error("tree toggle の要素がありません");
		const events: Array<{ type: string; detail: ToggleDetail }> = [];
		let cancel = true;
		root.addEventListener("tree:beforetoggle", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ToggleDetail>).detail });
			if (cancel) event.preventDefault();
		});
		root.addEventListener("tree:toggle", (event) =>
			events.push({ type: event.type, detail: (event as CustomEvent<ToggleDetail>).detail }),
		);

		await userEvent.click(toggle);
		expect(events).toHaveLength(1);
		expect(events[0]?.detail).toEqual({
			value: "parent",
			expanded: true,
			previousExpanded: false,
			reason: "pointer",
		});
		expect(parent.getAttribute("aria-expanded")).toBe("false");
		expect(controller.value).toBe("child");

		cancel = false;
		await userEvent.click(toggle);
		expect(events.map((event) => event.type)).toEqual([
			"tree:beforetoggle",
			"tree:beforetoggle",
			"tree:toggle",
		]);
		expect(events[2]?.detail.reason).toBe("pointer");
		expect(parent.getAttribute("aria-expanded")).toBe("true");
		expect(controller.value).toBe("child");

		const label = root.querySelector<HTMLElement>('[data-tree-label="parent"]');
		if (!label) throw new Error("tree item label がありません");
		await userEvent.click(label);
		expect(parent.getAttribute("aria-expanded")).toBe("true");
		expect(controller.value).toBe("parent");

		root.focus();
		await userEvent.keyboard("{ArrowLeft}");
		expect(events.at(-1)?.type).toBe("tree:toggle");
		expect(events.at(-1)?.detail.reason).toBe("keyboard");
		expect(parent.getAttribute("aria-expanded")).toBe("false");
	});

	test("[tree-disabled-guard][tree-disabled-guard-negative] Excludes aria-disabled items from navigation and selection", async () => {
		const root = await mount(`
			<ul data-controller="tree" aria-label="設定">
				<li data-tree-target="item" data-tree-value="one">一</li>
				<li data-tree-target="item" data-tree-value="disabled" aria-disabled="true">無効</li>
				<li data-tree-target="item" data-tree-value="three">三</li>
			</ul>
		`);
		const items = Array.from(root.querySelectorAll<HTMLLIElement>("li"));
		root.focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(root.getAttribute("aria-activedescendant")).toBe(items[0]?.id);
		await userEvent.keyboard("{ArrowDown}");
		expect(root.getAttribute("aria-activedescendant")).toBe(items[2]?.id);
		expect(items[1]?.getAttribute("aria-selected")).toBe("false");
		expect(items[1]?.dataset.state).toBe("disabled");
	});

	test("[tree-programmatic-silence][tree-programmatic-silence-negative] value/expanded setters and select/expand/collapse emit no events", async () => {
		const root = await mount(`
			<ul data-controller="tree" aria-label="設定">
				<li data-tree-target="item" data-tree-value="parent">
					親
					<ol><li data-tree-target="item" data-tree-value="child">子</li></ol>
				</li>
				<li data-tree-target="item" data-tree-value="sibling">兄弟</li>
			</ul>
		`);
		const controller = controllerFor(root);
		const events: Event[] = [];
		for (const type of ["tree:beforechange", "tree:change", "tree:beforetoggle", "tree:toggle"])
			root.addEventListener(type, (event) => events.push(event));

		controller.value = "sibling";
		controller.expanded = ["parent"];
		controller.select("parent");
		controller.expand("parent");
		controller.collapse("parent");
		expect(controller.value).toBe("parent");
		expect(controller.expanded).toEqual([]);
		expect(events).toEqual([]);
	});

	test("[tree-dynamic-targets] Tracks added and removed items", async () => {
		const root = await mount(`
			<ul data-controller="tree" aria-label="設定">
				<li data-tree-target="item" data-tree-value="one">一</li>
			</ul>
		`);
		root.insertAdjacentHTML(
			"beforeend",
			'<li data-tree-target="item" data-tree-value="two">二</li>',
		);
		await settle();
		const added = root.querySelector<HTMLLIElement>('[data-tree-value="two"]');
		if (!added) throw new Error("dynamic item がありません");
		expect(added.getAttribute("role")).toBe("treeitem");
		expect(added.getAttribute("tabindex")).toBe("-1");
		expect(added.dataset.state).toBe("inactive");

		root.focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(root.getAttribute("aria-activedescendant")).toBe(root.querySelector("li")?.id);
		added.remove();
		await settle();
		expect(root.querySelector('[data-tree-value="two"]')).toBeNull();
	});

	test("[tree-id-uniqueness][tree-preservation-negative] Avoids ID collisions across trees and preserves authored IDs and roles", async () => {
		const first = await mount(`
			<ul data-controller="tree" aria-label="一つ目">
				<li id="authored-item" role="presentation" data-tree-target="item" data-tree-value="one">一</li>
			</ul>
		`);
		const second = await mount(`
			<ol data-controller="tree" aria-label="二つ目">
				<li data-tree-target="item" data-tree-value="two">二</li>
			</ol>
		`);
		const firstItem = first.querySelector<HTMLLIElement>("li");
		const secondItem = second.querySelector<HTMLLIElement>("li");
		if (!firstItem || !secondItem) throw new Error("tree ID の要素がありません");

		expect(firstItem.id).toBe("authored-item");
		expect(firstItem.getAttribute("role")).toBe("presentation");
		expect(secondItem.id).not.toBe(firstItem.id);
		expect(new Set([firstItem.id, secondItem.id]).size).toBe(2);
	});

	test("[tree-disconnect-cleanup][tree-disconnect-cleanup-negative] Avoids duplicate listeners and observers across disconnect and reconnect", async () => {
		const root = await mount(`
			<ul data-controller="tree" aria-label="設定">
				<li data-tree-target="item" data-tree-value="one">一</li>
				<li data-tree-target="item" data-tree-value="two">二</li>
			</ul>
		`);
		const items = Array.from(root.querySelectorAll<HTMLLIElement>("li"));
		root.removeAttribute("data-controller");
		expect(root.getAttribute("role")).toBe("tree");
		const disconnectedEvents: Event[] = [];
		root.addEventListener("tree:change", (event) => disconnectedEvents.push(event));
		await userEvent.click(items[1]!);
		expect(disconnectedEvents).toHaveLength(0);

		root.setAttribute("data-controller", "tree");
		await settle();
		const events: Event[] = [];
		root.addEventListener("tree:change", (event) => events.push(event));
		await userEvent.click(items[1]!);
		expect(events).toHaveLength(1);
	});

	test("[tree-completion-warning][tree-completion-warning-negative] Warns once per connection when completing roles and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount(
				'<ul data-controller="tree" aria-label="設定"><li data-tree-target="item" data-tree-value="one">一</li></ul>',
			);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("tree controller");
			expect(warnings[0]).toContain('role="tree"');
			expect(warnings[0]).toContain('role="treeitem"');

			warnings.length = 0;
			await mount(
				'<ul data-controller="tree" aria-label="設定" role="tree">' +
					'<li data-tree-target="item" data-tree-value="parent" role="treeitem">親' +
					'<ol role="group"><li data-tree-target="item" data-tree-value="child" role="treeitem">子</li></ol>' +
					"</li></ul>",
			);
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div data-controller="tree" aria-label="不正"><li data-tree-target="item" data-tree-value="x">X</li></div>',
			);
			await settle();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(warnings[0]).not.toContain("Added ");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[tree-semantic-validation][tree-semantic-validation-negative][tree-value-uniqueness-negative] Disables invalid markup with one warning", async () => {
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div data-controller="tree" aria-label="不正"><li data-tree-target="item" data-tree-value="x">X</li></div>' +
					'<ul data-controller="tree" aria-label="不正"></ul>' +
					'<ul data-controller="tree" aria-label="不正"><li data-tree-target="item" data-tree-value="">空</li></ul>' +
					'<ul data-controller="tree" aria-label="不正"><li data-tree-target="item" data-tree-value="same">一</li><li data-tree-target="item" data-tree-value="same">二</li></ul>' +
					'<ul data-controller="tree" aria-label="不正"><li data-tree-target="item" data-tree-value="parent"><ol><li data-tree-target="item" data-tree-value="child">子</li></ol><ol><li data-tree-target="item" data-tree-value="other-child">別の子</li></ol></li></ul>' +
					'<ul data-controller="tree" aria-label="不正"><li data-tree-target="item" data-tree-value="item">項目</li><button type="button" data-tree-target="toggle">切替</button></ul>' +
					'<ul data-controller="tree" aria-label="不正"><li data-tree-target="item" data-tree-value="leaf"><button type="button" data-tree-target="toggle">切替</button></li></ul>',
			);
			await settle();
		} finally {
			console.warn = originalWarn;
		}

		expect(warnings).toHaveLength(7);
		expect(warnings[0]).toContain("tree controller");
		expect(warnings[0]).toContain("<ul> or <ol>");
		for (const root of Array.from(document.body.children)) {
			expect(root.getAttribute("role")).toBeNull();
			expect(root.querySelector("[data-state]")).toBeNull();
		}
	});

	test("[tree-typeahead][tree-typeahead-label-negative] Checks visible-item prefix matching and exclusion of nested/toggle text", async () => {
		const nestedRoot = await mount(
			'<ul data-controller="tree" aria-label="Nested">' +
				'<li data-tree-target="item" data-tree-value="parent"><ol><li data-tree-target="item" data-tree-value="hidden">Nested</li></ol> Parent</li>' +
				'<li data-tree-target="item" data-tree-value="next">Next</li>' +
				"</ul>",
		);
		const nestedItems = Array.from(nestedRoot.querySelectorAll<HTMLLIElement>("li"));
		nestedRoot.focus();
		await userEvent.keyboard("n");
		expect(nestedRoot.getAttribute("aria-activedescendant")).toBe(nestedItems[2]?.id);
		expect(nestedItems[0]?.dataset.state).toBe("inactive");
		expect(nestedItems[1]?.dataset.state).toBe("inactive");
		expect(nestedItems[2]?.dataset.state).toBe("active");

		const toggleRoot = await mount(
			'<ul data-controller="tree" aria-label="Toggle">' +
				'<li data-tree-target="item" data-tree-value="parent"><button type="button" data-tree-target="toggle">Toggle</button> Parent<ol><li data-tree-target="item" data-tree-value="child">Child</li></ol></li>' +
				'<li data-tree-target="item" data-tree-value="target">Target</li>' +
				"</ul>",
		);
		const toggleItems = Array.from(toggleRoot.querySelectorAll<HTMLLIElement>("li"));
		toggleRoot.focus();
		await userEvent.keyboard("t");
		expect(toggleRoot.getAttribute("aria-activedescendant")).toBe(toggleItems[2]?.id);
		expect(toggleItems[0]?.dataset.state).toBe("inactive");
		expect(toggleItems[1]?.dataset.state).toBe("inactive");
		expect(toggleItems[2]?.dataset.state).toBe("active");
	});
});
