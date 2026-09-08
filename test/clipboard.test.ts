import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import ClipboardController from "../src/clipboard_controller";

type CopySource = "target" | "text" | "selection";
type CopyReason = "pointer" | "keyboard";

type BeforeCopyDetail = {
	text: string;
	source: CopySource;
	reason: CopyReason;
};

type CopyDetail = BeforeCopyDetail & {
	ok: boolean;
	error: DOMException | null;
};

type ClipboardPublicController = Controller & {
	copy: (event?: Event) => Promise<void>;
};

let application: Application;
let writeText: ReturnType<typeof vi.fn>;
let originalClipboard: PropertyDescriptor | undefined;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const mountRaw = async (html: string) => {
	document.body.insertAdjacentHTML("beforeend", html);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("clipboard root がありません");
	return root;
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"clipboard",
	) as ClipboardPublicController | null;
	if (controller === null) throw new Error("clipboard controller が接続されていません");
	return controller;
};

const detailsFrom = (root: HTMLElement) => {
	const before: BeforeCopyDetail[] = [];
	const after: CopyDetail[] = [];
	root.addEventListener("clipboard:beforecopy", (event) => {
		before.push((event as CustomEvent<BeforeCopyDetail>).detail);
	});
	root.addEventListener("clipboard:copy", (event) => {
		after.push((event as CustomEvent<CopyDetail>).detail);
	});
	return { before, after };
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
	writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
	application = Application.start();
	application.register("clipboard", ClipboardController);
});

afterEach(() => {
	vi.restoreAllMocks();
	application.stop();
	if (originalClipboard) {
		Object.defineProperty(navigator, "clipboard", originalClipboard);
	} else {
		Reflect.deleteProperty(navigator, "clipboard");
	}
	document.body.innerHTML = "";
});

