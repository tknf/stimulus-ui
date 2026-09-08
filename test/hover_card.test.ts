import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser/context";
import HoverCardController, { type HoverCardToggleDetail } from "../src/hover_card_controller";

let application: Application;
let warnings: string[];
let originalWarn: typeof console.warn;
let count = 0;
const initialUrl = location.href;
const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const createPreview = (link = false, complete = true) => {
	count += 1;
	const root = document.createElement("div");
	root.id = `hover-fixture-${count}`;
	root.style.cssText = "position:fixed;left:0;top:0;width:600px;height:500px";
	root.dataset.controller = "hover-card";
	const trigger = document.createElement(link ? "a" : "button");
	if (trigger instanceof HTMLButtonElement) trigger.type = "button";
	if (trigger instanceof HTMLAnchorElement) trigger.href = "#hover-destination";
	trigger.textContent = "プロフィール";
	trigger.dataset.hoverCardTarget = "trigger";
	trigger.style.cssText = "position:absolute;left:80px;top:80px;width:100px;height:30px";
	const preview = link ? document.createElement("button") : null;
	if (preview) {
		preview.type = "button";
		preview.textContent = "プレビュー";
		preview.dataset.hoverCardTarget = "preview";
		preview.style.cssText = "position:absolute;left:80px;top:120px;width:100px;height:30px";
	}
	const content = document.createElement("div");
	content.dataset.hoverCardTarget = "content";
	content.style.cssText = "position:fixed;margin:0;left:200px;top:200px;width:160px;height:120px";
	const action = document.createElement("button");
	action.type = "button";
	action.textContent = "フォロー";
	const close = document.createElement("button");
	close.type = "button";
	close.textContent = "閉じる";
	close.dataset.hoverCardTarget = "close";
	content.append(action, close);
	root.append(trigger);
	if (preview) root.append(preview);
	root.append(content);
	const outside = document.createElement("button");
	outside.type = "button";
	outside.textContent = "外部";
	outside.style.cssText = "position:absolute;left:450px;top:350px";
	root.append(outside);
	if (complete) {
		content.id = `hover-content-${count}`;
		content.popover = "manual";
		trigger.setAttribute("aria-controls", content.id);
		preview?.setAttribute("aria-controls", content.id);
	}
	return { root, trigger, preview, content, action, close, outside };
};
const mount = async (fixture = createPreview()) => {
	document.body.append(fixture.root);
	await settle();
	const controller = application.getControllerForElementAndIdentifier(fixture.root, "hover-card");
	if (!(controller instanceof HoverCardController))
		throw new Error("hover-card が接続されていません");
	return { ...fixture, controller };
};
const move = async (root: HTMLElement, x: number, y: number) => {
	const pointer = commands as typeof commands & {
		cropperPointer: (selector: string, action: "move", x: number, y: number) => Promise<void>;
	};
	await pointer.cropperPointer(`#${root.id}`, "move", x, y);
};
const clock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
const advance = async (milliseconds: number) => {
	await vi.advanceTimersByTimeAsync(milliseconds);
};
const listen = (root: HTMLElement) => {
	const events: {
		type: string;
		detail: HoverCardToggleDetail;
		bubbles: boolean;
		cancelable: boolean;
	}[] = [];
	for (const type of ["hover-card:beforetoggle", "hover-card:toggle"]) {
		root.addEventListener(type, (event) =>
			events.push({
				type,
				detail: (event as CustomEvent<HoverCardToggleDetail>).detail,
				bubbles: event.bubbles,
				cancelable: event.cancelable,
			}),
		);
	}
	return events;
};
beforeEach(async () => {
	await page.viewport(800, 600);
	document.body.replaceChildren();
	warnings = [];
	originalWarn = console.warn;
	console.warn = (message?: unknown) => warnings.push(String(message));
	application = Application.start();
	application.register("hover-card", HoverCardController);
});
afterEach(async () => {
	for (const root of document.querySelectorAll('[data-controller="hover-card"]'))
		root.removeAttribute("data-controller");
	await settle();
	application.stop();
	vi.useRealTimers();
	vi.restoreAllMocks();
	console.warn = originalWarn;
	document.body.replaceChildren();
	history.replaceState(null, "", initialUrl);
});

