import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { commands, userEvent } from "vite-plus/test/browser/context";
import DialogController, {
	type DialogBounds,
	type DialogChangeDetail,
} from "../src/dialog_controller";

const fields = ["x", "y", "width", "height"] as const;
let application: Application;
let index = 0;
const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};
const required = <T extends Element>(root: ParentNode, selector: string) => {
	const element = root.querySelector<T>(selector);
	if (element === null) throw new Error(`dialog test に ${selector} がありません`);
	return element;
};
const mount = async (attributes = "", complete = true) => {
	const id = `panel-${index++}`;
	const root = document.createElement("div");
	root.id = id;
	root.innerHTML = `<div data-controller="dialog" data-dialog-modal-value="false" ${attributes}>
		<button type="button" data-dialog-target="trigger" aria-controls="${id}-dialog">開く</button>
		<button type="button" class="outside">背景</button>
		<div data-dialog-target="container" style="position:relative;width:800px;height:600px">
			<dialog id="${id}-dialog" data-dialog-target="dialog" aria-label="パネル" style="position:absolute;inset:auto;inset-inline-start:calc(var(--dialog-x)*1%);top:calc(var(--dialog-y)*1%);width:calc(var(--dialog-width)*1%);height:calc(var(--dialog-height)*1%);box-sizing:border-box;margin:0;max-width:none;max-height:none;overflow:auto">
				<button type="button" data-dialog-target="move" style="touch-action:none">移動</button>
				<button type="button" data-dialog-target="resize" style="touch-action:none">サイズ</button>
				<p id="${id}-instructions" data-dialog-target="instructions">矢印で移動とサイズを変更。Shiftは10倍。Escapeはドラッグ取消。数値を入力して適用できます。</p>
				${fields.map((field) => `<label>${field}<input type="number" data-dialog-target="${field}Control" ${complete ? 'step="any" required' : ""}></label>`).join("")}
				<button type="button" data-dialog-target="apply">適用</button>
				<button type="button" data-dialog-target="close">閉じる</button>
			</dialog>
		</div>
	</div>`;
	document.body.append(root);
	await settle();
	const owner = required<HTMLElement>(root, '[data-controller="dialog"]');
	const controller = application.getControllerForElementAndIdentifier(owner, "dialog");
	if (!(controller instanceof DialogController)) throw new Error("dialog が接続されていません");
	const target = <T extends HTMLElement>(name: string) =>
		required<T>(root, `[data-dialog-target="${name}"]`);
	const events: Array<{ type: string; detail: DialogChangeDetail; cancelable: boolean }> = [];
	for (const type of ["dialog:beforechange", "dialog:change"])
		owner.addEventListener(type, (event) => {
			if (event instanceof CustomEvent)
				events.push({
					type,
					detail: event.detail as DialogChangeDetail,
					cancelable: event.cancelable,
				});
		});
	return {
		root,
		owner,
		controller,
		target,
		events,
		dialog: target<HTMLDialogElement>("dialog"),
		outside: required<HTMLButtonElement>(root, ".outside"),
		move: target<HTMLButtonElement>("move"),
		resize: target<HTMLButtonElement>("resize"),
		apply: target<HTMLButtonElement>("apply"),
		trigger: target<HTMLButtonElement>("trigger"),
	};
};
type Mounted = Awaited<ReturnType<typeof mount>>;
const pointerCommands = commands as typeof commands & {
	dialogPointer: (
		selector: string,
		action: "down" | "move" | "up" | "release",
		x: number,
		y: number,
	) => Promise<void>;
};
const pointer = (mounted: Mounted, action: "down" | "move" | "up", x: number, y: number) =>
	pointerCommands.dialogPointer(
		`#${mounted.root.id} [data-dialog-target="container"]`,
		action,
		x / mounted.target("container").getBoundingClientRect().width,
		y / mounted.target("container").getBoundingClientRect().height,
	);
const handlePoint = (mounted: Mounted, handle = mounted.move) => {
	const container = mounted.target("container").getBoundingClientRect();
	const box = handle.getBoundingClientRect();
	return { x: box.x - container.x + box.width / 2, y: box.y - container.y + box.height / 2 };
};
const displayedBounds = (mounted: Mounted): DialogBounds => ({
	x: Number(mounted.dialog.style.getPropertyValue("--dialog-x")),
	y: Number(mounted.dialog.style.getPropertyValue("--dialog-y")),
	width: Number(mounted.dialog.style.getPropertyValue("--dialog-width")),
	height: Number(mounted.dialog.style.getPropertyValue("--dialog-height")),
});
const fillBounds = async (mounted: Mounted, value: DialogBounds) => {
	for (const field of fields)
		await userEvent.fill(mounted.target<HTMLInputElement>(`${field}Control`), String(value[field]));
};

