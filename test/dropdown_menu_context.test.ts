import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { commands, userEvent } from "vite-plus/test/browser/context";
import DropdownMenuController, {
	type DropdownMenuOpenDetail,
} from "../src/dropdown_menu_controller";

let application: Application;
let warnings: string[];
let originalWarn: typeof console.warn;
let nextId = 0;
const pointerCommands = commands as typeof commands & {
	cropperPointer: (
		selector: string,
		action: "down" | "move" | "up",
		x: number,
		y: number,
	) => Promise<void>;
};
const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
};
const createContextMenu = () => {
	const root = document.createElement("div");
	root.setAttribute("data-controller", "dropdown-menu");
	const trigger = document.createElement("button");
	trigger.type = "button";
	trigger.textContent = "操作メニュー";
	trigger.setAttribute("data-dropdown-menu-target", "trigger");
	trigger.setAttribute("aria-haspopup", "menu");
	const region = document.createElement("div");
	region.setAttribute("data-dropdown-menu-target", "context");
	region.setAttribute("role", "group");
	region.setAttribute("aria-label", "項目の操作");
	region.tabIndex = 0;
	const row = document.createElement("button");
	row.type = "button";
	row.textContent = "項目";
	const surface = document.createElement("p");
	surface.textContent = "操作対象の領域";
	region.append(row, surface);
	const menu = document.createElement("menu");
	menu.id = `context-menu-${++nextId}`;
	surface.id = `${menu.id}-surface`;
	menu.setAttribute("data-dropdown-menu-target", "menu");
	menu.setAttribute("role", "menu");
	menu.setAttribute("aria-label", "項目の操作");
	trigger.setAttribute("aria-controls", menu.id);
	const items = ["edit", "remove"].map((value) => {
		const item = document.createElement("button");
		item.type = "button";
		item.textContent = value;
		item.setAttribute("role", "menuitem");
		item.setAttribute("data-dropdown-menu-target", "item");
		item.setAttribute("data-dropdown-menu-value", value);
		return item;
	});
	menu.append(...items);
	root.append(trigger, region, menu);
	return { root, trigger, region, row, surface, menu, items };
};
const mount = async (fixture = createContextMenu()) => {
	document.body.append(fixture.root);
	await settle();
	const controller = application.getControllerForElementAndIdentifier(
		fixture.root,
		"dropdown-menu",
	);
	if (!(controller instanceof DropdownMenuController)) throw new Error("controller がありません");
	return { ...fixture, controller };
};
const listen = (root: HTMLElement) => {
	const events: { type: string; detail: DropdownMenuOpenDetail; cancelable: boolean }[] = [];
	for (const action of ["beforeopen", "open", "beforeclose", "close", "select"]) {
		root.addEventListener(`dropdown-menu:${action}`, (event) => {
			if (event.target === root)
				events.push({
					type: event.type,
					detail: (event as CustomEvent<DropdownMenuOpenDetail>).detail,
					cancelable: event.cancelable,
				});
		});
	}
	return events;
};
const coordinate = (root: HTMLElement, axis: "x" | "y") =>
	parseFloat(root.style.getPropertyValue(`--dropdown-menu-${axis}`));
// Change trusted pointer attributes during capture to test gestures, not real touch delivery.
const emulateTouch = (element: HTMLElement, primary = true) => {
	element.addEventListener(
		"pointerdown",
		(event) => {
			Object.defineProperty(event, "pointerType", { value: "touch" });
			Object.defineProperty(event, "isPrimary", { value: primary });
		},
		{ capture: true },
	);
};
beforeEach(() => {
	document.body.replaceChildren();
	warnings = [];
	originalWarn = console.warn;
	console.warn = (message?: unknown) => warnings.push(String(message));
	application = Application.start();
	application.register("dropdown-menu", DropdownMenuController);
});
afterEach(async () => {
	document.body.replaceChildren();
	await settle();
	application.stop();
	console.warn = originalWarn;
	vi.restoreAllMocks();
});

