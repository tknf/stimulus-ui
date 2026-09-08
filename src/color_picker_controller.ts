import { Controller } from "@hotwired/stimulus";
import { ensureElementId } from "./internal/ensure_element_id";
import { createFormResetTasks } from "./internal/form_reset_tasks";
import { isImeKeydown } from "./internal/ime";

/** HSVA color in the selected RGB color space. All numeric components must be finite. */
export type ColorPickerValue = {
	/** RGB color space used to interpret HSV and generate the CSS color; P3 is not reduced to sRGB. */
	colorSpace: "srgb" | "display-p3";
	/** Hue in degrees, clamped to 0..360. */
	hue: number;
	/** HSV saturation in percent, clamped to 0..100 (not the 0..1 CSS output scale). */
	saturation: number;
	/** HSV brightness in percent, clamped to 0..100 (not the 0..1 CSS output scale). */
	brightness: number;
	/** Opacity fraction, clamped to 0..1. */
	alpha: number;
};

type Channel = "hue" | "saturation" | "brightness" | "alpha";
type Reason = "pointer" | "keyboard";
type Source = Channel | "area" | "wheel";
export type ColorPickerChangeDetail = {
	value: ColorPickerValue;
	previousValue: ColorPickerValue;
	color: string;
	reason: Reason;
	source: Source;
};

type Markup = {
	area: HTMLButtonElement | null;
	wheel: HTMLButtonElement | null;
	instructions: HTMLElement | null;
	controls: Record<Channel, HTMLInputElement>;
};
type Geometry = { left: number; top: number; width: number; height: number; rtl: boolean };
type DirectInteraction = {
	kind: "direct";
	source: "area" | "wheel";
	handle: HTMLButtonElement;
	pointerId: number;
	geometry: Geometry;
	disabled: string;
};
type RangeInteraction = {
	kind: "range";
	input: HTMLInputElement;
	source: Channel;
	reason: Reason;
	pointerId: number | null;
	active: boolean;
	disabled: string;
};
type Interaction = DirectInteraction | RangeInteraction;
type StaleRange = { pointerId: number | null; timer: ReturnType<typeof setTimeout> | null };

const CHANNELS = ["hue", "saturation", "brightness", "alpha"] as const;
const MAXIMUM = { hue: 360, saturation: 100, brightness: 100, alpha: 1 } as const;
const DEFAULT_VALUE = {
	colorSpace: "srgb",
	hue: 0,
	saturation: 100,
	brightness: 100,
	alpha: 1,
} satisfies ColorPickerValue;
const CONFIGURATION_ATTRIBUTES = [
	"data-color-picker-value-value",
	"data-color-picker-step-value",
	"data-color-picker-hue-step-value",
];
const RANGE_KEYS = [
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"ArrowDown",
	"Home",
	"End",
	"PageUp",
	"PageDown",
];
const isColorValue = (value: unknown): value is ColorPickerValue => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const colorSpace: unknown = Reflect.get(value, "colorSpace");
	return (
		(colorSpace === "srgb" || colorSpace === "display-p3") &&
		CHANNELS.every((channel) => {
			const number: unknown = Reflect.get(value, channel);
			return typeof number === "number" && Number.isFinite(number);
		})
	);
};
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
const isRangeBound = (value: string, expected: number) =>
	/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number(value) === expected;
const normalize = (value: ColorPickerValue): ColorPickerValue => ({
	colorSpace: value.colorSpace,
	hue: clamp(value.hue, 360),
	saturation: clamp(value.saturation, 100),
	brightness: clamp(value.brightness, 100),
	alpha: clamp(value.alpha, 1),
});
const sameValue = (left: ColorPickerValue, right: ColorPickerValue) =>
	left.colorSpace === right.colorSpace &&
	CHANNELS.every((channel) => left[channel] === right[channel]);
const cssColor = (value: ColorPickerValue) => {
	const h = (value.hue % 360) / 60;
	const s = value.saturation / 100;
	const v = value.brightness / 100;
	const rgb = (offset: number) => {
		const k = (offset + h) % 6;
		return clamp(v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))), 1);
	};
	return `color(${value.colorSpace} ${rgb(5)} ${rgb(3)} ${rgb(1)} / ${value.alpha})`;
};

/**
 * Edits sRGB or Display-P3 HSVA colors through native ranges and optional area and wheel controls.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/color-picker.contract.json
 */
