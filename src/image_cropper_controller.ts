import { Controller } from "@hotwired/stimulus";
import { createFormResetTasks } from "./internal/form_reset_tasks";

import { ensureElementId } from "./internal/ensure_element_id";
import { isImeKeydown } from "./internal/ime";

/** Crop and image placement in viewport percentages, with logical horizontal coordinates. */
export type ImageCropperValue = {
	/** Selection distance from inline-start, in viewport-width percent; clamped to 0..100-width. */
	x: number;
	/** Selection distance from the top, in viewport-height percent; clamped to 0..100-height. */
	y: number;
	/** Selection width in viewport-width percent; clamped to minWidth..100. */
	width: number;
	/** Selection height in viewport-height percent; clamped to minHeight..100. */
	height: number;
	/** Image magnification relative to the viewport; clamped to 1..maxZoom. */
	zoom: number;
	/** Image offset from inline-start, in viewport-width percent; clamped to 100-100*zoom..0. */
	offsetX: number;
	/** Image offset from the top, in viewport-height percent; clamped to 100-100*zoom..0. */
	offsetY: number;
};

/** Source-image crop normalized to width=1 and height=1, without integer-pixel rounding. */
export type ImageCropperSourceRect = {
	/** Fraction of source width from the physical left edge, independent of text direction. */
	x: number;
	/** Fraction of source height from the physical top edge. */
	y: number;
	/** Crop width as a fraction of the full source-image width. */
	width: number;
	/** Crop height as a fraction of the full source-image height. */
	height: number;
};

type ChangeReason = "pointer" | "keyboard";

export type ImageCropperChangeDetail = {
	value: ImageCropperValue;
	previousValue: ImageCropperValue;
	sourceRect: ImageCropperSourceRect;
	previousSourceRect: ImageCropperSourceRect;
	reason: ChangeReason;
};

type Direction = "ltr" | "rtl";
type RangeField = "x" | "y" | "width" | "height" | "zoom";

type Markup = {
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
};

type ViewportGeometry = {
	left: number;
	top: number;
	width: number;
	height: number;
};

type DisabledSnapshot = {
	selection: boolean;
	resize: boolean;
	x: boolean;
	y: boolean;
	width: boolean;
	height: boolean;
	zoom: boolean;
};

type OperationContext = {
	markup: Markup;
	direction: Direction;
	configuration: readonly (string | null)[];
	disabled: DisabledSnapshot;
	geometry: ViewportGeometry | null;
};

type DirectInteraction = {
	type: "direct";
	button: HTMLButtonElement;
	field: "selection" | "resize";
	pointerId: number;
	origin: ImageCropperValue;
	startX: number;
	startY: number;
	context: OperationContext;
	moved: boolean;
	releasingCapture: boolean;
};

type RangeInteraction = {
	type: "range";
	control: HTMLInputElement;
	field: RangeField;
	origin: ImageCropperValue;
	reason: ChangeReason;
	context: OperationContext;
	pointerId: number | null;
	physicalEnded: boolean;
};

type Interaction = DirectInteraction | RangeInteraction;

type StaleRange = {
	control: HTMLInputElement;
	field: RangeField;
	pointerId: number | null;
	physicalEnded: boolean;
	consumeUntilChange: boolean;
};

const DEFAULT_VALUE: ImageCropperValue = {
	x: 25,
	y: 25,
	width: 50,
	height: 50,
	zoom: 1,
	offsetX: 0,
	offsetY: 0,
};