beforeEach(() => {
	document.body.innerHTML = "";
	application = Application.start();
	application.register("dialog", DialogController);
});
afterEach(async () => {
	await pointerCommands.dialogPointer("", "release", 0, 0);
	for (const root of document.querySelectorAll('[data-controller="dialog"]'))
		root.removeAttribute("data-controller");
	await settle();
	application.stop();
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

test("[dialog-panel-native][dialog-panel-modal-negative] Allows background interaction and Tab entry/exit in non-modal mode without stealing background focus", async () => {
	const mounted = await mount();
	await userEvent.click(mounted.trigger);
	expect(mounted.dialog.open).toBe(true);
	expect(mounted.dialog.matches(":modal")).toBe(false);
	expect(mounted.dialog.hasAttribute("aria-modal")).toBe(false);
	mounted.target<HTMLButtonElement>("close").focus();
	await userEvent.tab();
	expect(mounted.dialog.contains(document.activeElement)).toBe(false);
	mounted.move.focus();
	await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
	// Some engines include the native dialog itself in reverse Tab order.
	if (document.activeElement === mounted.dialog) await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
	expect(document.activeElement).toBe(mounted.outside);
	await userEvent.click(mounted.outside);
	mounted.outside.focus();
	await userEvent.keyboard("{Escape}");
	expect(mounted.dialog.open).toBe(true);
	mounted.controller.close();
	await settle();
	expect(document.activeElement).toBe(mounted.outside);
	await userEvent.click(mounted.trigger);
	const cancel = (event: Event) => event.preventDefault();
	mounted.owner.addEventListener("dialog:beforeclose", cancel);
	await userEvent.keyboard("{Escape}");
	expect(mounted.dialog.open).toBe(true);
	mounted.owner.removeEventListener("dialog:beforeclose", cancel);
	await userEvent.keyboard("{Escape}");
	expect(mounted.dialog.open).toBe(false);
});

test("[dialog-panel-bounds][dialog-panel-output-negative][dialog-panel-clamp-negative] Synchronizes numeric and CSS outputs and silently clamps API and configuration values", async () => {
	const mounted = await mount(
		'data-dialog-x-value="20" data-dialog-y-value="30" data-dialog-width-value="60"',
	);
	expect(mounted.controller.bounds).toEqual({ x: 20, y: 30, width: 60, height: 50 });
	expect(displayedBounds(mounted)).toEqual(mounted.controller.bounds);
	mounted.controller.bounds = { x: 99, y: -1, width: 200, height: 0 };
	expect(mounted.controller.bounds).toEqual({ x: 0, y: 0, width: 100, height: 10 });
	expect(displayedBounds(mounted)).toEqual(mounted.controller.bounds);
	const copy = mounted.controller.bounds;
	copy.width = 12;
	expect(mounted.controller.bounds.width).toBe(100);
	mounted.controller.bounds = { x: NaN, y: 2, width: 3, height: 4 };
	Reflect.set(mounted.controller, "bounds", null);
	Reflect.set(mounted.controller, "bounds", { x: 1 });
	expect(mounted.controller.bounds.width).toBe(100);
	mounted.owner.setAttribute("data-dialog-x-value", "10");
	await settle();
	expect(mounted.controller.bounds).toEqual({ x: 10, y: 30, width: 60, height: 50 });
	expect(mounted.events).toEqual([]);
	expect(mounted.target<HTMLInputElement>("xControl").value).toBe("10");
});

test("[dialog-panel-keyboard][dialog-panel-rtl-negative] Provides arrow and Shift equivalents for movement and resizing in visual RTL directions", async () => {
	const mounted = await mount('dir="rtl" data-dialog-x-value="20" data-dialog-y-value="20"');
	mounted.controller.show();
	mounted.move.focus();
	await userEvent.keyboard("{ArrowRight}{ArrowDown}");
	expect(mounted.controller.bounds).toEqual({ x: 19, y: 21, width: 50, height: 50 });
	await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
	expect(mounted.controller.bounds.x).toBe(29);
	mounted.resize.focus();
	await userEvent.keyboard("{ArrowLeft}{ArrowUp}");
	expect(mounted.controller.bounds).toEqual({ x: 29, y: 21, width: 51, height: 49 });
	await userEvent.keyboard("{Control>}{ArrowRight}{/Control}{Alt>}{ArrowDown}{/Alt}");
	expect(mounted.controller.bounds.width).toBe(51);
	expect(mounted.events.at(-1)?.detail.reason).toBe("keyboard");
	mounted.controller.bounds = { x: 49, y: 49, width: 50, height: 50 };
	await userEvent.keyboard("{Shift>}{ArrowLeft}{ArrowDown}{/Shift}");
	expect(mounted.controller.bounds).toEqual({ x: 49, y: 49, width: 51, height: 51 });
});

test("[dialog-panel-input][dialog-panel-before-negative] Commits bounds through input and click while honoring beforechange cancellation and invalid input", async () => {
	const mounted = await mount();
	mounted.controller.show();
	const value = { x: 12.5, y: 13.25, width: 60.5, height: 70 };
	await fillBounds(mounted, value);
	await userEvent.click(mounted.apply);
	expect(mounted.controller.bounds).toEqual(value);
	expect(mounted.events.map((event) => [event.type, event.cancelable])).toEqual([
		["dialog:beforechange", true],
		["dialog:change", false],
	]);
	expect(mounted.events[1]?.detail).toEqual({
		bounds: value,
		previousBounds: { x: 0, y: 0, width: 50, height: 50 },
		reason: "pointer",
		operation: "set",
	});
	mounted.events.length = 0;
	const cancel = (event: Event) => event.preventDefault();
	mounted.owner.addEventListener("dialog:beforechange", cancel);
	await fillBounds(mounted, { x: 0, y: 0, width: 40, height: 40 });
	mounted.apply.focus();
	await userEvent.keyboard("{Enter}");
	expect(mounted.controller.bounds).toEqual(value);
	expect(displayedBounds(mounted)).toEqual(value);
	expect(mounted.events.map((event) => event.type)).toEqual(["dialog:beforechange"]);
	expect(mounted.events[0]?.detail.reason).toBe("keyboard");
	mounted.owner.removeEventListener("dialog:beforechange", cancel);
	mounted.events.length = 0;
	await userEvent.fill(mounted.target<HTMLInputElement>("xControl"), "");
	await userEvent.click(mounted.apply);
	expect(mounted.controller.bounds).toEqual(value);
	expect(mounted.events).toEqual([]);
	expect(mounted.target<HTMLInputElement>("xControl").validity.valueMissing).toBe(true);
});

test("[dialog-panel-drag][dialog-panel-preview-negative] Previews drags and commits once on pointerup, with identical resize bounds", async () => {
	const mounted = await mount();
	mounted.controller.show();
	const point = handlePoint(mounted);
	await pointer(mounted, "down", point.x, point.y);
	await pointer(mounted, "move", point.x + 80, point.y + 60);
	expect(displayedBounds(mounted).x).toBeCloseTo(10, 0);
	expect(displayedBounds(mounted).y).toBeCloseTo(10, 0);
	const preview = displayedBounds(mounted);
	expect(mounted.controller.bounds.x).toBe(0);
	expect(mounted.events).toEqual([]);
	await pointer(mounted, "up", point.x + 80, point.y + 60);
	expect(mounted.controller.bounds).toEqual(preview);
	expect(mounted.events.map((event) => event.type)).toEqual([
		"dialog:beforechange",
		"dialog:change",
	]);
	mounted.events.length = 0;
	const resize = handlePoint(mounted, mounted.resize);
	await pointer(mounted, "down", resize.x, resize.y);
	await pointer(mounted, "up", resize.x + 80, resize.y + 60);
	expect(mounted.controller.bounds.x).toBe(preview.x);
	expect(mounted.controller.bounds.y).toBe(preview.y);
	expect(mounted.controller.bounds.width).toBeCloseTo(60, 0);
	expect(mounted.controller.bounds.height).toBeCloseTo(60, 0);
	expect(mounted.events.at(-1)?.detail.operation).toBe("resize");
});

test("[dialog-panel-drag-cancel][dialog-panel-cancel-negative] Cancels only the preview on Escape or lost capture and leaves the panel open", async () => {
	const mounted = await mount();
	mounted.controller.show();
	const initial = mounted.controller.bounds;
	let pointerId = -1;
	mounted.move.addEventListener("pointerdown", (event) => {
		pointerId = event.pointerId;
	});
	for (const cancellation of ["escape", "capture"]) {
		const point = handlePoint(mounted);
		await pointer(mounted, "down", point.x, point.y);
		await pointer(mounted, "move", point.x + 80, point.y + 60);
		if (cancellation === "escape") await userEvent.keyboard("{Escape}");
		else mounted.move.releasePointerCapture(pointerId);
		await pointer(mounted, "move", point.x + 90, point.y + 60);
		await pointer(mounted, "up", point.x + 90, point.y + 60);
		expect(displayedBounds(mounted)).toEqual(initial);
		expect(mounted.dialog.open).toBe(true);
		expect(mounted.controller.bounds).toEqual(initial);
	}
	expect(mounted.events).toEqual([]);
});

test("[dialog-panel-trusted][dialog-panel-trusted-negative] Synthetic click, keydown, and pointer events do not change bounds or events", async () => {
	const mounted = await mount();
	mounted.controller.show();
	await fillBounds(mounted, { x: 20, y: 20, width: 50, height: 50 });
	mounted.apply.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
	mounted.move.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
	mounted.move.dispatchEvent(
		new PointerEvent("pointerdown", { bubbles: true, pointerId: 10, isPrimary: true, button: 0 }),
	);
	mounted.move.dispatchEvent(
		new PointerEvent("pointermove", { bubbles: true, pointerId: 10, clientX: 80 }),
	);
	mounted.move.dispatchEvent(
		new PointerEvent("pointerup", { bubbles: true, pointerId: 10, clientX: 80 }),
	);
	expect(mounted.controller.bounds).toEqual({ x: 0, y: 0, width: 50, height: 50 });
	expect(mounted.events).toEqual([]);
});

test("[dialog-panel-reentrant][dialog-panel-reentrant-negative] Does not overwrite API, configuration, or target changes from beforechange with stale candidates", async () => {
	const mounted = await mount();
	mounted.controller.show();
	const changed = { x: 15, y: 15, width: 55, height: 55 };
	mounted.owner.addEventListener(
		"dialog:beforechange",
		() => {
			mounted.controller.bounds = changed;
		},
		{ once: true },
	);
	mounted.move.focus();
	await userEvent.keyboard("{ArrowRight}");
	expect(mounted.controller.bounds).toEqual(changed);
	expect(mounted.events.map((event) => event.type)).toEqual(["dialog:beforechange"]);
	mounted.events.length = 0;
	mounted.owner.addEventListener(
		"dialog:beforechange",
		() => {
			mounted.owner.setAttribute("data-dialog-x-value", "20");
		},
		{ once: true },
	);
	await userEvent.keyboard("{ArrowRight}");
	await settle();
	expect(mounted.controller.bounds.x).toBe(20);
	expect(mounted.events.map((event) => event.type)).toEqual(["dialog:beforechange"]);
	mounted.events.length = 0;
	mounted.owner.addEventListener(
		"dialog:beforechange",
		() => {
			mounted.move.replaceWith(mounted.move.cloneNode(true));
		},
		{ once: true },
	);
	await userEvent.keyboard("{ArrowRight}");
	await settle();
	expect(mounted.events.map((event) => event.type)).toEqual(["dialog:beforechange"]);
});

test("[dialog-panel-lifecycle][dialog-panel-cleanup-negative] Carries no drags or listeners across direct disconnect and reconnect", async () => {
	const mounted = await mount();
	mounted.controller.show();
	const point = handlePoint(mounted);
	await pointer(mounted, "down", point.x, point.y);
	await pointer(mounted, "move", point.x + 80, point.y + 60);
	mounted.controller.disconnect();
	expect(displayedBounds(mounted).x).toBe(0);
	mounted.dialog.show();
	await pointer(mounted, "up", point.x + 80, point.y + 60);
	mounted.move.focus();
	await userEvent.keyboard("{ArrowRight}");
	expect(mounted.controller.bounds.x).toBe(0);
	expect(mounted.events).toEqual([]);
	mounted.controller.connect();
	await settle();
	mounted.controller.show();
	mounted.move.focus();
	await userEvent.keyboard("{ArrowRight}");
	expect(mounted.controller.bounds.x).toBe(1);
	expect(mounted.events.map((event) => event.type)).toEqual([
		"dialog:beforechange",
		"dialog:change",
	]);
});

test("[dialog-panel-validation][dialog-panel-validation-negative] Disables missing targets and nonfinite settings and distinguishes completion from missing-name warnings", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const complete = await mount();
	expect(warn).not.toHaveBeenCalled();
	expect(complete.move.getAttribute("aria-describedby")).toBe(complete.target("instructions").id);
	const incomplete = await mount("", false);
	expect(warn).toHaveBeenCalledTimes(1);
	expect(warn.mock.calls[0]?.[0]).toContain("Added ");
	expect(incomplete.target<HTMLInputElement>("xControl").step).toBe("any");
	incomplete.move.textContent = "";
	incomplete.controller.disconnect();
	incomplete.controller.connect();
	await settle();
	incomplete.controller.show();
	expect(incomplete.dialog.open).toBe(false);
	expect(warn.mock.calls.at(-1)?.[0]).toContain("Enhancement has been disabled");
	const invalid = await mount('data-dialog-min-width-value="NaN"');
	invalid.controller.show();
	expect(invalid.dialog.open).toBe(false);
	complete.target("xControl").remove();
	await settle();
	complete.controller.show();
	expect(complete.dialog.open).toBe(false);
});

test("[dialog-panel-isolation] Does not propagate bounds interaction or focus changes to another panel", async () => {
	const first = await mount();
	const second = await mount();
	first.controller.show();
	second.controller.show();
	first.move.focus();
	await userEvent.keyboard("{ArrowRight}");
	expect(first.controller.bounds.x).toBe(1);
	expect(second.controller.bounds.x).toBe(0);
	expect(second.events).toEqual([]);
	expect(document.activeElement).toBe(first.move);
});

test("[dialog-panel-drag-cancel] Cancels active drags for API, configuration, target, or container changes", async () => {
	const mounted = await mount();
	mounted.controller.show();
	for (const change of ["api", "value", "target", "container"] as const) {
		const handle = mounted.target<HTMLButtonElement>("move");
		const point = handlePoint(mounted, handle);
		await pointer(mounted, "down", point.x, point.y);
		await pointer(mounted, "move", point.x + 40, point.y + 30);
		if (change === "api") mounted.controller.bounds = { x: 5, y: 5, width: 50, height: 50 };
		if (change === "value") mounted.owner.setAttribute("data-dialog-x-value", "10");
		if (change === "target") handle.replaceWith(handle.cloneNode(true));
		if (change === "container") mounted.target("container").style.width = "780px";
		await settle();
		const value = mounted.controller.bounds;
		await pointer(mounted, "up", point.x + 50, point.y + 30);
		expect(mounted.controller.bounds).toEqual(value);
		expect(displayedBounds(mounted)).toEqual(value);
		expect(mounted.events).toEqual([]);
	}
});

test("[dialog-panel-reentrant] Does not start dragging if a pointerdown focus listener closes the panel or capture fails", async () => {
	const mounted = await mount();
	mounted.controller.show();
	mounted.outside.focus();
	mounted.move.addEventListener("focus", () => mounted.controller.close(), { once: true });
	await userEvent.click(mounted.move);
	expect(mounted.controller.bounds.x).toBe(0);
	expect(mounted.dialog.open).toBe(false);
	mounted.controller.show();
	vi.spyOn(mounted.move, "setPointerCapture").mockImplementation(() => {
		throw new Error("capture unavailable");
	});
	await userEvent.click(mounted.move);
	expect(mounted.events).toEqual([]);
});

test("[dialog-panel-input] Prevents form submission from extra-input Enter and checks custom validity before applying", async () => {
	const mounted = await mount();
	const form = document.createElement("form");
	mounted.dialog.append(form);
	const input = mounted.target<HTMLInputElement>("xControl");
	const label = input.parentElement;
	if (label === null) throw new Error("input のラベルがありません");
	form.append(label);
	await settle();
	const submit = vi.fn((event: Event) => event.preventDefault());
	form.addEventListener("submit", submit);
	mounted.controller.show();
	input.focus();
	await userEvent.keyboard("{Enter}");
	expect(submit).not.toHaveBeenCalled();
	await userEvent.fill(input, "15");
	input.setCustomValidity("この位置は使用できません");
	await userEvent.click(mounted.apply);
	expect(mounted.controller.bounds.x).toBe(0);
	expect(input.validationMessage).toBe("この位置は使用できません");
	expect(mounted.events).toEqual([]);
});

test("[dialog-panel-trusted][dialog-panel-key-reason-negative] Synthetic or canceled Enter does not contaminate the next pointer apply reason", async () => {
	const mounted = await mount();
	mounted.controller.show();
	for (const mode of ["synthetic", "prevented"] as const) {
		await userEvent.fill(
			mounted.target<HTMLInputElement>("xControl"),
			mode === "synthetic" ? "10" : "20",
		);
		if (mode === "synthetic")
			mounted.apply.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
		else {
			mounted.apply.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
			mounted.apply.focus();
			await userEvent.keyboard("{Enter}");
		}
		await userEvent.click(mounted.apply);
		expect(mounted.events.at(-1)?.detail.reason).toBe("pointer");
	}
});

test("[dialog-panel-validation][dialog-panel-writing-negative] Rejects vertical writing mode set only on the dialog", async () => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
	const mounted = await mount();
	mounted.dialog.style.writingMode = "vertical-rl";
	mounted.controller.disconnect();
	mounted.controller.connect();
	await settle();
	mounted.controller.show();
	expect(mounted.dialog.open).toBe(false);
});