export default class ColorPickerController extends Controller<HTMLElement> {
	static targets = [
		"area",
		"wheel",
		"hueControl",
		"saturationControl",
		"brightnessControl",
		"alphaControl",
		"instructions",
	];
	static values = {
		value: { type: Object, default: DEFAULT_VALUE },
		step: { type: Number, default: 1 },
		hueStep: { type: Number, default: 1 },
	};
	declare readonly areaTargets: HTMLElement[];
	declare readonly wheelTargets: HTMLElement[];
	declare readonly hueControlTargets: HTMLElement[];
	declare readonly saturationControlTargets: HTMLElement[];
	declare readonly brightnessControlTargets: HTMLElement[];
	declare readonly alphaControlTargets: HTMLElement[];
	declare readonly instructionsTargets: HTMLElement[];
	declare readonly valueValue: unknown;
	declare readonly stepValue: number;
	declare readonly hueStepValue: number;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private reconcileQueued = false;
	private committedValue: ColorPickerValue | null = null;
	private initialValue: ColorPickerValue | null = null;
	private previewValue: ColorPickerValue | null = null;
	private lastValueAttribute: string | null = null;
	private boundMarkup: Markup | null = null;
	private boundConfiguration = "";
	private boundForm: HTMLFormElement | null = null;
	private boundDocument: Document | null = null;
	private boundWindow: Window | null = null;
	private interaction: Interaction | null = null;
	private revision = 0;
	private requesting = false;
	private observer: MutationObserver | null = null;
	private resetTasks = createFormResetTasks();
	private staleRanges = new Map<HTMLInputElement, StaleRange>();
	private descriptions = new WeakMap<HTMLButtonElement, string>();
	private relations = new WeakMap<HTMLButtonElement, string>();

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		// Stimulus parses Object values before a Changed callback can validate invalid JSON.
		// Observe attribute changes and catch parsing errors when reading through values.
		this.observer = new MutationObserver((records) => {
			if (
				records.some(
					(record) =>
						record.target === this.element ||
						(record.target instanceof HTMLElement &&
							this.boundMarkup !== null &&
							[
								...Object.values(this.boundMarkup.controls),
								this.boundMarkup.area,
								this.boundMarkup.wheel,
							].some(
								(target) =>
									target !== null &&
									record.target instanceof HTMLElement &&
									record.target.contains(target),
							)),
				)
			) {
				this.scheduleReconcile();
			}
		});
		this.observer.observe(this.element, {
			attributes: true,
			subtree: true,
			attributeFilter: [...CONFIGURATION_ATTRIBUTES, "dir", "disabled"],
		});
		this.reconcile();
	};
	disconnect = () => {
		this.cancelInteraction();
		this.connected = false;
		this.unbind();
		this.observer?.disconnect();
		this.observer = null;
		this.enhanced = false;
		this.reconcileQueued = false;
		for (const input of this.staleRanges.keys()) {
			this.clearStale(input);
		}
	};
	areaTargetConnected = () => this.scheduleReconcile();
	areaTargetDisconnected = () => this.scheduleReconcile();
	wheelTargetConnected = () => this.scheduleReconcile();
	wheelTargetDisconnected = () => this.scheduleReconcile();
	hueControlTargetConnected = () => this.scheduleReconcile();
	hueControlTargetDisconnected = () => this.scheduleReconcile();
	saturationControlTargetConnected = () => this.scheduleReconcile();
	saturationControlTargetDisconnected = () => this.scheduleReconcile();
	brightnessControlTargetConnected = () => this.scheduleReconcile();
	brightnessControlTargetDisconnected = () => this.scheduleReconcile();
	alphaControlTargetConnected = () => this.scheduleReconcile();
	alphaControlTargetDisconnected = () => this.scheduleReconcile();
	instructionsTargetConnected = () => this.scheduleReconcile();
	instructionsTargetDisconnected = () => this.scheduleReconcile();

	/**
	 * Copy of the committed color, or null before the first valid connection. Assignment validates
	 * the color space and four finite HSVA values, clamps their ranges, cancels preview, and commits
	 * without events or focus movement. Invalid values and disconnected writes are ignored.
	 */
	get value(): ColorPickerValue | null {
		return this.committedValue === null ? null : { ...this.committedValue };
	}
	/**
	 * Copy of the committed color, or null before the first valid connection. Assignment validates
	 * the color space and four finite HSVA values, clamps their ranges, cancels preview, and commits
	 * without events or focus movement. Invalid values and disconnected writes are ignored.
	 */
	set value(value: ColorPickerValue) {
		if (!isColorValue(value) || !this.ensureEnhanced()) {
			return;
		}
		this.cancelInteraction(true);
		this.commitValue(normalize(value));
	}
	/**
	 * Committed color as color(srgb r g b / a) or color(display-p3 r g b / a), or null before the
	 * first valid connection. Uses encoded RGB components without 8-bit rounding or reducing P3 to
	 * sRGB.
	 */
	get color(): string | null {
		return this.committedValue === null ? null : cssColor(this.committedValue);
	}

	private configuration = () =>
		JSON.stringify(
			CONFIGURATION_ATTRIBUTES.map((attribute) => this.element.getAttribute(attribute)),
		);
	private inputValue = () => {
		try {
			return isColorValue(this.valueValue) ? normalize(this.valueValue) : null;
		} catch {
			return null;
		}
	};
	private scheduleReconcile = () => {
		if (!this.connected) {
			return;
		}
		this.cancelInteraction(true);
		if (this.reconcileQueued) {
			return;
		}
		this.reconcileQueued = true;
		queueMicrotask(() => {
			this.reconcileQueued = false;
			if (this.connected) {
				this.reconcile();
			}
		});
	};
	private reconcile = () => {
		if (!this.connected) {
			return;
		}
		this.cancelInteraction(true);
		this.unbind();
		const markup = this.getMarkup();
		const value = this.inputValue();
		if (
			markup === null ||
			value === null ||
			!this.isValidMarkup(markup) ||
			!this.isValidConfiguration()
		) {
			this.enhanced = false;
			this.warnInvalid();
			return;
		}
		const attribute = this.element.getAttribute("data-color-picker-value-value");
		if (this.committedValue === null || attribute !== this.lastValueAttribute) {
			this.committedValue = value;
		}
		if (this.initialValue === null) {
			this.initialValue = { ...this.committedValue };
		}
		this.lastValueAttribute = attribute;
		this.boundConfiguration = this.configuration();
		this.enhanced = true;
		this.applyStructure(markup);
		this.bind(markup);
		this.syncState();
	};
	private ensureEnhanced = () => {
		if (!this.connected || !this.element.isConnected) {
			return false;
		}
		if (!this.enhanced || !this.bindingCurrent()) {
			this.reconcile();
		}
		return this.connected && this.enhanced && this.committedValue !== null && this.bindingCurrent();
	};
	private getMarkup = (): Markup | null => {
		if (
			this.areaTargets.length > 1 ||
			this.wheelTargets.length > 1 ||
			this.instructionsTargets.length > 1 ||
			[
				this.hueControlTargets,
				this.saturationControlTargets,
				this.brightnessControlTargets,
				this.alphaControlTargets,
			].some((targets) => targets.length !== 1)
		) {
			return null;
		}
		const area = this.areaTargets[0] ?? null;
		const wheel = this.wheelTargets[0] ?? null;
		const instructions = this.instructionsTargets[0] ?? null;
		const [hue] = this.hueControlTargets;
		const [saturation] = this.saturationControlTargets;
		const [brightness] = this.brightnessControlTargets;
		const [alpha] = this.alphaControlTargets;
		if (
			(area !== null && !(area instanceof HTMLButtonElement)) ||
			(wheel !== null && !(wheel instanceof HTMLButtonElement)) ||
			!(hue instanceof HTMLInputElement) ||
			!(saturation instanceof HTMLInputElement) ||
			!(brightness instanceof HTMLInputElement) ||
			!(alpha instanceof HTMLInputElement)
		) {
			return null;
		}
		return { area, wheel, instructions, controls: { hue, saturation, brightness, alpha } };
	};
	private hasName = (element: HTMLElement, textAllowed = false) => {
		const labelledBy = element.getAttribute("aria-labelledby");
		if (labelledBy !== null) {
			const ids = labelledBy.trim().split(/\s+/).filter(Boolean);
			return (
				ids.length > 0 &&
				ids.every((id) => Boolean(element.ownerDocument.getElementById(id)?.textContent?.trim()))
			);
		}
		if (element.hasAttribute("aria-label")) {
			return Boolean(element.getAttribute("aria-label")?.trim());
		}
		if (element instanceof HTMLInputElement) {
			return Array.from(element.labels ?? []).some(
				(label) => label.control === element && Boolean(label.textContent?.trim()),
			);
		}
		return textAllowed && Boolean(element.textContent?.trim());
	};
	private allowedRole = (element: HTMLElement, role: string) =>
		!element.hasAttribute("role") || element.getAttribute("role") === role;
	private isValidMarkup = (markup: Markup) => {
		if (
			this.element instanceof HTMLButtonElement ||
			this.element instanceof HTMLInputElement ||
			this.element instanceof HTMLSelectElement ||
			this.element instanceof HTMLTextAreaElement ||
			!this.allowedRole(this.element, "group") ||
			!this.hasName(this.element)
		) {
			return false;
		}
		const handles = [markup.area, markup.wheel].filter((handle) => handle !== null);
		const elements = [
			...handles,
			...Object.values(markup.controls),
			...(markup.instructions === null ? [] : [markup.instructions]),
		];
		if (
			new Set(elements).size !== elements.length ||
			elements.some((element) => element === this.element || !this.element.contains(element))
		) {
			return false;
		}
		for (const element of elements) {
			for (
				let ancestor = element.parentElement;
				ancestor !== null;
				ancestor = ancestor.parentElement
			) {
				if (ancestor instanceof HTMLButtonElement) {
					return false;
				}
			}
		}
		if (handles.length > 0 && markup.instructions === null) {
			return false;
		}
		if (markup.instructions !== null && !markup.instructions.textContent?.trim()) {
			return false;
		}
		const view = this.element.ownerDocument.defaultView;
		if (
			view === null ||
			handles.some(
				(handle) =>
					handle.type !== "button" ||
					!this.allowedRole(handle, "button") ||
					!this.hasName(handle, true) ||
					view.getComputedStyle(handle).writingMode !== "horizontal-tb" ||
					elements.some((element) => element !== handle && handle.contains(element)),
			)
		) {
			return false;
		}
		const form = markup.controls.hue.form;
		return CHANNELS.every((channel) => {
			const input = markup.controls[channel];
			return (
				input.type === "range" &&
				!input.hidden &&
				input.getAttribute("aria-hidden") !== "true" &&
				this.allowedRole(input, "slider") &&
				this.hasName(input) &&
				input.form === form &&
				(!input.hasAttribute("min") || isRangeBound(input.min, 0)) &&
				(!input.hasAttribute("max") || isRangeBound(input.max, MAXIMUM[channel])) &&
				(!input.hasAttribute("step") || input.step === "any")
			);
		});
	};
	private isValidConfiguration = () =>
		Number.isFinite(this.stepValue) &&
		this.stepValue > 0 &&
		this.stepValue <= 100 &&
		Number.isFinite(this.hueStepValue) &&
		this.hueStepValue > 0 &&
		this.hueStepValue <= 360;
	private sameMarkup = (left: Markup, right: Markup) =>
		left.area === right.area &&
		left.wheel === right.wheel &&
		left.instructions === right.instructions &&
		CHANNELS.every((channel) => left.controls[channel] === right.controls[channel]);
	private bindingCurrent = () => {
		const markup = this.getMarkup();
		return (
			this.connected &&
			this.element.isConnected &&
			this.boundMarkup !== null &&
			markup !== null &&
			this.sameMarkup(markup, this.boundMarkup) &&
			this.boundConfiguration === this.configuration() &&
			this.isValidConfiguration() &&
			this.isValidMarkup(markup)
		);
	};
	private applyStructure = (markup: Markup) => {
		const completed: string[] = [];
		const complete = (element: HTMLElement, name: string, value: string, label: string) => {
			if (!element.hasAttribute(name)) {
				element.setAttribute(name, value);
				completed.push(`${label}: ${name}`);
			}
		};
		complete(this.element, "role", "group", "root");
		for (const channel of CHANNELS) {
			const input = markup.controls[channel];
			ensureElementId(input, `color-picker-${channel}`);
			complete(input, "min", "0", channel);
			complete(input, "max", String(MAXIMUM[channel]), channel);
			complete(input, "step", "any", channel);
		}
		const instructionsId =
			markup.instructions === null
				? null
				: ensureElementId(markup.instructions, "color-picker-instructions");
		for (const [handle, related, name] of [
			[markup.area, `${markup.controls.saturation.id} ${markup.controls.brightness.id}`, "area"],
			[markup.wheel, markup.controls.hue.id, "wheel"],
		] as const) {
			if (handle === null) {
				continue;
			}
			const previous = this.relations.get(handle);
			if (!handle.hasAttribute("aria-controls")) {
				handle.setAttribute("aria-controls", related);
				this.relations.set(handle, related);
				completed.push(`${name}: aria-controls`);
			} else if (previous !== undefined && handle.getAttribute("aria-controls") === previous) {
				handle.setAttribute("aria-controls", related);
				this.relations.set(handle, related);
			}
			if (instructionsId !== null) {
				const owned = this.descriptions.get(handle);
				const ids = (handle.getAttribute("aria-describedby") ?? "")
					.split(/\s+/)
					.filter((id) => id !== "" && id !== owned);
				if (!ids.includes(instructionsId)) {
					ids.push(instructionsId);
					this.descriptions.set(handle, instructionsId);
				}
				handle.setAttribute("aria-describedby", ids.join(" "));
			}
		}
		if (completed.length > 0 && !this.completionWarningIssued) {
			this.completionWarningIssued = true;
			console.warn(
				`color-picker controller: Added ${completed.join(", ")}. Include them in your markup.`,
			);
		}
	};
	private warnInvalid = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			"color-picker controller: Provide a named group, four labeled native ranges, optional native buttons and instructions, an HSVA value with a color space, and finite steps as specified in the contract. Enhancement has been disabled.",
		);
	};
	private syncState = () => {
		const value = this.previewValue ?? this.committedValue;
		if (value === null) {
			return;
		}
		this.element.dataset.state = this.interaction === null ? "idle" : "adjusting";
		this.element.dataset.colorSpace = value.colorSpace;
		this.element.style.setProperty("--color-picker-hue", String(value.hue));
		this.element.style.setProperty("--color-picker-saturation", String(value.saturation / 100));
		this.element.style.setProperty("--color-picker-brightness", String(value.brightness / 100));
		this.element.style.setProperty("--color-picker-alpha", String(value.alpha));
		this.element.style.setProperty("--color-picker-color", cssColor(value));
		this.element.style.setProperty(
			"--color-picker-hue-color",
			cssColor({ ...value, saturation: 100, brightness: 100, alpha: 1 }),
		);
		if (this.boundMarkup !== null) {
			for (const channel of CHANNELS) {
				this.boundMarkup.controls[channel].value = String(value[channel]);
			}
		}
	};
	private commitValue = (value: ColorPickerValue) => {
		this.revision++;
		this.committedValue = { ...value };
		this.syncState();
	};
	private bind = (markup: Markup) => {
		this.boundMarkup = markup;
		this.boundDocument = this.element.ownerDocument;
		this.boundWindow = this.boundDocument.defaultView;
		this.boundForm = markup.controls.hue.form;
		this.element.addEventListener("pointerdown", this.handlePointerdown);
		this.element.addEventListener("lostpointercapture", this.handlePointercancel);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.element.addEventListener("keyup", this.handleKeyup);
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("input", this.handleInput);
		this.element.addEventListener("change", this.handleChange);
		this.element.addEventListener("blur", this.handleBlur, true);
		this.element.addEventListener("focus", this.handleFocus, true);
		this.boundDocument.addEventListener("pointermove", this.handlePointermove);
		this.boundDocument.addEventListener("pointerup", this.handlePointerup);
		this.boundDocument.addEventListener("pointercancel", this.handlePointercancel);
		this.boundWindow?.addEventListener("blur", this.handleWindowBlur);
		this.boundWindow?.addEventListener("focus", this.handleWindowFocus);
		this.boundForm?.addEventListener("reset", this.handleReset);
	};
	private unbind = () => {
		this.element.removeEventListener("pointerdown", this.handlePointerdown);
		this.element.removeEventListener("lostpointercapture", this.handlePointercancel);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.element.removeEventListener("keyup", this.handleKeyup);
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("input", this.handleInput);
		this.element.removeEventListener("change", this.handleChange);
		this.element.removeEventListener("blur", this.handleBlur, true);
		this.element.removeEventListener("focus", this.handleFocus, true);
		this.boundDocument?.removeEventListener("pointermove", this.handlePointermove);
		this.boundDocument?.removeEventListener("pointerup", this.handlePointerup);
		this.boundDocument?.removeEventListener("pointercancel", this.handlePointercancel);
		this.boundWindow?.removeEventListener("blur", this.handleWindowBlur);
		this.boundWindow?.removeEventListener("focus", this.handleWindowFocus);
		this.boundForm?.removeEventListener("reset", this.handleReset);
		this.resetTasks.cancel();
		this.boundMarkup = null;
		this.boundDocument = null;
		this.boundWindow = null;
		this.boundForm = null;
		for (const input of this.staleRanges.keys()) {
			if (!this.element.contains(input)) {
				this.clearStale(input);
			}
		}
	};
	private channelFor = (event: Event): Channel | null => {
		const markup = this.boundMarkup;
		if (markup === null) {
			return null;
		}
		return (
			CHANNELS.find((channel) => event.composedPath().includes(markup.controls[channel])) ?? null
		);
	};
	private surfaceFor = (event: Event): "area" | "wheel" | null => {
		const markup = this.boundMarkup;
		if (markup === null) {
			return null;
		}
		return (
			(["area", "wheel"] as const).find(
				(source) => markup[source] !== null && event.composedPath().includes(markup[source]),
			) ?? null
		);
	};
	private disabledSignature = () => {
		const markup = this.boundMarkup;
		return markup === null
			? ""
			: JSON.stringify([
					markup.area?.matches(":disabled"),
					markup.wheel?.matches(":disabled"),
					...CHANNELS.map((channel) => markup.controls[channel].matches(":disabled")),
				]);
	};
	private clearStale = (input: HTMLInputElement) => {
		const stale = this.staleRanges.get(input);
		if (stale?.timer !== null && stale?.timer !== undefined) {
			clearTimeout(stale.timer);
		}
		this.staleRanges.delete(input);
	};
	private releaseStale = (input: HTMLInputElement, stale: StaleRange) => {
		if (stale.timer !== null) {
			clearTimeout(stale.timer);
		}
		stale.timer = setTimeout(() => {
			if (this.staleRanges.get(input) === stale) {
				this.staleRanges.delete(input);
			}
		}, 0);
	};
	private cancelInteraction = (suppressRange = false) => {
		this.revision++;
		const interaction = this.interaction;
		this.interaction = null;
		this.previewValue = null;
		if (
			interaction?.kind === "direct" &&
			interaction.handle.hasPointerCapture(interaction.pointerId)
		) {
			interaction.handle.releasePointerCapture(interaction.pointerId);
		}
		if (suppressRange && interaction?.kind === "range") {
			this.clearStale(interaction.input);
			const stale: StaleRange = { pointerId: interaction.pointerId, timer: null };
			this.staleRanges.set(interaction.input, stale);
			if (!interaction.active) {
				this.releaseStale(interaction.input, stale);
			}
		}
		this.syncState();
	};
	private currentInteraction = () => {
		const interaction = this.interaction;
		if (interaction === null) {
			return null;
		}
		if (!this.bindingCurrent() || interaction.disabled !== this.disabledSignature()) {
			this.cancelInteraction(true);
			this.scheduleReconcile();
			return null;
		}
		return interaction;
	};
	private requestChange = (value: ColorPickerValue, reason: Reason, source: Source) => {
		if (this.requesting || !this.ensureEnhanced() || this.committedValue === null) {
			return;
		}
		const candidate = normalize(value);
		const previousValue = { ...this.committedValue };
		this.syncState();
		if (sameValue(candidate, previousValue)) {
			this.syncState();
			return;
		}
		const revision = this.revision;
		const markup = this.boundMarkup;
		const disabled = this.disabledSignature();
		const detail = (): ColorPickerChangeDetail => ({
			value: { ...candidate },
			previousValue: { ...previousValue },
			color: cssColor(candidate),
			reason,
			source,
		});
		this.requesting = true;
		let accepted: boolean;
		try {
			accepted = this.element.dispatchEvent(
				new CustomEvent<ColorPickerChangeDetail>("color-picker:beforechange", {
					bubbles: true,
					cancelable: true,
					detail: detail(),
				}),
			);
		} finally {
			this.requesting = false;
		}
		if (
			!accepted ||
			revision !== this.revision ||
			this.boundMarkup !== markup ||
			!this.bindingCurrent() ||
			disabled !== this.disabledSignature()
		) {
			return;
		}
		this.commitValue(candidate);
		this.element.dispatchEvent(
			new CustomEvent<ColorPickerChangeDetail>("color-picker:change", {
				bubbles: true,
				detail: detail(),
			}),
		);
	};
	private geometry = (handle: HTMLElement): Geometry | null => {
		const rect = handle.getBoundingClientRect();
		const view = handle.ownerDocument.defaultView;
		if (
			view === null ||
			![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) ||
			rect.width <= 0 ||
			rect.height <= 0
		) {
			return null;
		}
		return {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
			rtl: view.getComputedStyle(handle).direction === "rtl",
		};
	};
	private directCandidate = (interaction: DirectInteraction, x: number, y: number) => {
		const value = this.committedValue;
		const markup = this.boundMarkup;
		if (value === null || markup === null) {
			return null;
		}
		const candidate = { ...value };
		const rect = interaction.geometry;
		const horizontal = (x - rect.left) / rect.width;
		const vertical = (y - rect.top) / rect.height;
		if (interaction.source === "area") {
			if (!markup.controls.saturation.matches(":disabled")) {
				candidate.saturation = clamp((rect.rtl ? 1 - horizontal : horizontal) * 100, 100);
			}
			if (!markup.controls.brightness.matches(":disabled")) {
				candidate.brightness = clamp((1 - vertical) * 100, 100);
			}
		} else if (!markup.controls.hue.matches(":disabled")) {
			const dx = horizontal - 0.5;
			const dy = vertical - 0.5;
			if (Math.hypot(dx, dy) > 0.001) {
				candidate.hue = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
			}
		}
		return candidate;
	};
	private directPreview = (event: PointerEvent) => {
		if (!event.isTrusted || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
			return false;
		}
		const interaction = this.currentInteraction();
		if (interaction?.kind !== "direct" || interaction.pointerId !== event.pointerId) {
			return false;
		}
		const geometry = this.geometry(interaction.handle);
		if (geometry === null || JSON.stringify(geometry) !== JSON.stringify(interaction.geometry)) {
			this.cancelInteraction();
			return false;
		}
		this.previewValue = this.directCandidate(interaction, event.clientX, event.clientY);
		this.syncState();
		return true;
	};
	private startRange = (
		input: HTMLInputElement,
		source: Channel,
		reason: Reason,
		pointerId: number | null,
	) => {
		this.cancelInteraction(true);
		this.clearStale(input);
		this.interaction = {
			kind: "range",
			input,
			source,
			reason,
			pointerId,
			active: true,
			disabled: this.disabledSignature(),
		};
		this.previewValue = this.value;
		this.syncState();
	};
	private handlePointerdown = (event: PointerEvent) => {
		if (
			!event.isTrusted ||
			!event.isPrimary ||
			event.button !== 0 ||
			event.defaultPrevented ||
			!this.ensureEnhanced() ||
			this.boundMarkup === null
		) {
			return;
		}
		if (
			this.interaction?.pointerId !== null &&
			this.interaction?.pointerId !== undefined &&
			this.interaction.pointerId !== event.pointerId
		) {
			event.preventDefault();
			return;
		}
		const channel = this.channelFor(event);
		if (channel !== null) {
			const input = this.boundMarkup.controls[channel];
			if (!input.matches(":disabled")) {
				this.startRange(input, channel, "pointer", event.pointerId);
			}
			return;
		}
		const source = this.surfaceFor(event);
		const handle = source === null ? null : this.boundMarkup[source];
		if (source === null || handle === null || handle.matches(":disabled")) {
			return;
		}
		const geometry = this.geometry(handle);
		if (geometry === null) {
			return;
		}
		this.cancelInteraction(true);
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			return;
		}
		const revision = this.revision;
		event.preventDefault();
		handle.focus();
		if (revision !== this.revision || !this.bindingCurrent()) {
			if (handle.hasPointerCapture(event.pointerId)) {
				handle.releasePointerCapture(event.pointerId);
			}
			return;
		}
		this.interaction = {
			kind: "direct",
			source,
			handle,
			pointerId: event.pointerId,
			geometry,
			disabled: this.disabledSignature(),
		};
		this.directPreview(event);
	};
	private handlePointermove = (event: PointerEvent) => {
		if (event.isTrusted && event.buttons === 0) {
			for (const [input, stale] of this.staleRanges) {
				if (stale.pointerId === event.pointerId) {
					this.releaseStale(input, stale);
				}
			}
		}
		if (this.directPreview(event)) {
			event.preventDefault();
		}
	};
	private handlePointerup = (event: PointerEvent) => {
		if (!event.isTrusted || event.button !== 0) {
			return;
		}
		for (const [input, stale] of this.staleRanges) {
			if (stale.pointerId === event.pointerId) {
				this.releaseStale(input, stale);
			}
		}
		const interaction = this.currentInteraction();
		if (interaction === null || interaction.pointerId !== event.pointerId) {
			return;
		}
		if (interaction.kind === "direct") {
			if (!this.directPreview(event)) {
				return;
			}
			const candidate = this.previewValue;
			this.cancelInteraction();
			if (candidate !== null) {
				this.requestChange(candidate, "pointer", interaction.source);
			}
		} else {
			interaction.active = false;
			if (
				this.previewValue !== null &&
				this.committedValue !== null &&
				sameValue(this.previewValue, this.committedValue)
			) {
				this.cancelInteraction();
			}
		}
	};
	private handlePointercancel = (event: PointerEvent) => {
		if (!event.isTrusted) {
			return;
		}
		if (this.interaction?.pointerId === event.pointerId) {
			this.cancelInteraction(true);
		}
		for (const [input, stale] of this.staleRanges) {
			if (stale.pointerId === event.pointerId) {
				this.releaseStale(input, stale);
			}
		}
	};
	private handleKeydown = (event: KeyboardEvent) => {
		if (
			!event.isTrusted ||
			event.defaultPrevented ||
			isImeKeydown(event) ||
			event.ctrlKey ||
			event.altKey ||
			event.metaKey ||
			!this.ensureEnhanced() ||
			this.boundMarkup === null ||
			this.committedValue === null
		) {
			return;
		}
		const channel = this.channelFor(event);
		const source = this.surfaceFor(event);
		if (channel === null && source === null) {
			return;
		}
		if (event.key === "Escape") {
			if (this.interaction !== null) {
				event.preventDefault();
				this.cancelInteraction(true);
			}
			return;
		}
		if (channel !== null) {
			const input = this.boundMarkup.controls[channel];
			if (RANGE_KEYS.includes(event.key) && !input.matches(":disabled")) {
				if (
					this.interaction?.kind !== "range" ||
					this.interaction.input !== input ||
					!this.interaction.active
				) {
					this.startRange(input, channel, "keyboard", null);
				}
			}
			return;
		}
		const handle = source === null ? null : this.boundMarkup[source];
		if (
			handle === null ||
			handle.matches(":disabled") ||
			!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
		) {
			return;
		}
		if (source === "area" && (event.key === "Home" || event.key === "End")) {
			return;
		}
		event.preventDefault();
		this.cancelInteraction(true);
		const candidate = { ...this.committedValue };
		const rtl = handle.ownerDocument.defaultView?.getComputedStyle(handle).direction === "rtl";
		const multiplier = event.shiftKey ? 10 : 1;
		const horizontal =
			(event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0) * (rtl ? -1 : 1);
		const vertical = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
		if (source === "area") {
			if (!this.boundMarkup.controls.saturation.matches(":disabled")) {
				candidate.saturation += horizontal * this.stepValue * multiplier;
			}
			if (!this.boundMarkup.controls.brightness.matches(":disabled")) {
				candidate.brightness += vertical * this.stepValue * multiplier;
			}
		} else if (!this.boundMarkup.controls.hue.matches(":disabled")) {
			candidate.hue =
				event.key === "Home"
					? 0
					: event.key === "End"
						? 360
						: candidate.hue + (horizontal + vertical) * this.hueStepValue * multiplier;
		}
		if (source !== null) {
			this.requestChange(normalize(candidate), "keyboard", source);
		}
	};
	private handleKeyup = (event: KeyboardEvent) => {
		if (!event.isTrusted) {
			return;
		}
		const channel = this.channelFor(event);
		const input = channel === null ? null : this.boundMarkup?.controls[channel];
		if (input === null || input === undefined) {
			return;
		}
		const stale = this.staleRanges.get(input);
		if (stale?.pointerId === null) {
			this.releaseStale(input, stale);
		}
		const interaction = this.currentInteraction();
		if (
			interaction?.kind !== "range" ||
			interaction.input !== input ||
			interaction.reason !== "keyboard"
		) {
			return;
		}
		interaction.active = false;
		if (
			this.previewValue !== null &&
			this.committedValue !== null &&
			sameValue(this.previewValue, this.committedValue)
		) {
			this.cancelInteraction();
		}
	};
	private handleClick = (event: MouseEvent) => {
		if (
			!event.isTrusted ||
			event.detail !== 0 ||
			!this.ensureEnhanced() ||
			this.boundMarkup === null
		) {
			return;
		}
		const source = this.surfaceFor(event);
		const handle = source === null ? null : this.boundMarkup[source];
		if (handle === null || handle.matches(":disabled")) {
			return;
		}
		const candidates =
			source === "area"
				? [this.boundMarkup.controls.saturation, this.boundMarkup.controls.brightness]
				: [this.boundMarkup.controls.hue];
		const input = candidates.find((candidate) => !candidate.matches(":disabled"));
		if (input === undefined) {
			return;
		}
		this.cancelInteraction(true);
		const details: HTMLDetailsElement[] = [];
		for (
			let ancestor = input.parentElement;
			ancestor !== null && this.element.contains(ancestor);
			ancestor = ancestor.parentElement
		) {
			if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
				details.push(ancestor);
			}
		}
		for (const ancestor of details.reverse()) {
			ancestor.open = true;
		}
		input.focus();
	};
	private nativeValue = (event: Event) => {
		const channel = this.channelFor(event);
		const markup = this.boundMarkup;
		if (channel === null || markup === null) {
			return null;
		}
		const input = markup.controls[channel];
		const value = input.valueAsNumber;
		if (
			!event.isTrusted ||
			this.staleRanges.has(input) ||
			input.matches(":disabled") ||
			!Number.isFinite(value)
		) {
			this.syncState();
			return null;
		}
		if (!this.ensureEnhanced() || this.boundMarkup?.controls[channel] !== input) {
			this.syncState();
			return null;
		}
		return { channel, input, value };
	};
	private handleInput = (event: Event) => {
		const native = this.nativeValue(event);
		if (native === null || this.committedValue === null) {
			return;
		}
		const current = this.currentInteraction();
		if (this.staleRanges.has(native.input)) {
			this.syncState();
			return;
		}
		if (current?.kind === "range" && current.input === native.input) {
			this.previewValue = normalize({ ...this.committedValue, [native.channel]: native.value });
			this.syncState();
		} else if (current === null) {
			this.requestChange(
				normalize({ ...this.committedValue, [native.channel]: native.value }),
				"keyboard",
				native.channel,
			);
		} else {
			this.syncState();
		}
	};
	private handleChange = (event: Event) => {
		const native = this.nativeValue(event);
		if (native === null || this.committedValue === null) {
			return;
		}
		const current = this.currentInteraction();
		if (this.staleRanges.has(native.input)) {
			this.syncState();
			return;
		}
		if (current !== null && (current.kind !== "range" || current.input !== native.input)) {
			this.syncState();
			return;
		}
		const reason = current?.kind === "range" ? current.reason : "keyboard";
		const candidate = normalize({ ...this.committedValue, [native.channel]: native.value });
		this.cancelInteraction();
		this.requestChange(candidate, reason, native.channel);
	};
	private handleBlur = (event: FocusEvent) => {
		if (this.interaction?.kind === "range" && event.target === this.interaction.input) {
			this.cancelInteraction(true);
		}
	};
	private handleFocus = (event: FocusEvent) => {
		if (!event.isTrusted) {
			return;
		}
		const channel = this.channelFor(event);
		const input = channel === null ? null : this.boundMarkup?.controls[channel];
		const stale = input === null || input === undefined ? undefined : this.staleRanges.get(input);
		if (input !== null && input !== undefined && stale !== undefined) {
			this.releaseStale(input, stale);
		}
	};
	private handleWindowFocus = (event: FocusEvent) => {
		if (!event.isTrusted || event.target !== this.boundWindow) {
			return;
		}
		for (const [input, stale] of this.staleRanges) {
			this.releaseStale(input, stale);
		}
	};
	private handleWindowBlur = () => this.cancelInteraction(true);
	private handleReset = (event: Event) => {
		const revision = this.revision;
		this.resetTasks.schedule(() => {
			if (
				event.defaultPrevented ||
				!this.connected ||
				!this.bindingCurrent() ||
				this.initialValue === null
			) {
				return;
			}
			if (revision !== this.revision) {
				this.syncState();
				return;
			}
			this.cancelInteraction(true);
			this.commitValue({ ...this.initialValue });
		});
	};
}

export { ColorPickerController };