test("[menu-context-pointer][menu-context-pointer-negative][menu-context-position-negative] Reports right-click targets and viewport coordinates and restores the original focus on Escape", async () => {
	const page = await mount();
	const events = listen(page.root);
	page.row.focus();
	let point = { x: 0, y: 0 };
	let prevented = false;
	let openingFocus: Element | null = null;
	page.root.addEventListener(
		"contextmenu",
		() => {
			openingFocus = document.activeElement;
		},
		{ capture: true },
	);
	page.root.addEventListener("contextmenu", (event) => {
		point = { x: event.clientX, y: event.clientY };
		prevented = event.defaultPrevented;
	});
	await userEvent.click(page.surface, { button: "right", position: { x: 5, y: 5 } });
	expect(page.controller.open).toBe(true);
	expect(prevented).toBe(true);
	expect(coordinate(page.root, "x")).toBeCloseTo(point.x);
	expect(coordinate(page.root, "y")).toBeCloseTo(point.y);
	expect(page.root.style.left).toBe("");
	expect(page.root.style.top).toBe("");
	expect(events.map((event) => event.type)).toEqual([
		"dropdown-menu:beforeopen",
		"dropdown-menu:open",
	]);
	expect(events[1]?.detail).toEqual({ reason: "pointer", context: page.surface });
	expect(document.activeElement).toBe(page.items[0]);
	await userEvent.keyboard("{Escape}");
	expect(document.activeElement).toBe(openingFocus);
	expect(events.at(-1)?.detail).toEqual({ reason: "keyboard", value: "", context: page.surface });
	expect(warnings).toEqual([]);
});

test("[menu-context-keyboard][menu-context-keyboard-negative][menu-context-anchor-negative] Opens at the focused target's logical start and bottom on Shift+F10 or ContextMenu", async () => {
	const page = await mount();
	page.row.dir = "rtl";
	for (const key of ["{Shift>}{F10}{/Shift}", "{ContextMenu}"]) {
		page.row.focus();
		const rect = page.row.getBoundingClientRect();
		await userEvent.keyboard(key);
		expect(page.controller.open).toBe(true);
		expect(coordinate(page.root, "x")).toBeCloseTo(rect.right);
		expect(coordinate(page.root, "y")).toBeCloseTo(rect.bottom);
		await userEvent.keyboard("{Escape}");
		expect(document.activeElement).toBe(page.row);
	}
	page.trigger.focus();
	await userEvent.keyboard("{Shift>}{F10}{/Shift}");
	expect(page.controller.open).toBe(true);
});

test("[menu-context-fallback] Opens below the persistent button without context through the button or API", async () => {
	const page = await mount();
	const events = listen(page.root);
	await userEvent.click(page.trigger);
	expect(events[1]?.detail).toEqual({ reason: "pointer" });
	expect(coordinate(page.root, "x")).toBeCloseTo(page.trigger.getBoundingClientRect().left);
	page.controller.hide();
	events.length = 0;
	page.controller.show();
	expect(page.controller.open).toBe(true);
	expect(events).toEqual([]);
});

test("[menu-context-cancel] Canceling beforeopen preserves the native menu and existing open state and coordinates", async () => {
	const page = await mount();
	await userEvent.click(page.surface, { button: "right" });
	const x = coordinate(page.root, "x");
	const y = coordinate(page.root, "y");
	page.root.addEventListener("dropdown-menu:beforeopen", (event) => event.preventDefault());
	let prevented = true;
	page.root.addEventListener("contextmenu", (event) => {
		prevented = event.defaultPrevented;
	});
	await userEvent.click(page.row, { button: "right" });
	expect(page.controller.open).toBe(true);
	expect(coordinate(page.root, "x")).toBe(x);
	expect(coordinate(page.root, "y")).toBe(y);
	expect(prevented).toBe(false);
});

test("[menu-context-retarget] Changes the open menu context and passes it in selection detail", async () => {
	const page = await mount();
	const events = listen(page.root);
	await userEvent.click(page.surface, { button: "right" });
	await userEvent.click(page.row, { button: "right" });
	await userEvent.keyboard("{Enter}");
	expect(events.filter((event) => event.type === "dropdown-menu:open")).toHaveLength(2);
	expect(events.at(-1)?.detail).toEqual({ reason: "keyboard", value: "edit", context: page.row });
});

