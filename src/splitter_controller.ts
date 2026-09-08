import { Controller } from "@hotwired/stimulus";

import { ensureElementId } from "./internal/ensure_element_id";
import { hasAccessibleTextName } from "./internal/accessible_text_name";

type ChangeReason = "keyboard" | "pointer";

export type SplitterChangeDetail = {
	value: number;
	previousValue: number;
	reason: ChangeReason;
};

type PointerDrag = {
	pointerId: number;
	origin: number;
	offset: number;
};

/**
 * Controls a two-region split through pointer and keyboard interaction.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/splitter.contract.json
 */
export default class SplitterController extends Controller<HTMLElement> {
	static targets = ["handle", "primary", "range"];
	static values = {
		value: { type: Number, default: 50 },
		min: { type: Number, default: 0 },
		max: { type: Number, default: 100 },
		step: { type: Number, default: 1 },
		orientation: { type: String, default: "vertical" },
	};

	declare readonly handleTargets: HTMLElement[];
	declare readonly primaryTargets: HTMLElement[];
	declare readonly rangeTargets: HTMLInputElement[];
	declare readonly valueValue: number;
	declare readonly minValue: number;
	declare readonly maxValue: number;
	declare readonly stepValue: number;
	declare readonly orientationValue: string;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private initialized = false;
	private currentValue = 50;
	private rememberedValue: number | null = null;
	private boundHandle: HTMLElement | null = null;
	private boundRange: HTMLInputElement | null = null;
	private rangeReason: ChangeReason = "keyboard";
	private revision = 0;
	private drag: PointerDrag | null = null;

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.reconcile();
	};

	disconnect = () => {
		this.revision++;
		this.connected = false;
		this.disconnectCleanup();
		this.enhanced = false;
		this.drag = null;
	};

	handleTargetConnected = () => {
		if (this.connected) {
			this.reconcile();
		}
	};

	handleTargetDisconnected = () => {
		if (this.connected) {
			this.reconcile();
		}
	};

	primaryTargetConnected = () => {
		if (this.connected) {
			this.reconcile();
		}
	};

	primaryTargetDisconnected = () => {
		if (this.connected) {
			this.reconcile();
		}
	};

	rangeTargetConnected = () => {
		if (this.connected) {
			this.reconcile();
		}
	};

	rangeTargetDisconnected = () => {
		if (this.connected) {
			this.reconcile();
		}
	};

	valueValueChanged = (value: number) => {
		if (!this.connected || !this.initialized || !this.enhanced) {
			return;
		}
		if (!Number.isFinite(value)) {
			this.reconcile();
			return;
		}
		this.commitProgrammaticValue(value);
	};

	minValueChanged = () => {
		if (this.connected) {
			this.reconcile();
		}
	};

	maxValueChanged = () => {
		if (this.connected) {
			this.reconcile();
		}
	};

	stepValueChanged = () => {
		if (this.connected) {
			this.reconcile();
		}
	};

	orientationValueChanged = () => {
		if (this.connected) {
			this.reconcile();
		}
	};

	/**
	 * Current primary-pane ratio. Assignment synchronizes ARIA, data-state, and the CSS custom
	 * property without custom events.
	 */
	get value(): number {
		return this.currentValue;
	}

	/**
	 * Current primary-pane ratio. Assignment synchronizes ARIA, data-state, and the CSS custom
	 * property without custom events.
	 */
	set value(value: number) {
		if (!this.ensureEnhanced() || !Number.isFinite(value)) {
			return;
		}
		this.commitProgrammaticValue(value);
	}

	/**
	 * Collapses the primary pane to its minimum, remembering the previous ratio, without custom
	 * events.
	 *
	 * @returns No return value.
	 */
	collapse = () => {
		if (!this.ensureEnhanced() || this.currentValue === this.minValue) {
			return;
		}
		this.rememberedValue = this.currentValue;
		this.commitProgrammaticValue(this.minValue);
	};

	/**
	 * Restores the ratio saved before collapse without custom events. Does nothing when not
	 * collapsed.
	 *
	 * @returns No return value.
	 */
	expand = () => {
		if (!this.ensureEnhanced() || this.currentValue !== this.minValue) {
			return;
		}
		if (this.rememberedValue === null) {
			return;
		}
		const value = this.rememberedValue;
		this.rememberedValue = null;
		this.commitProgrammaticValue(value);
	};

	private ensureEnhanced = () => {
		if (this.connected && !this.enhanced) {
			this.reconcile();
		}
		return this.connected && this.enhanced;
	};

	private reconcile = () => {
		this.revision++;
		if (!this.isValidMarkup()) {
			this.enhanced = false;
			this.releasePointerCapture();
			this.unbind();
			this.warnInvalidMarkup();
			return;
		}

		this.releasePointerCapture();
		this.unbind();
		this.enhanced = true;
		if (!this.initialized) {
			this.initialized = true;
			this.currentValue = this.clamp(this.valueValue);
		} else {
			this.currentValue = this.clamp(this.currentValue);
		}
		const completionAttributes = this.applyStructure();
		this.bind();
		this.syncState();
		this.warnCompletion(completionAttributes);
	};

	private isValidMarkup = () => {
		if (this.handleTargets.length !== 1 || this.primaryTargets.length !== 1) {
			return false;
		}
		const handle = this.handleTargets[0];
		const primary = this.primaryTargets[0];
		if (
			!(handle instanceof HTMLElement) ||
			!(primary instanceof HTMLElement) ||
			handle === this.element ||
			primary === this.element ||
			!this.element.contains(handle) ||
			!this.element.contains(primary)
		) {
			return false;
		}

		return (
			this.isValidRange() &&
			this.hasAccessibleName(handle) &&
			Number.isFinite(this.valueValue) &&
			Number.isFinite(this.minValue) &&
			Number.isFinite(this.maxValue) &&
			Number.isFinite(this.stepValue) &&
			this.minValue >= 0 &&
			this.maxValue <= 100 &&
			this.minValue < this.maxValue &&
			this.stepValue > 0 &&
			(this.orientationValue === "vertical" || this.orientationValue === "horizontal")
		);
	};

	private isValidRange = () => {
		const range = this.rangeTargets[0];
		return (
			this.rangeTargets.length === 1 &&
			range instanceof HTMLInputElement &&
			range.type === "range" &&
			range !== this.element &&
			range !== this.handleTargets[0] &&
			range !== this.primaryTargets[0] &&
			this.element.contains(range) &&
			!range.matches(":disabled") &&
			!range.hidden &&
			(hasAccessibleTextName(range, false) ||
				Array.from(range.labels ?? []).some((label) => hasAccessibleTextName(label, true)))
		);
	};

	private hasAccessibleName = (handle: HTMLElement) => {
		if (handle.getAttribute("aria-label")?.trim()) {
			return true;
		}
		const labelledBy = handle.getAttribute("aria-labelledby")?.trim();
		if (!labelledBy) {
			return false;
		}
		return labelledBy.split(/\s+/).every((id) => handle.ownerDocument.getElementById(id) !== null);
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			"splitter controller: Provide one handle, one primary, and one named enabled native range input target inside the root. Name the handle. Use finite value, min, max, and step values with min >= 0, max <= 100, min < max, and step > 0. Set orientation to vertical or horizontal. Enhancement has been disabled.",
		);
	};

	private applyStructure = () => {
		const completionAttributes: string[] = [];
		const handle = this.handleTargets[0];
		const primary = this.primaryTargets[0];
		if (!(handle instanceof HTMLElement) || !(primary instanceof HTMLElement)) {
			return completionAttributes;
		}

		const primaryId = ensureElementId(primary, "splitter-primary");
		if (!handle.hasAttribute("role")) {
			handle.setAttribute("role", "separator");
			completionAttributes.push('role="separator"');
		}
		if (!handle.hasAttribute("tabindex")) {
			handle.setAttribute("tabindex", "0");
		}
		if (!handle.hasAttribute("aria-controls")) {
			handle.setAttribute("aria-controls", primaryId);
			completionAttributes.push("aria-controls");
		}
		return completionAttributes;
	};

	private warnCompletion = (attributes: string[]) => {
		if (attributes.length === 0 || this.completionWarningIssued) {
			return;
		}
		this.completionWarningIssued = true;
		console.warn(
			`splitter controller: Added ${attributes.join(", ")}. Include them in your markup.`,
		);
	};

	private bind = () => {
		const handle = this.handleTargets[0];
		if (!(handle instanceof HTMLElement)) {
			return;
		}
		handle.addEventListener("pointerdown", this.handlePointerdown);
		handle.addEventListener("pointermove", this.handlePointermove);
		handle.addEventListener("pointerup", this.handlePointerup);
		handle.addEventListener("pointercancel", this.handlePointercancel);
		handle.addEventListener("keydown", this.handleKeydown);
		this.boundHandle = handle;
		const range = this.rangeTargets[0];
		if (range instanceof HTMLInputElement) {
			range.addEventListener("change", this.handleRangeChange);
			range.addEventListener("pointerdown", this.handleRangePointerdown);
			range.addEventListener("keydown", this.handleRangeKeydown);
			this.boundRange = range;
		}
	};

	private unbind = () => {
		this.boundHandle?.removeEventListener("pointerdown", this.handlePointerdown);
		this.boundHandle?.removeEventListener("pointermove", this.handlePointermove);
		this.boundHandle?.removeEventListener("pointerup", this.handlePointerup);
		this.boundHandle?.removeEventListener("pointercancel", this.handlePointercancel);
		this.boundHandle?.removeEventListener("keydown", this.handleKeydown);
		this.boundHandle = null;
		this.boundRange?.removeEventListener("change", this.handleRangeChange);
		this.boundRange?.removeEventListener("pointerdown", this.handleRangePointerdown);
		this.boundRange?.removeEventListener("keydown", this.handleRangeKeydown);
		this.boundRange = null;
		this.rangeReason = "keyboard";
	};

	private disconnectCleanup = () => {
		this.releasePointerCapture();
		this.unbind();
	};

	private releasePointerCapture = () => {
		const handle = this.boundHandle;
		const pointerId = this.drag?.pointerId;
		if (handle !== null && pointerId !== undefined) {
			try {
				if (handle.hasPointerCapture(pointerId)) {
					handle.releasePointerCapture(pointerId);
				}
			} catch {
				// Pointer capture may already have been released.
			}
		}
		this.drag = null;
		if (handle !== null) {
			handle.dataset.state = "idle";
		}
	};

	private syncState = () => {
		if (!this.enhanced) {
			return;
		}
		const handle = this.handleTargets[0];
		if (!(handle instanceof HTMLElement)) {
			return;
		}
		const state = this.currentValue === this.minValue ? "collapsed" : "expanded";
		this.element.dataset.state = state;
		handle.dataset.state = this.drag === null ? "idle" : "dragging";
		handle.setAttribute("aria-valuenow", String(this.currentValue));
		handle.setAttribute("aria-valuemin", String(this.minValue));
		handle.setAttribute("aria-valuemax", String(this.maxValue));
		handle.setAttribute("aria-orientation", this.orientationValue);
		this.element.style.setProperty("--splitter-value", String(this.currentValue));
		const range = this.rangeTargets[0];
		if (range instanceof HTMLInputElement) {
			range.min = String(this.minValue);
			range.max = String(this.maxValue);
			range.step = "any";
			range.defaultValue = String(this.currentValue);
			range.value = String(this.currentValue);
		}
	};

	private clamp = (value: number) => Math.min(this.maxValue, Math.max(this.minValue, value));

	private commitProgrammaticValue = (value: number) => {
		this.applyValue(this.clamp(value));
	};

	private applyValue = (value: number) => {
		this.revision++;
		this.currentValue = this.clamp(value);
		this.syncState();
	};

	private requestUserChange = (value: number, previousValue: number, reason: ChangeReason) => {
		const nextValue = this.clamp(value);
		if (nextValue === previousValue) {
			return false;
		}
		const detail: SplitterChangeDetail = { value: nextValue, previousValue, reason };
		const beforeChange = new CustomEvent<SplitterChangeDetail>("splitter:beforechange", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		const revision = this.revision;
		const primary = this.primaryTargets[0];
		const settings = [
			this.valueValue,
			this.minValue,
			this.maxValue,
			this.stepValue,
			this.orientationValue,
		];
		const accepted = this.element.dispatchEvent(beforeChange);
		if (revision !== this.revision || !this.connected || !this.enhanced) {
			return false;
		}
		if (
			!this.element.isConnected ||
			!this.element.getAttribute("data-controller")?.split(/\s+/).includes(this.identifier)
		) {
			return false;
		}
		const currentSettings = [
			this.valueValue,
			this.minValue,
			this.maxValue,
			this.stepValue,
			this.orientationValue,
		];
		if (
			!this.isValidMarkup() ||
			this.rangeTargets[0] !== this.boundRange ||
			this.primaryTargets[0] !== primary ||
			this.handleTargets[0] !== this.boundHandle ||
			settings.some((value, index) => value !== currentSettings[index])
		) {
			this.reconcile();
			return false;
		}
		if (!accepted) {
			this.applyValue(previousValue);
			return false;
		}
		this.applyValue(nextValue);
		this.element.dispatchEvent(
			new CustomEvent<SplitterChangeDetail>("splitter:change", { bubbles: true, detail }),
		);
		return true;
	};

	private handleRangePointerdown = (event: PointerEvent) => {
		if (event.isTrusted) {
			this.rangeReason = "pointer";
		}
	};

	private handleRangeKeydown = (event: KeyboardEvent) => {
		if (event.isTrusted) {
			this.rangeReason = "keyboard";
		}
	};

	private handleRangeChange = (event: Event) => {
		if (!this.ensureEnhanced() || event.currentTarget !== this.boundRange) {
			return;
		}
		if (!this.isValidRange()) {
			this.reconcile();
			return;
		}
		const range = this.boundRange;
		if (range === null) {
			return;
		}
		const reason = this.rangeReason;
		this.rangeReason = "keyboard";
		if (!event.isTrusted) {
			this.syncState();
			return;
		}
		this.releasePointerCapture();
		this.requestUserChange(range.valueAsNumber, this.currentValue, reason);
	};

	private handlePointerdown = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted || event.button !== 0) {
			return;
		}
		const handle = event.currentTarget;
		if (!(handle instanceof HTMLElement)) {
			return;
		}
		const rawValue = this.pointerValue(event);
		if (rawValue === null) {
			return;
		}
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			return;
		}
		this.drag = {
			pointerId: event.pointerId,
			origin: this.currentValue,
			offset: this.currentValue - rawValue,
		};
		handle.dataset.state = "dragging";
		event.preventDefault();
	};

	private handlePointermove = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		if (this.drag === null || event.pointerId !== this.drag.pointerId) {
			return;
		}
		const rawValue = this.pointerValue(event);
		if (rawValue === null) {
			return;
		}
		this.previewValue(rawValue + this.drag.offset);
	};

	private handlePointerup = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		if (this.drag === null || event.pointerId !== this.drag.pointerId) {
			return;
		}
		const drag = this.drag;
		const value = this.currentValue;
		this.releasePointerCapture();
		this.requestUserChange(value, drag.origin, "pointer");
	};

	private handlePointercancel = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		if (this.drag === null || event.pointerId !== this.drag.pointerId) {
			return;
		}
		const origin = this.drag.origin;
		this.releasePointerCapture();
		this.applyValue(origin);
	};

	private pointerValue = (event: PointerEvent) => {
		const rect = this.element.getBoundingClientRect();
		if (this.orientationValue === "vertical") {
			if (rect.width <= 0) {
				return null;
			}
			const distance = this.isRtl() ? rect.right - event.clientX : event.clientX - rect.left;
			return (distance / rect.width) * 100;
		}
		if (rect.height <= 0) {
			return null;
		}
		return ((event.clientY - rect.top) / rect.height) * 100;
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		let nextValue: number | null = null;
		if (event.key === "Home") {
			nextValue = this.minValue;
		} else if (event.key === "End") {
			nextValue = this.maxValue;
		} else if (event.key === "Enter") {
			if (this.currentValue === this.minValue) {
				if (this.rememberedValue !== null) {
					const value = this.rememberedValue;
					if (this.requestUserChange(value, this.currentValue, "keyboard")) {
						this.rememberedValue = null;
					}
				}
			} else {
				const previousValue = this.currentValue;
				if (this.requestUserChange(this.minValue, previousValue, "keyboard")) {
					this.rememberedValue = previousValue;
				}
			}
			if (event.cancelable) {
				event.preventDefault();
			}
			return;
		} else if (this.orientationValue === "vertical") {
			const rtl = this.isRtl();
			if (event.key === (rtl ? "ArrowLeft" : "ArrowRight")) {
				nextValue = this.currentValue + this.stepValue;
			} else if (event.key === (rtl ? "ArrowRight" : "ArrowLeft")) {
				nextValue = this.currentValue - this.stepValue;
			}
		} else if (event.key === "ArrowDown") {
			nextValue = this.currentValue + this.stepValue;
		} else if (event.key === "ArrowUp") {
			nextValue = this.currentValue - this.stepValue;
		}

		if (nextValue === null) {
			return;
		}
		if (event.cancelable) {
			event.preventDefault();
		}
		this.requestUserChange(nextValue, this.currentValue, "keyboard");
	};

	private previewValue = (value: number) => {
		this.currentValue = this.clamp(value);
		this.syncState();
	};

	private isRtl = () => {
		let element: HTMLElement | null = this.element;
		while (element !== null) {
			if (element.getAttribute("dir") !== null) {
				return element.getAttribute("dir") === "rtl";
			}
			element = element.parentElement;
		}
		return false;
	};
}

export { SplitterController };
