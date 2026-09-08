import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import TooltipController from "../src/tooltip_controller";

type PublicController = Controller & {
	open: boolean;
	show: () => void;
	hide: () => void;
};
type Detail = { open: boolean; previousOpen: boolean; reason: "pointer" | "keyboard" };

let application: Application;
let originalWarn: typeof console.warn;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
};

const wait = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const appendRoot = (markup: string) => {
	document.body.insertAdjacentHTML("beforeend", markup);
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("tooltip root がありません");
	return root;
};

const connectRoot = async (root: HTMLElement) => {
	root.setAttribute("data-controller", "tooltip");
	await settle();
};

const mount = async (attributes = "", contentText = "補足情報", triggerAttributes = "") => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<div data-controller="tooltip" ${attributes}><button type="button" data-tooltip-target="trigger" ${triggerAttributes}>設定</button><div data-tooltip-target="content">${contentText}</div></div>`,
	);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLDivElement)) throw new Error("tooltip root がありません");
	const trigger = root.querySelector("button");
	const content = root.lastElementChild;
	if (!(trigger instanceof HTMLButtonElement) || !(content instanceof HTMLDivElement))
		throw new Error("tooltip target がありません");
	return { root, trigger, content };
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"tooltip",
	) as PublicController | null;
	if (!controller) throw new Error("tooltip controller がありません");
	return controller;
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("tooltip", TooltipController);
});

afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("tooltip", () => {
	test("[tooltip-state-sync] Synchronizes role, ID, aria-describedby, popover, and data-state", async () => {
		const { root, trigger, content } = await mount(
			"",
			"補足情報",
			'aria-describedby="author-description"',
		);
		expect(content.getAttribute("role")).toBe("tooltip");
		expect(content.getAttribute("popover")).toBe("manual");
		expect(content.id).not.toBe("");
		expect(trigger.getAttribute("aria-describedby")?.split(" ")).toEqual([
			"author-description",
			content.id,
		]);
		expect(root.dataset.state).toBe("closed");
		expect(content.dataset.state).toBe("closed");
	});

	test("[tooltip-focus-escape][tooltip-request-noop-negative][tooltip-beforetoggle-cancel-negative] Checks focus opening, Escape dismissal, keyboard reason, and cancellation", async () => {
		const { root, trigger, content } = await mount();
		const events: Array<{ type: string; detail: Detail }> = [];
		let cancel = true;
		root.addEventListener("tooltip:beforetoggle", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<Detail>).detail });
			if (cancel) event.preventDefault();
		});
		root.addEventListener("tooltip:toggle", (event) =>
			events.push({ type: event.type, detail: (event as CustomEvent<Detail>).detail }),
		);
		trigger.focus();
		await settle();
		expect(root.dataset.state).toBe("closed");
		expect(events).toHaveLength(1);
		cancel = false;
		trigger.blur();
		trigger.focus();
		await settle();
		expect(root.dataset.state).toBe("open");
		expect(events.map((event) => event.type)).toEqual([
			"tooltip:beforetoggle",
			"tooltip:beforetoggle",
			"tooltip:toggle",
		]);
		expect(events.at(-1)?.detail).toEqual({ open: true, previousOpen: false, reason: "keyboard" });
		await userEvent.keyboard("{Escape}");
		expect(root.dataset.state).toBe("closed");
		expect(events.at(-1)?.detail).toEqual({ open: false, previousOpen: true, reason: "keyboard" });
		expect(content.matches(":popover-open")).toBe(false);
	});

	test("[tooltip-hoverable-delay][tooltip-hoverable-guard-negative][tooltip-trigger-to-content-negative] Checks trigger/content hover, delay, and pointer reason", async () => {
		const { root, trigger, content } = await mount('data-tooltip-delay-value="100"');
		const outside = document.createElement("button");
		outside.type = "button";
		outside.textContent = "outside";
		document.body.append(outside);
		const events: Detail[] = [];
		root.addEventListener("tooltip:toggle", (event) =>
			events.push((event as CustomEvent<Detail>).detail),
		);
		await userEvent.hover(trigger);
		await wait(10);
		expect(root.dataset.state).toBe("closed");
		await wait(110);
		expect(root.dataset.state).toBe("open");
		// Browsers fire trigger pointerleave before content pointerenter.
		// Remaining open across that order is required by WCAG 1.4.13 hoverable.
		await userEvent.hover(content);
		await settle();
		expect(root.dataset.state).toBe("open");

		// Close when the destination is neither trigger nor content.
		await userEvent.click(outside);
		await settle();
		expect(root.dataset.state).toBe("closed");
		expect(events.map((event) => event.reason)).toEqual(["pointer", "pointer"]);

		const focused = await mount();
		const focusedOutside = document.createElement("button");
		focusedOutside.type = "button";
		document.body.append(focusedOutside);
		focused.trigger.focus();
		await settle();
		await userEvent.hover(focused.trigger);
		await userEvent.hover(focusedOutside);
		await settle();
		expect(focused.root.dataset.state).toBe("open");
	});

	test("[tooltip-isTrusted-guard] Synthetic pointer/focus does not change state or custom events", async () => {
		const { root, trigger, content } = await mount();
		const events: string[] = [];
		root.addEventListener("tooltip:beforetoggle", (event) => events.push(event.type));
		root.addEventListener("tooltip:toggle", (event) => events.push(event.type));

		trigger.dispatchEvent(new FocusEvent("focus"));
		await settle();
		expect(root.dataset.state).toBe("closed");
		expect(events).toEqual([]);

		trigger.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
		content.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
		await settle();
		expect(root.dataset.state).toBe("closed");
		expect(events).toEqual([]);
	});

	test("[tooltip-event-trust][tooltip-trigger-enter-trusted-negative][tooltip-trigger-leave-trusted-negative][tooltip-focus-trusted-negative][tooltip-blur-trusted-negative][tooltip-content-enter-trusted-negative][tooltip-content-leave-trusted-negative][tooltip-document-keydown-trusted-negative] Each handler preserves state for synthetic events", async () => {
		const triggerEnter = await mount();
		triggerEnter.trigger.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
		await settle();
		expect(triggerEnter.root.dataset.state).toBe("closed");

		const triggerLeave = await mount();
		controllerFor(triggerLeave.root).show();
		triggerLeave.trigger.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
		await settle();
		expect(triggerLeave.root.dataset.state).toBe("open");

		const focus = await mount();
		focus.trigger.dispatchEvent(new FocusEvent("focus"));
		await settle();
		expect(focus.root.dataset.state).toBe("closed");

		const blur = await mount();
		controllerFor(blur.root).show();
		blur.trigger.dispatchEvent(new FocusEvent("blur"));
		await settle();
		expect(blur.root.dataset.state).toBe("open");

		const contentEnter = await mount('data-tooltip-delay-value="20"');
		await userEvent.hover(contentEnter.trigger);
		await wait(1);
		contentEnter.content.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
		await wait(30);
		expect(contentEnter.root.dataset.state).toBe("open");

		const contentLeave = await mount();
		controllerFor(contentLeave.root).show();
		contentLeave.content.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
		await settle();
		expect(contentLeave.root.dataset.state).toBe("open");

		const documentKeydown = await mount();
		controllerFor(documentKeydown.root).show();
		document.dispatchEvent(
			new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
		);
		await settle();
		expect(documentKeydown.root.dataset.state).toBe("open");
	});

	test("[tooltip-hover-transitions][tooltip-trigger-to-content-negative][tooltip-content-to-trigger-negative][tooltip-content-enter-timer-negative][tooltip-inactive-timer-negative] Checks pointer transitions and pending-timer cleanup", async () => {
		const transition = await mount();
		controllerFor(transition.root).show();
		const transitionEvents: Detail[] = [];
		transition.root.addEventListener("tooltip:toggle", (event) =>
			transitionEvents.push((event as CustomEvent<Detail>).detail),
		);
		await wait(10);
		let contentLeaveTarget: EventTarget | null = null;
		transition.content.addEventListener("pointerleave", (event) => {
			contentLeaveTarget = (event as PointerEvent).relatedTarget;
		});
		await userEvent.hover(transition.content);
		await wait(10);
		await userEvent.hover(transition.trigger);
		await settle();
		expect(contentLeaveTarget).toBe(transition.trigger);
		expect(transition.root.dataset.state).toBe("open");
		expect(transitionEvents).toEqual([]);

		const contentTimer = await mount('data-tooltip-delay-value="500"');
		contentTimer.content.style.setProperty("display", "block", "important");
		await userEvent.hover(contentTimer.trigger);
		await wait(10);
		await userEvent.hover(contentTimer.content);
		await wait(550);
		expect(contentTimer.root.dataset.state).toBe("closed");

		const inactiveTimer = await mount('data-tooltip-delay-value="40"');
		const outside = document.createElement("button");
		outside.type = "button";
		outside.textContent = "outside";
		document.body.append(outside);
		await userEvent.hover(inactiveTimer.trigger);
		await wait(5);
		await userEvent.hover(outside);
		await wait(50);
		expect(inactiveTimer.root.dataset.state).toBe("closed");
	});

	test("[tooltip-programmatic-silence][tooltip-programmatic-silence-negative][tooltip-commit-noop-negative] open, show, and hide operate without emitting events", async () => {
		const { root, content } = await mount();
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("tooltip:toggle", (event) => events.push(event));
		const showPopover = vi.spyOn(content, "showPopover");
		const hidePopover = vi.spyOn(content, "hidePopover");
		controller.show();
		expect(controller.open).toBe(true);
		controller.show();
		controller.open = true;
		controller.open = false;
		controller.hide();
		controller.hide();
		controller.open = false;
		expect(controller.open).toBe(false);
		expect(showPopover).toHaveBeenCalledTimes(1);
		expect(hidePopover).toHaveBeenCalledTimes(1);
		expect(events).toEqual([]);
	});

	test("[tooltip-external-toggle][tooltip-popover-toggle-listener-negative] Synchronizes external popover toggles to data-state", async () => {
		const { root, content } = await mount();
		content.showPopover();
		await wait(10);
		expect(root.dataset.state).toBe("open");
		expect(content.dataset.state).toBe("open");
		content.hidePopover();
		await wait(10);
		expect(root.dataset.state).toBe("closed");
		expect(content.dataset.state).toBe("closed");
	});

	test("[tooltip-schedule-noop][tooltip-schedule-open-noop-negative] scheduleOpen does not create a timer while open", async () => {
		const { root, trigger } = await mount('data-tooltip-delay-value="20"');
		const controller = controllerFor(root);
		controller.show();
		const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
		trigger.focus();
		await settle();
		expect(setTimeoutSpy).not.toHaveBeenCalled();
	});

	test("[tooltip-popover-failure][tooltip-commit-popover-failure-negative][tooltip-request-commit-failure-negative] Popover API exceptions neither update state nor emit toggle notifications", async () => {
		const { root, trigger, content } = await mount();
		Object.defineProperty(content, "showPopover", {
			configurable: true,
			value: () => {
				throw new Error("showPopover failure");
			},
			writable: true,
		});
		const events: string[] = [];
		root.addEventListener("tooltip:beforetoggle", (event) => events.push(event.type));
		root.addEventListener("tooltip:toggle", (event) => events.push(event.type));
		trigger.focus();
		await settle();
		expect(root.dataset.state).toBe("closed");
		expect(events).toEqual(["tooltip:beforetoggle"]);
	});

	test("[tooltip-lifecycle] Avoids duplicate listeners on target changes and reconnect", async () => {
		const { root, content } = await mount();
		content.remove();
		await settle();
		expect(root.dataset.state).toBe("closed");
		root.insertAdjacentHTML("beforeend", '<div data-tooltip-target="content">新しい補足</div>');
		await settle();
		const nextContent = root.lastElementChild;
		expect(nextContent?.getAttribute("role")).toBe("tooltip");
		root.removeAttribute("data-controller");
		await settle();
		root.setAttribute("data-controller", "tooltip");
		await settle();
		await userEvent.tab();
		await settle();
		expect(root.dataset.state).toBe("open");
	});

	test("[tooltip-disconnect-cleanup][tooltip-disconnect-listener-negative][tooltip-disconnect-timer-negative][tooltip-disconnect-connected-negative][tooltip-disconnect-enhanced-negative] Disconnect clears listeners and timers and updates connection state", async () => {
		const { root, trigger } = await mount('data-tooltip-delay-value="100"');
		const controller = controllerFor(root);
		const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
		const removeEventListenerSpy = vi.spyOn(trigger, "removeEventListener");
		await userEvent.hover(trigger);
		await wait(5);
		controller.disconnect();
		await settle();
		expect(clearTimeoutSpy).toHaveBeenCalled();
		expect(removeEventListenerSpy).toHaveBeenCalledWith("focus", expect.any(Function));
		controller.show();
		expect(root.dataset.state).toBe("closed");
		await wait(120);
		expect(root.dataset.state).toBe("closed");
	});

	test("[tooltip-completion-warning][tooltip-completion-warning-negative] Warns once per connection when completing role and popover and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("tooltip controller");
			expect(warnings[0]).toContain('role="tooltip"');
			expect(warnings[0]).toContain('popover="manual"');

			warnings.length = 0;
			const complete = appendRoot(
				'<div><button data-tooltip-target="trigger">設定</button><div data-tooltip-target="content" role="tooltip" popover="manual">補足</div></div>',
			);
			await connectRoot(complete);
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			const invalid = appendRoot(
				'<div><button data-tooltip-target="trigger">設定</button><div data-tooltip-target="content"><button>操作</button></div></div>',
			);
			await connectRoot(invalid);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(warnings[0]).not.toContain("Added ");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[tooltip-semantic-validation][tooltip-semantic-validation-negative][tooltip-focusable-content-negative] Disables focusable content with a warning", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="tooltip"><button data-tooltip-target="trigger">設定</button><div data-tooltip-target="content"><span><button>操作</button></span></div></div>',
		);
		await settle();
		const root = document.body.lastElementChild;
		if (!(root instanceof HTMLDivElement)) throw new Error("invalid tooltip root");
		expect(warnings).toHaveLength(1);
		expect(root?.dataset.state).toBeUndefined();
		expect(root?.lastElementChild?.getAttribute("role")).toBeNull();
	});

	test("[tooltip-markup-guards][tooltip-trigger-count-negative][tooltip-content-count-negative][tooltip-trigger-element-type-negative][tooltip-content-element-type-negative][tooltip-trigger-content-distinct-negative][tooltip-trigger-focusable-negative][tooltip-popover-show-negative][tooltip-popover-hide-negative][tooltip-delay-finite-negative][tooltip-delay-nonnegative-negative][tooltip-disabled-content-negative][tooltip-hidden-content-negative] Checks each markup guard", async () => {
		const tooManyTriggers = appendRoot(
			'<div><button data-tooltip-target="trigger">A</button><button data-tooltip-target="trigger">B</button><div data-tooltip-target="content">補足</div></div>',
		);
		await connectRoot(tooManyTriggers);
		expect(tooManyTriggers.dataset.state).toBeUndefined();
		expect(
			tooManyTriggers.querySelector('[data-tooltip-target="content"]')?.getAttribute("role"),
		).toBeNull();

		const tooManyContents = appendRoot(
			'<div><button data-tooltip-target="trigger">設定</button><div data-tooltip-target="content">A</div><div data-tooltip-target="content">B</div></div>',
		);
		await connectRoot(tooManyContents);
		expect(tooManyContents.dataset.state).toBeUndefined();
		expect(
			tooManyContents.querySelector('[data-tooltip-target="content"]')?.getAttribute("role"),
		).toBeNull();

		const unfocusableTrigger = appendRoot(
			'<div><div data-tooltip-target="trigger" tabindex="-1">設定</div><div data-tooltip-target="content">補足</div></div>',
		);
		await connectRoot(unfocusableTrigger);
		expect(unfocusableTrigger.dataset.state).toBeUndefined();
		expect(
			unfocusableTrigger.querySelector('[data-tooltip-target="content"]')?.getAttribute("role"),
		).toBeNull();

		const nonHTMLElementTrigger = appendRoot(
			'<div><svg data-tooltip-target="trigger" tabindex="0"><text>設定</text></svg><div data-tooltip-target="content">補足</div></div>',
		);
		await connectRoot(nonHTMLElementTrigger);
		expect(nonHTMLElementTrigger.dataset.state).toBeUndefined();
		expect(
			nonHTMLElementTrigger.querySelector('[data-tooltip-target="content"]')?.getAttribute("role"),
		).toBeNull();

		const nonHTMLElementContent = appendRoot(
			'<div><button data-tooltip-target="trigger">設定</button><svg data-tooltip-target="content"></svg></div>',
		);
		const svgContent = nonHTMLElementContent.querySelector('[data-tooltip-target="content"]');
		if (!(svgContent instanceof SVGElement)) throw new Error("SVG content target がありません");
		Object.defineProperties(svgContent, {
			showPopover: { configurable: true, value: () => undefined },
			hidePopover: { configurable: true, value: () => undefined },
		});
		await connectRoot(nonHTMLElementContent);
		expect(nonHTMLElementContent.dataset.state).toBeUndefined();

		const sameTriggerAndContent = appendRoot(
			'<div><button disabled data-tooltip-target="trigger content">設定</button></div>',
		);
		const sameTarget = sameTriggerAndContent.querySelector("button");
		if (!(sameTarget instanceof HTMLButtonElement)) throw new Error("同一 target がありません");
		Object.defineProperties(sameTarget, {
			showPopover: { configurable: true, value: () => undefined },
			hidePopover: { configurable: true, value: () => undefined },
		});
		await connectRoot(sameTriggerAndContent);
		expect(sameTriggerAndContent.dataset.state).toBeUndefined();

		const infiniteDelay = appendRoot(
			'<div data-tooltip-delay-value="Infinity"><button data-tooltip-target="trigger">設定</button><div data-tooltip-target="content">補足</div></div>',
		);
		await connectRoot(infiniteDelay);
		expect(infiniteDelay.dataset.state).toBeUndefined();

		const negativeDelay = appendRoot(
			'<div data-tooltip-delay-value="-1"><button data-tooltip-target="trigger">設定</button><div data-tooltip-target="content">補足</div></div>',
		);
		await connectRoot(negativeDelay);
		expect(negativeDelay.dataset.state).toBeUndefined();

		const missingShowPopover = appendRoot(
			'<div><button data-tooltip-target="trigger">設定</button><div data-tooltip-target="content">補足</div></div>',
		);
		const showContent = missingShowPopover.querySelector('[data-tooltip-target="content"]');
		if (!(showContent instanceof HTMLElement)) throw new Error("showPopover target がありません");
		Object.defineProperty(showContent, "showPopover", {
			configurable: true,
			value: undefined,
			writable: true,
		});
		await connectRoot(missingShowPopover);
		expect(missingShowPopover.dataset.state).toBeUndefined();

		const missingHidePopover = appendRoot(
			'<div><button data-tooltip-target="trigger">設定</button><div data-tooltip-target="content">補足</div></div>',
		);
		const hideContent = missingHidePopover.querySelector('[data-tooltip-target="content"]');
		if (!(hideContent instanceof HTMLElement)) throw new Error("hidePopover target がありません");
		Object.defineProperty(hideContent, "hidePopover", {
			configurable: true,
			value: undefined,
			writable: true,
		});
		await connectRoot(missingHidePopover);
		expect(missingHidePopover.dataset.state).toBeUndefined();

		const disabledContent = appendRoot(
			'<div><button data-tooltip-target="trigger">設定</button><div data-tooltip-target="content"><button disabled>操作</button></div></div>',
		);
		await connectRoot(disabledContent);
		expect(disabledContent.dataset.state).toBe("closed");
		expect(
			disabledContent.querySelector('[data-tooltip-target="content"]')?.getAttribute("role"),
		).toBe("tooltip");

		const hiddenContent = appendRoot(
			'<div><button data-tooltip-target="trigger">設定</button><div data-tooltip-target="content"><button hidden>操作</button></div></div>',
		);
		await connectRoot(hiddenContent);
		expect(hiddenContent.dataset.state).toBe("closed");
		expect(
			hiddenContent.querySelector('[data-tooltip-target="content"]')?.getAttribute("role"),
		).toBe("tooltip");
	});

	test("[tooltip-structure-preservation][tooltip-role-preservation-negative][tooltip-popover-preservation-negative] Preserves authored role and popover", async () => {
		const root = appendRoot(
			'<div><button data-tooltip-target="trigger">設定</button><div data-tooltip-target="content" role="note" popover="auto">補足</div></div>',
		);
		await connectRoot(root);
		const content = root.querySelector('[data-tooltip-target="content"]');
		expect(content?.getAttribute("role")).toBe("note");
		expect(content?.getAttribute("popover")).toBe("auto");
	});

	test("[tooltip-warning-once][tooltip-warning-once-negative] Warns only once per connection for invalid markup even after reconciliation", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		const root = appendRoot(
			'<div data-tooltip-delay-value="10"><button data-tooltip-target="trigger">設定</button><div data-tooltip-target="content"><button>操作</button></div></div>',
		);
		await connectRoot(root);
		root.setAttribute("data-tooltip-delay-value", "20");
		await settle();
		expect(warnings).toHaveLength(1);
	});
});