test("[hover-card-structure] [hover-card-structure-preservation-negative] Checks link/button state, relationships, ID and tabindex completion, and authored attributes", async () => {
	const first = await mount(createPreview(true, false));
	expect(first.content.id).toMatch(/^hover-card-content-/);
	expect(first.content.popover).toBe("manual");
	expect(first.trigger.getAttribute("tabindex")).toBe("0");
	expect(first.trigger.getAttribute("aria-controls")).toBe(first.content.id);
	expect(first.preview?.getAttribute("aria-controls")).toBe(first.content.id);
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toContain("Added ");
	first.controller.show();
	for (const element of [first.root, first.trigger, first.preview, first.content])
		expect(element?.dataset.state).toBe("open");
	expect(first.trigger.getAttribute("aria-expanded")).toBe("true");
	expect(first.preview?.getAttribute("aria-expanded")).toBe("true");
	first.controller.hide();
	expect(first.root.dataset.state).toBe("closed");
	first.root.remove();
	await settle();
	warnings.length = 0;
	const fixture = createPreview();
	fixture.trigger.setAttribute("aria-controls", "author-related");
	fixture.content.setAttribute("role", "group");
	const second = await mount(fixture);
	expect(second.trigger.getAttribute("aria-controls")).toBe("author-related");
	expect(second.content.id).toBe(`hover-content-${count}`);
	expect(second.content.getAttribute("role")).toBe("group");
	expect(warnings).toEqual([]);
});

test("[hover-card-keyboard] [hover-card-keyboard-focus-return-negative] Shows immediately on focus, enters with Tab/Shift+Tab, and does not reopen after Escape", async () => {
	const { root, trigger, preview, content, action, close, outside, controller } = await mount(
		createPreview(true),
	);
	trigger.focus();
	expect(controller.open).toBe(true);
	expect(document.activeElement).toBe(trigger);
	await userEvent.tab();
	expect(document.activeElement).toBe(preview);
	await userEvent.tab();
	expect(document.activeElement).toBe(action);
	await userEvent.tab({ shift: true });
	expect(document.activeElement).toBe(preview);
	action.focus();
	await userEvent.keyboard("{Escape}");
	expect(controller.open).toBe(false);
	expect(document.activeElement).toBe(trigger);
	await settle();
	expect(root.dataset.state).toBe("closed");
	await userEvent.keyboard("{Enter}");
	expect(location.hash).toBe("#hover-destination");
	outside.focus();
	preview?.focus();
	expect(controller.open).toBe(true);
	close.focus();
	await userEvent.keyboard(" ");
	expect(content.matches(":popover-open")).toBe(false);
	expect(document.activeElement).toBe(trigger);
});

test("[hover-card-link] Preserves link navigation and opens preview buttons without navigating", async () => {
	const { trigger, preview, outside, controller } = await mount(createPreview(true));
	await userEvent.click(trigger);
	expect(location.hash).toBe("#hover-destination");
	history.replaceState(null, "", initialUrl);
	outside.focus();
	controller.hide();
	if (!preview) throw new Error("preview button がありません");
	await userEvent.click(preview);
	expect(controller.open).toBe(true);
	expect(location.href).toBe(initialUrl);
});

test("[hover-card-pointer] [hover-card-pointer-corridor-negative] [hover-card-pointer-exit-negative] Delays hover opening, retains movement through the convex corridor in both directions, and closes outside", async () => {
	const { root, trigger, content, controller } = await mount();
	clock();
	await move(root, 20, 20);
	await userEvent.hover(trigger);
	await advance(299);
	expect(controller.open).toBe(false);
	await advance(1);
	expect(controller.open).toBe(true);
	await move(root, 170, 105);
	await move(root, 190, 150);
	await advance(1000);
	expect(controller.open).toBe(true);
	await userEvent.hover(content);
	await advance(500);
	expect(controller.open).toBe(true);
	await move(root, 205, 205);
	await move(root, 190, 160);
	await advance(500);
	expect(controller.open).toBe(true);
	await userEvent.hover(trigger);
	await move(root, 20, 20);
	await advance(149);
	expect(controller.open).toBe(true);
	await advance(1);
	expect(controller.open).toBe(false);
});

