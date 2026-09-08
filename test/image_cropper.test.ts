import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { commands, server, userEvent } from "vite-plus/test/browser/context";
import ImageCropperController, {
	type ImageCropperChangeDetail,
	type ImageCropperSourceRect,
	type ImageCropperValue,
} from "../src/image_cropper_controller";

type PublicController = Controller & {
	value: ImageCropperValue | null;
	sourceRect: ImageCropperSourceRect | null;
	zoom: number | null;
};

type Field = "x" | "y" | "width" | "height" | "zoom";
type DisabledTarget =
	| "selection"
	| "resize"
	| "xControl"
	| "yControl"
	| "widthControl"
	| "heightControl"
	| "zoomControl";

type MountOptions = {
	value?: ImageCropperValue;
	attributes?: string;
	complete?: boolean;
	details?: boolean;
	form?: boolean;
	imageAlt?: string;
	authoredRelations?: boolean;
	disabled?: readonly DisabledTarget[];
};

type Mounted = {
	root: HTMLElement;
	viewport: HTMLElement;
	image: HTMLImageElement;
	selection: HTMLButtonElement;
	resize: HTMLButtonElement;
	xControl: HTMLInputElement;
	yControl: HTMLInputElement;
	widthControl: HTMLInputElement;
	heightControl: HTMLInputElement;
	zoomControl: HTMLInputElement;
	instructions: HTMLElement;
	details: HTMLDetailsElement | null;
	form: HTMLFormElement | null;
	controller: PublicController;
};

type EventRecord = {
	type: string;
	detail: ImageCropperChangeDetail;
	target: EventTarget | null;
	cancelable: boolean;
};

type Geometry = { left: number; top: number; width: number; height: number };

const DEFAULT_VALUE: ImageCropperValue = {
	x: 25,
	y: 25,
	width: 50,
	height: 50,
	zoom: 1,
	offsetX: 0,
	offsetY: 0,
};

let mountIndex = 0;
let application: Application;
let originalWarn: typeof console.warn;

const cloneValue = (value: ImageCropperValue): ImageCropperValue => ({ ...value });

const pointerCommands = commands as typeof commands & {
	cropperPointer: (
		selector: string,
		action: "down" | "move" | "up",
		x: number,
		y: number,
	) => Promise<void>;
};

const pointer = (mounted: Mounted, action: "down" | "move" | "up", x = 45, y = 45) =>
	pointerCommands.cropperPointer(
		`#${mounted.root.id} [data-image-cropper-target="viewport"]`,
		action,
		x,
		y,
	);

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const required = <ElementType extends Element>(root: ParentNode, selector: string): ElementType => {
	const element = root.querySelector<ElementType>(selector);
	if (element === null) throw new Error(`image-cropper test に ${selector} がありません`);
	return element;
};

const controllerFor = (root: HTMLElement): PublicController => {
	const controller = application.getControllerForElementAndIdentifier(root, "image-cropper");
	if (controller === null) throw new Error("image-cropper controller が接続されていません");
	return controller as PublicController;
};

const disabledAttribute = (
	disabled: readonly DisabledTarget[] | undefined,
	target: DisabledTarget,
) => (disabled?.includes(target) ? " disabled" : "");

const mount = async (options: MountOptions = {}): Promise<Mounted> => {
	const index = (mountIndex += 1);
	const id = `image-cropper-test-${index}`;
	const value = cloneValue(options.value ?? DEFAULT_VALUE);
	const complete = options.complete ?? true;
	const authoredRelations = options.authoredRelations ?? false;
	const imageAlt = options.imageAlt ?? "青い背景の画像";
	const selectionControls = authoredRelations ? `${id}-authored-selection` : `${id}-x ${id}-y`;
	const resizeControls = authoredRelations ? `${id}-authored-resize` : `${id}-width ${id}-height`;
	const rangeControls = authoredRelations ? `${id}-authored-control` : `${id}-viewport`;
	const rootRole = complete ? ' role="group"' : "";
	const buttonType = complete ? ' type="button"' : "";
	const imageDraggable = complete ? ' draggable="false"' : "";
	const selectionControlsAttribute = complete ? ` aria-controls="${selectionControls}"` : "";
	const resizeControlsAttribute = complete ? ` aria-controls="${resizeControls}"` : "";
	const selectionDescription = complete ? ` aria-describedby="${id}-instructions"` : "";
	const rangeControlsAttribute = complete ? ` aria-controls="${rangeControls}"` : "";
	const range = (field: Field, label: string, min: string, max: string, fieldValue: number) => {
		const target = `${field}Control`;
		return `<label for="${id}-${field}">${label}</label><input id="${id}-${field}" type="range" min="${min}" max="${max}" step="any" value="${fieldValue}" aria-label="${label}"${rangeControlsAttribute}${disabledAttribute(options.disabled, target as DisabledTarget)} data-image-cropper-target="${target}" />`;
	};
	const controls = [
		range("x", "位置 X（%）", "0", "100", value.x),
		range("y", "位置 Y（%）", "0", "100", value.y),
		range("width", "幅（%）", "1", "100", value.width),
		range("height", "高さ（%）", "1", "100", value.height),
		range("zoom", "倍率", "1", "5", value.zoom),
	].join("");
	const controlsMarkup = options.details
		? `<details id="${id}-details"><summary>詳細 controls</summary><div>${controls}</div></details>`
		: `<div>${controls}</div>`;
	const formStart = options.form ? `<form id="${id}-form">` : "";
	const formEnd = options.form ? "</form>" : "";
	document.body.insertAdjacentHTML(
		"beforeend",
		`${formStart}<div id="${id}-root" data-controller="image-cropper"${rootRole} aria-label="画像の切り抜き" data-image-cropper-value-value='${JSON.stringify(value)}' ${options.attributes ?? ""} style="position:relative;--authored:keep"><div id="${id}-viewport" data-image-cropper-target="viewport" style="position:relative;width:100px;height:100px"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='blue'/%3E%3C/svg%3E" alt="${imageAlt}"${imageDraggable} data-image-cropper-target="image" /><button${buttonType} aria-label="切り抜き位置を調整"${selectionControlsAttribute}${selectionDescription}${disabledAttribute(options.disabled, "selection")} data-image-cropper-target="selection" style="position:absolute;left:25px;top:25px;width:50px;height:50px">位置</button><button${buttonType} aria-label="切り抜きサイズを調整"${resizeControlsAttribute}${selectionDescription}${disabledAttribute(options.disabled, "resize")} data-image-cropper-target="resize" style="position:absolute;left:75px;top:75px;width:10px;height:10px">サイズ</button></div><p id="${id}-instructions" data-image-cropper-target="instructions">位置は矢印、サイズは Shift+矢印、倍率は + / -、Escape、Enter / Space で操作します。</p>${controlsMarkup}</div>${formEnd}`,
	);
	await settle();
	const root = required<HTMLElement>(document, `#${id}-root`);
	return {
		root,
		viewport: required<HTMLElement>(root, '[data-image-cropper-target="viewport"]'),
		image: required<HTMLImageElement>(root, '[data-image-cropper-target="image"]'),
		selection: required<HTMLButtonElement>(root, '[data-image-cropper-target="selection"]'),
		resize: required<HTMLButtonElement>(root, '[data-image-cropper-target="resize"]'),
		xControl: required<HTMLInputElement>(root, '[data-image-cropper-target="xControl"]'),
		yControl: required<HTMLInputElement>(root, '[data-image-cropper-target="yControl"]'),
		widthControl: required<HTMLInputElement>(root, '[data-image-cropper-target="widthControl"]'),
		heightControl: required<HTMLInputElement>(root, '[data-image-cropper-target="heightControl"]'),
		zoomControl: required<HTMLInputElement>(root, '[data-image-cropper-target="zoomControl"]'),
		instructions: required<HTMLElement>(root, '[data-image-cropper-target="instructions"]'),
		details: root.querySelector<HTMLDetailsElement>("details"),
		form: root.closest("form"),
		controller: controllerFor(root),
	};
};