test("[menu-context-protected][menu-context-protected-negative] Preserves editing context menus, IME, and modified keys", async () => {
	const page = await mount();
	for (const tag of ["input", "textarea", "select", "div"]) {
		const input = document.createElement(tag);
		if (tag === "div") {
			input.contentEditable = "true";
			input.textContent = "編集";
		}
		page.region.append(input);
		await userEvent.click(input, { button: "right" });
		input.focus();
		await userEvent.keyboard("{Shift>}{F10}{/Shift}");
		expect(page.controller.open).toBe(false);
	}
	page.row.focus();
	await userEvent.keyboard("{Control>}{Shift>}{F10}{/Shift}{/Control}");
	expect(page.controller.open).toBe(false);
	page.row.addEventListener(
		"keydown",
		(event) => Object.defineProperty(event, "isComposing", { value: true }),
		{ capture: true, once: true },
	);
	page.row.addEventListener("contextmenu", (event) => event.preventDefault(), {
		capture: true,
		once: true,
	});
	await userEvent.keyboard("{ContextMenu}");
	expect(page.controller.open).toBe(false);
});

test("[menu-context-synthetic][menu-context-trusted-negative][menu-context-press-trusted-negative] Ignores synthetic contextmenu and pointer interaction", async () => {
	const page = await mount();
	page.surface.dispatchEvent(
		new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			button: 2,
			clientX: 70,
			clientY: 90,
		}),
	);
	expect(page.controller.open).toBe(false);
	const rect = page.surface.getBoundingClientRect();
	page.surface.dispatchEvent(
		new PointerEvent("pointerdown", {
			bubbles: true,
			pointerType: "touch",
			isPrimary: true,
			pointerId: 7,
			clientX: rect.left + 2,
			clientY: rect.top + 2,
		}),
	);
	const up = new PointerEvent("pointerup", {
		bubbles: true,
		pointerType: "touch",
		isPrimary: true,
		pointerId: 7,
		clientX: rect.left + 2,
		clientY: rect.top + 2,
	});
	Object.defineProperty(up, "timeStamp", { value: up.timeStamp + 650 });
	page.surface.dispatchEvent(up);
	expect(page.controller.open).toBe(false);
});

test("[menu-context-disabled] Rejects context interaction even when disabled is set during capture", async () => {
	const page = await mount();
	page.surface.addEventListener(
		"contextmenu",
		() => {
			page.trigger.disabled = true;
		},
		{ capture: true },
	);
	await userEvent.click(page.surface, { button: "right" });
	expect(page.controller.open).toBe(false);
	page.row.focus();
	await userEvent.keyboard("{Shift>}{F10}{/Shift}");
	expect(page.controller.open).toBe(false);
});

test("[menu-context-before][menu-context-before-negative] Does not overwrite API, target, or connection changes during beforeopen with stale requests", async () => {
	for (const change of ["api", "region", "target", "disabled", "attribute", "disconnect"]) {
		const page = await mount();
		const events = listen(page.root);
		page.root.addEventListener(
			"dropdown-menu:beforeopen",
			() => {
				if (change === "api") page.controller.show();
				if (change === "region") page.region.removeAttribute("data-dropdown-menu-target");
				if (change === "target") page.surface.remove();
				if (change === "disabled") page.trigger.disabled = true;
				if (change === "attribute") page.root.setAttribute("data-dropdown-menu-open-value", "true");
				if (change === "disconnect") page.controller.disconnect();
			},
			{ once: true },
		);
		await userEvent.click(page.surface, { button: "right" });
		expect(
			events.map((event) => event.type),
			change,
		).toEqual(["dropdown-menu:beforeopen"]);
		page.root.remove();
		await settle();
	}
});

