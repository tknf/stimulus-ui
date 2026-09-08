import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import ToastController from "../src/toast_controller";

type ToastPublicController = Controller & {
	visible: boolean;
	show: (event?: Event) => void;
	hide: (event?: Event) => void;
};

type ToastDetail = { reason: "pointer" | "keyboard" };

let application: Application;
let originalWarn: typeof console.warn;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const mount = async (attributes = "", dismissAttributes = "") => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<div data-controller="toast" aria-label="通知" ${attributes}>通知内容<button type="button" data-toast-target="dismiss" ${dismissAttributes}>閉じる</button></div>`,
	);
	await settle();
	const root = document.body.lastElementChild;
	const dismiss = root?.querySelector('[data-toast-target="dismiss"]');
	if (!(root instanceof HTMLDivElement) || !(dismiss instanceof HTMLButtonElement))
		throw new Error("toast root を作成できませんでした");
	return { root, dismiss };
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"toast",
	) as ToastPublicController | null;
	if (!controller) throw new Error("toast controller が接続されていません");
	return controller;
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("toast", ToastController);
});

afterEach(() => {
	vi.restoreAllMocks();
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("toast", () => {
	test("[toast-state-sync][toast-root-state-negative][toast-role-preservation-negative][toast-aria-live-preservation-negative] Synchronizes role, aria-live, state, and authored attributes", async () => {
		const { root } = await mount('id="authored-toast" data-toast-live-value="assertive"');

		expect(root.id).toBe("authored-toast");
		expect(root.getAttribute("role")).toBe("alert");
		expect(root.getAttribute("aria-live")).toBe("assertive");
		expect(root.dataset.state).toBe("visible");
		expect(root.hidden).toBe(false);

		const authored = await mount('role="log" aria-live="off" data-state="authored"');
		expect(authored.root.getAttribute("role")).toBe("log");
		expect(authored.root.getAttribute("aria-live")).toBe("off");
		expect(authored.root.dataset.state).toBe("visible");
	});

	test("[toast-initial-state][toast-hidden-state-negative] Synchronizes initial hidden state with visible/hide APIs", async () => {
		const { root } = await mount("hidden");
		const controller = controllerFor(root);

		expect(controller.visible).toBe(false);
		expect(root.dataset.state).toBe("hidden");
		controller.show();
		expect(controller.visible).toBe(true);
		expect(root.hidden).toBe(false);
		controller.hide();
		expect(controller.visible).toBe(false);
		expect(root.hidden).toBe(true);
	});

	test("[toast-dismiss-events][toast-same-state-guard-negative][toast-disabled-dismiss-negative] Checks dismiss cancellation, commitment, and pointer/keyboard reasons", async () => {
		const { root, dismiss } = await mount();
		const controller = controllerFor(root);
		const events: Array<{ type: string; detail: ToastDetail }> = [];
		let cancel = true;
		root.addEventListener("toast:beforehide", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ToastDetail>).detail });
			if (cancel) event.preventDefault();
		});
		root.addEventListener("toast:hide", (event) =>
			events.push({ type: event.type, detail: (event as CustomEvent<ToastDetail>).detail }),
		);

		await userEvent.click(dismiss);
		expect(controller.visible).toBe(true);
		expect(events).toEqual([{ type: "toast:beforehide", detail: { reason: "pointer" } }]);

		cancel = false;
		events.length = 0;
		await userEvent.click(dismiss);
		expect(controller.visible).toBe(false);
		expect(events).toEqual([
			{ type: "toast:beforehide", detail: { reason: "pointer" } },
			{ type: "toast:hide", detail: { reason: "pointer" } },
		]);

		controller.show();
		events.length = 0;
		dismiss.focus();
		await userEvent.keyboard("{Enter}");
		expect(events).toEqual([
			{ type: "toast:beforehide", detail: { reason: "keyboard" } },
			{ type: "toast:hide", detail: { reason: "keyboard" } },
		]);

		root.hidden = false;
		events.length = 0;
		await userEvent.click(dismiss);
		expect(controller.visible).toBe(false);
		expect(events).toEqual([]);

		controller.show();
		events.length = 0;
		dismiss.addEventListener(
			"click",
			() => {
				dismiss.disabled = true;
			},
			{ capture: true, once: true },
		);
		await userEvent.click(dismiss);
		expect(controller.visible).toBe(true);
		expect(events).toEqual([]);
	});

	test("[toast-programmatic-silence][toast-click-trusted-negative] APIs and synthetic interaction emit no custom events", async () => {
		const { root, dismiss } = await mount("hidden");
		const controller = controllerFor(root);
		const events: Event[] = [];
		for (const name of ["toast:beforeshow", "toast:show", "toast:beforehide", "toast:hide"])
			root.addEventListener(name, (event) => events.push(event));

		controller.show();
		dismiss.click();
		expect(controller.visible).toBe(true);
		controller.visible = false;
		controller.hide();
		await settle();

		expect(controller.visible).toBe(false);
		expect(events).toEqual([]);
	});

	test("[toast-timeout][toast-timer-schedule-negative][toast-duration-change-reconcile-negative] Checks duration timeout, zero duration, and disconnect cleanup", async () => {
		const timed = await mount('data-toast-duration-value="20" hidden');
		const timedController = controllerFor(timed.root);
		timedController.show();
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(timedController.visible).toBe(false);
		expect(timed.root.dataset.state).toBe("hidden");

		const persistent = await mount('data-toast-duration-value="0" hidden');
		const persistentController = controllerFor(persistent.root);
		persistentController.show();
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(persistentController.visible).toBe(true);

		const dynamic = await mount('data-toast-duration-value="0" hidden');
		const dynamicController = controllerFor(dynamic.root);
		dynamicController.show();
		dynamic.root.setAttribute("data-toast-duration-value", "20");
		await settle();
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(dynamicController.visible).toBe(false);
	});

	test("[toast-focus-hold][toast-focus-hold-negative][toast-focus-hold-schedule-negative] Stops the timer while focus is inside and restarts the duration when focus leaves", async () => {
		const outside = document.createElement("button");
		outside.type = "button";
		document.body.append(outside);

		const preFocused = await mount('data-toast-duration-value="20" hidden');
		const preFocusedController = controllerFor(preFocused.root);
		preFocused.root.hidden = false;
		preFocused.dismiss.focus();
		preFocusedController.show();
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(preFocusedController.visible).toBe(true);
		outside.focus();
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(preFocusedController.visible).toBe(false);

		const held = await mount('data-toast-duration-value="20" hidden');
		const heldController = controllerFor(held.root);
		heldController.show();
		held.dismiss.focus();
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(heldController.visible).toBe(true);

		outside.focus();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(heldController.visible).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(heldController.visible).toBe(false);

		const normal = await mount('data-toast-duration-value="20" hidden');
		const normalController = controllerFor(normal.root);
		normalController.show();
		outside.focus();
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(normalController.visible).toBe(false);
		expect(document.activeElement).toBe(outside);
	});

	test("[toast-popover-mode][toast-popover-toggle-listener-negative] Tracks popover opening/closing without changing hidden", async () => {
		const { root } = await mount('popover="manual"');
		const controller = controllerFor(root);
		expect(root.hasAttribute("hidden")).toBe(false);
		expect(controller.visible).toBe(false);
		controller.show();
		await settle();
		expect(controller.visible).toBe(true);
		expect(root.matches(":popover-open")).toBe(true);
		expect(root.hasAttribute("hidden")).toBe(false);
		controller.hide();
		await settle();
		expect(controller.visible).toBe(false);
		expect(root.matches(":popover-open")).toBe(false);
		expect(root.hasAttribute("hidden")).toBe(false);
		root.showPopover();
		await settle();
		expect(controller.visible).toBe(true);
		root.hidePopover();
		await settle();
		expect(controller.visible).toBe(false);
	});

	test("[toast-disconnect-cleanup][toast-timeout-cleanup-negative] Avoids duplicate listeners and timers across disconnect and reconnect", async () => {
		const { root, dismiss } = await mount('data-toast-duration-value="1000" hidden');
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("toast:hide", (event) => events.push(event));
		controller.show();
		const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
		root.removeAttribute("data-controller");
		await settle();
		expect(clearTimeoutSpy).toHaveBeenCalled();
		await userEvent.click(dismiss);
		expect(events).toEqual([]);
		root.setAttribute("data-controller", "toast");
		await settle();
		controllerFor(root).show();
		await userEvent.click(dismiss);
		expect(events).toHaveLength(1);
	});

	test("[toast-disconnect-listener-negative] Leaves no listeners after direct disconnect", async () => {
		const { root, dismiss } = await mount();
		const controller = controllerFor(root) as ToastPublicController & {
			disconnect: () => void;
		};
		const events: Event[] = [];
		root.addEventListener("toast:beforehide", (event) => events.push(event));
		controller.disconnect();
		await userEvent.click(dismiss);
		expect(events).toEqual([]);
	});

	test("[toast-semantic-validation][toast-semantic-validation-negative][toast-duration-validation-negative][toast-live-validation-negative][toast-dismiss-target-validation-negative][toast-dismiss-count-validation-negative] Disables invalid markup with one warning", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div id="invalid-duration" data-controller="toast" data-toast-duration-value="-1"><button type="button" data-toast-target="dismiss">閉じる</button></div>' +
				'<div id="invalid-live" data-controller="toast" data-toast-live-value="rude"><button type="button" data-toast-target="dismiss">閉じる</button></div>' +
				'<div id="invalid-dismiss" data-controller="toast"><span data-toast-target="dismiss">閉じる</span></div>' +
				'<div id="invalid-count" data-controller="toast"><button type="button" data-toast-target="dismiss">一つ</button><button type="button" data-toast-target="dismiss">二つ</button></div>',
		);
		await settle();
		for (const id of ["invalid-duration", "invalid-live", "invalid-dismiss", "invalid-count"]) {
			const root = document.getElementById(id);
			if (!(root instanceof HTMLDivElement)) throw new Error(`${id} root がありません`);
			expect(root.dataset.state).toBeUndefined();
			expect(root.hasAttribute("role")).toBe(false);
		}
		expect(warnings).toHaveLength(4);
	});
});