test("[dialog-panel-validation][dialog-panel-invalid-state-negative] Synchronizes existing state and ARIA to closed when a required target disappears", async () => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
	const mounted = await mount();
	mounted.controller.show();
	mounted.target("xControl").remove();
	await settle();
	expect(mounted.dialog.open).toBe(false);
	expect(mounted.owner.dataset.state).toBe("closed");
	expect(mounted.dialog.dataset.state).toBe("closed");
	expect(mounted.trigger.getAttribute("aria-expanded")).toBe("false");
	expect(mounted.events).toEqual([]);
});

test("[dialog-panel-validation][dialog-panel-instructions-negative] Does not accept the dialog itself as the instructions target", async () => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
	const mounted = await mount();
	mounted.target("instructions").remove();
	mounted.dialog.setAttribute("data-dialog-target", "dialog instructions");
	await settle();
	mounted.controller.show();
	expect(mounted.dialog.open).toBe(false);
});

test("[dialog-panel-validation][dialog-panel-label-negative] Rejects an input when its original label for changes to another element", async () => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
	const mounted = await mount();
	const input = mounted.target<HTMLInputElement>("xControl");
	const label = input.parentElement;
	if (!(label instanceof HTMLLabelElement)) throw new Error("ラベルがありません");
	input.id = `${mounted.root.id}-x`;
	label.htmlFor = input.id;
	mounted.controller.show();
	expect(mounted.dialog.open).toBe(true);
	expect(input.labels?.length).toBe(1);
	label.htmlFor = "missing-input";
	await userEvent.click(mounted.move);
	await settle();
	expect(mounted.dialog.open).toBe(false);
	expect(mounted.events).toEqual([]);
});