test("[hover-card-pointer] Preserves the gap for left-side RTL placement and closes on outside movement", async () => {
	const fixture = createPreview();
	fixture.root.dir = "rtl";
	fixture.trigger.style.left = "400px";
	fixture.content.style.left = "200px";
	const { root, trigger, controller } = await mount(fixture);
	clock();
	await userEvent.hover(trigger);
	await advance(300);
	expect(controller.open).toBe(true);
	await move(root, 405, 105);
	await move(root, 375, 170);
	await advance(500);
	expect(controller.open).toBe(true);
	await move(root, 580, 20);
	await advance(150);
	expect(controller.open).toBe(false);
});

test("[hover-card-keyboard] Stays open on pointer exit while content has focus and closes when Tab moves outside", async () => {
	const { root, trigger, action, close, outside, controller } = await mount();
	clock();
	trigger.focus();
	action.focus();
	await move(root, 20, 20);
	await advance(1000);
	expect(controller.open).toBe(true);
	expect(document.activeElement).toBe(action);
	close.focus();
	await userEvent.tab();
	expect(document.activeElement).toBe(outside);
	expect(controller.open).toBe(false);
});

test("[hover-card-events] [hover-card-events-reentry-negative] Checks beforetoggle cancellation, detail, bubbling, API reentrancy, and event-free programmatic changes", async () => {
	const { root, trigger, content, outside, controller } = await mount();
	const events = listen(root);
	const cancel = (event: Event) => event.preventDefault();
	root.addEventListener("hover-card:beforetoggle", cancel);
	trigger.focus();
	expect(controller.open).toBe(false);
	expect(events).toEqual([
		{
			type: "hover-card:beforetoggle",
			detail: { open: true, previousOpen: false, reason: "keyboard" },
			bubbles: true,
			cancelable: true,
		},
	]);
	outside.focus();
	root.removeEventListener("hover-card:beforetoggle", cancel);
	trigger.focus();
	expect(events.at(-1)?.cancelable).toBe(false);
	expect(events.at(-1)?.detail.open).toBe(true);
	root.addEventListener("hover-card:beforetoggle", cancel);
	if (content.firstElementChild instanceof HTMLElement) content.firstElementChild.focus();
	const focused = document.activeElement;
	await userEvent.keyboard("{Escape}");
	expect(controller.open).toBe(true);
	expect(document.activeElement).toBe(focused);
	root.removeEventListener("hover-card:beforetoggle", cancel);
	outside.focus();
	controller.hide();
	events.length = 0;
	root.addEventListener("hover-card:beforetoggle", () => controller.hide(), { once: true });
	trigger.focus();
	expect(controller.open).toBe(false);
	expect(events).toHaveLength(1);
	events.length = 0;
	controller.show();
	controller.open = false;
	expect(events).toEqual([]);
});

test("[hover-card-events] [hover-card-events-trusted-negative] [hover-card-events-disabled-negative] Synthetic events and disabled buttons do not toggle, and native toggle cancellation is honored", async () => {
	const { root, trigger, close, content, controller } = await mount();
	const events = listen(root);
	clock();
	trigger.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
	trigger.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
	trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
	await advance(300);
	expect(controller.open).toBe(false);
	expect(events).toEqual([]);
	controller.show();
	close.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	expect(controller.open).toBe(true);
	controller.hide();
	trigger.addEventListener(
		"click",
		() => {
			if (trigger instanceof HTMLButtonElement) trigger.disabled = true;
			controller.hide();
			events.length = 0;
		},
		{ capture: true, once: true },
	);
	await userEvent.click(trigger);
	expect(controller.open).toBe(false);
	expect(events).toEqual([]);
	await move(root, 20, 20);
	await userEvent.hover(trigger);
	await advance(300);
	expect(controller.open).toBe(false);
	if (trigger instanceof HTMLButtonElement) trigger.disabled = false;
	content.addEventListener("beforetoggle", (event) => event.preventDefault(), { once: true });
	controller.show();
	expect(controller.open).toBe(false);
});