const VALUE_KEYS = ["x", "y", "width", "height", "zoom", "offsetX", "offsetY"] as const;
const CONFIGURATION_ATTRIBUTES = [
	"data-image-cropper-value-value",
	"data-image-cropper-step-value",
	"data-image-cropper-zoom-step-value",
	"data-image-cropper-min-width-value",
	"data-image-cropper-min-height-value",
	"data-image-cropper-max-zoom-value",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isImageCropperValue = (value: unknown): value is ImageCropperValue => {
	if (!isRecord(value)) {
		return false;
	}
	return VALUE_KEYS.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
};

const cloneValue = (value: ImageCropperValue): ImageCropperValue => ({ ...value });

const cloneSourceRect = (value: ImageCropperSourceRect): ImageCropperSourceRect => ({ ...value });

const sameValue = (left: ImageCropperValue, right: ImageCropperValue) =>
	VALUE_KEYS.every((key) => left[key] === right[key]);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Controls a crop rectangle and image scale through authored native pointer and keyboard controls.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/image-cropper.contract.json
 */
export default class ImageCropperController extends Controller<HTMLElement> {
	static targets = [
		"viewport",
		"image",
		"selection",
		"resize",
		"xControl",
		"yControl",
		"widthControl",
		"heightControl",
		"zoomControl",
		"instructions",
	];

	static values = {
		value: { type: Object, default: DEFAULT_VALUE },
		step: { type: Number, default: 1 },
		zoomStep: { type: Number, default: 0.1 },
		minWidth: { type: Number, default: 1 },
		minHeight: { type: Number, default: 1 },
		maxZoom: { type: Number, default: 5 },
	};

	declare readonly viewportTargets: HTMLElement[];
	declare readonly imageTargets: HTMLElement[];
	declare readonly selectionTargets: HTMLElement[];
	declare readonly resizeTargets: HTMLElement[];
	declare readonly xControlTargets: HTMLElement[];
	declare readonly yControlTargets: HTMLElement[];
	declare readonly widthControlTargets: HTMLElement[];
	declare readonly heightControlTargets: HTMLElement[];
	declare readonly zoomControlTargets: HTMLElement[];
	declare readonly instructionsTargets: HTMLElement[];
	declare readonly valueValue: ImageCropperValue;
	declare readonly stepValue: number;
	declare readonly zoomStepValue: number;
	declare readonly minWidthValue: number;
	declare readonly minHeightValue: number;
	declare readonly maxZoomValue: number;

	private resetTasks = createFormResetTasks();
	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private initialized = false;
	private committedValue: ImageCropperValue | null = null;
	private initialValue: ImageCropperValue | null = null;
	private previewValue: ImageCropperValue | null = null;
	private lastValueAttribute: string | null = null;
	private interaction: Interaction | null = null;
	private boundMarkup: Markup | null = null;
	private boundConfiguration: readonly (string | null)[] | null = null;
	private boundForms = new Set<HTMLFormElement>();
	private boundDocument: Document | null = null;
	private boundWindow: Window | null = null;
	private reconcileQueued = false;
	private revision = 0;
	private suppressedClickTarget: HTMLButtonElement | null = null;
	private staleRanges = new Map<HTMLInputElement, StaleRange>();

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.reconcile();
	};

	disconnect = () => {
		this.invalidateInteraction(true);
		this.connected = false;
		this.unbind();
		this.staleRanges.clear();
		this.enhanced = false;
		this.reconcileQueued = false;
		this.suppressedClickTarget = null;
		if (this.initialized) {
			this.element.dataset.state = "idle";
		}
	};

	viewportTargetConnected = () => this.targetChanged();
	viewportTargetDisconnected = () => this.targetChanged();
	imageTargetConnected = () => this.targetChanged();
	imageTargetDisconnected = () => this.targetChanged();
	selectionTargetConnected = () => this.targetChanged();
	selectionTargetDisconnected = () => this.targetChanged();
	resizeTargetConnected = () => this.targetChanged();
	resizeTargetDisconnected = () => this.targetChanged();
	xControlTargetConnected = () => this.targetChanged();
	xControlTargetDisconnected = () => this.targetChanged();
	yControlTargetConnected = () => this.targetChanged();
	yControlTargetDisconnected = () => this.targetChanged();
	widthControlTargetConnected = () => this.targetChanged();
	widthControlTargetDisconnected = () => this.targetChanged();
	heightControlTargetConnected = () => this.targetChanged();
	heightControlTargetDisconnected = () => this.targetChanged();
	zoomControlTargetConnected = () => this.targetChanged();
	zoomControlTargetDisconnected = () => this.targetChanged();
	instructionsTargetConnected = () => this.targetChanged();
	instructionsTargetDisconnected = () => this.targetChanged();

	valueValueChanged = () => this.configurationChanged();
	stepValueChanged = () => this.configurationChanged();
	zoomStepValueChanged = () => this.configurationChanged();
	minWidthValueChanged = () => this.configurationChanged();
	minHeightValueChanged = () => this.configurationChanged();
	maxZoomValueChanged = () => this.configurationChanged();

	/**
	 * Copy of the current crop, including an active preview, or null before the first valid
	 * connection. Assignment normalizes all seven values together and commits without events or
	 * focus movement. Invalid or disconnected configurations ignore writes. Invalid objects cancel
	 * preview and retain the last committed value.
	 */
	get value(): ImageCropperValue | null {
		const value = this.effectiveValue();
		return value === null ? null : cloneValue(value);
	}

	/**
	 * Copy of the current crop, including an active preview, or null before the first valid
	 * connection. Assignment normalizes all seven values together and commits without events or
	 * focus movement. Invalid or disconnected configurations ignore writes. Invalid objects cancel
	 * preview and retain the last committed value.
	 */
	set value(value: ImageCropperValue) {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.invalidateInteraction(true);
		if (!isImageCropperValue(value) || this.committedValue === null) {
			this.syncState();
			return;
		}
		this.committedValue = this.normalizeValue(value);
		this.syncState();
	}

	/**
	 * Copy of the source-image rectangle calculated from the current crop and direction, including
	 * preview. Returns null before the first valid connection.
	 */
	get sourceRect(): ImageCropperSourceRect | null {
		const value = this.effectiveValue();
		const markup = this.boundMarkup ?? this.getMarkup();
		if (value === null || markup === null || !this.initialized) {
			return null;
		}
		return cloneSourceRect(this.sourceRectFor(value, this.directionFor(markup.viewport)));
	}

	/**
	 * Current magnification, or null before the first valid connection. Assignment cancels preview
	 * and zooms from the last committed state, preserving the crop rectangle while updating zoom and
	 * offsets. Non-finite values retain the committed state; invalid or disconnected configurations
	 * ignore writes. Does not emit events or move focus.
	 */
	get zoom(): number | null {
		return this.effectiveValue()?.zoom ?? null;
	}

	/**
	 * Current magnification, or null before the first valid connection. Assignment cancels preview
	 * and zooms from the last committed state, preserving the crop rectangle while updating zoom and
	 * offsets. Non-finite values retain the committed state; invalid or disconnected configurations
	 * ignore writes. Does not emit events or move focus.
	 */
	set zoom(value: number) {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.invalidateInteraction(true);
		if (!Number.isFinite(value) || this.committedValue === null) {
			this.syncState();
			return;
		}
		this.committedValue = this.zoomValue(this.committedValue, value);
		this.syncState();
	}

	private targetChanged = () => {
		if (!this.connected) {
			return;
		}
		this.invalidateInteraction(true);
		this.scheduleReconcile();
	};

	private configurationChanged = () => {
		if (!this.connected) {
			return;
		}
		this.invalidateInteraction(true);
		this.scheduleReconcile();
	};

	private scheduleReconcile = () => {
		if (!this.connected || this.reconcileQueued) {
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
		this.invalidateInteraction(true);
		this.unbind();

		const markup = this.getMarkup();
		if (
			markup === null ||
			!this.isValidMarkup() ||
			!this.isValidConfiguration() ||
			!isImageCropperValue(this.valueValue)
		) {
			this.enhanced = false;
			if (this.initialized) {
				this.element.dataset.state = "idle";
			}
			this.warnInvalidMarkup();
			return;
		}

		const valueAttribute = this.element.getAttribute("data-image-cropper-value-value");
		if (!this.initialized) {
			this.committedValue = this.normalizeValue(this.valueValue);
			this.initialValue = cloneValue(this.committedValue);
			this.initialized = true;
		} else if (valueAttribute !== this.lastValueAttribute && this.committedValue !== null) {
			this.committedValue = this.normalizeValue(this.valueValue);
		} else if (this.committedValue !== null) {
			this.committedValue = this.normalizeValue(this.committedValue);
		}
		this.lastValueAttribute = valueAttribute;
		this.boundConfiguration = this.configurationSignature();
		this.enhanced = true;

		const completionAttributes = this.applyStructure(markup);
		this.bind(markup);
		this.syncState();
		this.warnCompletion(completionAttributes);
	};

	private ensureEnhanced = () => {
		if (!this.connected) {
			return false;
		}
		if (!this.enhanced || !this.isBindingCurrent()) {
			this.reconcile();
		}
		return (
			this.connected && this.enhanced && this.committedValue !== null && this.isBindingCurrent()
		);
	};

	private getMarkup = (): Markup | null => {
		const viewport = this.onlyElement(this.viewportTargets);
		const image = this.onlyElement(this.imageTargets);
		const selection = this.onlyElement(this.selectionTargets);
		const resize = this.onlyElement(this.resizeTargets);
		const xControl = this.onlyElement(this.xControlTargets);
		const yControl = this.onlyElement(this.yControlTargets);
		const widthControl = this.onlyElement(this.widthControlTargets);
		const heightControl = this.onlyElement(this.heightControlTargets);
		const zoomControl = this.onlyElement(this.zoomControlTargets);
		const instructions = this.onlyElement(this.instructionsTargets);
		if (
			viewport === null ||
			image === null ||
			selection === null ||
			resize === null ||
			xControl === null ||
			yControl === null ||
			widthControl === null ||
			heightControl === null ||
			zoomControl === null ||
			instructions === null
		) {
			return null;
		}
		if (
			!(image instanceof HTMLImageElement) ||
			!(selection instanceof HTMLButtonElement) ||
			!(resize instanceof HTMLButtonElement) ||
			!(xControl instanceof HTMLInputElement) ||
			!(yControl instanceof HTMLInputElement) ||
			!(widthControl instanceof HTMLInputElement) ||
			!(heightControl instanceof HTMLInputElement) ||
			!(zoomControl instanceof HTMLInputElement)
		) {
			return null;
		}
		return {
			viewport,
			image,
			selection,
			resize,
			xControl,
			yControl,
			widthControl,
			heightControl,
			zoomControl,
			instructions,
		};
	};

	private onlyElement = (targets: readonly HTMLElement[]) => {
		if (targets.length !== 1) {
			return null;
		}
		return targets[0] ?? null;
	};

	private isValidMarkup = () => {
		if (this.element instanceof HTMLButtonElement || this.element instanceof HTMLInputElement) {
			return false;
		}
		const markup = this.getMarkup();
		if (markup === null) {
			return false;
		}
		const elements = [
			markup.viewport,
			markup.image,
			markup.selection,
			markup.resize,
			markup.xControl,
			markup.yControl,
			markup.widthControl,
			markup.heightControl,
			markup.zoomControl,
			markup.instructions,
		];
		const targetNames = [
			"viewport",
			"image",
			"selection",
			"resize",
			"xControl",
			"yControl",
			"widthControl",
			"heightControl",
			"zoomControl",
			"instructions",
		] as const;
		if (new Set(elements).size !== elements.length) {
			return false;
		}
		if (
			this.element.getAttribute("data-controller")?.split(/\s+/).includes("image-cropper") !==
				true ||
			!elements.every(
				(element, index) =>
					this.isTargetInThisRoot(element) && this.hasTarget(element, targetNames[index]),
			)
		) {
			return false;
		}
		if (
			!markup.viewport.contains(markup.image) ||
			!markup.viewport.contains(markup.selection) ||
			!markup.viewport.contains(markup.resize) ||
			markup.selection.parentElement !== markup.resize.parentElement ||
			markup.image.contains(markup.selection) ||
			markup.image.contains(markup.resize) ||
			markup.selection.contains(markup.image) ||
			markup.resize.contains(markup.image) ||
			markup.viewport.contains(markup.xControl) ||
			markup.viewport.contains(markup.yControl) ||
			markup.viewport.contains(markup.widthControl) ||
			markup.viewport.contains(markup.heightControl) ||
			markup.viewport.contains(markup.zoomControl)
		) {
			return false;
		}
		if (
			markup.image.alt.trim() === "" ||
			markup.image.hasAttribute("tabindex") ||
			markup.image.hasAttribute("contenteditable") ||
			(markup.image.hasAttribute("draggable") && markup.image.draggable)
		) {
			return false;
		}
		if (
			(markup.selection.hasAttribute("type") && markup.selection.type !== "button") ||
			(markup.resize.hasAttribute("type") && markup.resize.type !== "button") ||
			!this.isAllowedRole(this.element, "group") ||
			!this.isAllowedRole(markup.selection, "button") ||
			!this.isAllowedRole(markup.resize, "button") ||
			!this.isAllowedRole(markup.xControl, "slider") ||
			!this.isAllowedRole(markup.yControl, "slider") ||
			!this.isAllowedRole(markup.widthControl, "slider") ||
			!this.isAllowedRole(markup.heightControl, "slider") ||
			!this.isAllowedRole(markup.zoomControl, "slider")
		) {
			return false;
		}
		if (
			this.isHiddenControl(markup.xControl) ||
			this.isHiddenControl(markup.yControl) ||
			this.isHiddenControl(markup.widthControl) ||
			this.isHiddenControl(markup.heightControl) ||
			this.isHiddenControl(markup.zoomControl)
		) {
			return false;
		}
		if (
			!this.hasAccessibleName(this.element, false) ||
			!this.hasAccessibleName(markup.selection, true) ||
			!this.hasAccessibleName(markup.resize, true) ||
			!this.hasAccessibleName(markup.xControl, true) ||
			!this.hasAccessibleName(markup.yControl, true) ||
			!this.hasAccessibleName(markup.widthControl, true) ||
			!this.hasAccessibleName(markup.heightControl, true) ||
			!this.hasAccessibleName(markup.zoomControl, true) ||
			markup.instructions.textContent?.trim() === ""
		) {
			return false;
		}
		const form = markup.xControl.form;
		if (
			markup.yControl.form !== form ||
			markup.widthControl.form !== form ||
			markup.heightControl.form !== form ||
			markup.zoomControl.form !== form
		) {
			return false;
		}
		return (
			markup.xControl.type === "range" &&
			markup.yControl.type === "range" &&
			markup.widthControl.type === "range" &&
			markup.heightControl.type === "range" &&
			markup.zoomControl.type === "range"
		);
	};

	private isTargetInThisRoot = (element: HTMLElement) => {
		if (element === this.element || !this.element.contains(element)) {
			return false;
		}
		let ancestor = element.parentElement;
		while (ancestor !== null && ancestor !== this.element) {
			const identifiers = ancestor.getAttribute("data-controller")?.split(/\s+/) ?? [];
			if (identifiers.includes("image-cropper")) {
				return false;
			}
			ancestor = ancestor.parentElement;
		}
		return ancestor === this.element;
	};

	private isAllowedRole = (element: HTMLElement, role: string) =>
		!element.hasAttribute("role") || element.getAttribute("role")?.trim() === role;

	private isHiddenControl = (element: HTMLInputElement) =>
		element.hidden || element.getAttribute("aria-hidden")?.trim().toLowerCase() === "true";

	private hasAccessibleName = (element: HTMLElement, allowButtonText: boolean) => {
		const labelledBy = element.getAttribute("aria-labelledby");
		if (labelledBy !== null) {
			const ids = labelledBy.trim().split(/\s+/).filter(Boolean);
			return (
				ids.length > 0 &&
				ids.every((id) => {
					const labelledElement = element.ownerDocument.getElementById(id);
					return (
						labelledElement !== null &&
						labelledElement.ownerDocument === element.ownerDocument &&
						labelledElement.textContent?.trim() !== ""
					);
				})
			);
		}
		if (element.getAttribute("aria-label")?.trim()) {
			return true;
		}
		if (allowButtonText && element instanceof HTMLButtonElement && element.textContent?.trim()) {
			return true;
		}
		if (element instanceof HTMLInputElement || element instanceof HTMLButtonElement) {
			const labels = element.labels;
			if (labels !== null && Array.from(labels).some((label) => label.textContent?.trim() !== "")) {
				return true;
			}
		}
		return false;
	};

	private isValidConfiguration = () =>
		Number.isFinite(this.stepValue) &&
		this.stepValue > 0 &&
		Number.isFinite(this.zoomStepValue) &&
		this.zoomStepValue > 0 &&
		Number.isFinite(this.minWidthValue) &&
		this.minWidthValue > 0 &&
		this.minWidthValue <= 100 &&
		Number.isFinite(this.minHeightValue) &&
		this.minHeightValue > 0 &&
		this.minHeightValue <= 100 &&
		Number.isFinite(this.maxZoomValue) &&
		this.maxZoomValue >= 1 &&
		Number.isFinite(100 * this.maxZoomValue);

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			"image-cropper controller: Provide the root, ten targets, native button / input[type=range] controls, accessible names, instructions, settings, and value shape specified in the contract. Enhancement has been disabled.",
		);
	};

	private applyStructure = (markup: Markup) => {
		const completionAttributes: string[] = [];
		const viewportId = ensureElementId(markup.viewport, "image-cropper-viewport");
		const xId = ensureElementId(markup.xControl, "image-cropper-x-control");
		const yId = ensureElementId(markup.yControl, "image-cropper-y-control");
		const widthId = ensureElementId(markup.widthControl, "image-cropper-width-control");
		const heightId = ensureElementId(markup.heightControl, "image-cropper-height-control");
		ensureElementId(markup.zoomControl, "image-cropper-zoom-control");
		const instructionsId = ensureElementId(markup.instructions, "image-cropper-instructions");

		if (!this.element.hasAttribute("role")) {
			this.element.setAttribute("role", "group");
			completionAttributes.push('root role="group"');
		}
		if (!markup.selection.hasAttribute("type")) {
			markup.selection.setAttribute("type", "button");
			completionAttributes.push('selection type="button"');
		}
		if (!markup.resize.hasAttribute("type")) {
			markup.resize.setAttribute("type", "button");
			completionAttributes.push('resize type="button"');
		}
		if (!markup.image.hasAttribute("draggable")) {
			markup.image.setAttribute("draggable", "false");
			completionAttributes.push('image draggable="false"');
		}
		if (!markup.selection.hasAttribute("aria-controls")) {
			markup.selection.setAttribute("aria-controls", `${xId} ${yId}`);
			completionAttributes.push("selection aria-controls");
		}
		if (!markup.resize.hasAttribute("aria-controls")) {
			markup.resize.setAttribute("aria-controls", `${widthId} ${heightId}`);
			completionAttributes.push("resize aria-controls");
		}
		const controls = [
			[markup.xControl, viewportId, "xControl aria-controls"],
			[markup.yControl, viewportId, "yControl aria-controls"],
			[markup.widthControl, viewportId, "widthControl aria-controls"],
			[markup.heightControl, viewportId, "heightControl aria-controls"],
			[markup.zoomControl, viewportId, "zoomControl aria-controls"],
		] as const;
		for (const [control, controlId, label] of controls) {
			if (control.hasAttribute("aria-controls")) {
				continue;
			}
			control.setAttribute("aria-controls", controlId);
			completionAttributes.push(label);
		}
		this.appendDescription(markup.selection, instructionsId);
		this.appendDescription(markup.resize, instructionsId);
		return completionAttributes;
	};

	private appendDescription = (element: HTMLElement, id: string) => {
		const tokens = element.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? [];
		if (!tokens.includes(id)) {
			tokens.push(id);
		}
		element.setAttribute("aria-describedby", tokens.join(" "));
	};

	private warnCompletion = (attributes: readonly string[]) => {
		if (attributes.length === 0 || this.completionWarningIssued) {
			return;
		}
		this.completionWarningIssued = true;
		console.warn(
			`image-cropper controller: Added ${attributes.join(", ")}. Include them in your markup.`,
		);
	};

	private bind = (markup: Markup) => {
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		markup.selection.addEventListener("pointerdown", this.handleDirectPointerdown);
		markup.selection.addEventListener("pointermove", this.handleDirectPointermove);
		markup.selection.addEventListener("pointerup", this.handleDirectPointerup);
		markup.selection.addEventListener("pointercancel", this.handleDirectPointercancel);
		markup.selection.addEventListener("lostpointercapture", this.handleLostPointerCapture);
		markup.resize.addEventListener("pointerdown", this.handleDirectPointerdown);
		markup.resize.addEventListener("pointermove", this.handleDirectPointermove);
		markup.resize.addEventListener("pointerup", this.handleDirectPointerup);
		markup.resize.addEventListener("pointercancel", this.handleDirectPointercancel);
		markup.resize.addEventListener("lostpointercapture", this.handleLostPointerCapture);

		for (const [control, field] of this.rangeEntries(markup)) {
			control.addEventListener("pointerdown", this.handleRangePointerdown);
			control.addEventListener("pointerup", this.handleRangePointerup);
			control.addEventListener("pointercancel", this.handleRangePointercancel);
			control.addEventListener("keyup", this.handleRangeKeyup);
			control.addEventListener("input", this.handleRangeInput);
			control.addEventListener("change", this.handleRangeChange);
			control.addEventListener("blur", this.handleRangeBlur);
			void field;
			if (control.form !== null) {
				this.boundForms.add(control.form);
			}
		}
		this.element.ownerDocument.addEventListener("reset", this.handleFormReset, true);
		this.boundDocument = this.element.ownerDocument;

		const view = this.element.ownerDocument.defaultView;
		if (view !== null) {
			view.addEventListener("keydown", this.handleWindowKeydown);
			view.addEventListener("blur", this.handleWindowBlur);
			this.boundWindow = view;
		}
		this.boundMarkup = markup;
	};

	private unbind = () => {
		this.resetTasks.cancel();
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		const markup = this.boundMarkup;
		if (markup !== null) {
			markup.selection.removeEventListener("pointerdown", this.handleDirectPointerdown);
			markup.selection.removeEventListener("pointermove", this.handleDirectPointermove);
			markup.selection.removeEventListener("pointerup", this.handleDirectPointerup);
			markup.selection.removeEventListener("pointercancel", this.handleDirectPointercancel);
			markup.selection.removeEventListener("lostpointercapture", this.handleLostPointerCapture);
			markup.resize.removeEventListener("pointerdown", this.handleDirectPointerdown);
			markup.resize.removeEventListener("pointermove", this.handleDirectPointermove);
			markup.resize.removeEventListener("pointerup", this.handleDirectPointerup);
			markup.resize.removeEventListener("pointercancel", this.handleDirectPointercancel);
			markup.resize.removeEventListener("lostpointercapture", this.handleLostPointerCapture);
			for (const [control] of this.rangeEntries(markup)) {
				control.removeEventListener("pointerdown", this.handleRangePointerdown);
				control.removeEventListener("pointerup", this.handleRangePointerup);
				control.removeEventListener("pointercancel", this.handleRangePointercancel);
				control.removeEventListener("keyup", this.handleRangeKeyup);
				control.removeEventListener("input", this.handleRangeInput);
				control.removeEventListener("change", this.handleRangeChange);
				control.removeEventListener("blur", this.handleRangeBlur);
			}
		}
		this.boundForms.clear();
		this.boundDocument?.removeEventListener("reset", this.handleFormReset, true);
		this.boundDocument = null;
		this.boundWindow?.removeEventListener("keydown", this.handleWindowKeydown);
		this.boundWindow?.removeEventListener("blur", this.handleWindowBlur);
		this.boundWindow = null;
		this.boundMarkup = null;
		this.boundConfiguration = null;
	};

	private rangeEntries = (markup: Markup): readonly (readonly [HTMLInputElement, RangeField])[] => [
		[markup.xControl, "x"],
		[markup.yControl, "y"],
		[markup.widthControl, "width"],
		[markup.heightControl, "height"],
		[markup.zoomControl, "zoom"],
	];

	private rangeFieldFor = (control: HTMLInputElement, markup: Markup | null = this.boundMarkup) => {
		if (markup === null) {
			return null;
		}
		for (const [candidate, field] of this.rangeEntries(markup)) {
			if (candidate === control) {
				return field;
			}
		}
		return null;
	};

	private controlFor = (markup: Markup, field: RangeField) => {
		switch (field) {
			case "x":
				return markup.xControl;
			case "y":
				return markup.yControl;
			case "width":
				return markup.widthControl;
			case "height":
				return markup.heightControl;
			case "zoom":
				return markup.zoomControl;
		}
	};

	private effectiveValue = () => this.previewValue ?? this.committedValue;

	private normalizeValue = (value: ImageCropperValue): ImageCropperValue => {
		const width = clamp(value.width, this.minWidthValue, 100);
		const height = clamp(value.height, this.minHeightValue, 100);
		const zoom = clamp(value.zoom, 1, this.maxZoomValue);
		return {
			x: clamp(value.x, 0, 100 - width),
			y: clamp(value.y, 0, 100 - height),
			width,
			height,
			zoom,
			offsetX: clamp(value.offsetX, 100 - 100 * zoom, 0),
			offsetY: clamp(value.offsetY, 100 - 100 * zoom, 0),
		};
	};

	private normalizeField = (base: ImageCropperValue, field: RangeField, rawValue: number) => {
		if (!Number.isFinite(rawValue)) {
			return cloneValue(base);
		}
		const value = cloneValue(base);
		switch (field) {
			case "x":
				value.x = clamp(rawValue, 0, 100 - value.width);
				return value;
			case "y":
				value.y = clamp(rawValue, 0, 100 - value.height);
				return value;
			case "width":
				value.width = clamp(rawValue, this.minWidthValue, 100 - value.x);
				return value;
			case "height":
				value.height = clamp(rawValue, this.minHeightValue, 100 - value.y);
				return value;
			case "zoom":
				return this.zoomValue(base, rawValue);
		}
	};

	private zoomValue = (base: ImageCropperValue, rawZoom: number): ImageCropperValue => {
		const zoom = clamp(rawZoom, 1, this.maxZoomValue);
		const value = cloneValue(base);
		value.zoom = zoom;
		if (zoom === 1) {
			value.offsetX = 0;
			value.offsetY = 0;
			return value;
		}
		const centerX = base.x + base.width / 2;
		const centerY = base.y + base.height / 2;
		value.offsetX = clamp(
			centerX - ((centerX - base.offsetX) / base.zoom) * zoom,
			100 - 100 * zoom,
			0,
		);
		value.offsetY = clamp(
			centerY - ((centerY - base.offsetY) / base.zoom) * zoom,
			100 - 100 * zoom,
			0,
		);
		return value;
	};

	private rangeBounds = (value: ImageCropperValue, field: RangeField) => {
		switch (field) {
			case "x":
				return { min: 0, max: 100 - value.width };
			case "y":
				return { min: 0, max: 100 - value.height };
			case "width":
				return { min: this.minWidthValue, max: 100 - value.x };
			case "height":
				return { min: this.minHeightValue, max: 100 - value.y };
			case "zoom":
				return { min: 1, max: this.maxZoomValue };
		}
	};

	private syncState = () => {
		const value = this.effectiveValue();
		if (value === null) {
			return;
		}
		this.element.dataset.state = this.stateForInteraction();
		const properties: readonly (readonly [string, number])[] = [
			["--image-cropper-x", value.x],
			["--image-cropper-y", value.y],
			["--image-cropper-width", value.width],
			["--image-cropper-height", value.height],
			["--image-cropper-zoom", value.zoom],
			["--image-cropper-offset-x", value.offsetX],
			["--image-cropper-offset-y", value.offsetY],
		];
		for (const [property, propertyValue] of properties) {
			this.element.style.setProperty(property, String(propertyValue));
		}
		const markup = this.boundMarkup;
		if (markup === null) {
			return;
		}
		for (const [control, field] of this.rangeEntries(markup)) {
			const bounds = this.rangeBounds(value, field);
			control.min = String(bounds.min);
			control.max = String(bounds.max);
			control.step = "any";
			control.value = String(value[field]);
		}
	};

	private stateForInteraction = () => {
		const interaction = this.interaction;
		if (interaction?.type === "direct") {
			return interaction.field === "selection" ? "moving" : "resizing";
		}
		if (interaction?.type === "range") {
			if (!interaction.physicalEnded) {
				return "adjusting";
			}
			if (this.previewValue !== null && !sameValue(this.previewValue, interaction.origin)) {
				return "adjusting";
			}
		}
		return "idle";
	};

	private directionFor = (viewport: HTMLElement): Direction => {
		const view = viewport.ownerDocument.defaultView;
		if (view === null) {
			return "ltr";
		}
		return view.getComputedStyle(viewport).direction === "rtl" ? "rtl" : "ltr";
	};

	private sourceRectFor = (
		value: ImageCropperValue,
		direction: Direction,
	): ImageCropperSourceRect => {
		const denominator = 100 * value.zoom;
		const rawX =
			direction === "rtl"
				? 1 - (value.x + value.width - value.offsetX) / denominator
				: (value.x - value.offsetX) / denominator;
		const rawY = (value.y - value.offsetY) / denominator;
		const rawWidth = value.width / denominator;
		const rawHeight = value.height / denominator;
		const left = clamp(rawX, 0, 1);
		const top = clamp(rawY, 0, 1);
		const right = clamp(rawX + rawWidth, 0, 1);
		const bottom = clamp(rawY + rawHeight, 0, 1);
		return {
			x: left,
			y: top,
			width: Math.max(0, right - left),
			height: Math.max(0, bottom - top),
		};
	};

	private readGeometry = (viewport: HTMLElement): ViewportGeometry | null => {
		if (viewport.ownerDocument.defaultView === null) {
			return null;
		}
		const rect = viewport.getBoundingClientRect();
		if (
			!Number.isFinite(rect.left) ||
			!Number.isFinite(rect.top) ||
			!Number.isFinite(rect.width) ||
			!Number.isFinite(rect.height) ||
			rect.width <= 0 ||
			rect.height <= 0
		) {
			return null;
		}
		return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
	};

	private sameGeometry = (left: ViewportGeometry | null, right: ViewportGeometry | null) =>
		left !== null &&
		right !== null &&
		left.left === right.left &&
		left.top === right.top &&
		left.width === right.width &&
		left.height === right.height;

	private configurationSignature = () =>
		CONFIGURATION_ATTRIBUTES.map((attribute) => this.element.getAttribute(attribute));

	private sameConfiguration = (
		left: readonly (string | null)[],
		right: readonly (string | null)[],
	) => left.length === right.length && left.every((value, index) => value === right[index]);

	private isDisabled = (element: HTMLElement) => element.matches(":disabled");

	private disabledSnapshot = (markup: Markup): DisabledSnapshot => ({
		selection: this.isDisabled(markup.selection),
		resize: this.isDisabled(markup.resize),
		x: this.isDisabled(markup.xControl),
		y: this.isDisabled(markup.yControl),
		width: this.isDisabled(markup.widthControl),
		height: this.isDisabled(markup.heightControl),
		zoom: this.isDisabled(markup.zoomControl),
	});

	private sameDisabled = (left: DisabledSnapshot, right: DisabledSnapshot) =>
		left.selection === right.selection &&
		left.resize === right.resize &&
		left.x === right.x &&
		left.y === right.y &&
		left.width === right.width &&
		left.height === right.height &&
		left.zoom === right.zoom;

	private captureContext = (
		markup: Markup,
		geometry: ViewportGeometry | null,
	): OperationContext => ({
		markup,
		direction: this.directionFor(markup.viewport),
		configuration: this.configurationSignature(),
		disabled: this.disabledSnapshot(markup),
		geometry,
	});

	private hasTarget = (element: HTMLElement, target: string) =>
		(element.getAttribute("data-image-cropper-target") ?? "").split(/\s+/).includes(target);

	private sameMarkup = (left: Markup, right: Markup) =>
		left.viewport === right.viewport &&
		left.image === right.image &&
		left.selection === right.selection &&
		left.resize === right.resize &&
		left.xControl === right.xControl &&
		left.yControl === right.yControl &&
		left.widthControl === right.widthControl &&
		left.heightControl === right.heightControl &&
		left.zoomControl === right.zoomControl &&
		left.instructions === right.instructions;

	private markupStillCurrent = (markup: Markup) =>
		this.isTargetInThisRoot(markup.viewport) &&
		this.isTargetInThisRoot(markup.image) &&
		this.isTargetInThisRoot(markup.selection) &&
		this.isTargetInThisRoot(markup.resize) &&
		this.isTargetInThisRoot(markup.xControl) &&
		this.isTargetInThisRoot(markup.yControl) &&
		this.isTargetInThisRoot(markup.widthControl) &&
		this.isTargetInThisRoot(markup.heightControl) &&
		this.isTargetInThisRoot(markup.zoomControl) &&
		this.isTargetInThisRoot(markup.instructions) &&
		this.hasTarget(markup.viewport, "viewport") &&
		this.hasTarget(markup.image, "image") &&
		this.hasTarget(markup.selection, "selection") &&
		this.hasTarget(markup.resize, "resize") &&
		this.hasTarget(markup.xControl, "xControl") &&
		this.hasTarget(markup.yControl, "yControl") &&
		this.hasTarget(markup.widthControl, "widthControl") &&
		this.hasTarget(markup.heightControl, "heightControl") &&
		this.hasTarget(markup.zoomControl, "zoomControl") &&
		this.hasTarget(markup.instructions, "instructions");

	private isBindingCurrent = () => {
		const markup = this.getMarkup();
		const configuration = this.boundConfiguration;
		return (
			this.element.getAttribute("data-controller")?.split(/\s+/).includes("image-cropper") ===
				true &&
			markup !== null &&
			this.boundMarkup !== null &&
			this.sameMarkup(markup, this.boundMarkup) &&
			this.markupStillCurrent(this.boundMarkup) &&
			this.isStructureCurrent(markup) &&
			this.isValidMarkup() &&
			this.isValidConfiguration() &&
			isImageCropperValue(this.valueValue) &&
			this.lastValueAttribute === this.element.getAttribute("data-image-cropper-value-value") &&
			configuration !== null &&
			this.sameConfiguration(configuration, this.configurationSignature())
		);
	};

	private isStructureCurrent = (markup: Markup) => {
		const controls = this.rangeEntries(markup).map(([control]) => control);
		const form = markup.xControl.form;
		return (
			this.element.hasAttribute("role") &&
			markup.image.hasAttribute("draggable") &&
			[markup.viewport, markup.instructions, ...controls].every((element) => element.id !== "") &&
			[markup.selection, markup.resize].every(
				(button) =>
					button.hasAttribute("type") &&
					(button.getAttribute("aria-describedby") ?? "")
						.split(/\s+/)
						.includes(markup.instructions.id),
			) &&
			[markup.selection, markup.resize, ...controls].every((element) =>
				element.hasAttribute("aria-controls"),
			) &&
			(form === null
				? this.boundForms.size === 0
				: this.boundForms.size === 1 && this.boundForms.has(form))
		);
	};

	private contextStillValid = (context: OperationContext) => {
		const currentMarkup = this.getMarkup();
		if (
			!this.connected ||
			!this.enhanced ||
			this.element.getAttribute("data-controller")?.split(/\s+/).includes("image-cropper") !==
				true ||
			currentMarkup === null ||
			!this.sameMarkup(currentMarkup, context.markup) ||
			!this.markupStillCurrent(context.markup) ||
			!this.isValidMarkup() ||
			!this.isValidConfiguration() ||
			!isImageCropperValue(this.valueValue) ||
			!this.sameConfiguration(context.configuration, this.configurationSignature()) ||
			this.directionFor(context.markup.viewport) !== context.direction ||
			!this.sameDisabled(context.disabled, this.disabledSnapshot(context.markup))
		) {
			return false;
		}
		if (
			context.geometry !== null &&
			!this.sameGeometry(context.geometry, this.readGeometry(context.markup.viewport))
		) {
			return false;
		}
		return true;
	};

	private invalidateInteraction = (rememberStale: boolean) => {
		const interaction = this.interaction;
		if (interaction?.type === "range" && rememberStale) {
			this.rememberStaleRange(interaction);
		}
		if (interaction?.type === "direct") {
			this.releaseDirectCapture(interaction);
		}
		this.interaction = null;
		this.previewValue = null;
		this.revision += 1;
		if (this.committedValue !== null) {
			this.syncState();
		}
	};

	private rememberStaleRange = (interaction: RangeInteraction) => {
		this.staleRanges.set(interaction.control, {
			control: interaction.control,
			field: interaction.field,
			pointerId: interaction.pointerId,
			physicalEnded: interaction.physicalEnded,
			consumeUntilChange: false,
		});
	};

	private rememberConflictingRange = (control: HTMLInputElement, field: RangeField) => {
		this.staleRanges.set(control, {
			control,
			field,
			pointerId: null,
			physicalEnded: false,
			consumeUntilChange: true,
		});
	};

	private releaseDirectCapture = (interaction: DirectInteraction) => {
		interaction.releasingCapture = true;
		try {
			if (interaction.button.hasPointerCapture(interaction.pointerId)) {
				interaction.button.releasePointerCapture(interaction.pointerId);
			}
		} catch {
			// Capture may already have been released.
		} finally {
			interaction.releasingCapture = false;
		}
	};

	private handleClick = (event: MouseEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		const target = event.target;
		const markup = this.boundMarkup;
		if (markup === null || !(target instanceof Node)) {
			return;
		}
		const button = markup.selection.contains(target)
			? markup.selection
			: markup.resize.contains(target)
				? markup.resize
				: null;
		if (button === null) {
			return;
		}
		if (this.suppressedClickTarget === button) {
			this.suppressedClickTarget = null;
			return;
		}
		if (this.isDisabled(button)) {
			return;
		}
		this.invalidateInteraction(true);
		const control =
			button === markup.selection
				? this.enabledControl(markup.xControl, markup.yControl)
				: this.enabledControl(markup.widthControl, markup.heightControl);
		if (control === null) {
			return;
		}
		this.openDetailsFor(control);
		control.focus();
	};

	private enabledControl = (first: HTMLInputElement, second: HTMLInputElement) => {
		if (!this.isDisabled(first)) {
			return first;
		}
		if (!this.isDisabled(second)) {
			return second;
		}
		return null;
	};

	private openDetailsFor = (element: HTMLElement) => {
		const details: HTMLDetailsElement[] = [];
		let ancestor = element.parentElement;
		while (ancestor !== null && ancestor !== this.element) {
			if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
				details.push(ancestor);
			}
			ancestor = ancestor.parentElement;
		}
		for (const detail of details.reverse()) {
			detail.open = true;
		}
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted || isImeKeydown(event)) {
			return;
		}
		const target = event.target;
		const markup = this.boundMarkup;
		if (markup === null || !(target instanceof Node)) {
			return;
		}
		if (markup.selection.contains(target)) {
			this.suppressedClickTarget = null;
			this.handleDirectKeydown(event, markup.selection, "selection");
			return;
		}
		if (markup.resize.contains(target)) {
			this.suppressedClickTarget = null;
			this.handleDirectKeydown(event, markup.resize, "resize");
			return;
		}
		const field = markup.xControl.contains(target)
			? "x"
			: markup.yControl.contains(target)
				? "y"
				: markup.widthControl.contains(target)
					? "width"
					: markup.heightControl.contains(target)
						? "height"
						: markup.zoomControl.contains(target)
							? "zoom"
							: null;
		if (field !== null) {
			this.handleRangeKeydown(event, field);
		}
	};

	private handleDirectKeydown = (
		event: KeyboardEvent,
		button: HTMLButtonElement,
		field: "selection" | "resize",
	) => {
		if (this.isDisabled(button) || this.interaction?.type === "direct") {
			return;
		}
		const markup = this.boundMarkup;
		const base = this.committedValue;
		if (markup === null || base === null) {
			return;
		}
		const direction = this.directionFor(markup.viewport);
		const horizontalDelta = direction === "rtl" ? -this.stepValue : this.stepValue;
		const hasPrimaryModifier = event.altKey || event.ctrlKey || event.metaKey;
		if (hasPrimaryModifier) {
			return;
		}

		let rangeField: RangeField | null = null;
		let delta = 0;
		if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			if (field === "resize" && event.shiftKey) {
				return;
			}
			delta = event.key === "ArrowRight" ? horizontalDelta : -horizontalDelta;
			rangeField =
				field === "selection" && event.shiftKey ? "width" : field === "selection" ? "x" : "width";
		} else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
			if (field === "resize" && event.shiftKey) {
				return;
			}
			delta = event.key === "ArrowDown" ? this.stepValue : -this.stepValue;
			rangeField =
				field === "selection" && event.shiftKey ? "height" : field === "selection" ? "y" : "height";
		} else if (event.key === "+" || event.key === "=") {
			rangeField = "zoom";
			delta = this.zoomStepValue;
		} else if (event.key === "-") {
			if (event.shiftKey) {
				return;
			}
			rangeField = "zoom";
			delta = -this.zoomStepValue;
		} else if (event.key === "Escape") {
			if (this.interaction === null) {
				return;
			}
			this.invalidateInteraction(true);
			if (event.cancelable) {
				event.preventDefault();
			}
			return;
		} else {
			return;
		}

		if (rangeField === null || this.isRangeFieldDisabled(markup, rangeField)) {
			return;
		}
		this.invalidateInteraction(true);
		const current = this.committedValue;
		if (current === null) {
			return;
		}
		const candidate = this.normalizeField(current, rangeField, current[rangeField] + delta);
		if (event.cancelable) {
			event.preventDefault();
		}
		this.requestUserChange(
			candidate,
			current,
			"keyboard",
			this.captureContext(markup, null),
			this.revision,
		);
	};

	private isRangeFieldDisabled = (markup: Markup, field: RangeField) =>
		this.isDisabled(this.controlFor(markup, field));

	private handleDirectPointerdown = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted || !event.isPrimary || event.button !== 0) {
			return;
		}
		const button = event.currentTarget;
		const markup = this.boundMarkup;
		if (!(button instanceof HTMLButtonElement) || markup === null) {
			return;
		}
		this.suppressedClickTarget = null;
		if (this.isDisabled(button) || this.interaction?.type === "direct") {
			return;
		}
		const geometry = this.readGeometry(markup.viewport);
		if (geometry === null) {
			return;
		}
		if (this.interaction !== null) {
			this.invalidateInteraction(true);
		}
		try {
			button.setPointerCapture(event.pointerId);
		} catch {
			return;
		}
		this.interaction = {
			type: "direct",
			button,
			field: button === markup.selection ? "selection" : "resize",
			pointerId: event.pointerId,
			origin: cloneValue(this.committedValue ?? DEFAULT_VALUE),
			startX: event.clientX,
			startY: event.clientY,
			context: this.captureContext(markup, geometry),
			moved: false,
			releasingCapture: false,
		};
		this.syncState();
		const interaction = this.interaction;
		if (interaction?.type !== "direct") {
			return;
		}
		queueMicrotask(() => {
			if (this.interaction !== interaction) {
				return;
			}
			if (!this.connected || !interaction.button.hasPointerCapture(interaction.pointerId)) {
				this.invalidateInteraction(true);
			}
		});
	};

	private handleDirectPointermove = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted || !event.isPrimary) {
			return;
		}
		const interaction = this.interaction;
		if (interaction?.type !== "direct" || interaction.pointerId !== event.pointerId) {
			return;
		}
		if (!interaction.button.hasPointerCapture(interaction.pointerId)) {
			this.invalidateInteraction(true);
			return;
		}
		if (!this.contextStillValid(interaction.context)) {
			this.invalidateInteraction(true);
			return;
		}
		if (event.clientX !== interaction.startX || event.clientY !== interaction.startY) {
			interaction.moved = true;
		}
		this.previewDirect(interaction, event.clientX, event.clientY);
	};

	private previewDirect = (interaction: DirectInteraction, clientX: number, clientY: number) => {
		const geometry = interaction.context.geometry;
		const base = interaction.origin;
		if (geometry === null) {
			return;
		}
		const directionSign = interaction.context.direction === "rtl" ? -1 : 1;
		const deltaX = ((clientX - interaction.startX) / geometry.width) * 100 * directionSign;
		const deltaY = ((clientY - interaction.startY) / geometry.height) * 100;
		const candidate = cloneValue(base);
		if (interaction.field === "selection") {
			if (!interaction.context.disabled.x) {
				candidate.x = clamp(base.x + deltaX, 0, 100 - base.width);
			}
			if (!interaction.context.disabled.y) {
				candidate.y = clamp(base.y + deltaY, 0, 100 - base.height);
			}
		} else {
			if (!interaction.context.disabled.width) {
				candidate.width = clamp(base.width + deltaX, this.minWidthValue, 100 - base.x);
			}
			if (!interaction.context.disabled.height) {
				candidate.height = clamp(base.height + deltaY, this.minHeightValue, 100 - base.y);
			}
		}
		this.previewValue = candidate;
		this.syncState();
	};

	private handleDirectPointerup = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted || !event.isPrimary) {
			return;
		}
		const interaction = this.interaction;
		if (interaction?.type !== "direct" || interaction.pointerId !== event.pointerId) {
			return;
		}
		if (!interaction.button.hasPointerCapture(interaction.pointerId)) {
			this.invalidateInteraction(true);
			return;
		}
		if (!this.contextStillValid(interaction.context)) {
			this.invalidateInteraction(true);
			return;
		}
		if (event.clientX !== interaction.startX || event.clientY !== interaction.startY) {
			interaction.moved = true;
		}
		this.previewDirect(interaction, event.clientX, event.clientY);
		interaction.releasingCapture = true;
		this.releaseDirectCapture(interaction);
		interaction.releasingCapture = false;
		const candidate = this.previewValue ?? interaction.origin;
		const context = interaction.context;
		const origin = interaction.origin;
		const moved = interaction.moved;
		this.interaction = null;
		this.previewValue = null;
		this.revision += 1;
		this.syncState();
		if (moved) {
			this.suppressedClickTarget = interaction.button;
		}
		this.requestUserChange(candidate, origin, "pointer", context, this.revision);
	};

	private handleDirectPointercancel = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted || !event.isPrimary) {
			return;
		}
		const interaction = this.interaction;
		if (interaction?.type !== "direct" || interaction.pointerId !== event.pointerId) {
			return;
		}
		this.invalidateInteraction(true);
	};

	private handleLostPointerCapture = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted || !event.isPrimary) {
			return;
		}
		const interaction = this.interaction;
		if (
			interaction?.type !== "direct" ||
			interaction.button !== event.currentTarget ||
			interaction.pointerId !== event.pointerId ||
			interaction.releasingCapture
		) {
			return;
		}
		this.invalidateInteraction(true);
	};

	private requestUserChange = (
		candidate: ImageCropperValue,
		previous: ImageCropperValue,
		reason: ChangeReason,
		context: OperationContext,
		revision: number,
	) => {
		if (sameValue(candidate, previous)) {
			this.committedValue = cloneValue(previous);
			this.previewValue = null;
			this.syncState();
			return;
		}
		const beforeDetail = this.changeDetail(candidate, previous, context.direction, reason);
		this.previewValue = null;
		this.committedValue = cloneValue(previous);
		this.syncState();
		const beforeChange = new CustomEvent<ImageCropperChangeDetail>("image-cropper:beforechange", {
			bubbles: true,
			cancelable: true,
			detail: beforeDetail,
		});
		const allowed = this.element.dispatchEvent(beforeChange);
		if (revision !== this.revision || !this.contextStillValid(context)) {
			return;
		}
		if (!allowed) {
			this.committedValue = cloneValue(previous);
			this.previewValue = null;
			this.syncState();
			return;
		}
		this.committedValue = cloneValue(candidate);
		this.previewValue = null;
		this.syncState();
		this.element.dispatchEvent(
			new CustomEvent<ImageCropperChangeDetail>("image-cropper:change", {
				bubbles: true,
				cancelable: false,
				detail: this.changeDetail(
					candidate,
					previous,
					this.directionFor(context.markup.viewport),
					reason,
				),
			}),
		);
	};

	private changeDetail = (
		value: ImageCropperValue,
		previousValue: ImageCropperValue,
		direction: Direction,
		reason: ChangeReason,
	): ImageCropperChangeDetail => ({
		value: cloneValue(value),
		previousValue: cloneValue(previousValue),
		sourceRect: cloneSourceRect(this.sourceRectFor(value, direction)),
		previousSourceRect: cloneSourceRect(this.sourceRectFor(previousValue, direction)),
		reason,
	});

	private handleRangePointerdown = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted || !event.isPrimary || event.button !== 0) {
			return;
		}
		const control = event.currentTarget;
		if (!(control instanceof HTMLInputElement)) {
			return;
		}
		const field = this.rangeFieldFor(control);
		if (field === null || this.isDisabled(control)) {
			return;
		}
		if (this.interaction?.type === "direct") {
			this.invalidateInteraction(true);
		}
		this.startRangeInteraction(control, field, "pointer", event.pointerId);
	};

	private handleRangePointerup = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted || !event.isPrimary) {
			return;
		}
		const control = event.currentTarget;
		if (!(control instanceof HTMLInputElement)) {
			return;
		}
		const interaction = this.interaction;
		if (interaction?.type === "range" && interaction.control === control) {
			if (interaction.pointerId !== event.pointerId) {
				return;
			}
			if (!this.contextStillValid(interaction.context) || this.isDisabled(control)) {
				this.invalidateInteraction(true);
				return;
			}
			interaction.physicalEnded = true;
			if (this.previewValue === null || sameValue(this.previewValue, interaction.origin)) {
				this.previewValue = null;
				this.syncState();
			}
			return;
		}
		const stale = this.staleRanges.get(control);
		if (stale?.consumeUntilChange) {
			this.staleRanges.delete(control);
			return;
		}
		if (stale !== undefined && stale.pointerId === event.pointerId) {
			stale.physicalEnded = true;
		}
	};

	private handleRangePointercancel = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted || !event.isPrimary) {
			return;
		}
		const control = event.currentTarget;
		if (!(control instanceof HTMLInputElement)) {
			return;
		}
		const interaction = this.interaction;
		if (interaction?.type === "range" && interaction.control === control) {
			if (interaction.pointerId !== event.pointerId) {
				return;
			}
			this.invalidateInteraction(true);
			return;
		}
		const stale = this.staleRanges.get(control);
		if (stale?.consumeUntilChange) {
			this.staleRanges.delete(control);
			return;
		}
		if (stale === undefined || stale.pointerId === event.pointerId) {
			this.staleRanges.delete(control);
		}
	};

	private handleRangeKeyup = (event: KeyboardEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		const control = event.currentTarget;
		if (!(control instanceof HTMLInputElement)) {
			return;
		}
		const interaction = this.interaction;
		if (interaction?.type === "range" && interaction.control === control) {
			if (!this.isNativeRangeKey(event.key)) {
				return;
			}
			if (!this.contextStillValid(interaction.context) || this.isDisabled(control)) {
				this.invalidateInteraction(true);
				return;
			}
			interaction.physicalEnded = true;
			if (this.previewValue === null || sameValue(this.previewValue, interaction.origin)) {
				this.previewValue = null;
				this.syncState();
			}
			return;
		}
		const stale = this.staleRanges.get(control);
		if (stale?.consumeUntilChange) {
			this.staleRanges.delete(control);
			return;
		}
		if (stale !== undefined && this.isNativeRangeKey(event.key)) {
			stale.physicalEnded = true;
		}
	};

	private handleRangeKeydown = (event: KeyboardEvent, field: RangeField) => {
		if (!event.isTrusted || isImeKeydown(event)) {
			return;
		}
		const markup = this.boundMarkup;
		if (markup === null) {
			return;
		}
		const control = this.controlFor(markup, field);
		if (this.isDisabled(control) || !this.isNativeRangeKey(event.key)) {
			return;
		}
		const interaction = this.interaction;
		if (interaction?.type === "direct") {
			return;
		}
		if (
			interaction?.type === "range" &&
			interaction.control === control &&
			!interaction.physicalEnded
		) {
			return;
		}
		if (interaction !== null) {
			this.invalidateInteraction(true);
		}
		this.staleRanges.delete(control);
		this.startRangeInteraction(control, field, "keyboard", null);
	};

	private isNativeRangeKey = (key: string) =>
		[
			"ArrowLeft",
			"ArrowRight",
			"ArrowUp",
			"ArrowDown",
			"Home",
			"End",
			"PageUp",
			"PageDown",
		].includes(key);

	private startRangeInteraction = (
		control: HTMLInputElement,
		field: RangeField,
		reason: ChangeReason,
		pointerId: number | null,
	) => {
		if (this.committedValue === null || this.boundMarkup === null) {
			return;
		}
		const current = this.interaction;
		if (current?.type === "direct") {
			return;
		}
		if (current?.type === "range") {
			this.invalidateInteraction(true);
		}
		this.staleRanges.delete(control);
		this.interaction = {
			type: "range",
			control,
			field,
			origin: cloneValue(this.committedValue),
			reason,
			context: this.captureContext(this.boundMarkup, null),
			pointerId,
			physicalEnded: false,
		};
		this.previewValue = null;
		this.syncState();
	};

	private handleRangeInput = (event: Event) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const control = event.currentTarget;
		if (!(control instanceof HTMLInputElement)) {
			return;
		}
		const field = this.rangeFieldFor(control);
		if (field === null) {
			return;
		}
		if (!event.isTrusted) {
			this.syncState();
			return;
		}
		if (this.isDisabled(control)) {
			this.invalidateInteraction(true);
			return;
		}
		const nativeValue = control.valueAsNumber;
		let interaction = this.interaction;
		if (interaction?.type === "direct") {
			this.invalidateInteraction(true);
			this.rememberConflictingRange(control, field);
			return;
		}
		if (interaction?.type === "range" && interaction.control !== control) {
			this.invalidateInteraction(true);
			interaction = null;
		}
		if (interaction === null) {
			const stale = this.staleRanges.get(control);
			if (stale?.consumeUntilChange) {
				this.syncState();
				return;
			}
			if (stale !== undefined && !stale.physicalEnded) {
				this.syncState();
				return;
			}
			if (stale !== undefined) {
				this.staleRanges.delete(control);
			}
			const origin = this.committedValue;
			const markup = this.boundMarkup;
			if (origin === null || markup === null) {
				return;
			}
			this.requestUserChange(
				this.normalizeField(origin, field, nativeValue),
				origin,
				"keyboard",
				this.captureContext(markup, null),
				this.revision,
			);
			return;
		}
		if (interaction?.type !== "range" || interaction.control !== control) {
			return;
		}
		if (!this.contextStillValid(interaction.context)) {
			this.invalidateInteraction(true);
			return;
		}
		const nextValue = nativeValue;
		if (!Number.isFinite(nextValue)) {
			this.syncState();
			return;
		}
		this.previewValue = this.normalizeField(interaction.origin, field, nextValue);
		this.syncState();
	};

	private handleRangeChange = (event: Event) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const control = event.currentTarget;
		if (!(control instanceof HTMLInputElement)) {
			return;
		}
		const field = this.rangeFieldFor(control);
		if (field === null) {
			return;
		}
		if (!event.isTrusted) {
			this.syncState();
			return;
		}
		if (this.isDisabled(control)) {
			this.invalidateInteraction(true);
			return;
		}
		const nativeValue = control.valueAsNumber;
		let interaction = this.interaction;
		if (interaction?.type === "direct") {
			this.invalidateInteraction(true);
			this.rememberConflictingRange(control, field);
			return;
		}
		if (interaction?.type === "range" && interaction.control !== control) {
			this.invalidateInteraction(true);
			interaction = null;
		}
		if (interaction === null) {
			const stale = this.staleRanges.get(control);
			if (stale !== undefined) {
				this.syncState();
				this.staleRanges.delete(control);
				return;
			}
			this.startRangeInteraction(control, field, "keyboard", null);
			interaction = this.interaction;
		}
		if (interaction?.type !== "range" || interaction.control !== control) {
			return;
		}
		if (!this.contextStillValid(interaction.context)) {
			this.invalidateInteraction(true);
			return;
		}
		const nextValue = nativeValue;
		if (!Number.isFinite(nextValue)) {
			this.invalidateInteraction(true);
			return;
		}
		const candidate = this.normalizeField(interaction.origin, field, nextValue);
		const origin = interaction.origin;
		const reason = interaction.reason;
		const context = interaction.context;
		this.interaction = null;
		this.previewValue = null;
		this.revision += 1;
		this.syncState();
		this.staleRanges.delete(control);
		this.requestUserChange(candidate, origin, reason, context, this.revision);
	};

	private handleRangeBlur = (event: FocusEvent) => {
		const control = event.currentTarget;
		if (!(control instanceof HTMLInputElement)) {
			return;
		}
		const interaction = this.interaction;
		if (interaction?.type === "range" && interaction.control === control) {
			this.invalidateInteraction(true);
		}
	};

	private handleWindowKeydown = (event: KeyboardEvent) => {
		if (!event.isTrusted || isImeKeydown(event) || event.key !== "Escape") {
			return;
		}
		const interaction = this.interaction;
		if (interaction === null) {
			return;
		}
		this.invalidateInteraction(true);
		if (event.cancelable) {
			event.preventDefault();
		}
	};

	private handleWindowBlur = () => {
		if (this.interaction !== null) {
			this.invalidateInteraction(true);
		}
	};

	private handleFormReset = (event: Event) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const form = event.target;
		if (!(form instanceof HTMLFormElement) || !this.boundForms.has(form)) {
			return;
		}
		const revision = this.revision;
		const markup = this.boundMarkup;
		const configuration = this.configurationSignature();
		const direction = markup === null ? null : this.directionFor(markup.viewport);
		const disabled = markup === null ? null : this.disabledSnapshot(markup);
		this.resetTasks.schedule(() => {
			if (
				event.defaultPrevented ||
				!this.connected ||
				!this.enhanced ||
				!this.boundForms.has(form)
			) {
				return;
			}
			if (revision !== this.revision) {
				this.syncState();
				return;
			}
			if (
				markup === null ||
				this.boundMarkup === null ||
				!this.sameMarkup(markup, this.boundMarkup) ||
				!this.markupStillCurrent(markup) ||
				!this.isValidMarkup() ||
				!this.isValidConfiguration() ||
				!isImageCropperValue(this.valueValue) ||
				!this.sameConfiguration(configuration, this.configurationSignature()) ||
				(direction !== null && this.directionFor(markup.viewport) !== direction) ||
				(disabled !== null && !this.sameDisabled(disabled, this.disabledSnapshot(markup)))
			) {
				this.syncState();
				return;
			}
			if (this.initialValue === null) {
				return;
			}
			this.invalidateInteraction(true);
			this.committedValue = this.normalizeValue(this.initialValue);
			this.syncState();
		});
	};
}

export { ImageCropperController };