test("[dialog-panel-validation][dialog-panel-mode-state-negative] Synchronizes closed state even when the destination mode lacks required targets", async () => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
	const mounted = await mount();
	mounted.controller.show();
	mounted.owner.setAttribute("data-dialog-modal-value", "true");
	await settle();
	expect(mounted.dialog.open).toBe(false);
	expect(mounted.owner.dataset.state).toBe("closed");
	expect(mounted.dialog.dataset.state).toBe("closed");
	expect(mounted.trigger.getAttribute("aria-expanded")).toBe("false");
});

test("[dialog-panel-native] Switches both display modes when valid target configuration and mode change together", async () => {
	const mounted = await mount();
	mounted.controller.show();
	const panelTargets = [
		"container",
		"move",
		"resize",
		"apply",
		"instructions",
		...fields.map((field) => `${field}Control`),
	].map((name) => ({ name, element: mounted.target(name) }));
	for (const { element } of panelTargets) element.removeAttribute("data-dialog-target");
	mounted.owner.setAttribute("data-dialog-modal-value", "true");
	await settle();
	mounted.controller.show();
	expect(mounted.dialog.matches(":modal")).toBe(true);
	expect(mounted.dialog.style.getPropertyValue("--dialog-x")).toBe("");
	for (const { name, element } of panelTargets) element.setAttribute("data-dialog-target", name);
	mounted.owner.setAttribute("data-dialog-modal-value", "false");
	await settle();
	mounted.controller.show();
	expect(mounted.dialog.open).toBe(true);
	expect(mounted.dialog.matches(":modal")).toBe(false);
	expect(displayedBounds(mounted)).toEqual(mounted.controller.bounds);
	expect(mounted.events).toEqual([]);
});