test("[hover-card-lifecycle] [hover-card-lifecycle-disconnect-negative] Direct disconnect clears timers and listeners without duplicates on reconnection", async () => {
	const { root, trigger, outside, controller } = await mount();
	clock();
	const remove = vi.spyOn(trigger, "removeEventListener");
	const removeDocument = vi.spyOn(document, "removeEventListener");
	const clear = vi.spyOn(globalThis, "clearTimeout");
	await userEvent.hover(trigger);
	controller.disconnect();
	expect(remove).toHaveBeenCalledWith("pointerenter", expect.any(Function));
	expect(removeDocument).toHaveBeenCalledWith("pointermove", expect.any(Function));
	expect(removeDocument).toHaveBeenCalledWith("keydown", expect.any(Function));
	expect(clear).toHaveBeenCalled();
	await advance(1000);
	trigger.focus();
	controller.show();
	expect(controller.open).toBe(false);
	outside.focus();
	controller.connect();
	await settle();
	const events = listen(root);
	trigger.focus();
	expect(events.filter((event) => event.type === "hover-card:toggle")).toHaveLength(1);
});

test("[hover-card-events] Same-value API calls clear pending timers and do not notify native display failures", async () => {
	const { root, trigger, content, outside, controller } = await mount();
	const events = listen(root);
	clock();
	await move(root, 20, 20);
	await userEvent.hover(trigger);
	controller.open = false;
	await advance(1000);
	expect(controller.open).toBe(false);
	expect(events).toEqual([]);
	const show = vi.spyOn(content, "showPopover").mockImplementation(() => {
		throw new DOMException("表示できません", "InvalidStateError");
	});
	trigger.focus();
	expect(controller.open).toBe(false);
	expect(events.map((event) => event.type)).toEqual(["hover-card:beforetoggle"]);
	show.mockRestore();
	outside.focus();
	root.addEventListener("hover-card:beforetoggle", () => controller.disconnect(), { once: true });
	trigger.focus();
	expect(controller.open).toBe(false);
});

test("[hover-card-pointer] Hover timers do not steal focus, and Escape prevents reopening while hover remains", async () => {
	const { root, trigger, outside, controller } = await mount();
	outside.focus();
	clock();
	await move(root, 20, 20);
	await userEvent.hover(trigger);
	await advance(300);
	expect(controller.open).toBe(true);
	expect(document.activeElement).toBe(outside);
	await userEvent.keyboard("{Escape}");
	expect(controller.open).toBe(false);
	expect(document.activeElement).toBe(outside);
	await advance(1000);
	expect(controller.open).toBe(false);
	await move(root, 20, 20);
	await userEvent.hover(trigger);
	await advance(300);
	expect(controller.open).toBe(true);
});

test("[hover-card-lifecycle] Content replacement closes old content and rechecks timers and delay changes", async () => {
	const { root, trigger, content, outside, controller } = await mount();
	controller.show();
	const next = content.cloneNode(true);
	if (!(next instanceof HTMLElement)) throw new Error("content を作成できません");
	content.replaceWith(next);
	await settle();
	expect(content.matches(":popover-open")).toBe(false);
	expect(controller.open).toBe(false);
	controller.openDelayValue = 10;
	await settle();
	clock();
	outside.focus();
	await move(root, 20, 20);
	await userEvent.hover(trigger);
	await advance(10);
	expect(next.matches(":popover-open")).toBe(true);
	controller.openDelayValue = -1;
	await settle();
	expect(warnings.at(-1)).toContain("Enhancement has been disabled");
});

test("[hover-card-lifecycle] [hover-card-lifecycle-invalid-negative] Retains hover during visible content updates and closes invalid markup", async () => {
	const { root, trigger, content, action, controller } = await mount();
	clock();
	await move(root, 20, 20);
	await userEvent.hover(trigger);
	await advance(300);
	await userEvent.hover(content);
	action.textContent = "フォロー中";
	await settle();
	await move(root, 20, 20);
	await advance(150);
	expect(controller.open).toBe(false);
	controller.show();
	action.autofocus = true;
	await settle();
	expect(content.matches(":popover-open")).toBe(false);
	expect(controller.open).toBe(false);
	expect(root.dataset.state).toBe("closed");
	expect(trigger.getAttribute("aria-expanded")).toBe("false");
	action.autofocus = false;
	await settle();
	controller.show();
	content.popover = "auto";
	await settle();
	expect(content.matches(":popover-open")).toBe(false);
	expect(controller.open).toBe(false);
	expect(root.dataset.state).toBe("closed");
});

