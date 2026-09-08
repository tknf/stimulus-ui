import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { commands, userEvent } from "vite-plus/test/browser/context";
import ColorPickerController, {
	type ColorPickerValue,
	type ColorPickerChangeDetail,
} from "../src/color_picker_controller";

const channels = ["hue", "saturation", "brightness", "alpha"] as const;
const maximum = { hue: 360, saturation: 100, brightness: 100, alpha: 1 };
const initial = (): ColorPickerValue => ({
	colorSpace: "srgb",
	hue: 210,
	saturation: 40,
	brightness: 60,
	alpha: 0.5,
});
let application: Application;
let index = 0;
const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};
const required = <T extends Element>(root: ParentNode, selector: string) => {
	const element = root.querySelector<T>(selector);
	if (element === null) throw new Error(`color-picker test に ${selector} がありません`);
	return element;
};
type Options = {
	value?: unknown;
	area?: boolean;
	wheel?: boolean;
	rtl?: boolean;
	complete?: boolean;
	form?: boolean;
};
const mount = async ({
	value = initial(),
	area = true,
	wheel = true,
	rtl = false,
	complete = true,
	form = false,
}: Options = {}) => {
	const id = `color-${index++}`;
	const root = document.createElement("div");
	root.id = id;
	root.setAttribute("data-controller", "color-picker");
	root.setAttribute("aria-label", "色を選ぶ");
	if (complete) root.setAttribute("role", "group");
	if (rtl) root.dir = "rtl";
	root.setAttribute(
		"data-color-picker-value-value",
		typeof value === "string" ? value : JSON.stringify(value),
	);
	root.innerHTML = `${area ? `<button type="button" data-color-picker-target="area" aria-label="彩度と明るさのスライダーへ" ${complete ? `aria-controls="${id}-saturation ${id}-brightness"` : ""} style="display:block;width:200px;height:160px;padding:0;border:0;touch-action:none">色領域</button>` : ""}
		${wheel ? `<button type="button" data-color-picker-target="wheel" aria-label="色相のスライダーへ" ${complete ? `aria-controls="${id}-hue"` : ""} style="display:block;width:160px;height:160px;padding:0;border:0;touch-action:none">色相の輪</button>` : ""}
		<p id="${id}-instructions" data-color-picker-target="instructions">矢印で調整。Shiftは10倍。Escapeで取消。EnterとSpaceでスライダーへ移動します。</p>
		${channels.map((channel) => `<label>${channel}<input id="${id}-${channel}" data-color-picker-target="${channel}Control" type="range" name="${channel}" ${complete ? `min="0" max="${maximum[channel]}" step="any"` : ""} style="width:220px"></label>`).join("")}`;
	const parent = form ? document.createElement("form") : document.createElement("div");
	parent.append(root);
	if (form) parent.insertAdjacentHTML("beforeend", '<button type="reset">リセット</button>');
	document.body.append(parent);
	await settle();
	const controller = application.getControllerForElementAndIdentifier(root, "color-picker");
	if (!(controller instanceof ColorPickerController))
		throw new Error("color-picker が接続されていません");
	const target = <T extends HTMLElement>(name: string) =>
		required<T>(root, `[data-color-picker-target="${name}"]`);
	const events: Array<{ type: string; detail: ColorPickerChangeDetail; cancelable: boolean }> = [];
	for (const type of ["color-picker:beforechange", "color-picker:change"])
		root.addEventListener(type, (event) => {
			if (event instanceof CustomEvent)
				events.push({
					type,
					detail: event.detail as ColorPickerChangeDetail,
					cancelable: event.cancelable,
				});
		});
	return { root, parent, controller, target, events };
};
type Mounted = Awaited<ReturnType<typeof mount>>;
const pointerCommands = commands as typeof commands & {
	colorPointer: (
		selector: string,
		action: "down" | "move" | "up" | "release",
		x: number,
		y: number,
	) => Promise<void>;
};
const pointer = (
	mounted: Mounted,
	target: string,
	action: "down" | "move" | "up",
	x: number,
	y: number,
) => {
	const element = mounted.target(target);
	if (element.id === "") element.id = `${mounted.root.id}-${target}`;
	return pointerCommands.colorPointer(`#${element.id}`, action, x, y);
};
const clickPoint = async (mounted: Mounted, target: string, x: number, y: number) => {
	await pointer(mounted, target, "down", x, y);
	await pointer(mounted, target, "up", x, y);
};
const property = (mounted: Mounted, name: string) =>
	mounted.root.style.getPropertyValue(`--color-picker-${name}`);