test("[menu-context-after][menu-context-after-negative] Preserves API changes in after listeners and focus changes in before listeners", async () => {
	const page = await mount();
	const outside = document.createElement("button");
	outside.textContent = "外";
	document.body.append(outside);
	page.root.addEventListener("dropdown-menu:beforeopen", () => outside.focus(), { once: true });
	await userEvent.click(page.surface, { button: "right" });
	expect(document.activeElement).toBe(outside);
	page.controller.hide();
	page.root.addEventListener("dropdown-menu:open", () => page.controller.hide(), { once: true });
	await userEvent.click(page.surface, { button: "right" });
	expect(page.controller.open).toBe(false);
	expect(document.activeElement).not.toBe(page.items[0]);
	expect(page.items.every((item) => item.dataset.state === "inactive")).toBe(true);
	await userEvent.click(page.surface, { button: "right" });
	const events = listen(page.root);
	let afterCloseFocus: Element | null = null;
	page.root.addEventListener(
		"dropdown-menu:close",
		() => {
			page.controller.show();
			afterCloseFocus = document.activeElement;
		},
		{ once: true },
	);
	await userEvent.keyboard("{Enter}");
	expect(page.controller.open).toBe(true);
	expect(document.activeElement).toBe(afterCloseFocus);
	expect(events.map((event) => event.type)).toEqual([
		"dropdown-menu:beforeclose",
		"dropdown-menu:close",
	]);
});

test("[menu-context-longpress][menu-context-longpress-negative][menu-context-click-negative][menu-context-cancel-trusted-negative] Opens long presses on release, suppresses compatibility clicks, and preserves short taps", async () => {
	const page = await mount();
	emulateTouch(page.row);
	page.row.addEventListener(
		"pointerup",
		() => page.row.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true })),
		{ capture: true, once: true },
	);
	const clicks: Event[] = [];
	page.row.addEventListener("click", (event) => clicks.push(event));
	await userEvent.click(page.row, { delay: 650 });
	expect(page.controller.open).toBe(true);
	expect(clicks).toEqual([]);
	await userEvent.keyboard("{Escape}");
	await userEvent.click(page.row);
	expect(page.controller.open).toBe(false);
	expect(clicks).toHaveLength(1);
});

test("[menu-context-longpress-cancel][menu-context-distance-negative] Cancels long presses on movement, nonprimary input, or context replacement", async () => {
	for (const change of ["movement", "secondary", "target"]) {
		const page = await mount();
		emulateTouch(page.row, change !== "secondary");
		page.row.addEventListener(
			"pointerup",
			(event) => {
				if (change === "movement")
					Object.defineProperty(event, "clientX", { value: event.clientX + 20 });
				if (change === "target") page.region.removeAttribute("data-dropdown-menu-target");
			},
			{ capture: true },
		);
		await userEvent.click(page.row, { delay: 650 });
		expect(page.controller.open, change).toBe(false);
		page.root.remove();
		await settle();
	}
});

test("[menu-context-names][menu-context-names-negative] Completes names and disables explicit empty names or invalid context configurations", async () => {
	const fixture = createContextMenu();
	fixture.menu.removeAttribute("aria-label");
	const page = await mount(fixture);
	expect(page.menu.getAttribute("aria-labelledby")).toBe(page.trigger.id);
	expect(page.trigger.id).not.toBe("");
	expect(warnings).toHaveLength(1);
	page.menu.setAttribute("aria-labelledby", "empty-context-label");
	const empty = document.createElement("span");
	empty.id = "empty-context-label";
	page.root.append(empty);
	await settle();
	await userEvent.click(page.surface, { button: "right" });
	expect(page.controller.open).toBe(false);
	expect(warnings).toHaveLength(2);
});