const mountRaw = async (markup: string) => {
	document.body.insertAdjacentHTML("beforeend", markup);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("raw root がありません");
	return { root, controller: controllerFor(root) };
};

type RawMarkupOptions = {
	rootAttributes?: string;
	image?: string;
	selection?: string;
	resize?: string;
	controls?: string;
	extraControls?: string;
};

const rawCropperMarkup = (options: RawMarkupOptions = {}) => {
	const index = (mountIndex += 1);
	const id = `image-cropper-raw-${index}`;
	const image =
		options.image ??
		`<img id="${id}-image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E" alt="画像" draggable="false" data-image-cropper-target="image" />`;
	const selection =
		options.selection ??
		`<button id="${id}-selection" type="button" aria-label="位置" data-image-cropper-target="selection">位置</button>`;
	const resize =
		options.resize ??
		`<button id="${id}-resize" type="button" aria-label="サイズ" data-image-cropper-target="resize">サイズ</button>`;
	const controls =
		options.controls ??
		(["x", "y", "width", "height", "zoom"] as const)
			.map(
				(field) =>
					`<input id="${id}-${field}" type="range" aria-label="${field}" data-image-cropper-target="${field}Control" />`,
			)
			.join("");
	return `<div id="${id}-root" data-controller="image-cropper" ${options.rootAttributes ?? 'role="group" aria-label="切り抜き"'} data-image-cropper-value-value='${JSON.stringify(DEFAULT_VALUE)}'><div id="${id}-viewport" data-image-cropper-target="viewport">${image}${selection}${resize}</div><p data-image-cropper-target="instructions">矢印と Escape で操作します。</p><div>${controls}${options.extraControls ?? ""}</div></div>`;
};

const setViewportGeometry = (
	viewport: HTMLElement,
	initial: Geometry = { left: 0, top: 0, width: 100, height: 100 },
) => {
	let geometry = initial;
	Object.defineProperty(viewport, "getBoundingClientRect", {
		configurable: true,
		value: () => new DOMRect(geometry.left, geometry.top, geometry.width, geometry.height),
	});
	return (next: Geometry) => {
		geometry = next;
	};
};

const controlFor = (mounted: Mounted, field: Field) => {
	switch (field) {
		case "x":
			return mounted.xControl;
		case "y":
			return mounted.yControl;
		case "width":
			return mounted.widthControl;
		case "height":
			return mounted.heightControl;
		case "zoom":
			return mounted.zoomControl;
	}
};

const recordEvents = (root: HTMLElement) => {
	const records: EventRecord[] = [];
	for (const type of ["image-cropper:beforechange", "image-cropper:change"]) {
		root.addEventListener(type, (event) => {
			if (!(event instanceof CustomEvent)) throw new Error("custom event ではありません");
			records.push({
				type: event.type,
				detail: event.detail as ImageCropperChangeDetail,
				target: event.target,
				cancelable: event.cancelable,
			});
		});
	}
	return records;
};

const expectValue = (actual: ImageCropperValue | null, expected: ImageCropperValue) => {
	if (actual === null) throw new Error("value が null です");
	for (const key of ["x", "y", "width", "height", "zoom", "offsetX", "offsetY"] as const) {
		expect(actual[key]).toBeCloseTo(expected[key], 8);
	}
};

const expectSourceRect = (
	actual: ImageCropperSourceRect | null,
	expected: ImageCropperSourceRect,
) => {
	if (actual === null) throw new Error("sourceRect が null です");
	for (const key of ["x", "y", "width", "height"] as const) {
		expect(actual[key]).toBeCloseTo(expected[key], 8);
	}
};