const expectControls = (mounted: Mounted, value: ColorPickerValue) => {
	for (const channel of channels)
		expect(mounted.target<HTMLInputElement>(`${channel}Control`).valueAsNumber).toBeCloseTo(
			value[channel],
			8,
		);
};

beforeEach(() => {
	document.body.innerHTML = "";
	application = Application.start();
	application.register("color-picker", ColorPickerController);
});
afterEach(async () => {
	await pointerCommands.colorPointer("", "release", 0, 0);
	for (const root of document.querySelectorAll('[data-controller="color-picker"]'))
		root.removeAttribute("data-controller");
	await settle();
	application.stop();
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

test("[color-picker-model][color-picker-color-negative][color-picker-output-negative] Preserves sRGB and Display-P3 color space, alpha, and precision in CSS and native outputs", async () => {
	const mounted = await mount();
	for (const colorSpace of ["srgb", "display-p3"] as const) {
		for (const [hue, rgb] of [
			[0, "1 0 0"],
			[120, "0 1 0"],
			[240, "0 0 1"],
			[360, "1 0 0"],
		] as const) {
			const value = { colorSpace, hue, saturation: 100, brightness: 100, alpha: 0.375 };
			mounted.controller.value = value;
			expect(mounted.root.dataset.colorSpace).toBe(colorSpace);
			expect(mounted.controller.color).toBe(`color(${colorSpace} ${rgb} / 0.375)`);
			expect(property(mounted, "color")).toBe(mounted.controller.color);
			expect(property(mounted, "hue-color")).toBe(`color(${colorSpace} ${rgb} / 1)`);
			expectControls(mounted, value);
			const swatch = document.createElement("div");
			swatch.style.color = mounted.controller.color ?? "";
			document.body.append(swatch);
			expect(getComputedStyle(swatch).color).toContain(`color(${colorSpace} `);
			swatch.remove();
		}
	}
	const precise = {
		colorSpace: "display-p3",
		hue: 35.123456,
		saturation: 54.987654,
		brightness: 65.123456,
		alpha: 0.123456,
	} satisfies ColorPickerValue;
	mounted.controller.value = precise;
	expect(mounted.controller.value).toEqual(precise);
	expectControls(mounted, precise);
	expect(Number(property(mounted, "saturation"))).toBeCloseTo(0.54987654, 8);
	expect(Number(property(mounted, "brightness"))).toBeCloseTo(0.65123456, 8);
	expect(Number(property(mounted, "alpha"))).toBe(0.123456);
	expect(mounted.events).toEqual([]);
});

test("[color-picker-model][color-picker-value-negative] Preserves achromatic hue, clamps API values, and copies input and getter objects", async () => {
	const mounted = await mount();
	const value = { ...initial(), hue: 123, saturation: 0, brightness: 0, alpha: 0 };
	mounted.controller.value = value;
	value.hue = 50;
	const copy = mounted.controller.value;
	if (copy === null) throw new Error("色値がありません");
	copy.hue = 20;
	expect(mounted.controller.value?.hue).toBe(123);
	expect(mounted.controller.color).toBe("color(srgb 0 0 0 / 0)");
	mounted.controller.value = { ...initial(), hue: 999, saturation: -1, brightness: 101, alpha: 2 };
	expect(mounted.controller.value).toEqual({
		...initial(),
		hue: 360,
		saturation: 0,
		brightness: 100,
		alpha: 1,
	});
	Reflect.set(mounted.controller, "value", null);
	Reflect.set(mounted.controller, "value", { ...initial(), hue: NaN });
	expect(mounted.controller.value?.hue).toBe(360);
	expect(mounted.events).toEqual([]);
});

test("[color-picker-keyboard][color-picker-rtl-negative] Supports area axes and wheel arrows, boundaries, and Shift in RTL", async () => {
	const mounted = await mount({ rtl: true });
	const area = mounted.target<HTMLButtonElement>("area");
	area.focus();
	await userEvent.keyboard("{ArrowRight}{ArrowUp}");
	expect(mounted.controller.value).toEqual({ ...initial(), saturation: 39, brightness: 61 });
	await userEvent.keyboard("{Shift>}{ArrowLeft}{ArrowDown}{/Shift}");
	expect(mounted.controller.value).toEqual({ ...initial(), saturation: 49, brightness: 51 });
	const wheel = mounted.target<HTMLButtonElement>("wheel");
	wheel.focus();
	await userEvent.keyboard("{ArrowRight}{ArrowDown}");
	expect(mounted.controller.value?.hue).toBe(208);
	await userEvent.keyboard("{Home}");
	expect(mounted.controller.value?.hue).toBe(0);
	await userEvent.keyboard("{End}");
	expect(mounted.controller.value?.hue).toBe(360);
	expect(mounted.events.at(-1)?.detail.reason).toBe("keyboard");
	const previous = mounted.controller.value;
	for (const flag of ["ctrlKey", "altKey", "metaKey", "isComposing", "keyCode"] as const) {
		wheel.addEventListener(
			"keydown",
			(event) => Object.defineProperty(event, flag, { value: flag === "keyCode" ? 229 : true }),
			{ once: true, capture: true },
		);
		await userEvent.keyboard("{ArrowLeft}");
	}
	expect(mounted.controller.value).toEqual(previous);
});

test("[color-picker-pointer][color-picker-preview-negative] Previews area clicks and drags and commits once on pointerup", async () => {
	const mounted = await mount();
	await pointer(mounted, "area", "down", 0.25, 0.25);
	expect(mounted.controller.value).toEqual(initial());
	expect(mounted.root.dataset.state).toBe("adjusting");
	expect(Number(property(mounted, "saturation"))).toBeCloseTo(0.25, 1);
	expect(Number(property(mounted, "brightness"))).toBeCloseTo(0.75, 1);
	expect(mounted.events).toEqual([]);
	await pointer(mounted, "area", "move", 0.75, 0.5);
	await pointer(mounted, "area", "up", 0.75, 0.5);
	expect(mounted.controller.value?.saturation).toBeCloseTo(75, 0);
	expect(mounted.controller.value?.brightness).toBeCloseTo(50, 0);
	expect(mounted.events.map((event) => [event.type, event.cancelable])).toEqual([
		["color-picker:beforechange", true],
		["color-picker:change", false],
	]);
	expect(mounted.events[1]?.detail).toMatchObject({
		reason: "pointer",
		source: "area",
		previousValue: initial(),
	});
	expect(mounted.root.dataset.state).toBe("idle");
	mounted.events.length = 0;
	await clickPoint(mounted, "area", 0.5, 0.75);
	expect(mounted.controller.value?.saturation).toBeCloseTo(50, 0);
	expect(mounted.controller.value?.brightness).toBeCloseTo(25, 0);
	expect(mounted.events).toHaveLength(2);
});

test("[color-picker-pointer] Selects wheel hue clockwise from zero at the top and preserves the value at the center", async () => {
	const mounted = await mount({ area: false });
	for (const [x, y, hue] of [
		[0.75, 0.5, 90],
		[0.5, 0.75, 180],
		[0.25, 0.5, 270],
		[0.5, 0.25, 0],
	]) {
		await clickPoint(mounted, "wheel", x, y);
		const actual = mounted.controller.value?.hue ?? NaN;
		expect(Math.min(Math.abs(actual - hue), Math.abs(actual - hue - 360))).toBeLessThan(3);
	}
	expect(mounted.events.at(-1)?.detail.source).toBe("wheel");
	mounted.controller.value = { ...initial(), hue: 123 };
	mounted.events.length = 0;
	const wheel = mounted.target<HTMLButtonElement>("wheel");
	const center = (event: PointerEvent) => {
		const rect = wheel.getBoundingClientRect();
		Object.defineProperties(event, {
			clientX: { value: rect.left + rect.width / 2 },
			clientY: { value: rect.top + rect.height / 2 },
		});
	};
	// Check a trusted center-point event independently of browser pixel rounding.
	for (const type of ["pointerdown", "pointermove", "pointerup"] as const)
		wheel.addEventListener(type, center, { capture: true });
	await clickPoint(mounted, "wheel", 0.5, 0.5);
	expect(mounted.controller.value?.hue).toBe(123);
	expect(mounted.events).toEqual([]);
});

test("[color-picker-range][color-picker-range-negative] Handles track clicks and keyboard interaction on every native range", async () => {
	const mounted = await mount({ area: false, wheel: false });
	for (const channel of channels) {
		mounted.events.length = 0;
		await clickPoint(mounted, `${channel}Control`, 0.8, 0.5);
		expect(mounted.controller.value?.[channel]).toBeGreaterThan(maximum[channel] * 0.6);
		expect(mounted.events.map((event) => event.type)).toEqual([
			"color-picker:beforechange",
			"color-picker:change",
		]);
		expect(mounted.events[1]?.detail).toMatchObject({ source: channel, reason: "pointer" });
		mounted.target<HTMLInputElement>(`${channel}Control`).focus();
		await userEvent.keyboard("{Home}");
		expect(mounted.controller.value?.[channel]).toBe(0);
		expect(mounted.events.at(-1)?.detail.reason).toBe("keyboard");
		expect(mounted.root.dataset.state).toBe("idle");
	}
});

test("[color-picker-cancel][color-picker-before-negative] Restores all outputs when beforechange is canceled", async () => {
	const mounted = await mount();
	const beforeValues: Array<ColorPickerValue | null> = [];
	mounted.root.addEventListener("color-picker:beforechange", (event) => {
		beforeValues.push(mounted.controller.value);
		expectControls(mounted, initial());
		event.preventDefault();
	});
	await clickPoint(mounted, "area", 0.9, 0.8);
	mounted.target<HTMLButtonElement>("wheel").focus();
	await userEvent.keyboard("{ArrowRight}");
	await clickPoint(mounted, "alphaControl", 0.9, 0.5);
	expect(beforeValues).toEqual([initial(), initial(), initial()]);
	expect(mounted.events.map((event) => event.type)).toEqual([
		"color-picker:beforechange",
		"color-picker:beforechange",
		"color-picker:beforechange",
	]);
	expect(mounted.controller.value).toEqual(initial());
	expectControls(mounted, initial());
	expect(mounted.root.dataset.state).toBe("idle");
});

test("[color-picker-cancel][color-picker-capture-negative] Cancels drag previews on Escape and lost capture", async () => {
	const mounted = await mount();
	const area = mounted.target<HTMLButtonElement>("area");
	let pointerId = 0;
	area.addEventListener("pointerdown", (event) => {
		pointerId = event.pointerId;
	});
	for (const cancellation of ["escape", "capture"]) {
		await pointer(mounted, "area", "down", 0.2, 0.2);
		await pointer(mounted, "area", "move", 0.8, 0.8);
		if (cancellation === "escape") await userEvent.keyboard("{Escape}");
		else area.releasePointerCapture(pointerId);
		await pointer(mounted, "area", "move", 0.9, 0.9);
		await pointer(mounted, "area", "up", 0.9, 0.9);
		expect(mounted.controller.value).toEqual(initial());
		expectControls(mounted, initial());
		expect(mounted.root.dataset.state).toBe("idle");
	}
	expect(mounted.events).toEqual([]);
});

test("[color-picker-reentrant][color-picker-reentrant-negative] Prioritizes API and attribute changes in before listeners without leaking detail mutations into state", async () => {
	const mounted = await mount();
	const replacement = {
		...initial(),
		colorSpace: "display-p3",
		hue: 33,
	} satisfies ColorPickerValue;
	mounted.root.addEventListener(
		"color-picker:beforechange",
		(event) => {
			if (event instanceof CustomEvent) (event.detail as ColorPickerChangeDetail).value.hue = 12;
			mounted.controller.value = replacement;
		},
		{ once: true },
	);
	await clickPoint(mounted, "area", 0.8, 0.8);
	expect(mounted.controller.value).toEqual(replacement);
	expect(mounted.events.map((event) => event.type)).toEqual(["color-picker:beforechange"]);
	mounted.events.length = 0;
	mounted.root.addEventListener(
		"color-picker:beforechange",
		() =>
			mounted.root.setAttribute(
				"data-color-picker-value-value",
				JSON.stringify({ ...initial(), hue: 55 }),
			),
		{ once: true },
	);
	await clickPoint(mounted, "area", 0.3, 0.3);
	await settle();
	expect(mounted.controller.value).toEqual({ ...initial(), hue: 55 });
	expect(mounted.events.map((event) => event.type)).toEqual(["color-picker:beforechange"]);
});

test("[color-picker-disabled][color-picker-disabled-negative] Keeps disabled channels fixed during area interaction and honors disabled fieldsets", async () => {
	const mounted = await mount();
	mounted.target<HTMLInputElement>("saturationControl").disabled = true;
	await settle();
	await clickPoint(mounted, "area", 0.9, 0.9);
	expect(mounted.controller.value?.saturation).toBe(initial().saturation);
	expect(Math.abs((mounted.controller.value?.brightness ?? NaN) - 10)).toBeLessThan(1);
	const fieldset = document.createElement("fieldset");
	mounted.parent.append(fieldset);
	fieldset.append(mounted.root);
	fieldset.disabled = true;
	await settle();
	const value = mounted.controller.value;
	mounted.events.length = 0;
	await clickPoint(mounted, "area", 0.4, 0.4);
	expect(mounted.controller.value).toEqual(value);
	expect(mounted.events).toEqual([]);
	mounted.controller.value = initial();
	expect(mounted.controller.value).toEqual(initial());
});

test("[color-picker-validation][color-picker-validation-negative] Validates names, targets, and values and warns only when completing missing static attributes", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const complete = await mount();
	expect(warn).not.toHaveBeenCalled();
	const incomplete = await mount({ complete: false });
	expect(warn).toHaveBeenCalledTimes(1);
	expect(warn.mock.calls[0]?.[0]).toContain("Added ");
	expect(incomplete.root.getAttribute("role")).toBe("group");
	expect(incomplete.target("area").getAttribute("aria-controls")).toBe(
		`${incomplete.root.id}-saturation ${incomplete.root.id}-brightness`,
	);
	const invalid = await mount({ value: "{broken-json" });
	expect(invalid.controller.value).toBeNull();
	expect(invalid.root.hasAttribute("data-state")).toBe(false);
	invalid.root.setAttribute("data-color-picker-value-value", JSON.stringify(initial()));
	await settle();
	expect(invalid.controller.value).toEqual(initial());
	complete.target("instructions").remove();
	await settle();
	await clickPoint(complete, "area", 0.9, 0.9);
	expect(complete.controller.value).toEqual(initial());
	expect(warn.mock.calls.at(-1)?.[0]).toContain("Enhancement has been disabled");
});

test("[color-picker-lifecycle][color-picker-cleanup-negative] Stops old listeners and capture after direct disconnect and avoids duplicates on reconnection", async () => {
	const mounted = await mount();
	await pointer(mounted, "area", "down", 0.9, 0.9);
	mounted.controller.disconnect();
	await pointer(mounted, "area", "up", 0.9, 0.9);
	expect(mounted.controller.value).toEqual(initial());
	expectControls(mounted, initial());
	mounted.target<HTMLButtonElement>("wheel").focus();
	await userEvent.keyboard("{ArrowRight}");
	expect(mounted.events).toEqual([]);
	mounted.controller.connect();
	await settle();
	await userEvent.keyboard("{ArrowRight}");
	expect(mounted.events).toHaveLength(2);
	expect(mounted.controller.value?.hue).toBe(211);
});

test("[color-picker-reset][color-picker-reset-negative] Synchronizes trusted resets after native restoration and respects cancellation and newer API values", async () => {
	const mounted = await mount({ form: true });
	const reset = required<HTMLButtonElement>(mounted.parent, '[type="reset"]');
	const changed = { ...initial(), hue: 30, alpha: 0.2 };
	mounted.controller.value = changed;
	await userEvent.click(reset);
	await settle();
	expect(mounted.controller.value).toEqual(initial());
	expectControls(mounted, initial());
	mounted.controller.value = changed;
	mounted.parent.addEventListener("reset", (event) => event.preventDefault(), { once: true });
	await userEvent.click(reset);
	await settle();
	expect(mounted.controller.value).toEqual(changed);
	expectControls(mounted, changed);
	mounted.parent.addEventListener(
		"reset",
		() => {
			mounted.controller.value = { ...changed, hue: 80 };
		},
		{ once: true },
	);
	await userEvent.click(reset);
	await settle();
	expect(mounted.controller.value?.hue).toBe(80);
	expectControls(mounted, { ...changed, hue: 80 });
	expect(mounted.events).toEqual([]);
});

test("[color-picker-trusted][color-picker-trusted-negative] Does not treat synthetic pointer, keydown, input, or change events as color changes", async () => {
	const mounted = await mount();
	const area = mounted.target("area");
	area.dispatchEvent(
		new PointerEvent("pointerdown", {
			bubbles: true,
			pointerId: 1,
			isPrimary: true,
			button: 0,
			clientX: 50,
			clientY: 50,
		}),
	);
	area.dispatchEvent(
		new PointerEvent("pointerup", {
			bubbles: true,
			pointerId: 1,
			isPrimary: true,
			button: 0,
			clientX: 50,
			clientY: 50,
		}),
	);
	area.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
	area.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
	const input = mounted.target<HTMLInputElement>("alphaControl");
	input.value = "0.9";
	input.dispatchEvent(new Event("input", { bubbles: true }));
	input.dispatchEvent(new Event("change", { bubbles: true }));
	expect(mounted.controller.value).toEqual(initial());
	expectControls(mounted, initial());
	expect(mounted.events).toEqual([]);
});

test("[color-picker-isolation] Keeps outer previews during nested instances' value and configuration changes", async () => {
	const outer = await mount();
	const inner = await mount();
	outer.root.append(inner.root);
	await settle();
	await pointer(outer, "area", "down", 0.8, 0.8);
	inner.root.setAttribute(
		"data-color-picker-value-value",
		JSON.stringify({ ...initial(), hue: 20 }),
	);
	await settle();
	expect(outer.root.dataset.state).toBe("adjusting");
	await pointer(outer, "area", "up", 0.8, 0.8);
	expect(outer.controller.value?.saturation).toBeCloseTo(80, 0);
	expect(inner.controller.value?.hue).toBe(20);
});

test("[color-picker-range][color-picker-range-negative][color-picker-stale-negative] Previews native drags and discards stale completion after API changes or Escape", async () => {
	const mounted = await mount();
	await pointer(mounted, "alphaControl", "down", 0.5, 0.5);
	await pointer(mounted, "alphaControl", "move", 0.8, 0.5);
	expect(mounted.controller.value).toEqual(initial());
	expect(Number(property(mounted, "alpha"))).toBeGreaterThan(0.7);
	await pointer(mounted, "alphaControl", "up", 0.8, 0.5);
	expect(mounted.controller.value?.alpha).toBeGreaterThan(0.7);
	expect(mounted.events).toHaveLength(2);
	for (const cancellation of ["api", "escape"] as const) {
		mounted.controller.value = initial();
		mounted.events.length = 0;
		await pointer(mounted, "alphaControl", "down", 0.5, 0.5);
		await pointer(mounted, "alphaControl", "move", 0.8, 0.5);
		const expected = cancellation === "api" ? { ...initial(), alpha: 0.2 } : initial();
		if (cancellation === "api") mounted.controller.value = expected;
		else await userEvent.keyboard("{Escape}");
		await pointer(mounted, "alphaControl", "move", 0.9, 0.5);
		await pointer(mounted, "alphaControl", "up", 0.9, 0.5);
		await settle();
		expect(mounted.controller.value).toEqual(expected);
		expectControls(mounted, expected);
		expect(mounted.events).toEqual([]);
		mounted.target<HTMLInputElement>("alphaControl").focus();
		await userEvent.keyboard("{Home}");
		expect(mounted.controller.value?.alpha).toBe(0);
	}
});

test("[color-picker-cancel][color-picker-geometry-negative] Invalidates direct-interaction coordinates when dimensions or direction change", async () => {
	const mounted = await mount();
	for (const change of ["size", "direction"] as const) {
		await pointer(mounted, "area", "down", 0.2, 0.2);
		if (change === "size") mounted.target("area").style.width = "230px";
		else mounted.target("area").style.direction = "rtl";
		await pointer(mounted, "area", "up", 0.8, 0.8);
		expect(mounted.controller.value).toEqual(initial());
		expectControls(mounted, initial());
		expect(mounted.root.dataset.state).toBe("idle");
	}
	expect(mounted.events).toEqual([]);
});

test("[color-picker-lifecycle][color-picker-membership-negative] Synchronizes replacement targets without committing stale candidates during before events or capture", async () => {
	const mounted = await mount();
	const replace = () => {
		const old = mounted.target<HTMLInputElement>("saturationControl");
		const replacement = old.cloneNode(true);
		old.replaceWith(replacement);
		return old;
	};
	mounted.root.addEventListener("color-picker:beforechange", replace, { once: true });
	await clickPoint(mounted, "area", 0.8, 0.8);
	await settle();
	expect(mounted.controller.value).toEqual(initial());
	expectControls(mounted, initial());
	expect(mounted.events.map((event) => event.type)).toEqual(["color-picker:beforechange"]);
	mounted.events.length = 0;
	await pointer(mounted, "area", "down", 0.8, 0.8);
	const old = replace();
	await settle();
	await pointer(mounted, "area", "up", 0.8, 0.8);
	old.value = "90";
	old.dispatchEvent(new Event("change", { bubbles: true }));
	expect(mounted.controller.value).toEqual(initial());
	expectControls(mounted, initial());
	expect(mounted.events).toEqual([]);
});

test("[color-picker-keyboard][color-picker-activation-negative] Uses Enter and Space to reach enabled ranges inside closed details", async () => {
	const mounted = await mount();
	const details = document.createElement("details");
	const summary = document.createElement("summary");
	summary.textContent = "チャンネル";
	details.append(summary);
	mounted.root.append(details);
	for (const channel of channels) {
		const label = mounted.target<HTMLInputElement>(`${channel}Control`).parentElement;
		if (label === null) throw new Error("labelがありません");
		details.append(label);
	}
	mounted.target<HTMLInputElement>("saturationControl").disabled = true;
	await settle();
	mounted.target("area").focus();
	await userEvent.keyboard("{Enter}");
	expect(details.open).toBe(true);
	expect(document.activeElement).toBe(mounted.target("brightnessControl"));
	details.open = false;
	mounted.target("wheel").focus();
	await userEvent.keyboard(" ");
	expect(details.open).toBe(true);
	expect(document.activeElement).toBe(mounted.target("hueControl"));
	expect(mounted.events).toEqual([]);
});

test("[color-picker-validation][color-picker-preservation-negative] Preserves authored attributes and descriptions without partially completing invalid configurations", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const mounted = await mount();
	mounted.controller.disconnect();
	const area = mounted.target("area");
	area.setAttribute("aria-controls", "authored-controls");
	area.setAttribute("aria-describedby", "authored-description");
	mounted.target<HTMLInputElement>("hueControl").min = "0.0";
	mounted.controller.connect();
	expect(area.getAttribute("aria-controls")).toBe("authored-controls");
	expect(area.getAttribute("aria-describedby")).toBe(
		`authored-description ${mounted.root.id}-instructions`,
	);
	expect(mounted.target<HTMLInputElement>("hueControl").min).toBe("0.0");
	expect(warn).not.toHaveBeenCalled();
	mounted.controller.disconnect();
	mounted.root.removeAttribute("role");
	mounted.target<HTMLInputElement>("hueControl").max = "100";
	mounted.controller.connect();
	expect(mounted.root.hasAttribute("role")).toBe(false);
	expect(warn).toHaveBeenCalledTimes(1);
	mounted.target<HTMLInputElement>("hueControl").max = "360";
	mounted.root.setAttribute("data-color-picker-step-value", "2");
	await settle();
	expect(mounted.root.getAttribute("role")).toBe("group");
});