describe("clipboard", () => {
	test("[clipboard-source-target] Passes input values and arbitrary element textContent to writeText", async () => {
		const inputRoot = await mountRaw(
			'<div data-controller="clipboard"><button type="button" data-clipboard-target="trigger">入力をコピー</button><input data-clipboard-target="source" value="input value"></div>',
		);
		const inputTrigger = inputRoot.querySelector<HTMLButtonElement>(
			'[data-clipboard-target="trigger"]',
		);
		if (!inputTrigger) throw new Error("input trigger がありません");
		const inputEvents = detailsFrom(inputRoot);
		await userEvent.click(inputTrigger);
		await settle();

		expect(writeText).toHaveBeenNthCalledWith(1, "input value");
		expect(inputEvents.before).toEqual([
			{ text: "input value", source: "target", reason: "pointer" },
		]);
		expect(inputEvents.after[0]).toMatchObject({
			text: "input value",
			source: "target",
			reason: "pointer",
			ok: true,
			error: null,
		});

		const textRoot = await mountRaw(
			'<div data-controller="clipboard"><button type="button" data-clipboard-target="trigger">本文をコピー</button><p data-clipboard-target="source">text content</p></div>',
		);
		const textTrigger = textRoot.querySelector<HTMLButtonElement>(
			'[data-clipboard-target="trigger"]',
		);
		if (!textTrigger) throw new Error("text trigger がありません");
		await userEvent.click(textTrigger);
		await settle();

		expect(writeText).toHaveBeenNthCalledWith(2, "text content");

		const textareaRoot = await mountRaw(
			'<div data-controller="clipboard"><button type="button" data-clipboard-target="trigger">textarea をコピー</button><textarea data-clipboard-target="source">textarea value</textarea></div>',
		);
		const textareaTrigger = textareaRoot.querySelector<HTMLButtonElement>(
			'[data-clipboard-target="trigger"]',
		);
		if (!textareaTrigger) throw new Error("textarea trigger がありません");
		await userEvent.click(textareaTrigger);
		await settle();

		expect(writeText).toHaveBeenNthCalledWith(3, "textarea value");
	});

	test("[clipboard-source-text] Uses the configured text value and records keyboard reason", async () => {
		const root = await mountRaw(
			'<div data-controller="clipboard" data-clipboard-source-value="text" data-clipboard-text-value="fixed text"><button type="button" data-clipboard-target="trigger">固定文字列をコピー</button></div>',
		);
		const trigger = root.querySelector<HTMLButtonElement>('[data-clipboard-target="trigger"]');
		if (!trigger) throw new Error("trigger がありません");
		const events = detailsFrom(root);

		trigger.focus();
		await userEvent.keyboard("{Enter}");
		await settle();

		expect(writeText).toHaveBeenCalledWith("fixed text");
		expect(events.before).toEqual([{ text: "fixed text", source: "text", reason: "keyboard" }]);
	});

	test("[clipboard-source-selection][clipboard-selection-scope-negative] Copies only selections inside the root", async () => {
		const root = await mountRaw(
			'<div data-controller="clipboard" data-clipboard-source-value="selection"><p id="inside">inside selection</p><button type="button" data-clipboard-target="trigger">選択をコピー</button></div>',
		);
		const inside = root.querySelector<HTMLElement>("#inside");
		const trigger = root.querySelector<HTMLButtonElement>('[data-clipboard-target="trigger"]');
		if (!inside || !trigger) throw new Error("selection target がありません");
		const selection = window.getSelection();
		if (!selection) throw new Error("Selection がありません");
		const range = document.createRange();
		range.selectNodeContents(inside);
		selection.removeAllRanges();
		selection.addRange(range);
		const events = detailsFrom(root);

		await userEvent.click(trigger);
		await settle();
		expect(writeText).toHaveBeenCalledWith("inside selection");
		expect(events.before[0]).toEqual({
			text: "inside selection",
			source: "selection",
			reason: "pointer",
		});

		const outside = document.createElement("p");
		outside.textContent = "outside selection";
		document.body.append(outside);
		const outsideRange = document.createRange();
		outsideRange.selectNodeContents(outside);
		selection.removeAllRanges();
		selection.addRange(outsideRange);
		writeText.mockClear();
		events.before.length = 0;
		events.after.length = 0;

		await userEvent.click(trigger);
		await settle();
		expect(writeText).not.toHaveBeenCalled();
		expect(events.before).toEqual([]);
		expect(events.after).toEqual([]);
	});

	test("[clipboard-empty-source-negative] Does nothing for an empty copy source", async () => {
		const root = await mountRaw(
			'<div data-controller="clipboard"><button type="button" data-clipboard-target="trigger">空値をコピー</button><input data-clipboard-target="source" value=""></div>',
		);
		const trigger = root.querySelector<HTMLButtonElement>('[data-clipboard-target="trigger"]');
		if (!trigger) throw new Error("trigger がありません");
		const events = detailsFrom(root);

		await userEvent.click(trigger);
		await settle();

		expect(writeText).not.toHaveBeenCalled();
		expect(events.before).toEqual([]);
		expect(events.after).toEqual([]);
	});

	test("[clipboard-beforecopy-cancel][clipboard-beforecopy-cancel-negative] Canceling beforecopy prevents writing and copy events", async () => {
		const root = await mountRaw(
			'<div data-controller="clipboard" data-clipboard-source-value="text" data-clipboard-text-value="cancel me"><button type="button" data-clipboard-target="trigger">コピー</button></div>',
		);
		const trigger = root.querySelector<HTMLButtonElement>('[data-clipboard-target="trigger"]');
		if (!trigger) throw new Error("trigger がありません");
		const events = detailsFrom(root);
		root.addEventListener("clipboard:beforecopy", (event) => event.preventDefault());

		await userEvent.click(trigger);
		await settle();

		expect(writeText).not.toHaveBeenCalled();
		expect(events.before).toEqual([{ text: "cancel me", source: "text", reason: "pointer" }]);
		expect(events.after).toEqual([]);
	});

	test("[clipboard-failure-detail][clipboard-failure-detail-negative] Reports writeText rejection with ok=false and a DOMException", async () => {
		const error = new DOMException("permission denied", "NotAllowedError");
		writeText.mockRejectedValue(error);
		const root = await mountRaw(
			'<div data-controller="clipboard" data-clipboard-source-value="text" data-clipboard-text-value="failure"><button type="button" data-clipboard-target="trigger">コピー</button></div>',
		);
		const trigger = root.querySelector<HTMLButtonElement>('[data-clipboard-target="trigger"]');
		if (!trigger) throw new Error("trigger がありません");
		const events = detailsFrom(root);

		await userEvent.click(trigger);
		await settle();

		expect(events.after).toHaveLength(1);
		expect(events.after[0]).toEqual({
			text: "failure",
			source: "text",
			reason: "pointer",
			ok: false,
			error: error,
		});
	});

	test("[clipboard-synthetic-guard][clipboard-synthetic-guard-negative] Neither writes nor emits events for synthetic clicks", async () => {
		const root = await mountRaw(
			'<div data-controller="clipboard" data-clipboard-source-value="text" data-clipboard-text-value="synthetic"><button type="button" data-clipboard-target="trigger">コピー</button></div>',
		);
		const trigger = root.querySelector<HTMLButtonElement>('[data-clipboard-target="trigger"]');
		if (!trigger) throw new Error("trigger がありません");
		const events = detailsFrom(root);

		await controllerFor(root).copy();
		trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		await settle();

		expect(writeText).not.toHaveBeenCalled();
		expect(events.before).toEqual([]);
		expect(events.after).toEqual([]);
	});

	test("[clipboard-disconnect-cleanup][clipboard-disconnect-cleanup-negative] Removes listeners across reconnection and emits no event for promises completed after disconnect", async () => {
		let resolveWrite: (() => void) | undefined;
		writeText.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveWrite = resolve;
				}),
		);
		const root = await mountRaw(
			'<div data-controller="clipboard" data-clipboard-source-value="text" data-clipboard-text-value="pending"><button type="button" data-clipboard-target="trigger">コピー</button></div>',
		);
		const trigger = root.querySelector<HTMLButtonElement>('[data-clipboard-target="trigger"]');
		if (!trigger) throw new Error("trigger がありません");
		const events = detailsFrom(root);

		await userEvent.click(trigger);
		expect(writeText).toHaveBeenCalledTimes(1);
		root.removeAttribute("data-controller");
		await settle();
		await userEvent.click(trigger);
		await settle();
		expect(writeText).toHaveBeenCalledTimes(1);

		resolveWrite?.();
		await settle();
		expect(events.after).toEqual([]);

		root.setAttribute("data-controller", "clipboard");
		await settle();
		writeText.mockResolvedValue(undefined);
		await userEvent.click(trigger);
		await settle();
		expect(writeText).toHaveBeenCalledTimes(2);
		expect(events.after).toHaveLength(1);
	});

	test("[clipboard-semantic-validation][clipboard-semantic-validation-negative] Warns once and disables enhancement for invalid markup or values", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const invalidTriggerRoot = await mountRaw(
			'<div data-controller="clipboard"><div data-clipboard-target="trigger">button ではない</div><span data-clipboard-target="source">text</span></div>',
		);
		const invalidTrigger = invalidTriggerRoot.querySelector<HTMLElement>(
			'[data-clipboard-target="trigger"]',
		);
		if (!invalidTrigger) throw new Error("invalid trigger がありません");
		const invalidValueRoot = await mountRaw(
			'<div data-controller="clipboard" data-clipboard-source-value="invalid"><button type="button" data-clipboard-target="trigger">不正な value</button></div>',
		);
		const invalidValueTrigger = invalidValueRoot.querySelector<HTMLButtonElement>(
			'[data-clipboard-target="trigger"]',
		);
		if (!invalidValueTrigger) throw new Error("invalid value trigger がありません");

		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn.mock.calls[0]?.[0]).toContain("clipboard controller");
		expect(warn.mock.calls[0]?.[0]).toContain("trigger");
		expect(warn.mock.calls[1]?.[0]).toContain("source");

		await userEvent.click(invalidTrigger);
		await userEvent.click(invalidValueTrigger);
		await settle();
		expect(writeText).not.toHaveBeenCalled();
	});
});
