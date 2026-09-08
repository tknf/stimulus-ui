import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import DropdownMenuController from "../src/dropdown_menu_controller";

type DropdownMenuPublicController = Controller & {
	open: boolean;
	show: () => void;
	hide: () => void;
	toggle: () => void;
	select: (value: string) => void;
};

type CloseDetail = { reason: "pointer" | "keyboard"; value: string };
type SelectDetail = { reason: "pointer" | "keyboard"; value: string };

let application: Application;
let originalWarn: typeof console.warn;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const mount = async (rootAttributes = "", triggerAttributes = "", menuAttributes = "") => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<div data-controller="dropdown-menu" ${rootAttributes}>` +
			`<button type="button" data-dropdown-menu-target="trigger" ${triggerAttributes}>操作</button>` +
			`<menu data-dropdown-menu-target="menu" ${menuAttributes}>` +
			'<button type="button" data-dropdown-menu-target="item" data-dropdown-menu-value="edit">編集</button>' +
			'<button type="button" data-dropdown-menu-target="item" data-dropdown-menu-value="delete">削除</button>' +
			'<button type="button" data-dropdown-menu-target="item" data-dropdown-menu-value="disabled" disabled>無効</button>' +
			"</menu></div>",
	);
	await settle();
	const root = document.body.lastElementChild;
	const trigger = root?.querySelector('[data-dropdown-menu-target="trigger"]');
	const menu = root?.querySelector('[data-dropdown-menu-target="menu"]');
	const items = root?.querySelectorAll('[data-dropdown-menu-target="item"]');
	if (
		!(root instanceof HTMLElement) ||
		!(trigger instanceof HTMLButtonElement) ||
		!(menu instanceof HTMLElement) ||
		!items ||
		items.length !== 3
	) {
		throw new Error("dropdown-menu を作成できませんでした");
	}
	return {
		root,
		trigger,
		menu,
		items: Array.from(items).filter(
			(item): item is HTMLButtonElement => item instanceof HTMLButtonElement,
		),
	};
};

const mountRaw = async (html: string) => {
	document.body.insertAdjacentHTML("beforeend", html);
	await settle();
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"dropdown-menu",
	) as DropdownMenuPublicController | null;
	if (controller === null) throw new Error("dropdown-menu controller が接続されていません");
	return controller;
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("dropdown-menu", DropdownMenuController);
});

afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("dropdown-menu", () => {
	test("[dropdown-menu-state-sync][dropdown-menu-name-preservation][dropdown-menu-root-state-negative][dropdown-menu-trigger-expanded-negative][dropdown-menu-menu-hidden-negative][dropdown-menu-item-tabindex-negative][dropdown-menu-item-disabled-state-negative][dropdown-menu-trigger-has-popup-preservation-negative][dropdown-menu-trigger-controls-preservation-negative] Synchronizes native semantics, relationships, and state", async () => {
		const { root, trigger, menu, items } = await mount(
			'id="authored-root" aria-label="操作"',
			'aria-haspopup="true" aria-controls="other-menu" aria-expanded="mixed"',
			'id="authored-menu" role="menu"',
		);
		expect(root.id).toBe("authored-root");
		expect(trigger.getAttribute("aria-haspopup")).toBe("true");
		expect(trigger.getAttribute("aria-controls")).toBe("other-menu");
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(menu.id).toBe("authored-menu");
		expect(menu.getAttribute("role")).toBe("menu");
		expect(menu.hidden).toBe(true);
		expect(items[0]?.getAttribute("role")).toBe("menuitem");
		expect(items[0]?.id).toMatch(/^dropdown-menu-item-/);
		expect(items[0]?.tabIndex).toBe(-1);
		expect(items[2]?.dataset.state).toBe("disabled");
		expect(root.dataset.state).toBe("closed");
		expect(trigger.dataset.state).toBe("closed");
		expect(menu.dataset.state).toBe("closed");
	});

	test("[dropdown-menu-initial-open] The open value synchronizes only initial state without moving focus", async () => {
		const { root, trigger, menu, items } = await mount('data-dropdown-menu-open-value="true"');
		const controller = controllerFor(root);
		expect(controller.open).toBe(true);
		expect(menu.hidden).toBe(false);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(items.every((item) => item.dataset.state !== "active")).toBe(true);
		expect(document.activeElement).not.toBe(items[0]);
	});

	test("[dropdown-menu-programmatic-silence] Public APIs change only open state without emitting events", async () => {
		const { root, menu } = await mount();
		const controller = controllerFor(root);
		const events: Event[] = [];
		for (const name of [
			"dropdown-menu:beforeopen",
			"dropdown-menu:open",
			"dropdown-menu:beforeclose",
			"dropdown-menu:close",
			"dropdown-menu:select",
		])
			root.addEventListener(name, (event) => events.push(event));

		controller.show();
		expect(controller.open).toBe(true);
		expect(menu.hidden).toBe(false);
		controller.hide();
		controller.toggle();
		controller.open = false;
		controller.select("edit");
		expect(controller.open).toBe(false);
		expect(menu.hidden).toBe(true);
		expect(events).toEqual([]);
	});

	test("[dropdown-menu-click-trusted-negative][dropdown-menu-keydown-trusted-negative][dropdown-menu-document-pointer-trusted-negative][dropdown-menu-trigger-key-filter-negative] Does not treat synthetic events or unsupported keys as user actions", async () => {
		const { root, trigger, items } = await mount();
		const outside = document.createElement("button");
		outside.type = "button";
		document.body.append(outside);

		trigger.click();
		expect(root.dataset.state).toBe("closed");
		trigger.dispatchEvent(
			new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
		);
		expect(root.dataset.state).toBe("closed");

		trigger.focus();
		await userEvent.keyboard("{ArrowLeft}");
		expect(root.dataset.state).toBe("closed");

		await userEvent.click(trigger);
		expect(root.dataset.state).toBe("open");
		document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
		expect(root.dataset.state).toBe("open");
		await userEvent.click(outside);
		expect(root.dataset.state).toBe("closed");
		expect(document.activeElement).toBe(trigger);
		expect(items[0]?.dataset.state).toBe("inactive");
	});

	test("[dropdown-menu-beforeopen][dropdown-menu-trigger-keyboard] Checks trigger cancellation and focus during keyboard interaction", async () => {
		const { root, trigger, items } = await mount();
		const events: string[] = [];
		let cancel = true;
		root.addEventListener("dropdown-menu:beforeopen", (event) => {
			events.push(event.type);
			if (cancel) event.preventDefault();
		});
		root.addEventListener("dropdown-menu:open", (event) => events.push(event.type));

		trigger.focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(root.dataset.state).toBe("closed");
		expect(events).toEqual(["dropdown-menu:beforeopen"]);
		cancel = false;
		await userEvent.keyboard("{ArrowDown}");
		expect(events).toEqual([
			"dropdown-menu:beforeopen",
			"dropdown-menu:beforeopen",
			"dropdown-menu:open",
		]);
		expect(document.activeElement).toBe(items[0]);
		expect(items[0]?.dataset.state).toBe("active");
		await userEvent.keyboard("{Enter}");
		expect(root.dataset.state).toBe("closed");
	});

	test("[dropdown-menu-keyboard-navigation][dropdown-menu-keyboard-wrap-negative][dropdown-menu-item-active-state-negative] Checks menu arrows, Home, End, and wrapping at boundaries", async () => {
		const { trigger, items } = await mount();
		trigger.focus();
		await userEvent.keyboard("{Enter}");
		expect(document.activeElement).toBe(items[0]);
		await userEvent.keyboard("{ArrowDown}");
		expect(document.activeElement).toBe(items[1]);
		expect(items[1]?.dataset.state).toBe("active");
		await userEvent.keyboard("{ArrowDown}");
		expect(document.activeElement).toBe(items[0]);
		await userEvent.keyboard("{End}");
		expect(document.activeElement).toBe(items[1]);
		await userEvent.keyboard("{Home}");
		expect(document.activeElement).toBe(items[0]);
		await userEvent.keyboard("{ArrowUp}");
		expect(document.activeElement).toBe(items[1]);
	});

	test("[dropdown-menu-selection] Emits select after closing on pointer selection", async () => {
		const { root, trigger, items } = await mount();
		const events: Array<{ type: string; detail?: CloseDetail | SelectDetail }> = [];
		for (const name of [
			"dropdown-menu:beforeclose",
			"dropdown-menu:close",
			"dropdown-menu:select",
		]) {
			root.addEventListener(name, (event) =>
				events.push({
					type: event.type,
					detail: (event as CustomEvent<CloseDetail | SelectDetail>).detail,
				}),
			);
		}
		await userEvent.click(trigger);
		await userEvent.click(items[1]!);
		expect(events.map(({ type }) => type)).toEqual([
			"dropdown-menu:beforeclose",
			"dropdown-menu:close",
			"dropdown-menu:select",
		]);
		expect(events[1]?.detail).toEqual({ reason: "pointer", value: "delete" });
		expect(events[2]?.detail).toEqual({ reason: "pointer", value: "delete" });
		expect(document.activeElement).toBe(trigger);
	});

	test("[dropdown-menu-beforeclose][dropdown-menu-cancel] Canceling beforeclose prevents selection and closing", async () => {
		const { root, trigger, items } = await mount();
		await userEvent.click(trigger);
		const events: string[] = [];
		let cancel = true;
		root.addEventListener("dropdown-menu:beforeclose", (event) => {
			events.push(event.type);
			if (cancel) event.preventDefault();
		});
		root.addEventListener("dropdown-menu:close", (event) => events.push(event.type));
		root.addEventListener("dropdown-menu:select", (event) => events.push(event.type));

		await userEvent.click(items[0]!);
		expect(root.dataset.state).toBe("open");
		expect(events).toEqual(["dropdown-menu:beforeclose"]);
		cancel = false;
		await userEvent.click(items[0]!);
		expect(events).toEqual([
			"dropdown-menu:beforeclose",
			"dropdown-menu:beforeclose",
			"dropdown-menu:close",
			"dropdown-menu:select",
		]);
	});

	test("[dropdown-menu-outside-tab-escape] Checks specified focus behavior for outside pointers, Escape, and Tab", async () => {
		const { root, trigger, items } = await mount();
		const outside = document.createElement("button");
		outside.type = "button";
		document.body.append(outside);
		await userEvent.click(trigger);
		await userEvent.keyboard("{Escape}");
		expect(root.dataset.state).toBe("closed");
		expect(document.activeElement).toBe(trigger);
		await userEvent.click(trigger);
		await userEvent.click(outside);
		expect(root.dataset.state).toBe("closed");
		expect(document.activeElement).toBe(trigger);
		await userEvent.click(trigger);
		items[0]?.focus();
		await userEvent.keyboard("{Tab}");
		expect(root.dataset.state).toBe("closed");
	});

	test("[dropdown-menu-disabled-guard][dropdown-menu-disabled-items-negative][dropdown-menu-empty-value-guard-negative] Excludes disabled items from focus and selection", async () => {
		const { root, trigger, items } = await mount();
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("dropdown-menu:select", (event) => events.push(event));
		await userEvent.click(trigger);
		expect(document.activeElement).toBe(items[0]);
		items[2]?.focus();
		expect(document.activeElement).not.toBe(items[2]);
		expect(root.dataset.state).toBe("open");
		controller.select("");
		controller.select("missing");
		controller.select("disabled");
		expect(events).toEqual([]);
		const empty = document.createElement("button");
		empty.type = "button";
		empty.dataset.dropdownMenuTarget = "item";
		empty.dataset.dropdownMenuValue = "";
		empty.textContent = "空";
		root.querySelector("menu")?.append(empty);
		await settle();
		await userEvent.click(empty);
		expect(root.dataset.state).toBe("open");
		expect(events).toEqual([]);
	});

	test("[dropdown-menu-dynamic-targets] Synchronizes added, replaced, and removed items", async () => {
		const { root, menu, items } = await mount();
		menu.insertAdjacentHTML(
			"beforeend",
			'<button type="button" data-dropdown-menu-target="item" data-dropdown-menu-value="archive">保存</button>',
		);
		await settle();
		const added = menu.querySelector<HTMLButtonElement>('[data-dropdown-menu-value="archive"]');
		expect(added?.getAttribute("role")).toBe("menuitem");
		expect(added?.tabIndex).toBe(-1);
		items[0]?.remove();
		await settle();
		expect(root.dataset.state).toBe("closed");
		expect(menu.querySelectorAll('[data-dropdown-menu-target="item"]')).toHaveLength(3);
	});

	test("[dropdown-menu-disconnect-cleanup] Removes listeners and retains closed state on disconnect", async () => {
		const { root, trigger, menu } = await mount();
		await userEvent.click(trigger);
		root.remove();
		await settle();
		application.stop();
		expect(root.dataset.state).toBe("closed");
		expect(menu.hidden).toBe(true);
		const event = new PointerEvent("pointerdown", { bubbles: true });
		document.body.dispatchEvent(event);
		expect(root.dataset.state).toBe("closed");
	});

	test("[dropdown-menu-disconnect-combined-negative] Leftover listeners cannot reactivate after disconnect", async () => {
		const { root, trigger } = await mount();
		const controller = controllerFor(root) as DropdownMenuPublicController & {
			disconnect: () => void;
		};
		await userEvent.click(trigger);
		expect(root.dataset.state).toBe("open");
		controller.disconnect();
		expect(root.dataset.state).toBe("closed");
		await userEvent.click(trigger);
		expect(root.dataset.state).toBe("closed");
	});

	test("[dropdown-menu-completion-warning][dropdown-menu-completion-warning-negative] Warns once per connection when completing roles, relationships, and popup attributes and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("dropdown-menu controller");
			expect(warnings[0]).toContain('aria-haspopup="menu"');
			expect(warnings[0]).toContain('role="menu"');
			expect(warnings[0]).toContain("aria-controls");

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div data-controller="dropdown-menu">' +
					'<button type="button" data-dropdown-menu-target="trigger" aria-haspopup="menu" aria-controls="complete-menu">操作</button>' +
					'<menu id="complete-menu" data-dropdown-menu-target="menu" role="menu" aria-label="操作">' +
					'<button type="button" data-dropdown-menu-target="item" data-dropdown-menu-value="edit" role="menuitem">編集</button>' +
					"</menu></div>",
			);
			await settle();
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			await mountRaw(
				'<div data-controller="dropdown-menu"><button type="button" aria-haspopup="dialog" data-dropdown-menu-target="trigger">操作</button><menu role="listbox" data-dropdown-menu-target="menu"><button type="button" data-dropdown-menu-target="item" data-dropdown-menu-value="item">項目</button></menu></div>',
			);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(warnings[0]).not.toContain("Added ");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[dropdown-menu-semantic-validation][dropdown-menu-semantic-validation-negative][dropdown-menu-role-conflict] Warns once and disables enhancement for invalid markup", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		await mountRaw(
			'<div data-controller="dropdown-menu"><button type="button" aria-haspopup="dialog" data-dropdown-menu-target="trigger">操作</button>' +
				'<menu role="listbox" data-dropdown-menu-target="menu"><button type="button" data-dropdown-menu-target="item" data-dropdown-menu-value="item">項目</button></menu></div>',
		);
		const root = document.body.lastElementChild;
		if (!(root instanceof HTMLElement)) throw new Error("root がありません");
		expect(warnings).toHaveLength(1);
		expect(root.dataset.state).toBeUndefined();
		expect(root.querySelector('[data-dropdown-menu-target="menu"]')?.getAttribute("role")).toBe(
			"listbox",
		);
		root.innerHTML =
			'<button type="button" data-dropdown-menu-target="trigger">操作</button>' +
			'<menu data-dropdown-menu-target="menu"><button type="button" data-dropdown-menu-target="item" data-dropdown-menu-value="ok">OK</button></menu>';
		await settle();
		expect(warnings).toHaveLength(2);
		expect(root.dataset.state).toBe("closed");
	});

	test("[dropdown-menu-nested-events] Uses the originating root as the event target", async () => {
		const outer = await mount();
		const innerRoot = document.createElement("div");
		innerRoot.dataset.controller = "dropdown-menu";
		innerRoot.innerHTML =
			'<button type="button" data-dropdown-menu-target="trigger">内側</button>' +
			'<menu data-dropdown-menu-target="menu"><button type="button" data-dropdown-menu-target="item" data-dropdown-menu-value="inner">内側項目</button></menu>';
		outer.root.append(innerRoot);
		await settle();
		const received: Array<{ target: EventTarget | null; current: EventTarget | null }> = [];
		outer.root.addEventListener("dropdown-menu:open", (event) =>
			received.push({ target: event.target, current: event.currentTarget }),
		);
		const innerTrigger = innerRoot.querySelector<HTMLButtonElement>(
			"[data-dropdown-menu-target=trigger]",
		);
		if (!innerTrigger) throw new Error("inner trigger がありません");
		await userEvent.click(innerTrigger);
		expect(received).toEqual([{ target: innerRoot, current: outer.root }]);
	});
});