test("[color-picker-reset] Preserves current outputs and previews during reset configuration changes or cancellation", async () => {
	const mounted = await mount({ form: true });
	if (!(mounted.parent instanceof HTMLFormElement)) throw new Error("formがありません");
	await pointer(mounted, "area", "down", 0.8, 0.8);
	mounted.parent.addEventListener("reset", (event) => event.preventDefault(), { once: true });
	mounted.parent.reset();
	await settle();
	expect(mounted.root.dataset.state).toBe("adjusting");
	await pointer(mounted, "area", "up", 0.8, 0.8);
	const replacement = { ...initial(), hue: 55 };
	mounted.parent.addEventListener(
		"reset",
		() => mounted.root.setAttribute("data-color-picker-value-value", JSON.stringify(replacement)),
		{ once: true },
	);
	mounted.parent.reset();
	await settle();
	expect(mounted.controller.value).toEqual(replacement);
	expectControls(mounted, replacement);
});

test("[color-picker-blur-at-negative] Accepts subsequent originless trusted input after blur loses the completion event", async () => {
	for (const kind of ["input", "window"] as const) {
		const mounted = await mount();
		const input = mounted.target<HTMLInputElement>("alphaControl");
		input.scrollIntoView();
		await pointer(mounted, "alphaControl", "down", 0.5, 0.5);
		await pointer(mounted, "alphaControl", "move", 0.8, 0.5);
		expect(mounted.root.dataset.state).toBe("adjusting");
		const suppressEnd = (event: Event) => event.stopImmediatePropagation();
		// Block every completion notification because both pointerup and capture loss clean up.
		for (const type of ["lostpointercapture", "pointercancel"])
			mounted.root.ownerDocument.addEventListener(type, suppressEnd, true);
		if (kind === "input") {
			// Consumer code blocks native change immediately before blur, leaving the value uncommitted.
			input.addEventListener("change", (event) => event.stopPropagation(), {
				capture: true,
				once: true,
			});
			input.blur();
		} else window.dispatchEvent(new Event("blur"));
		let ended = false;
		mounted.root.ownerDocument.addEventListener(
			"pointerup",
			(event) => {
				ended = true;
				event.stopImmediatePropagation();
			},
			{
				capture: true,
				once: true,
			},
		);
		await pointer(mounted, "alphaControl", "up", 0.8, 0.5);
		await settle();
		expect(ended).toBe(true);
		for (const type of ["lostpointercapture", "pointercancel"])
			mounted.root.ownerDocument.removeEventListener(type, suppressEnd, true);
		expect(mounted.controller.value).toEqual(initial());
		expect(mounted.events).toEqual([]);
		mounted.target("wheel").focus();
		input.focus();
		// Receive trusted native input/change without delivering the initiating event to the controller.
		input.addEventListener("keydown", (event) => event.stopPropagation(), { once: true });
		await userEvent.keyboard("{Home}");
		expect(mounted.controller.value?.alpha).toBe(0);
		expect(mounted.events.map((event) => event.type)).toEqual([
			"color-picker:beforechange",
			"color-picker:change",
		]);
	}
});

