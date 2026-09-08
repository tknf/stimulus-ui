import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import DialogController from "../src/dialog_controller";

type DialogPublicController = Controller & {
	open: boolean;
	show: () => void;
	close: (returnValue?: string) => void;
	toggle: () => void;
};

type OpenDetail = { reason: "pointer" | "keyboard" };
type CloseDetail = { reason: "pointer" | "keyboard"; returnValue: string };

let application: Application;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const mount = async (
	rootAttributes = "",
	dialogAttributes = "",
	inner = "",
	triggerAttributes = "",
) => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<div data-controller="dialog" ${rootAttributes}>` +
			`<button type="button" data-dialog-target="trigger" ${triggerAttributes}>Open</button>` +
			`<dialog data-dialog-target="dialog" ${dialogAttributes}>` +
			'<h2 data-dialog-target="title">設定</h2>' +
			inner +
			'<button type="button" data-dialog-target="close">Close</button>' +
			"</dialog></div>",
	);
	await settle();
	const root = document.body.lastElementChild;
	const dialog = root?.querySelector('[data-dialog-target="dialog"]');
	const trigger = root?.querySelector('[data-dialog-target="trigger"]');
	const close = root?.querySelector('[data-dialog-target="close"]');
	const title = root?.querySelector('[data-dialog-target="title"]');
	if (
		!(root instanceof HTMLElement) ||
		!(dialog instanceof HTMLDialogElement) ||
		!(trigger instanceof HTMLButtonElement) ||
		!(close instanceof HTMLButtonElement) ||
		!(title instanceof HTMLElement)
	) {
		throw new Error("dialog を作成できませんでした");
	}
	return { root, dialog, trigger, close, title };
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"dialog",
	) as DialogPublicController | null;
	if (controller === null) throw new Error("dialog controller が接続されていません");
	return controller;
};

beforeEach(() => {
	document.body.innerHTML = "";
	application = Application.start();
	application.register("dialog", DialogController);
});

afterEach(() => {
	application.stop();
	document.body.innerHTML = "";
});

describe("dialog", () => {
	test("[dialog-state-sync][dialog-root-state-negative][dialog-dialog-state-negative][dialog-trigger-state-negative][dialog-trigger-expanded-negative][dialog-open-value-negative][dialog-trigger-controls-preservation-negative] Synchronizes native modal behavior, names, relationships, state, and authored attributes", async () => {
		const { root, dialog, trigger, title } = await mount(
			'data-dialog-open-value="true"',
			'aria-label="Authored label" role="alertdialog" aria-modal="true"',
		);
		const controller = controllerFor(root);

		expect(controller.open).toBe(true);
		expect(dialog.open).toBe(true);
		expect(dialog.getAttribute("role")).toBe("alertdialog");
		expect(dialog.getAttribute("aria-modal")).toBe("true");
		expect(dialog.id).toMatch(/^dialog-/);
		expect(dialog.getAttribute("aria-labelledby")).toBeNull();
		expect(trigger.getAttribute("aria-controls")).toBe(dialog.id);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(root.dataset.state).toBe("open");
		expect(dialog.dataset.state).toBe("open");
		expect(trigger.dataset.state).toBe("open");
		expect(title.id).toBe("");

		controller.close();
		expect(controller.open).toBe(false);
		expect(root.dataset.state).toBe("closed");
		expect(dialog.dataset.state).toBe("closed");
		expect(trigger.getAttribute("aria-expanded")).toBe("false");

		const authoredTrigger = await mount("", "", "", 'aria-controls="authored-controls"');
		expect(authoredTrigger.trigger.getAttribute("aria-controls")).toBe("authored-controls");
	});

	test("[dialog-title-label][dialog-title-labelledby-preservation-negative] Completes aria-labelledby and IDs through the title target", async () => {
		const { dialog, title } = await mount();
		expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
		expect(title.id).toMatch(/^dialog-title-/);

		const authored = await mount("", 'aria-labelledby="authored-label" id="authored-dialog"');
		expect(authored.dialog.id).toBe("authored-dialog");
		expect(authored.dialog.getAttribute("aria-labelledby")).toBe("authored-label");
		expect(authored.title.id).toBe("");
	});

	test("[dialog-beforeopen-cancel][dialog-beforeopen-cancel-negative] Allows cancellation of beforeopen from a trusted trigger", async () => {
		const { root, dialog, trigger } = await mount();
		const events: Array<{ type: string; detail: OpenDetail }> = [];
		let cancel = true;
		root.addEventListener("dialog:beforeopen", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<OpenDetail>).detail });
			if (cancel) event.preventDefault();
		});
		root.addEventListener("dialog:open", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<OpenDetail>).detail });
		});

		await userEvent.click(trigger);
		expect(dialog.open).toBe(false);
		expect(events.map(({ type }) => type)).toEqual(["dialog:beforeopen"]);

		cancel = false;
		events.length = 0;
		await userEvent.click(trigger);
		expect(dialog.open).toBe(true);
		expect(events.map(({ type }) => type)).toEqual(["dialog:beforeopen", "dialog:open"]);
		expect(events[1]?.detail).toEqual({ reason: "pointer" });
	});

	test("[dialog-keyboard-reason] Records reasons for keyboard trigger/close interaction and Escape", async () => {
		const { root, dialog, trigger, close } = await mount();
		const reasons: string[] = [];
		root.addEventListener("dialog:open", (event) => {
			reasons.push((event as CustomEvent<OpenDetail>).detail.reason);
		});
		root.addEventListener("dialog:close", (event) => {
			reasons.push((event as CustomEvent<CloseDetail>).detail.reason);
		});

		trigger.focus();
		await userEvent.keyboard("{Enter}");
		expect(dialog.open).toBe(true);
		close.focus();
		await userEvent.click(close);
		expect(dialog.open).toBe(false);
		expect(reasons).toEqual(["keyboard", "pointer"]);
		expect(document.activeElement).toBe(trigger);

		await userEvent.click(trigger);
		expect(dialog.open).toBe(true);
		expect(reasons).toEqual(["keyboard", "pointer", "pointer"]);
		await userEvent.keyboard("{Escape}");
		expect(dialog.open).toBe(false);
		expect(reasons).toEqual(["keyboard", "pointer", "pointer", "keyboard"]);
	});

	test("[dialog-key-filter-negative] Does not activate through unsupported keys", async () => {
		const { dialog, trigger, close } = await mount();
		const reasons: string[] = [];
		const root = trigger.parentElement;
		if (!(root instanceof HTMLElement)) throw new Error("dialog root がありません");
		root.addEventListener("dialog:open", (event) =>
			reasons.push((event as CustomEvent<OpenDetail>).detail.reason),
		);
		root.addEventListener("dialog:close", (event) =>
			reasons.push((event as CustomEvent<CloseDetail>).detail.reason),
		);

		trigger.focus();
		await userEvent.keyboard("{ArrowDown}");
		await userEvent.click(trigger);
		expect(dialog.open).toBe(true);
		await userEvent.click(close);
		expect(reasons).toEqual(["pointer", "pointer"]);
	});

	test("[dialog-beforeclose-cancel][dialog-beforeclose-cancel-negative] Canceling beforeclose prevents closing and focus restoration", async () => {
		const { root, dialog, trigger, close } = await mount();
		await userEvent.click(trigger);
		close.focus();
		let cancel = true;
		const events: string[] = [];
		root.addEventListener("dialog:beforeclose", (event) => {
			events.push(event.type);
			if (cancel) event.preventDefault();
		});
		root.addEventListener("dialog:close", (event) => events.push(event.type));

		await userEvent.click(close);
		expect(dialog.open).toBe(true);
		expect(document.activeElement).not.toBe(trigger);
		expect(events).toEqual(["dialog:beforeclose"]);

		cancel = false;
		await userEvent.click(close);
		expect(dialog.open).toBe(false);
		expect(document.activeElement).toBe(trigger);
		expect(events).toEqual(["dialog:beforeclose", "dialog:beforeclose", "dialog:close"]);
	});

	test("[dialog-escape-cancel][dialog-cancel-trusted-negative] Canceling Escape also prevents the native cancel event", async () => {
		const { root, dialog, trigger } = await mount();
		await userEvent.click(trigger);
		dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
		expect(dialog.open).toBe(true);
		let cancel = true;
		let nativeCancel = 0;
		const events: string[] = [];
		dialog.addEventListener("cancel", () => {
			nativeCancel += 1;
		});
		root.addEventListener("dialog:beforeclose", (event) => {
			events.push(event.type);
			if (cancel) event.preventDefault();
		});
		root.addEventListener("dialog:close", (event) => events.push(event.type));

		await userEvent.keyboard("{Escape}");
		expect(nativeCancel).toBe(1);
		expect(dialog.open).toBe(true);
		expect(events).toEqual(["dialog:beforeclose"]);

		cancel = false;
		await userEvent.keyboard("{Escape}");
		expect(dialog.open).toBe(false);
		expect(events).toEqual(["dialog:beforeclose", "dialog:beforeclose", "dialog:close"]);
	});

	test("[dialog-programmatic-silence][dialog-trigger-click-trusted-negative][dialog-close-click-trusted-negative] Emits no custom events from public APIs, initialization, or native close", async () => {
		const { root, dialog, trigger, close } = await mount();
		const controller = controllerFor(root);
		const events: Event[] = [];
		for (const name of ["dialog:beforeopen", "dialog:open", "dialog:beforeclose", "dialog:close"]) {
			root.addEventListener(name, (event) => events.push(event));
		}

		controller.show();
		controller.close();
		trigger.click();
		expect(dialog.open).toBe(true);
		close.click();
		expect(dialog.open).toBe(false);
		controller.show();
		expect(dialog.open).toBe(true);
		controller.close("programmatic");
		expect(dialog.returnValue).toBe("programmatic");
		controller.toggle();
		controller.open = false;
		dialog.close("native");
		await settle();
		expect(events).toEqual([]);
		expect(root.dataset.state).toBe("closed");
	});

	test("[dialog-disabled-guard][dialog-trigger-disabled-negative][dialog-close-disabled-negative][dialog-same-state-negative][dialog-target-membership-negative] Does nothing for disabled controls, unchanged state, or triggers outside the dialog scope", async () => {
		const { root, dialog, trigger, close } = await mount(
			"",
			"",
			'<button type="button" data-dialog-target="trigger" data-testid="inside-trigger">Inside open</button>',
		);
		const insideTrigger = dialog.querySelector('[data-testid="inside-trigger"]');
		if (!(insideTrigger instanceof HTMLButtonElement))
			throw new Error("inside trigger がありません");
		const events: string[] = [];
		root.addEventListener("dialog:beforeopen", (event) => events.push(event.type));
		root.addEventListener("dialog:open", (event) => events.push(event.type));
		root.addEventListener("dialog:beforeclose", (event) => events.push(event.type));
		root.addEventListener("dialog:close", (event) => events.push(event.type));
		trigger.disabled = true;
		trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		expect(dialog.open).toBe(false);
		expect(events).toEqual([]);

		const outsideTarget = document.createElement("button");
		outsideTarget.type = "button";
		outsideTarget.textContent = "Not a target";
		root.append(outsideTarget);
		await userEvent.click(outsideTarget);
		expect(dialog.open).toBe(false);

		trigger.disabled = false;
		await userEvent.click(trigger);
		const sameStateEvents = events.length;
		await userEvent.click(insideTrigger);
		expect(events).toHaveLength(sameStateEvents);
		close.disabled = true;
		close.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		expect(dialog.open).toBe(true);
		expect(events).toHaveLength(sameStateEvents);

		const outside = document.createElement("button");
		outside.type = "button";
		outside.dataset.dialogTarget = "trigger";
		document.body.append(outside);
		outside.click();
		expect(dialog.open).toBe(true);
	});

	test("[dialog-focus-autofocus] Uses native autofocus and restores focus to the initiating trigger", async () => {
		const { dialog, trigger, close } = await mount(
			"",
			"",
			'<input autofocus data-testid="initial">',
		);
		const initial = dialog.querySelector("[data-testid=initial]");
		if (!(initial instanceof HTMLInputElement)) throw new Error("autofocus target がありません");
		await userEvent.click(trigger);
		expect(document.activeElement).toBe(initial);
		await userEvent.click(close);
		expect(document.activeElement).toBe(trigger);

		await userEvent.click(trigger);
		trigger.remove();
		await userEvent.keyboard("{Escape}");
		expect(dialog.open).toBe(false);
		expect(document.activeElement).not.toBe(trigger);
	});

	test("[dialog-dynamic-targets] Synchronizes structure, state, and listeners after target replacement", async () => {
		const { root, dialog, trigger, close } = await mount();
		const controller = controllerFor(root);
		const nextTrigger = document.createElement("button");
		nextTrigger.type = "button";
		nextTrigger.dataset.dialogTarget = "trigger";
		nextTrigger.textContent = "Next open";
		trigger.replaceWith(nextTrigger);
		const nextClose = document.createElement("button");
		nextClose.type = "button";
		nextClose.dataset.dialogTarget = "close";
		nextClose.textContent = "Next close";
		close.replaceWith(nextClose);
		await settle();

		expect(nextTrigger.getAttribute("aria-controls")).toBe(dialog.id);
		await userEvent.click(nextTrigger);
		expect(dialog.open).toBe(true);
		await userEvent.click(nextClose);
		expect(dialog.open).toBe(false);
		expect(controller.open).toBe(false);

		const nextDialog = document.createElement("dialog");
		nextDialog.dataset.dialogTarget = "dialog";
		nextDialog.setAttribute("aria-label", "Next dialog");
		nextDialog.innerHTML = '<button type="button" data-dialog-target="close">Close next</button>';
		dialog.replaceWith(nextDialog);
		await settle();
		expect(nextDialog.dataset.state).toBe("closed");
		await userEvent.click(nextTrigger);
		expect(nextDialog.open).toBe(true);
	});

	test("[dialog-disconnect-cleanup] Closes the native modal and removes listeners on disconnect", async () => {
		const { root, dialog, trigger } = await mount();
		const controller = controllerFor(root);
		const events: string[] = [];
		root.addEventListener("dialog:open", () => events.push("open"));
		await userEvent.click(trigger);
		expect(dialog.open).toBe(true);
		root.remove();
		await settle();
		expect(dialog.open).toBe(false);
		trigger.click();
		expect(events).toEqual(["open"]);

		document.body.append(root);
		await settle();
		trigger.click();
		expect(events).toEqual(["open"]);
		controller.close();
		await userEvent.click(trigger);
		expect(events).toEqual(["open", "open"]);
	});

	test("[dialog-disconnect-listener-negative] Leaves no root listeners after direct disconnect", async () => {
		const { root, dialog, trigger } = await mount();
		const controller = controllerFor(root) as DialogPublicController & {
			disconnect: () => void;
		};
		const events: Event[] = [];
		root.addEventListener("dialog:open", (event) => events.push(event));
		controller.disconnect();
		await userEvent.click(trigger);
		expect(dialog.open).toBe(false);
		expect(events).toEqual([]);
	});

	test("[dialog-completion-warning][dialog-completion-warning-negative] Warns once per connection when completing aria-labelledby and aria-controls and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("dialog controller");
			expect(warnings[0]).toContain("aria-labelledby");
			expect(warnings[0]).toContain("aria-controls");

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div data-controller="dialog">' +
					'<button type="button" data-dialog-target="trigger" aria-controls="complete-dialog">Open</button>' +
					'<dialog id="complete-dialog" data-dialog-target="dialog" aria-labelledby="complete-dialog-title">' +
					'<h2 id="complete-dialog-title" data-dialog-target="title">設定</h2>' +
					'<button type="button" data-dialog-target="close">Close</button>' +
					"</dialog></div>",
			);
			await settle();
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div data-controller="dialog"><div data-dialog-target="dialog"></div><button data-dialog-target="trigger">Open</button></div>',
			);
			await settle();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(warnings[0]).not.toContain("Added ");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[dialog-semantic-validation][dialog-semantic-validation-negative] Warns once and disables enhancement for invalid targets", async () => {
		const originalWarn = console.warn;
		const warnings: string[] = [];
		console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
		try {
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div data-controller="dialog" id="invalid-dialog">' +
					'<button type="submit" data-dialog-target="trigger">Open</button>' +
					'<dialog data-dialog-target="dialog"><h2 data-dialog-target="title">Title</h2></dialog>' +
					'<p data-dialog-target="title">Outside</p></div>',
			);
			await settle();
			const root = document.getElementById("invalid-dialog");
			const dialog = root?.querySelector("dialog");
			if (!(root instanceof HTMLElement) || !(dialog instanceof HTMLDialogElement)) {
				throw new Error("invalid dialog を作成できませんでした");
			}
			const controller = controllerFor(root);
			controller.show();
			await settle();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("dialog controller");
			expect(dialog.open).toBe(false);
			expect(root.dataset.state).toBeUndefined();
			expect(dialog.id).toBe("");
			expect(dialog.hasAttribute("aria-labelledby")).toBe(false);
		} finally {
			console.warn = originalWarn;
		}
	});

	test("[dialog-invalid-target-count][dialog-dialog-target-count-negative][dialog-dialog-element-negative][dialog-trigger-validation-negative][dialog-close-validation-negative][dialog-title-count-negative][dialog-title-containment-negative][dialog-name-validation-negative][dialog-no-trigger-validation-negative] Disables invalid target counts, semantics, or names without throwing", async () => {
		const originalWarn = console.warn;
		console.warn = () => undefined;
		try {
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div data-controller="dialog" id="invalid-count">' +
					'<button type="button" data-dialog-target="trigger">Open</button>' +
					'<dialog data-dialog-target="dialog" aria-label="One"></dialog>' +
					'<dialog data-dialog-target="dialog" aria-label="Two"></dialog></div>' +
					'<div data-controller="dialog" id="invalid-dialog-target">' +
					'<button type="button" data-dialog-target="trigger">Open</button>' +
					'<div data-dialog-target="dialog" aria-label="Bad target"></div></div>' +
					'<div data-controller="dialog" id="invalid-trigger">' +
					'<button type="submit" data-dialog-target="trigger">Open</button>' +
					'<dialog data-dialog-target="dialog"><h2 data-dialog-target="title">Title</h2></dialog></div>' +
					'<div data-controller="dialog" id="invalid-close">' +
					'<button type="button" data-dialog-target="trigger">Open</button>' +
					'<dialog data-dialog-target="dialog"><h2 data-dialog-target="title">Title</h2><button type="submit" data-dialog-target="close">Close</button></dialog></div>' +
					'<div data-controller="dialog" id="invalid-title-count">' +
					'<button type="button" data-dialog-target="trigger">Open</button>' +
					'<dialog data-dialog-target="dialog"><h2 data-dialog-target="title">One</h2><h3 data-dialog-target="title">Two</h3></dialog></div>' +
					'<div data-controller="dialog" id="invalid-title-containment">' +
					'<button type="button" data-dialog-target="trigger">Open</button>' +
					'<dialog data-dialog-target="dialog" aria-label="Named"></dialog><h2 data-dialog-target="title">Outside</h2></div>' +
					'<div data-controller="dialog" id="invalid-name">' +
					'<button type="button" data-dialog-target="trigger">Open</button>' +
					'<dialog data-dialog-target="dialog"></dialog></div>' +
					'<div data-controller="dialog" id="invalid-no-trigger">' +
					'<dialog data-dialog-target="dialog" aria-label="Named"></dialog></div>',
			);
			await settle();
			for (const id of [
				"invalid-count",
				"invalid-dialog-target",
				"invalid-trigger",
				"invalid-close",
				"invalid-title-count",
				"invalid-title-containment",
				"invalid-name",
				"invalid-no-trigger",
			]) {
				const root = document.getElementById(id);
				if (!(root instanceof HTMLElement)) throw new Error(`${id} root がありません`);
				controllerFor(root).show();
				expect(root.dataset.state).toBeUndefined();
			}
		} finally {
			console.warn = originalWarn;
		}
	});
});