const appendDropTarget = (left: number, top: number) => {
	const target = document.createElement("div");
	target.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:20px;height:20px`;
	document.body.append(target);
	return target;
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("image-cropper", ImageCropperController);
});

afterEach(() => {
	console.warn = originalWarn;
	vi.restoreAllMocks();
	application.stop();
	document.body.innerHTML = "";
});

describe("image-cropper", () => {
	test("[image-cropper-semantic-validation][image-cropper-semantic-negative] Disables semantically invalid markup with one warning", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			const invalidImage = await mount({ imageAlt: "" });
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(invalidImage.root.dataset.state).toBeUndefined();
			expect(invalidImage.root.style.getPropertyValue("--image-cropper-x")).toBe("");

			const invalidLabelledBy = await mount({ attributes: 'aria-labelledby="missing-label"' });
			expect(warnings).toHaveLength(2);
			expect(invalidLabelledBy.root.dataset.state).toBeUndefined();

			const brokenButtonLabel = await mountRaw(
				rawCropperMarkup({
					selection:
						'<button id="broken-selection" type="button" aria-labelledby="missing-button-label" data-image-cropper-target="selection">位置</button>',
				}),
			);
			expect(warnings).toHaveLength(3);
			expect(brokenButtonLabel.root.dataset.state).toBeUndefined();

			const duplicateTarget = await mountRaw(
				rawCropperMarkup({
					extraControls:
						'<input type="range" aria-label="重複した位置" data-image-cropper-target="xControl" />',
				}),
			);
			expect(warnings).toHaveLength(4);
			expect(duplicateTarget.root.dataset.state).toBeUndefined();

			const wrongTargetType = await mountRaw(
				rawCropperMarkup({
					image: '<div data-image-cropper-target="image">画像</div>',
				}),
			);
			expect(warnings).toHaveLength(5);
			expect(wrongTargetType.root.dataset.state).toBeUndefined();

			const nestedImage = await mountRaw(
				rawCropperMarkup({
					image: "",
					selection:
						'<button type="button" aria-label="位置" data-image-cropper-target="selection"><img alt="画像" data-image-cropper-target="image" />位置</button>',
				}),
			);
			expect(warnings).toHaveLength(6);
			expect(nestedImage.root.dataset.state).toBeUndefined();

			const wrongRole = await mountRaw(
				rawCropperMarkup({ rootAttributes: 'role="region" aria-label="切り抜き"' }),
			);
			expect(warnings).toHaveLength(7);
			expect(wrongRole.root.dataset.state).toBeUndefined();

			const formMismatchControls = (["x", "y", "width", "height", "zoom"] as const)
				.map(
					(field, index) =>
						`<form id="raw-form-${index}"><input type="range" aria-label="${field}" data-image-cropper-target="${field}Control" /></form>`,
				)
				.join("");
			const mismatchedForms = await mountRaw(rawCropperMarkup({ controls: formMismatchControls }));
			expect(warnings).toHaveLength(8);
			expect(mismatchedForms.root.dataset.state).toBeUndefined();

			await mount({ attributes: 'data-image-cropper-step-value="0"' });
			expect(warnings).toHaveLength(9);

			const missing = await mountRaw(
				'<div data-controller="image-cropper" aria-label="切り抜き"><div data-image-cropper-target="viewport"><img alt="画像"><button type="button" aria-label="位置" data-image-cropper-target="selection"></button><button type="button" aria-label="サイズ" data-image-cropper-target="resize"></button></div><p data-image-cropper-target="instructions">説明</p><input type="range" aria-label="Y" data-image-cropper-target="yControl"><input type="range" aria-label="幅" data-image-cropper-target="widthControl"><input type="range" aria-label="高さ" data-image-cropper-target="heightControl"><input type="range" aria-label="倍率" data-image-cropper-target="zoomControl"></div>',
			);
			expect(warnings).toHaveLength(10);
			expect(missing.root.dataset.state).toBeUndefined();
		} finally {
			console.warn = originalWarn;
		}
	});

	test("[image-cropper-state-sync][image-cropper-snapshot-negative] Synchronizes initial values, seven custom properties, ranges, authored attributes, and object copies", async () => {
		const initial: ImageCropperValue = {
			x: 10,
			y: 15,
			width: 30,
			height: 40,
			zoom: 2,
			offsetX: -20,
			offsetY: -15,
		};
		const mounted = await mount({ value: initial, authoredRelations: true });
		expectValue(mounted.controller.value, initial);
		expectSourceRect(mounted.controller.sourceRect, { x: 0.15, y: 0.15, width: 0.15, height: 0.2 });
		expect(mounted.root.dataset.state).toBe("idle");
		expect(mounted.root.style.getPropertyValue("--image-cropper-x")).toBe("10");
		expect(mounted.root.style.getPropertyValue("--image-cropper-y")).toBe("15");
		expect(mounted.root.style.getPropertyValue("--image-cropper-width")).toBe("30");
		expect(mounted.root.style.getPropertyValue("--image-cropper-height")).toBe("40");
		expect(mounted.root.style.getPropertyValue("--image-cropper-zoom")).toBe("2");
		expect(mounted.root.style.getPropertyValue("--image-cropper-offset-x")).toBe("-20");
		expect(mounted.root.style.getPropertyValue("--image-cropper-offset-y")).toBe("-15");
		expect(mounted.xControl.min).toBe("0");
		expect(mounted.xControl.max).toBe("70");
		expect(mounted.yControl.max).toBe("60");
		expect(mounted.widthControl.min).toBe("1");
		expect(mounted.widthControl.max).toBe("90");
		expect(mounted.heightControl.max).toBe("85");
		expect(mounted.zoomControl.min).toBe("1");
		expect(mounted.zoomControl.max).toBe("5");
		for (const control of [
			mounted.xControl,
			mounted.yControl,
			mounted.widthControl,
			mounted.heightControl,
			mounted.zoomControl,
		]) {
			expect(control.step).toBe("any");
		}
		expect(mounted.selection.getAttribute("aria-controls")).toMatch(
			/^image-cropper-test-\d+-authored-selection$/,
		);
		expect(mounted.resize.getAttribute("aria-controls")).toMatch(
			/^image-cropper-test-\d+-authored-resize$/,
		);
		expect(mounted.xControl.getAttribute("aria-controls")).toMatch(
			/^image-cropper-test-\d+-authored-control$/,
		);
		expect(mounted.root.style.getPropertyValue("--authored")).toBe("keep");
		expect(mounted.root.style.getPropertyValue("position")).toBe("relative");
		expect(mounted.root.style.getPropertyValue("width")).toBe("");
		expect(mounted.root.style.getPropertyValue("transform")).toBe("");
		expect(mounted.root.textContent).toContain("位置は矢印");
		expect(mounted.root.querySelectorAll("img,button,input,p")).toHaveLength(9);
		expect(mounted.selection.dataset.state).toBeUndefined();

		const copy = mounted.controller.value;
		if (copy === null) throw new Error("copy が null です");
		copy.x = 90;
		expect(mounted.controller.value?.x).toBe(10);
	});

	test("[image-cropper-completion-warning][image-cropper-completion-negative] Completes only static attributes and never warns for complete markup", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			const incomplete = await mount({ complete: false });
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('root role="group"');
			expect(warnings[0]).toContain('selection type="button"');
			expect(warnings[0]).toContain('resize type="button"');
			expect(warnings[0]).toContain('image draggable="false"');
			expect(warnings[0]).toContain("aria-controls");
			expect(incomplete.root.getAttribute("role")).toBe("group");
			expect(incomplete.selection.type).toBe("button");
			expect(incomplete.image.draggable).toBe(false);
			expect(incomplete.selection.getAttribute("aria-describedby")).toContain("instructions");

			warnings.length = 0;
			await mount();
			expect(warnings).toEqual([]);
		} finally {
			console.warn = originalWarn;
		}
	});

	test("[image-cropper-geometry][image-cropper-bounds-negative][image-cropper-zoom-negative] Checks normalization, boundaries, centered zoom, and sourceRect", async () => {
		const mounted = await mount();
		const events = recordEvents(mounted.root);
		expectValue(mounted.controller.value, DEFAULT_VALUE);
		expectSourceRect(mounted.controller.sourceRect, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });

		mounted.controller.zoom = 2;
		expectValue(mounted.controller.value, {
			...DEFAULT_VALUE,
			zoom: 2,
			offsetX: -50,
			offsetY: -50,
		});
		expectSourceRect(mounted.controller.sourceRect, {
			x: 0.375,
			y: 0.375,
			width: 0.25,
			height: 0.25,
		});
		expect(events).toEqual([]);

		mounted.controller.value = {
			x: 35,
			y: 20,
			width: 50,
			height: 50,
			zoom: 2,
			offsetX: -50,
			offsetY: -50,
		};
		expectSourceRect(mounted.controller.sourceRect, {
			x: 0.425,
			y: 0.35,
			width: 0.25,
			height: 0.25,
		});

		mounted.controller.value = { ...DEFAULT_VALUE, x: 75, width: 25 };
		mounted.resize.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(mounted.controller.value?.x).toBe(75);
		expect(mounted.controller.value?.width).toBe(25);
		expect(mounted.widthControl.max).toBe("25");

		mounted.controller.value = { ...DEFAULT_VALUE, x: 10, y: 10, width: 100, height: 100 };
		expectValue(mounted.controller.value, {
			...DEFAULT_VALUE,
			x: 0,
			y: 0,
			width: 100,
			height: 100,
		});
		expect(mounted.xControl.min).toBe("0");
		expect(mounted.xControl.max).toBe("0");
		mounted.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(mounted.controller.value?.x).toBe(0);

		mounted.controller.value = { ...DEFAULT_VALUE, zoom: 3, offsetX: -100, offsetY: -100 };
		mounted.controller.zoom = 1;
		expect(mounted.controller.value?.offsetX).toBe(0);
		expect(mounted.controller.value?.offsetY).toBe(0);
		expectSourceRect(mounted.controller.sourceRect, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });

		const constrained = await mount({ attributes: 'data-image-cropper-min-width-value="80"' });
		expect(constrained.controller.value?.width).toBe(80);
		expect(constrained.controller.value?.x).toBe(20);
		expect(constrained.controller.value?.y).toBe(25);
		const beforeInvalid = constrained.controller.value;
		constrained.controller.value = { ...DEFAULT_VALUE, x: Number.NaN };
		expectValue(constrained.controller.value, beforeInvalid ?? DEFAULT_VALUE);
		expect(events).toEqual([]);
	});

	test("[image-cropper-direction][image-cropper-direction-negative] Checks LTR/RTL logical direction and native range defaults", async () => {
		const ltr = await mount({
			value: { x: 10, y: 20, width: 30, height: 40, zoom: 2, offsetX: -20, offsetY: -10 },
		});
		const rtl = await mount({
			attributes: 'dir="rtl"',
			value: { x: 10, y: 20, width: 30, height: 40, zoom: 2, offsetX: -20, offsetY: -10 },
		});
		expectSourceRect(ltr.controller.sourceRect, { x: 0.15, y: 0.15, width: 0.15, height: 0.2 });
		expectSourceRect(rtl.controller.sourceRect, { x: 0.7, y: 0.15, width: 0.15, height: 0.2 });

		ltr.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(ltr.controller.value?.x).toBe(11);
		rtl.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(rtl.controller.value?.x).toBe(9);

		rtl.xControl.focus();
		await userEvent.keyboard("{End}");
		expect(rtl.controller.value?.x).toBeCloseTo(rtl.xControl.valueAsNumber, 8);
	});

	test("[image-cropper-keyboard] Checks selection, resize, and zoom keyboard controls, modifiers, IME, Tab, and button activation", async () => {
		const mounted = await mount();
		const events = recordEvents(mounted.root);
		const escapePrevented: boolean[] = [];
		mounted.root.addEventListener("keydown", (event) => {
			if (event.key === "Escape") escapePrevented.push(event.defaultPrevented);
		});

		mounted.selection.focus();
		await userEvent.keyboard("{ArrowRight}{ArrowDown}");
		expect(mounted.controller.value?.x).toBe(26);
		expect(mounted.controller.value?.y).toBe(26);
		await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}{Shift>}{ArrowDown}{/Shift}");
		expect(mounted.controller.value?.x).toBe(26);
		expect(mounted.controller.value?.y).toBe(26);
		expect(mounted.controller.value?.width).toBe(51);
		expect(mounted.controller.value?.height).toBe(51);

		mounted.resize.focus();
		await userEvent.keyboard("{ArrowLeft}{ArrowUp}");
		expect(mounted.controller.value?.width).toBe(50);
		expect(mounted.controller.value?.height).toBe(50);
		await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
		expect(mounted.controller.value?.width).toBe(50);

		mounted.selection.focus();
		await userEvent.keyboard("=");
		expect(mounted.controller.value?.zoom).toBeCloseTo(1.1, 8);
		await userEvent.keyboard("-");
		expect(mounted.controller.value?.zoom).toBe(1);

		const unchanged = mounted.controller.value;
		await userEvent.keyboard(
			"{Control>}{ArrowRight}{/Control}{Alt>}{ArrowRight}{/Alt}{Meta>}{ArrowRight}{/Meta}",
		);
		expectValue(mounted.controller.value, unchanged ?? DEFAULT_VALUE);
		const imeEvent = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "ArrowRight",
			isComposing: true,
		});
		mounted.selection.dispatchEvent(imeEvent);
		expectValue(mounted.controller.value, unchanged ?? DEFAULT_VALUE);

		events.length = 0;
		await userEvent.keyboard("{Escape}");
		expect(escapePrevented).toEqual([false]);
		mounted.selection.focus();
		await userEvent.keyboard("{Enter}");
		expect(document.activeElement).toBe(mounted.xControl);
		mounted.selection.focus();
		await userEvent.keyboard(" ");
		expect(document.activeElement).toBe(mounted.xControl);
		mounted.selection.focus();
		await userEvent.tab();
		await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
		expect(document.activeElement).toBe(mounted.selection);
		expect(events).toEqual([]);

		const details = await mount({ details: true });
		if (details.details === null) throw new Error("details がありません");
		details.selection.focus();
		await userEvent.keyboard("{Enter}");
		expect(details.details.open).toBe(true);
		expect(document.activeElement).toBe(details.xControl);
		details.xControl.disabled = true;
		details.selection.focus();
		await userEvent.keyboard("{Space}");
		expect(document.activeElement).toBe(details.yControl);
	});

	test("[image-cropper-non-drag][image-cropper-native-range] Reaches every feature through track clicks and native keyboard interaction on five ranges", async () => {
		const fields: readonly Field[] = ["x", "y", "width", "height", "zoom"];
		for (const field of fields) {
			const mounted = await mount({
				value: { x: 5, y: 5, width: 10, height: 10, zoom: 1, offsetX: 0, offsetY: 0 },
			});
			const control = controlFor(mounted, field);
			const before = mounted.controller.value;
			const events = recordEvents(mounted.root);
			await userEvent.click(control);
			await settle();
			expect(mounted.controller.value?.[field]).not.toBe(before?.[field]);
			expect(mounted.root.dataset.state).toBe("idle");
			expect(events.map(({ type }) => type)).toEqual([
				"image-cropper:beforechange",
				"image-cropper:change",
			]);
			expect(events[0]?.detail.reason).toBe("pointer");
		}

		for (const field of fields) {
			const mounted = await mount({
				value: { x: 5, y: 5, width: 10, height: 10, zoom: 1, offsetX: 0, offsetY: 0 },
			});
			const control = controlFor(mounted, field);
			control.focus();
			await userEvent.keyboard("{End}");
			await settle();
			expect(mounted.controller.value?.[field]).toBeCloseTo(control.valueAsNumber, 8);
			expect(mounted.root.dataset.state).toBe("idle");
		}
	});

	test("[image-cropper-pointer][image-cropper-preview-negative][image-cropper-trusted-negative] Checks trusted direct-pointer preview, capture, commitment, boundaries, and blur cancellation", async () => {
		const moving = await mount();
		setViewportGeometry(moving.viewport);
		const movingStates: string[] = [];
		const movingEventCounts: number[] = [];
		let movingPointerdownValue: ImageCropperValue | null = null;
		const movingEvents = recordEvents(moving.root);
		let syntheticCaptureSent = false;
		moving.selection.addEventListener("pointermove", (event) => {
			if (syntheticCaptureSent || !(event instanceof PointerEvent)) return;
			syntheticCaptureSent = true;
			for (const pointerId of [event.pointerId, event.pointerId + 1]) {
				moving.selection.dispatchEvent(
					new PointerEvent("lostpointercapture", {
						bubbles: true,
						isPrimary: true,
						pointerId,
					}),
				);
			}
		});
		moving.selection.addEventListener("pointermove", () => {
			movingStates.push(moving.root.dataset.state ?? "");
			movingEventCounts.push(movingEvents.length);
		});
		moving.selection.addEventListener(
			"pointerdown",
			() => {
				movingPointerdownValue = moving.controller.value;
			},
			{ once: true },
		);
		await userEvent.dragAndDrop(moving.selection, appendDropTarget(220, 40));
		expectValue(movingPointerdownValue, DEFAULT_VALUE);
		await settle();
		expect(movingStates).toContain("moving");
		expect(movingEventCounts.every((count) => count === 0)).toBe(true);
		expect(moving.controller.value?.x).toBeGreaterThan(25);
		expect(moving.root.dataset.state).toBe("idle");
		expect(document.activeElement).not.toBe(moving.xControl);
		expect(movingEvents.map(({ type }) => type)).toEqual([
			"image-cropper:beforechange",
			"image-cropper:change",
		]);
		moving.selection.focus();
		await userEvent.keyboard("{Enter}");
		expect(document.activeElement).toBe(moving.xControl);

		const resizing = await mount();
		setViewportGeometry(resizing.viewport);
		const resizingEvents = recordEvents(resizing.root);
		const resizeRect = resizing.resize.getBoundingClientRect();
		await userEvent.dragAndDrop(
			resizing.resize,
			appendDropTarget(resizeRect.right + 100, resizeRect.bottom + 100),
		);
		expect(resizing.controller.value?.width).toBeGreaterThan(50);
		expect(resizingEvents.map(({ type }) => type)).toEqual([
			"image-cropper:beforechange",
			"image-cropper:change",
		]);

		const boundary = await mount({ value: { ...DEFAULT_VALUE, x: 0, y: 0 } });
		setViewportGeometry(boundary.viewport);
		const boundaryEvents = recordEvents(boundary.root);
		await userEvent.dragAndDrop(boundary.selection, appendDropTarget(0, 0));
		expectValue(boundary.controller.value, { ...DEFAULT_VALUE, x: 0, y: 0 });
		expect(boundaryEvents).toEqual([]);
		expect(boundary.root.dataset.state).toBe("idle");
		boundary.selection.focus();
		await userEvent.keyboard("{Enter}");
		expect(document.activeElement).toBe(boundary.xControl);

		const canceled = await mount();
		setViewportGeometry(canceled.viewport);
		const canceledEvents = recordEvents(canceled.root);
		canceled.selection.addEventListener(
			"pointerdown",
			() => {
				canceled.root.ownerDocument.defaultView?.dispatchEvent(new Event("blur"));
			},
			{ once: true },
		);
		await userEvent.dragAndDrop(canceled.selection, appendDropTarget(220, 40));
		expectValue(canceled.controller.value, DEFAULT_VALUE);
		expect(canceled.root.dataset.state).toBe("idle");
		expect(canceledEvents).toEqual([]);

		const captureCompleted = await mount();
		setViewportGeometry(captureCompleted.viewport);
		const captureEvents = recordEvents(captureCompleted.root);
		const releasePointerCapture = vi.spyOn(captureCompleted.selection, "releasePointerCapture");
		await userEvent.dragAndDrop(captureCompleted.selection, appendDropTarget(220, 40));
		expect(releasePointerCapture).toHaveBeenCalled();
		expect(captureCompleted.controller.value?.x).toBeGreaterThan(25);
		expect(captureCompleted.root.dataset.state).toBe("idle");
		expect(captureEvents.map(({ type }) => type)).toEqual([
			"image-cropper:beforechange",
			"image-cropper:change",
		]);
	});

	test("[image-cropper-events][image-cropper-cancel-negative] Checks beforechange/change order, cancellation, detail, bubbling, and unchanged values", async () => {
		const mounted = await mount();
		const events = recordEvents(mounted.root);
		let cancel = true;
		mounted.root.addEventListener("image-cropper:beforechange", (event) => {
			const detail = (event as CustomEvent<ImageCropperChangeDetail>).detail;
			if (!cancel) {
				detail.value.x = 99;
				detail.sourceRect.x = 99;
			}
			if (cancel) event.preventDefault();
		});

		mounted.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		expectValue(mounted.controller.value, DEFAULT_VALUE);
		expect(events.map(({ type }) => type)).toEqual(["image-cropper:beforechange"]);
		expect(events[0]?.target).toBe(mounted.root);
		expect(events[0]?.cancelable).toBe(true);
		expect(events[0]?.detail).toMatchObject({
			value: { ...DEFAULT_VALUE, x: 26 },
			previousValue: DEFAULT_VALUE,
			reason: "keyboard",
		});
		expectSourceRect(events[0]?.detail.sourceRect ?? null, {
			x: 0.26,
			y: 0.25,
			width: 0.5,
			height: 0.5,
		});

		cancel = false;
		mounted.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(mounted.controller.value?.x).toBe(26);
		expect(events.map(({ type }) => type)).toEqual([
			"image-cropper:beforechange",
			"image-cropper:beforechange",
			"image-cropper:change",
		]);
		expect(events[2]?.cancelable).toBe(false);
		expect(events[2]?.target).toBe(mounted.root);
		expect(events[2]?.detail.value.x).toBe(26);
		expect(events[2]?.detail.sourceRect.x).toBeCloseTo(0.26, 8);

		mounted.controller.value = { ...DEFAULT_VALUE, x: 0 };
		mounted.selection.focus();
		await userEvent.keyboard("{ArrowLeft}");
		expect(events).toHaveLength(3);
	});

	test("[image-cropper-native-range][image-cropper-trusted-negative] Checks native range pointer/keyboard origins, synthetic events, and interaction after boundaries", async () => {
		const pointer = await mount({ value: { ...DEFAULT_VALUE, x: 10 } });
		const pointerEvents = recordEvents(pointer.root);
		await userEvent.click(pointer.xControl);
		await settle();
		expect(pointerEvents).toHaveLength(2);
		expect(pointerEvents[0]?.detail.reason).toBe("pointer");
		expect(pointer.root.dataset.state).toBe("idle");

		const secondary = await mount();
		secondary.xControl.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				isPrimary: false,
				pointerId: 2,
			}),
		);
		expect(secondary.controller.value?.x).toBe(25);
		expect(secondary.root.dataset.state).toBe("idle");

		const synthetic = await mount({ value: { ...DEFAULT_VALUE, x: 20 } });
		const syntheticEvents = recordEvents(synthetic.root);
		synthetic.selection.focus();
		synthetic.selection.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		expect(document.activeElement).toBe(synthetic.selection);
		synthetic.xControl.value = "80";
		synthetic.xControl.dispatchEvent(new Event("input", { bubbles: true }));
		synthetic.xControl.dispatchEvent(new Event("change", { bubbles: true }));
		expect(synthetic.controller.value?.x).toBe(20);
		expect(synthetic.xControl.valueAsNumber).toBe(20);
		expect(syntheticEvents).toEqual([]);

		const keyboard = await mount({ value: { ...DEFAULT_VALUE, x: 10 } });
		const keyboardEvents = recordEvents(keyboard.root);
		keyboard.xControl.focus();
		await userEvent.keyboard("{End}");
		expect(keyboardEvents[0]?.detail.reason).toBe("keyboard");
		expect(keyboard.controller.value?.x).toBeCloseTo(keyboard.xControl.valueAsNumber, 8);

		const boundary = await mount({ value: { ...DEFAULT_VALUE, x: 0 } });
		const boundaryEvents = recordEvents(boundary.root);
		boundary.xControl.focus();
		await userEvent.keyboard("{Home}");
		expect(boundary.root.dataset.state).toBe("idle");
		expect(boundaryEvents).toEqual([]);
		await userEvent.keyboard("{ArrowRight}");
		expect(boundaryEvents[1]?.detail.previousValue.x).toBe(0);
		expect(boundary.controller.value?.x).toBeGreaterThan(0);
	});

	test("[image-cropper-disabled][image-cropper-disabled-negative] Checks disabled controls, fieldsets, direct interaction, and disabling mid-interaction", async () => {
		const axes = await mount({ value: { ...DEFAULT_VALUE, x: 10, y: 10 }, disabled: ["xControl"] });
		axes.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(axes.controller.value?.x).toBe(10);
		await userEvent.keyboard("{ArrowDown}");
		expect(axes.controller.value?.y).toBe(11);

		const dragged = await mount({
			value: { ...DEFAULT_VALUE, x: 10, y: 10 },
			disabled: ["xControl"],
		});
		setViewportGeometry(dragged.viewport);
		const draggedRect = dragged.selection.getBoundingClientRect();
		await userEvent.dragAndDrop(
			dragged.selection,
			appendDropTarget(draggedRect.right + 100, draggedRect.bottom),
		);
		expect(dragged.controller.value?.x).toBe(10);

		const disabledClick = await mount();
		const disabledEvents = recordEvents(disabledClick.root);
		disabledClick.selection.addEventListener(
			"click",
			() => {
				disabledClick.selection.disabled = true;
			},
			{ capture: true, once: true },
		);
		await userEvent.click(disabledClick.selection);
		expect(disabledClick.controller.value?.x).toBe(25);
		expect(disabledClick.controller.value?.y).toBe(25);
		expect(disabledEvents).toEqual([]);

		const fieldset = await mount();
		const disabledFieldset = document.createElement("fieldset");
		disabledFieldset.disabled = true;
		for (const control of [
			fieldset.xControl,
			fieldset.yControl,
			fieldset.widthControl,
			fieldset.heightControl,
			fieldset.zoomControl,
		]) {
			disabledFieldset.append(control);
		}
		fieldset.root.append(disabledFieldset);
		await settle();
		expect(fieldset.xControl.matches(":disabled")).toBe(true);
		fieldset.controller.value = { ...DEFAULT_VALUE, x: 70 };
		expect(fieldset.controller.value?.x).toBe(50);

		const interrupted = await mount();
		setViewportGeometry(interrupted.viewport);
		interrupted.selection.addEventListener(
			"pointerdown",
			() => {
				interrupted.xControl.disabled = true;
			},
			{ once: true },
		);
		await userEvent.dragAndDrop(interrupted.selection, appendDropTarget(220, 40));
		expectValue(interrupted.controller.value, DEFAULT_VALUE);
	});

	test("[image-cropper-interruption][image-cropper-stale-negative] Checks reentrant changes, target/configuration changes, reset races, and cancellation", async () => {
		const latestTarget = await mount();
		const latestTargetEvents = recordEvents(latestTarget.root);
		latestTarget.xControl.removeAttribute("data-image-cropper-target");
		latestTarget.controller.value = { ...DEFAULT_VALUE, x: 40 };
		expectValue(latestTarget.controller.value, DEFAULT_VALUE);
		expect(latestTargetEvents).toEqual([]);

		const latestClick = await mount();
		const latestClickEvents = recordEvents(latestClick.root);
		latestClick.selection.removeAttribute("data-image-cropper-target");
		await userEvent.click(latestClick.selection);
		expect(document.activeElement).not.toBe(latestClick.xControl);
		expect(latestClickEvents).toEqual([]);

		const latestConfiguration = await mount();
		latestConfiguration.root.setAttribute("data-image-cropper-step-value", "0");
		latestConfiguration.controller.value = { ...DEFAULT_VALUE, x: 40 };
		expectValue(latestConfiguration.controller.value, DEFAULT_VALUE);
		latestConfiguration.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		expectValue(latestConfiguration.controller.value, DEFAULT_VALUE);
		expect(document.activeElement).toBe(latestConfiguration.selection);

		const latestValueOperation = await mount();
		latestValueOperation.root.setAttribute(
			"data-image-cropper-value-value",
			JSON.stringify({
				x: 40,
				y: DEFAULT_VALUE.y,
				width: DEFAULT_VALUE.width,
				height: DEFAULT_VALUE.height,
				zoom: DEFAULT_VALUE.zoom,
				offsetX: DEFAULT_VALUE.offsetX,
			}),
		);
		latestValueOperation.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		expectValue(latestValueOperation.controller.value, DEFAULT_VALUE);
		expect(document.activeElement).toBe(latestValueOperation.selection);

		const latestValue = await mount();
		latestValue.root.setAttribute(
			"data-image-cropper-value-value",
			JSON.stringify({ x: 40, y: 20, width: 50, height: 50, zoom: 1, offsetX: 0 }),
		);
		latestValue.controller.zoom = 2;
		expectValue(latestValue.controller.value, DEFAULT_VALUE);

		const geometryChanged = await mount();
		const updateGeometry = setViewportGeometry(geometryChanged.viewport);
		geometryChanged.selection.addEventListener(
			"pointerdown",
			() => updateGeometry({ left: 0, top: 0, width: 50, height: 100 }),
			{ once: true },
		);
		await userEvent.dragAndDrop(geometryChanged.selection, appendDropTarget(220, 40));
		expectValue(geometryChanged.controller.value, DEFAULT_VALUE);

		const directionChanged = await mount();
		setViewportGeometry(directionChanged.viewport);
		directionChanged.selection.addEventListener(
			"pointerdown",
			() => directionChanged.viewport.setAttribute("dir", "rtl"),
			{ once: true },
		);
		await userEvent.dragAndDrop(directionChanged.selection, appendDropTarget(220, 40));
		expectValue(directionChanged.controller.value, DEFAULT_VALUE);

		const competingRange = await mount();
		setViewportGeometry(competingRange.viewport);
		const competingMismatches: boolean[] = [];
		competingRange.xControl.addEventListener("input", () => {
			competingMismatches.push(
				competingRange.controller.value?.x !== competingRange.xControl.valueAsNumber,
			);
		});
		let competingClick: Promise<void> | null = null;
		competingRange.selection.addEventListener(
			"pointerdown",
			() => {
				competingClick = userEvent.click(competingRange.xControl, {
					force: true,
					position: { x: 0, y: 0 },
				});
			},
			{ once: true },
		);
		await userEvent.dragAndDrop(competingRange.selection, appendDropTarget(220, 40));
		if (competingClick !== null) await Promise.resolve(competingClick);
		await settle();
		expect(competingMismatches.every((mismatch) => !mismatch)).toBe(true);
		expect(competingRange.root.dataset.state).toBe("idle");
		expect(competingRange.controller.value?.x).toBe(competingRange.xControl.valueAsNumber);

		const reentrant = await mount();
		const reentrantEvents = recordEvents(reentrant.root);
		let reentrantOnce = true;
		reentrant.root.addEventListener("image-cropper:beforechange", () => {
			if (!reentrantOnce) return;
			reentrantOnce = false;
			reentrant.controller.value = { ...DEFAULT_VALUE, x: 70 };
		});
		reentrant.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(reentrant.controller.value?.x).toBe(50);
		expect(reentrantEvents.map(({ type }) => type)).toEqual(["image-cropper:beforechange"]);

		const disconnected = await mount();
		const disconnectedEvents = recordEvents(disconnected.root);
		disconnected.root.addEventListener(
			"image-cropper:beforechange",
			() => disconnected.controller.disconnect(),
			{ once: true },
		);
		disconnected.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		expectValue(disconnected.controller.value, DEFAULT_VALUE);
		expect(disconnectedEvents.map(({ type }) => type)).toEqual(["image-cropper:beforechange"]);
		disconnected.controller.connect();
		await settle();

		const exchanged = await mount();
		const exchangedEvents = recordEvents(exchanged.root);
		let exchangedOnce = true;
		exchanged.root.addEventListener("image-cropper:beforechange", () => {
			if (!exchangedOnce) return;
			exchangedOnce = false;
			const replacement = document.createElement("input");
			replacement.id = "replacement-x";
			replacement.type = "range";
			replacement.setAttribute("aria-label", "位置 X（%）");
			replacement.setAttribute("aria-controls", exchanged.viewport.id);
			replacement.setAttribute("data-image-cropper-target", "xControl");
			exchanged.xControl.replaceWith(replacement);
		});
		exchanged.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		await settle();
		expect(exchanged.controller.value?.x).toBe(25);
		expect(exchangedEvents.map(({ type }) => type)).toEqual(["image-cropper:beforechange"]);
		expect(
			required<HTMLInputElement>(exchanged.root, '[data-image-cropper-target="xControl"]')
				.valueAsNumber,
		).toBe(25);

		exchanged.root.setAttribute("data-image-cropper-min-width-value", "80");
		await settle();
		expect(exchanged.controller.value?.width).toBe(80);
		expect(exchanged.controller.value?.x).toBe(20);

		const staleRange = await mount();
		const staleRangeEvents = recordEvents(staleRange.root);
		let staleRangeOnce = true;
		staleRange.xControl.addEventListener("input", () => {
			if (!staleRangeOnce) return;
			staleRangeOnce = false;
			staleRange.controller.value = { ...DEFAULT_VALUE, x: 40 };
		});
		staleRange.xControl.focus();
		await userEvent.keyboard("{End}");
		await settle();
		expect(staleRange.controller.value?.x).toBe(40);
		expect(staleRange.xControl.valueAsNumber).toBe(40);
		expect(staleRange.root.dataset.state).toBe("idle");
		expect(staleRangeEvents).toEqual([]);
		await userEvent.keyboard("{Home}");
		expect(staleRange.controller.value?.x).toBe(0);
		expect(staleRangeEvents.map(({ type }) => type)).toEqual([
			"image-cropper:beforechange",
			"image-cropper:change",
		]);

		const form = await mount({ form: true, value: { ...DEFAULT_VALUE, x: 20 } });
		if (form.form === null) throw new Error("form がありません");
		form.controller.value = { ...DEFAULT_VALUE, x: 40 };
		form.form.addEventListener("reset", (event) => event.preventDefault(), { once: true });
		form.form.reset();
		await settle();
		expect(form.controller.value?.x).toBe(40);
		form.form.addEventListener(
			"reset",
			() => {
				form.controller.value = { ...DEFAULT_VALUE, x: 40 };
			},
			{ once: true },
		);
		form.form.reset();
		await settle();
		expect(form.controller.value?.x).toBe(40);

		const earlyReset = await mount({ form: true });
		if (earlyReset.form === null) throw new Error("early reset の form がありません");
		earlyReset.controller.disconnect();
		earlyReset.form.addEventListener(
			"reset",
			() => {
				earlyReset.controller.value = { ...DEFAULT_VALUE, x: 40 };
			},
			{ capture: true, once: true },
		);
		earlyReset.controller.connect();
		earlyReset.form.reset();
		await settle();
		expect(earlyReset.controller.value?.x).toBe(40);
	});

	test("[image-cropper-interruption] Restores completed attributes lost after connection immediately before setters or activation", async () => {
		const mounted = await mount();
		const controls = [
			mounted.xControl,
			mounted.yControl,
			mounted.widthControl,
			mounted.heightControl,
			mounted.zoomControl,
		];
		mounted.root.removeAttribute("role");
		mounted.image.removeAttribute("draggable");
		for (const button of [mounted.selection, mounted.resize]) {
			button.removeAttribute("type");
			button.removeAttribute("aria-controls");
			button.removeAttribute("aria-describedby");
		}
		for (const element of [mounted.viewport, mounted.instructions, ...controls])
			element.removeAttribute("id");
		for (const control of controls) control.removeAttribute("aria-controls");
		mounted.controller.value = { ...DEFAULT_VALUE, x: 30 };
		expect(mounted.root.getAttribute("role")).toBe("group");
		expect(mounted.image.getAttribute("draggable")).toBe("false");
		for (const element of [mounted.viewport, mounted.instructions, ...controls])
			expect(element.id).not.toBe("");
		for (const button of [mounted.selection, mounted.resize]) {
			expect(button.type).toBe("button");
			expect(button.getAttribute("aria-describedby")).toContain(mounted.instructions.id);
		}
		expect(mounted.selection.getAttribute("aria-controls")).toBe(
			`${mounted.xControl.id} ${mounted.yControl.id}`,
		);
		for (const control of controls)
			expect(control.getAttribute("aria-controls")).toBe(mounted.viewport.id);
		mounted.selection.removeAttribute("type");
		await userEvent.click(mounted.selection);
		expect(mounted.selection.type).toBe("button");
		expect(document.activeElement).toBe(mounted.xControl);
	});

	test("[image-cropper-interruption][image-cropper-reset-negative] Tracks every range form-owner change across resets of old and new forms", async () => {
		const mounted = await mount({ form: true });
		if (mounted.form === null) throw new Error("form がありません");
		const next = document.createElement("form");
		next.id = `${mounted.root.id}-next-form`;
		document.body.append(next);
		for (const control of [
			mounted.xControl,
			mounted.yControl,
			mounted.widthControl,
			mounted.heightControl,
			mounted.zoomControl,
		])
			control.setAttribute("form", next.id);
		mounted.controller.value = { ...DEFAULT_VALUE, x: 40 };
		mounted.form.reset();
		await settle();
		expect(mounted.controller.value?.x).toBe(40);
		// Wait for committed reset values even if the timer task runs after the next frame.
		const nativeSetTimeout = window.setTimeout.bind(window);
		vi.spyOn(window, "setTimeout").mockImplementation((handler, timeout, ...args) =>
			nativeSetTimeout(handler, timeout === 0 ? 50 : timeout, ...args),
		);
		next.reset();
		await expect.poll(() => mounted.controller.value).toEqual(DEFAULT_VALUE);
		mounted.controller.value = { ...DEFAULT_VALUE, x: 35 };
		for (const control of [
			mounted.xControl,
			mounted.yControl,
			mounted.widthControl,
			mounted.heightControl,
			mounted.zoomControl,
		])
			control.removeAttribute("form");
		// Reset revalidates form-owner changes that do not pass through the setter.
		mounted.form.reset();
		await expect.poll(() => mounted.controller.value).toEqual(DEFAULT_VALUE);
	});

	test.each(["Escape", "capture喪失", "元位置"] as const)(
		"[image-cropper-pointer] Restores values and focus for real-pointer %s",
		async (ending) => {
			const mounted = await mount();
			const events = recordEvents(mounted.root);
			let pointerId = 0;
			mounted.selection.addEventListener("pointerdown", (event) => {
				pointerId = event.pointerId;
			});
			await pointer(mounted, "down");
			await pointer(mounted, "move", 60, 55);
			expect(mounted.root.dataset.state).toBe("moving");
			expect(mounted.controller.value?.x).toBeGreaterThan(25);
			if (ending === "Escape") await userEvent.keyboard("{Escape}");
			if (ending === "capture喪失") {
				mounted.selection.releasePointerCapture(pointerId);
				await pointer(mounted, "move", 61, 55);
				expect(mounted.root.dataset.state).toBe("idle");
			}
			await pointer(mounted, "up");
			expectValue(mounted.controller.value, DEFAULT_VALUE);
			expect(events).toEqual([]);
			expect(mounted.root.dataset.state).toBe("idle");
			if (ending === "元位置") expect(document.activeElement).not.toBe(mounted.xControl);
		},
	);

	test.each(["寸法ゼロ", "capture失敗"] as const)(
		"[image-cropper-pointer] Does not carry click suppression into the next %s pointerdown",
		async (failure) => {
			const mounted = await mount();
			await pointer(mounted, "down");
			await pointer(mounted, "move", 60, 55);
			mounted.root.addEventListener("click", (event) => event.stopImmediatePropagation(), {
				capture: true,
				once: true,
			});
			await pointer(mounted, "up", 60, 55);
			if (failure === "寸法ゼロ")
				setViewportGeometry(mounted.viewport, { left: 0, top: 0, width: 0, height: 0 });
			else
				vi.spyOn(mounted.selection, "setPointerCapture").mockImplementation(() => {
					throw new Error("capture unavailable");
				});
			await userEvent.click(mounted.selection);
			expect(document.activeElement).toBe(mounted.xControl);
		},
	);

	test.each(["selection", "xControl"] as const)(
		"[image-cropper-pointer][image-cropper-trusted-negative] Rejects trusted secondary pointers during %s",
		async (target) => {
			const mounted = await mount();
			const states: string[] = [];
			mounted[target].addEventListener(
				"pointerdown",
				(event) => {
					expect(event.isTrusted).toBe(true);
					// Preserve trust and change only the primary flag under test during capture.
					Object.defineProperty(event, "isPrimary", { value: false });
				},
				{ capture: true, once: true },
			);
			mounted[target].addEventListener(
				"pointerdown",
				() => states.push(mounted.root.dataset.state ?? ""),
				{ once: true },
			);
			await userEvent.click(mounted[target]);
			expect(states).toEqual(["idle"]);
		},
	);

	test.each(["pointermove", "pointerup", "pointercancel", "lostpointercapture"] as const)(
		"[image-cropper-pointer][image-cropper-trusted-negative] Does not mix synthetic %s into active drags",
		async (type) => {
			const mounted = await mount();
			const events = recordEvents(mounted.root);
			let pointerId = 0;
			mounted.selection.addEventListener("pointerdown", (event) => {
				pointerId = event.pointerId;
			});
			await pointer(mounted, "down");
			await pointer(mounted, "move", 55, 50);
			const before = mounted.controller.value;
			mounted.selection.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					isPrimary: true,
					pointerId,
					clientX: 500,
					clientY: 500,
				}),
			);
			expect(mounted.controller.value).toEqual(before);
			expect(mounted.root.dataset.state).toBe("moving");
			expect(events).toEqual([]);
			await userEvent.keyboard("{Escape}");
			await pointer(mounted, "up");
		},
	);

	test.each(["pointermove", "pointerup", "lostpointercapture"] as const)(
		"[image-cropper-pointer][image-cropper-trusted-negative] Rejects trusted %s from a different pointerId",
		async (type) => {
			const mounted = await mount();
			let pointerId = 0;
			mounted.selection.addEventListener("pointerdown", (event) => {
				pointerId = event.pointerId;
			});
			await pointer(mounted, "down");
			await pointer(mounted, "move", 55, 50);
			const before = mounted.controller.value;
			const seen: boolean[] = [];
			const observed: { value: ImageCropperValue | null; state: string | undefined }[] = [];
			mounted.selection.addEventListener(
				type,
				() => {
					observed.push({ value: mounted.controller.value, state: mounted.root.dataset.state });
				},
				{ once: true },
			);
			mounted.selection.addEventListener(
				type,
				(event) => {
					seen.push(event.isTrusted);
					Object.defineProperty(event, "pointerId", { value: pointerId + 1 });
				},
				{ capture: true, once: true },
			);
			if (type === "lostpointercapture") mounted.selection.releasePointerCapture(pointerId);
			if (type === "pointermove") await pointer(mounted, "move", 60, 55);
			else if (type === "pointerup") await pointer(mounted, "up", 55, 50);
			else {
				// Observe lostpointercapture before the next move detects missing capture.
				mounted.selection.addEventListener(
					"pointermove",
					(event) => event.stopImmediatePropagation(),
					{ capture: true, once: true },
				);
				await pointer(mounted, "move", 56, 50);
			}
			expect(seen).toEqual([true]);
			expect(observed).toEqual([{ value: before, state: "moving" }]);
			await userEvent.keyboard("{Escape}");
			await pointer(mounted, "up");
		},
	);

	// WebKit does not deliver pointercancel for this native drag; see browser-engine-differences.md.
	test.runIf(server.browser !== "webkit")(
		"[image-cropper-pointer] Discards previews on trusted pointercancel caused by native dragging",
		async () => {
			const mounted = await mount();
			const events = recordEvents(mounted.root);
			const cancellations: boolean[] = [];
			mounted.selection.draggable = true;
			mounted.selection.addEventListener("dragstart", (event) =>
				event.dataTransfer?.setData("text/plain", "crop"),
			);
			mounted.selection.addEventListener("pointercancel", (event) =>
				cancellations.push(event.isTrusted),
			);
			await pointer(mounted, "down");
			await pointer(mounted, "move", 60, 55);
			await pointer(mounted, "move", 65, 60);
			await pointer(mounted, "up", 65, 60);
			expect(cancellations).toEqual([true]);
			expectValue(mounted.controller.value, DEFAULT_VALUE);
			expect(mounted.root.dataset.state).toBe("idle");
			expect(events).toEqual([]);
		},
	);

	test("[image-cropper-interruption][image-cropper-stale-negative] Discards stale native input before physical interaction completes", async () => {
		const mounted = await mount();
		const events = recordEvents(mounted.root);
		mounted.xControl.addEventListener(
			"input",
			() => {
				mounted.controller.value = { ...DEFAULT_VALUE, x: 40 };
			},
			{ once: true },
		);
		const selector = `#${mounted.xControl.id}`;
		await pointerCommands.cropperPointer(selector, "down", 30, 5);
		await pointerCommands.cropperPointer(selector, "move", 50, 5);
		expect(mounted.controller.value?.x).toBe(40);
		expect(events).toEqual([]);
		await pointerCommands.cropperPointer(selector, "up", 50, 5);
	});

	test("[image-cropper-native-range] Commits originless trusted native adjustments with keyboard reason", async () => {
		const mounted = await mount();
		const events = recordEvents(mounted.root);
		const inputEventCounts: number[] = [];
		mounted.xControl.addEventListener("input", () => inputEventCounts.push(events.length));
		mounted.xControl.addEventListener("keydown", (event) => event.stopPropagation());
		mounted.xControl.focus();
		await userEvent.keyboard("{End}");
		expect(mounted.controller.value?.x).toBe(50);
		expect(inputEventCounts).toEqual([2]);
		expect(events.map(({ detail }) => detail.reason)).toEqual(["keyboard", "keyboard"]);
	});

	test("[image-cropper-interruption][image-cropper-stale-negative] Native change does not overwrite values committed by input listeners", async () => {
		const mounted = await mount();
		const events = recordEvents(mounted.root);
		mounted.xControl.addEventListener(
			"input",
			() => {
				const pendingValue = mounted.xControl.value;
				mounted.controller.value = { ...DEFAULT_VALUE, x: 40 };
				// Check a subsequent trusted change carrying the value of an invalidated interaction.
				mounted.xControl.value = pendingValue;
			},
			{ once: true },
		);
		mounted.xControl.focus();
		await userEvent.keyboard("{End}");
		expect(mounted.controller.value?.x).toBe(40);
		expect(events).toEqual([]);
	});

	test("[image-cropper-lifecycle][image-cropper-cleanup-negative] Checks direct disconnect and reconnection with the DOM retained", async () => {
		const mounted = await mount();
		const events = recordEvents(mounted.root);
		const removeRootListener = vi.spyOn(mounted.root, "removeEventListener");
		mounted.controller.disconnect();
		expect(removeRootListener.mock.calls.some(([type]) => type === "click")).toBe(true);
		mounted.xControl.value = "90";
		mounted.xControl.dispatchEvent(new Event("input", { bubbles: true }));
		mounted.xControl.dispatchEvent(new Event("change", { bubbles: true }));
		expect(events).toEqual([]);
		mounted.controller.connect();
		await settle();
		expect(mounted.xControl.valueAsNumber).toBe(25);
		mounted.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(events.map(({ type }) => type)).toEqual([
			"image-cropper:beforechange",
			"image-cropper:change",
		]);
	});

	test("[image-cropper-lifecycle][image-cropper-cleanup-negative] Releases actual pointer capture on disconnect", async () => {
		const active = await mount();
		setViewportGeometry(active.viewport);
		const releasePointerCapture = vi.spyOn(active.selection, "releasePointerCapture");
		let captureAfterDisconnect: boolean | null = null;
		active.selection.addEventListener(
			"pointerdown",
			(event) => {
				if (event instanceof PointerEvent) {
					active.selection.setPointerCapture(event.pointerId);
					active.controller.disconnect();
					captureAfterDisconnect = active.selection.hasPointerCapture(event.pointerId);
				}
			},
			{ once: true },
		);
		await userEvent.dragAndDrop(active.selection, appendDropTarget(220, 40));
		expect(releasePointerCapture).toHaveBeenCalled();
		expect(captureAfterDisconnect).toBe(false);
		expect(active.root.dataset.state).toBe("idle");
	});

	test("[image-cropper-lifecycle] Keeps nested instances of the same type isolated", async () => {
		const outer = await mount();
		const inner = await mount();
		outer.root.append(inner.root);
		const outerEvents = recordEvents(outer.root);
		inner.selection.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(inner.controller.value?.x).toBe(26);
		expect(outer.controller.value?.x).toBe(25);
		expect(outerEvents[1]?.target).toBe(inner.root);
	});

	test("[image-cropper-public-api][image-cropper-programmatic-negative] Checks value, zoom, sourceRect, event-free setters, and image target replacement", async () => {
		const mounted = await mount();
		const events = recordEvents(mounted.root);
		const valueCopy = mounted.controller.value;
		const sourceCopy = mounted.controller.sourceRect;
		if (valueCopy === null || sourceCopy === null) throw new Error("公開 getter が null です");
		valueCopy.x = 99;
		sourceCopy.x = 99;
		expect(mounted.controller.value?.x).toBe(25);
		expect(mounted.controller.sourceRect?.x).toBe(0.25);

		mounted.controller.zoom = 2;
		expect(mounted.controller.zoom).toBe(2);
		expect(events).toEqual([]);
		mounted.controller.zoom = Number.NaN;
		expect(mounted.controller.zoom).toBe(2);
		mounted.controller.value = { ...DEFAULT_VALUE, x: Number.NaN };
		expect(mounted.controller.value?.x).toBe(25);
		expect(events).toEqual([]);

		const oldImage = mounted.image;
		const replacement = document.createElement("img");
		replacement.src = oldImage.src;
		replacement.alt = "交換後の画像";
		replacement.draggable = false;
		replacement.setAttribute("data-image-cropper-target", "image");
		oldImage.replaceWith(replacement);
		await settle();
		expect(mounted.controller.zoom).toBe(2);
		expect(mounted.controller.value?.x).toBe(25);

		mounted.controller.disconnect();
		mounted.controller.zoom = 3;
		expect(mounted.controller.zoom).toBe(2);
	});
});