test("[menu-context-cleanup][menu-context-cleanup-negative][menu-context-closed-items-negative] Restores coordinates and removes listeners when context is removed or disconnected", async () => {
	const fixture = createContextMenu();
	fixture.root.style.setProperty("--dropdown-menu-x", "12px", "important");
	const page = await mount(fixture);
	await userEvent.click(page.surface, { button: "right" });
	page.region.removeAttribute("data-dropdown-menu-target");
	await settle();
	expect(page.controller.open).toBe(false);
	expect(page.root.style.getPropertyValue("--dropdown-menu-x")).toBe("12px");
	expect(page.items.every((item) => item.dataset.state === "inactive")).toBe(true);
	expect(page.root.style.getPropertyPriority("--dropdown-menu-x")).toBe("important");
	expect(page.root.style.getPropertyValue("--dropdown-menu-y")).toBe("");
	page.region.setAttribute("data-dropdown-menu-target", "context");
	await settle();
	await userEvent.click(page.surface, { button: "right" });
	const removeListener = vi.spyOn(page.root, "removeEventListener");
	page.controller.disconnect();
	for (const event of [
		"contextmenu",
		"pointerdown",
		"pointermove",
		"pointerup",
		"pointercancel",
		"pointerleave",
	])
		expect(removeListener).toHaveBeenCalledWith(event, expect.any(Function));
	expect(removeListener).toHaveBeenCalledWith("click", expect.any(Function), true);
	await userEvent.click(page.surface, { button: "right" });
	expect(page.controller.open).toBe(false);
	expect(page.root.style.getPropertyValue("--dropdown-menu-x")).toBe("12px");
});

test("[menu-context-native-priority][menu-context-native-priority-negative] Opens only once when native contextmenu occurs during a long press", async () => {
	const page = await mount();
	const events = listen(page.root);
	emulateTouch(page.row);
	page.row.addEventListener(
		"pointerdown",
		(event) => Object.defineProperty(event, "button", { value: 0 }),
		{ capture: true },
	);
	await userEvent.click(page.row, { button: "right", delay: 650 });
	expect(page.controller.open).toBe(true);
	expect(events.filter((event) => event.type === "dropdown-menu:open")).toHaveLength(1);
});

test("[menu-context-markup][menu-context-markup-negative] Disables multiple context targets and closes an open menu on dynamic violations", async () => {
	const fixture = createContextMenu();
	const duplicate = fixture.region.cloneNode(true);
	fixture.root.append(duplicate);
	const page = await mount(fixture);
	await userEvent.click(page.row, { button: "right" });
	expect(page.controller.open).toBe(false);
	expect(warnings).toHaveLength(1);
	page.root.removeChild(duplicate);
	await settle();
	await userEvent.click(page.row, { button: "right" });
	expect(page.controller.open).toBe(true);
	page.menu.setAttribute("aria-label", "");
	await settle();
	expect(page.controller.open).toBe(false);
	expect(page.menu.hidden).toBe(true);
	expect(page.items.every((item) => item.dataset.state === "inactive")).toBe(true);
});

test("[menu-context-shared-name] Does not count hidden-only item text as an accessible name", async () => {
	const fixture = createContextMenu();
	const item = fixture.items[0];
	if (!item) throw new Error("item がありません");
	item.innerHTML = '<span aria-hidden="true">編集</span>';
	const page = await mount(fixture);
	await userEvent.click(page.row, { button: "right" });
	expect(page.controller.open).toBe(false);
	expect(warnings).toHaveLength(1);
});

test("[menu-context-motion][menu-context-motion-negative] Does not open after moving away and back during a long press", async () => {
	const page = await mount();
	emulateTouch(page.surface);
	const selector = `#${page.surface.id}`;
	await pointerCommands.cropperPointer(selector, "down", 5, 5);
	try {
		await pointerCommands.cropperPointer(selector, "move", 30, 5);
		await pointerCommands.cropperPointer(selector, "move", 5, 5);
		await new Promise<void>((resolve) => setTimeout(resolve, 650));
	} finally {
		await pointerCommands.cropperPointer(selector, "up", 5, 5);
	}
	expect(page.controller.open).toBe(false);
});

test("[menu-context-close-before][menu-context-close-before-negative] Preserves item values and API state changed during beforeclose", async () => {
	for (const change of ["value", "api"]) {
		const page = await mount();
		await userEvent.click(page.row, { button: "right" });
		const events = listen(page.root);
		page.root.addEventListener(
			"dropdown-menu:beforeclose",
			() => {
				if (change === "api") page.controller.show();
				else page.items[0]?.setAttribute("data-dropdown-menu-value", "changed");
			},
			{ once: true },
		);
		await userEvent.keyboard("{Enter}");
		expect(page.controller.open).toBe(true);
		expect(events.map((event) => event.type)).toEqual(["dropdown-menu:beforeclose"]);
		page.root.remove();
		await settle();
	}
});