test("[hover-card-validation] [hover-card-validation-autofocus-negative] Separates invalid autofocus, names, or structure from completion warnings after recovery", async () => {
	const fixture = createPreview(true, false);
	fixture.action.autofocus = true;
	const { root, action, content, trigger, preview, controller } = await mount(fixture);
	controller.show();
	expect(root.dataset.state).toBeUndefined();
	expect(content.hasAttribute("popover")).toBe(false);
	expect(warnings).toHaveLength(1);
	action.autofocus = false;
	await settle();
	expect(warnings).toHaveLength(2);
	expect(warnings[1]).toContain("Added ");
	trigger.textContent = "";
	await settle();
	controller.show();
	expect(controller.open).toBe(false);
	expect(warnings).toHaveLength(2);
	trigger.textContent = "プロフィール";
	preview?.remove();
	await settle();
	controller.show();
	expect(controller.open).toBe(false);
});

test("[hover-card-events] Does not roll back external popover visibility through stale or synthetic toggle events", async () => {
	const { root, content, controller } = await mount();
	const events = listen(root);
	content.showPopover();
	await settle();
	expect(controller.open).toBe(true);
	content.hidePopover();
	content.showPopover();
	await settle();
	expect(controller.open).toBe(true);
	content.dispatchEvent(new ToggleEvent("toggle", { newState: "closed" }));
	expect(controller.open).toBe(true);
	content.hidePopover();
	await settle();
	expect(controller.open).toBe(false);
	expect(events).toEqual([]);
});

test("[hover-card-pointer] [hover-card-keyboard] [hover-card-pointer-reopen-negative] Reopens on the first hover or focus after an ordinary exit", async () => {
	const { root, trigger, outside, controller } = await mount();
	clock();
	await move(root, 20, 20);
	await userEvent.hover(trigger);
	await advance(300);
	await move(root, 20, 20);
	await advance(150);
	expect(controller.open).toBe(false);
	await userEvent.hover(trigger);
	await advance(300);
	expect(controller.open).toBe(true);
	await move(root, 20, 20);
	trigger.focus();
	outside.focus();
	expect(controller.open).toBe(false);
	trigger.focus();
	expect(controller.open).toBe(true);
});

test("[hover-card-lifecycle] [hover-card-lifecycle-reconcile-negative] Preserves pending openDelay and closeDelay during same-target content updates", async () => {
	const { root, trigger, action, controller } = await mount();
	clock();
	await move(root, 20, 20);
	await userEvent.hover(trigger);
	await advance(100);
	trigger.textContent = "担当者";
	await settle();
	await advance(200);
	expect(controller.open).toBe(true);
	await move(root, 20, 20);
	await advance(50);
	action.textContent = "フォロー中";
	await settle();
	await advance(100);
	expect(controller.open).toBe(false);
});

test("[hover-card-structure] [hover-card-structure-references-negative] Updates completed references after content replacement and preserves authored references", async () => {
	const { trigger, preview, content, controller } = await mount(createPreview(true, false));
	const oldId = content.id;
	const next = content.cloneNode(true);
	if (!(next instanceof HTMLElement)) throw new Error("content を作成できません");
	next.removeAttribute("id");
	content.replaceWith(next);
	await settle();
	expect(next.id).not.toBe(oldId);
	expect(trigger.getAttribute("aria-controls")).toBe(next.id);
	expect(preview?.getAttribute("aria-controls")).toBe(next.id);
	trigger.setAttribute("aria-controls", "author-replaced");
	next.id = "next-author-content";
	await settle();
	expect(trigger.getAttribute("aria-controls")).toBe("author-replaced");
	expect(preview?.getAttribute("aria-controls")).toBe("next-author-content");
	controller.show();
	expect(next.matches(":popover-open")).toBe(true);
});

test("[hover-card-events] [hover-card-events-pointer-reason-negative] Retains pointer reason for toggles following native pointer focus", async () => {
	const { root, trigger, outside, controller } = await mount();
	const events = listen(root);
	await userEvent.click(trigger);
	expect(controller.open).toBe(true);
	expect(events.at(-1)?.detail.reason).toBe("pointer");
	await userEvent.click(outside);
	await new Promise((resolve) => setTimeout(resolve, 170));
	expect(controller.open).toBe(false);
	expect(events.at(-1)?.detail.reason).toBe("pointer");
});
