import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import ToolbarController from "../src/toolbar_controller";

type ToolbarPublicController = Controller & {
	activeControl: HTMLElement | undefined;
	focusFirst: () => void;
	focusLast: () => void;
	scheduleReconcile: () => void;
};

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
		'<div data-controller="toolbar" aria-label="編集" ' +
			attributes +
			">" +
			'<button type="button" data-toolbar-target="control">太字</button>' +
			'<button type="button" data-toolbar-target="control">斜体</button>' +
			'<a href="/help" data-toolbar-target="control">ヘルプ</a>' +
			"</div>",
	);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("toolbar root がありません");
	const controls = Array.from(
		root.querySelectorAll<HTMLElement>('[data-toolbar-target="control"]'),
	);
	return { root, controls };
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"toolbar",
	) as ToolbarPublicController | null;
	if (!controller) throw new Error("toolbar controller が接続されていません");
	return controller;
};

const keydown = (element: HTMLElement, key: string) => {
	const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
	element.dispatchEvent(event);
	return event;
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("toolbar", ToolbarController);
});

afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("toolbar", () => {
	test("[toolbar-state-sync][toolbar-role-preservation-negative][toolbar-orientation-preservation-negative][toolbar-orientation-cleanup-negative] Synchronizes role, orientation, tabindex, and authored attributes without adding data-state", async () => {
		const { root, controls } = await mount('data-toolbar-orientation-value="vertical"');
		root.setAttribute("data-example", "preserved");

		expect(root.getAttribute("role")).toBe("toolbar");
		expect(root.getAttribute("aria-orientation")).toBe("vertical");
		expect(root.getAttribute("aria-label")).toBe("編集");
		expect(root.getAttribute("data-example")).toBe("preserved");
		expect(controls.filter((control) => control.getAttribute("tabindex") === "0")).toHaveLength(1);
		expect(controls[0]?.getAttribute("tabindex")).toBe("0");
		expect(controls[1]?.getAttribute("tabindex")).toBe("-1");
		expect(root.hasAttribute("data-state")).toBe(false);
		expect(controls.every((control) => !control.hasAttribute("data-state"))).toBe(true);

		const authored = await mount(
			'data-toolbar-orientation-value="vertical" role="group" aria-orientation="block"',
		);
		expect(authored.root.getAttribute("role")).toBe("group");
		expect(authored.root.getAttribute("aria-orientation")).toBe("block");

		root.setAttribute("data-toolbar-orientation-value", "horizontal");
		await settle();
		expect(root.hasAttribute("aria-orientation")).toBe(false);
	});

	test("[toolbar-navigation][toolbar-keydown-prevent-default-negative] Checks Arrow/Home/End, wrapping, and horizontal/vertical behavior", async () => {
		const horizontal = await mount();
		horizontal.controls[1]?.focus();
		const arrowEvent = keydown(horizontal.controls[1]!, "ArrowRight");
		expect(arrowEvent.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(horizontal.controls[2]);
		keydown(horizontal.controls[2]!, "ArrowRight");
		expect(document.activeElement).toBe(horizontal.controls[0]);
		keydown(horizontal.controls[0]!, "ArrowUp");
		expect(document.activeElement).toBe(horizontal.controls[0]);
		keydown(horizontal.controls[0]!, "End");
		expect(document.activeElement).toBe(horizontal.controls[2]);
		keydown(horizontal.controls[2]!, "Home");
		expect(document.activeElement).toBe(horizontal.controls[0]);

		const vertical = await mount('data-toolbar-orientation-value="vertical"');
		vertical.controls[1]?.focus();
		keydown(vertical.controls[1]!, "ArrowDown");
		expect(document.activeElement).toBe(vertical.controls[2]);
		keydown(vertical.controls[2]!, "ArrowRight");
		expect(document.activeElement).toBe(vertical.controls[2]);
		keydown(vertical.controls[2]!, "ArrowUp");
		expect(document.activeElement).toBe(vertical.controls[1]);
	});

	test("[toolbar-direction] Checks arrow mapping for horizontal RTL", async () => {
		const { root, controls } = await mount('dir="rtl"');
		controls[1]?.focus();
		keydown(controls[1]!, "ArrowLeft");
		expect(document.activeElement).toBe(controls[2]);
		keydown(controls[2]!, "ArrowRight");
		expect(document.activeElement).toBe(controls[1]);
		expect(getComputedStyle(root).direction).toBe("rtl");
	});

	test("[toolbar-disabled-guard] Excludes native-disabled and aria-disabled controls from navigation", async () => {
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="toolbar" aria-label="編集">' +
				'<button type="button" data-toolbar-target="control">有効</button>' +
				'<button type="button" data-toolbar-target="control" disabled>native disabled</button>' +
				'<a href="/disabled" data-toolbar-target="control" aria-disabled="true">aria disabled</a>' +
				'<button type="button" data-toolbar-target="control" aria-disabled="true">native enabled</button>' +
				"</div>",
		);
		await settle();
		const root = document.body.lastElementChild as HTMLElement;
		const controls = Array.from(
			root.querySelectorAll<HTMLElement>('[data-toolbar-target="control"]'),
		);
		controls[0]?.focus();
		keydown(controls[0]!, "ArrowRight");
		expect(document.activeElement).toBe(controls[3]);
		expect(controls[1]?.getAttribute("tabindex")).toBe("-1");
		expect(controls[2]?.getAttribute("tabindex")).toBe("-1");
	});

	test("[toolbar-focus-api][toolbar-focus-api-enhanced-negative] Provides activeControl, focusFirst, and focusLast", async () => {
		const { root, controls } = await mount();
		const controller = controllerFor(root);
		controller.focusLast();
		expect(document.activeElement).toBe(controls[2]);
		expect(controller.activeControl).toBe(controls[2]);
		controller.focusFirst();
		expect(document.activeElement).toBe(controls[0]);
		expect(controller.activeControl).toBe(controls[0]);
		controller.disconnect();
		controls[0]?.focus();
		controller.focusLast();
		expect(document.activeElement).toBe(controls[0]);
	});

	test("[toolbar-active-control-guard-negative] Excludes the current control from activeControl when disabled", async () => {
		const { root, controls } = await mount();
		const controller = controllerFor(root);
		controls[0]?.focus();
		expect(controller.activeControl).toBe(controls[0]);
		(controls[0] as HTMLButtonElement).disabled = true;
		expect(controller.activeControl).toBeUndefined();
	});

	test("[toolbar-dynamic-targets] Tracks target additions/removals and disabled changes", async () => {
		const { root, controls } = await mount();
		controls[0]?.focus();
		controls[0]?.remove();
		await settle();
		expect(
			root.querySelector<HTMLElement>('[data-toolbar-target="control"]')?.getAttribute("tabindex"),
		).toBe("0");

		root.insertAdjacentHTML(
			"beforeend",
			'<button type="button" data-toolbar-target="control" disabled>動的 disabled</button>',
		);
		await settle();
		const dynamic = root.lastElementChild as HTMLElement;
		expect(dynamic.getAttribute("tabindex")).toBe("-1");
		dynamic.removeAttribute("disabled");
		await settle();
		expect(dynamic.getAttribute("tabindex")).toBe("-1");
		const current = root.querySelector<HTMLElement>('[data-toolbar-target="control"]');
		expect(current?.getAttribute("tabindex")).toBe("0");
	});

	test("[toolbar-disconnect-cleanup][toolbar-disconnect-disable-enhancement-negative][toolbar-disconnect-listener-negative][toolbar-disconnect-combined-negative] Avoids duplicate listeners across disconnect and reconnect", async () => {
		const { root, controls } = await mount();
		const controller = controllerFor(root);
		controller.disconnect();

		controls[0]?.focus();
		const disconnectedKeydown = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "ArrowRight",
		});
		controls[0]?.dispatchEvent(disconnectedKeydown);
		expect(disconnectedKeydown.defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(controls[0]);

		controller.connect();
		await settle();
		controls[0]?.focus();
		keydown(controls[0]!, "ArrowRight");
		expect(document.activeElement).toBe(controls[1]);
	});

	test("[toolbar-disconnect-pending-reconcile-negative] Discards scheduled resynchronization after disconnect", async () => {
		const { root, controls } = await mount();
		const controller = controllerFor(root);
		controller.scheduleReconcile();
		controller.disconnect();
		await settle();

		controls[0]?.focus();
		const event = keydown(controls[0]!, "ArrowRight");
		expect(event.defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(controls[0]);
	});

	test("[toolbar-enhancement-guard-negative] Does not duplicate MutationObserver registration on resynchronization", async () => {
		const { root } = await mount();
		const observe = vi.spyOn(MutationObserver.prototype, "observe");
		try {
			root.setAttribute("data-toolbar-orientation-value", "vertical");
			await settle();
			expect(observe).not.toHaveBeenCalled();
		} finally {
			observe.mockRestore();
		}
	});

	test("[toolbar-semantic-validation][toolbar-semantic-validation-negative] Disables markup without control targets with a warning", async () => {
		const warnings: unknown[][] = [];
		console.warn = (...args: unknown[]) => warnings.push(args);
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="toolbar" aria-label="空"></div>',
		);
		await settle();
		const root = document.body.lastElementChild as HTMLElement;
		expect(warnings).toHaveLength(1);
		expect(String(warnings[0]?.[0])).toContain("toolbar controller");
		expect(root.hasAttribute("role")).toBe(false);

		root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
		expect(root.hasAttribute("aria-orientation")).toBe(false);
	});

	test("[toolbar-value-validation] Disables unsupported orientation with a warning", async () => {
		const warnings: unknown[][] = [];
		console.warn = (...args: unknown[]) => warnings.push(args);
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="toolbar" data-toolbar-orientation-value="diagonal" aria-label="不正"><button data-toolbar-target="control">操作</button></div>',
		);
		await settle();
		const root = document.body.lastElementChild as HTMLElement;
		expect(warnings).toHaveLength(1);
		expect(root.hasAttribute("role")).toBe(false);
		expect(root.querySelector("button")?.hasAttribute("tabindex")).toBe(false);
	});
});