test("[menu-context-shortcut-cancel][menu-context-shortcut-cancel-negative] Does not reopen through native contextmenu after a shortcut is canceled", async () => {
	const page = await mount();
	for (const key of ["{ContextMenu}", "{Shift>}{F10}{/Shift}"]) {
		const events = listen(page.root);
		page.row.focus();
		page.root.addEventListener("dropdown-menu:beforeopen", (event) => event.preventDefault(), {
			once: true,
		});
		await userEvent.keyboard(key);
		expect(page.controller.open).toBe(false);
		expect(events.map((event) => event.type)).toEqual(["dropdown-menu:beforeopen"]);
	}
});

test("[menu-context-close-focus][menu-context-close-focus-negative] Restores the trigger for outside interaction and trigger toggles, and the original context for Escape", async () => {
	const page = await mount();
	const outside = document.createElement("button");
	outside.textContent = "外";
	document.body.append(outside);
	for (const destination of [outside, page.trigger]) {
		page.row.focus();
		await userEvent.keyboard("{ContextMenu}");
		await userEvent.click(destination);
		expect(document.activeElement).toBe(page.trigger);
	}
	page.row.focus();
	await userEvent.keyboard("{ContextMenu}");
	await userEvent.keyboard("{Escape}");
	expect(document.activeElement).toBe(page.row);
});

for (const action of ["open", "close"] as const) {
	test(`[menu-context-after-value][menu-context-after-value-negative] ${action} listenerのopen value属性変更後は古いfocusとselectionを実行しない`, async () => {
		const page = await mount();
		page.row.focus();
		if (action === "close") await userEvent.keyboard("{ContextMenu}");
		const events = listen(page.root);
		const focused: Element[] = [];
		page.root.addEventListener("focusin", (event) => {
			if (event.target instanceof Element) focused.push(event.target);
		});
		page.root.addEventListener(
			`dropdown-menu:${action}`,
			() =>
				page.root.setAttribute(
					"data-dropdown-menu-open-value",
					action === "open" ? "false" : "true",
				),
			{ once: true },
		);
		await userEvent.keyboard(action === "open" ? "{ContextMenu}" : "{Enter}");
		expect(page.controller.open).toBe(action === "close");
		expect(events.map((event) => event.type)).toEqual([
			`dropdown-menu:before${action}`,
			`dropdown-menu:${action}`,
		]);
		expect(focused).toEqual([]);
	});
}

test("[menu-context-after-focus-value][menu-context-after-value-negative] Does not emit stale selection after a focus listener changes the open value attribute", async () => {
	const page = await mount();
	await userEvent.click(page.trigger);
	const events = listen(page.root);
	page.trigger.addEventListener(
		"focus",
		() => page.root.setAttribute("data-dropdown-menu-open-value", "true"),
		{ once: true },
	);
	await userEvent.keyboard("{Enter}");
	expect(page.controller.open).toBe(true);
	expect(events.map((event) => event.type)).toEqual([
		"dropdown-menu:beforeclose",
		"dropdown-menu:close",
	]);
});

test("[menu-context-press-targets][menu-context-press-targets-negative] Does not open if valid trigger or menu targets are replaced during a long press", async () => {
	for (const target of ["trigger", "menu"] as const) {
		const page = await mount();
		emulateTouch(page.row);
		page.row.addEventListener(
			"pointerup",
			() => {
				const element = page[target];
				element.replaceWith(element.cloneNode(true));
			},
			{ capture: true },
		);
		await userEvent.click(page.row, { delay: 650 });
		expect(page.controller.open).toBe(false);
		page.root.remove();
		await settle();
	}
});

test("[menu-context-element][menu-context-element-negative] Disables SVG context targets", async () => {
	const fixture = createContextMenu();
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("data-dropdown-menu-target", "context");
	fixture.region.replaceWith(svg);
	const page = await mount(fixture);
	await userEvent.click(page.trigger);
	expect(page.controller.open).toBe(false);
	expect(warnings).toHaveLength(1);
});