test("[color-picker-idle-escape-negative] Passes idle Escape to the parent and prevents its default only during interaction", async () => {
	const mounted = await mount();
	const prevented: boolean[] = [];
	mounted.parent.addEventListener("keydown", (event) => {
		if (event instanceof KeyboardEvent && event.key === "Escape")
			prevented.push(event.defaultPrevented);
	});
	for (const target of ["area", "wheel", "alphaControl"]) {
		mounted.target(target).focus();
		await userEvent.keyboard("{Escape}");
	}
	expect(prevented).toEqual([false, false, false]);
	await pointer(mounted, "area", "down", 0.8, 0.8);
	await userEvent.keyboard("{Escape}");
	await pointer(mounted, "area", "up", 0.8, 0.8);
	expect(prevented.at(-1)).toBe(true);
	expect(mounted.events).toEqual([]);
});

test("[color-picker-range-syntax-negative] Disables invalid HTML min and max syntax without completing it", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	for (const [attribute, value] of [
		["max", "0x168"],
		["min", "0x0"],
		["max", "+360"],
		["max", "360."],
	] as const) {
		const mounted = await mount();
		mounted.controller.disconnect();
		mounted.root.removeAttribute("role");
		mounted.target<HTMLInputElement>("hueControl").setAttribute(attribute, value);
		mounted.controller.connect();
		expect(mounted.root.hasAttribute("role")).toBe(false);
		mounted.target("wheel").focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(mounted.controller.value).toEqual(initial());
		expect(mounted.events).toEqual([]);
	}
	expect(warn).toHaveBeenCalledTimes(4);
});

test("[color-picker-button-ancestor-negative] Disables targets inside nontarget buttons", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	for (const target of ["area", "wheel", "hueControl", "instructions"]) {
		const mounted = await mount();
		mounted.controller.disconnect();
		mounted.root.removeAttribute("role");
		const button = document.createElement("button");
		button.type = "button";
		mounted.root.append(button);
		const element = mounted.target(target);
		if (element instanceof HTMLInputElement && element.parentElement !== null)
			button.append(element.parentElement);
		else button.append(element);
		mounted.controller.connect();
		expect(mounted.root.hasAttribute("role")).toBe(false);
		expect(mounted.controller.value).toEqual(initial());
	}
	expect(warn).toHaveBeenCalledTimes(4);
});

test("[color-picker-button-ancestor-negative] Also disables range-only configurations whose entire root is inside a button", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const mounted = await mount({ area: false, wheel: false });
	mounted.controller.disconnect();
	mounted.root.removeAttribute("role");
	const button = document.createElement("button");
	button.type = "button";
	mounted.parent.append(button);
	button.append(mounted.root);
	mounted.controller.connect();
	expect(mounted.root.hasAttribute("role")).toBe(false);
	expect(warn).toHaveBeenCalledTimes(1);
});
