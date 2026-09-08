import { Controller } from "@hotwired/stimulus";
import { createFormResetTasks } from "./internal/form_reset_tasks";

type ChangeReason = "pointer" | "keyboard";
type SliderThumb = "start" | "end";
type SliderMode = "single" | "range";

export type SliderChangeDetail = {
	value: number;
	previousValue: number;
	reason: ChangeReason;
	thumb?: SliderThumb;
};

type PendingInteraction = {
	input: HTMLInputElement;
	previousRawValue: string;
	previousValue: number;
	reason: ChangeReason;
};

/**
 * Adds state outputs and cancelable user changes to one or two native range inputs.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/slider.contract.json
 */
export default class SliderController extends Controller<HTMLElement> {
	static targets = ["input"];

	declare readonly inputTargets: HTMLElement[];

	private resetTasks = createFormResetTasks();
	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private currentMode: SliderMode | null = null;
	private reconcileQueued = false;
	private pendingInteraction: PendingInteraction | null = null;
	private boundInputs: HTMLInputElement[] = [];
	private boundForms = new Set<HTMLFormElement>();
	private stateOwnedInputs = new Set<HTMLInputElement>();
	private rootStateOwned = false;

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.reconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.unbind();
		this.enhanced = false;
		this.reconcileQueued = false;
		this.pendingInteraction = null;
	};

	inputTargetConnected = () => this.scheduleReconcile();

	inputTargetDisconnected = (input: HTMLElement) => {
		if (this.connected) {
			this.clearInputState(input);
		}
		this.scheduleReconcile();
	};

	/**
	 * Native numeric value in single-input mode. Assignment synchronizes value, data-state, and CSS
	 * custom properties without events. In range mode, reads return NaN and writes do nothing.
	 */
	get value(): number {
		const rootInput = this.nativeInput();
		if (rootInput !== null) {
			return rootInput.valueAsNumber;
		}
		if (this.currentMode !== "single" || !this.enhanced) {
			return Number.NaN;
		}
		return this.managedInputs()[0]?.valueAsNumber ?? Number.NaN;
	}

	/**
	 * Native numeric value in single-input mode. Assignment synchronizes value, data-state, and CSS
	 * custom properties without events. In range mode, reads return NaN and writes do nothing.
	 */
	set value(value: number) {
		if (!this.ensureEnhanced() || this.currentMode !== "single") {
			return;
		}
		const input = this.singleInput();
		if (input === null) {
			return;
		}

		input.valueAsNumber = value;
		this.synchronize(input);
	}

	/**
	 * Range start value. Assignment clamps to end and commits without events. In single-input mode,
	 * reads return NaN and writes do nothing.
	 */
	get start(): number {
		if (this.currentMode !== "range" || !this.enhanced) {
			return Number.NaN;
		}
		return this.managedInputs()[0]?.valueAsNumber ?? Number.NaN;
	}

	/**
	 * Range start value. Assignment clamps to end and commits without events. In single-input mode,
	 * reads return NaN and writes do nothing.
	 */
	set start(value: number) {
		if (!this.ensureEnhanced() || this.currentMode !== "range") {
			return;
		}
		const inputs = this.managedInputs();
		const start = inputs[0];
		const end = inputs[1];
		if (start === undefined || end === undefined) {
			return;
		}

		this.setRangeValue(start, Math.min(value, end.valueAsNumber));
	}

	/**
	 * Range end value. Assignment clamps to start and commits without events. In single-input mode,
	 * reads return NaN and writes do nothing.
	 */
	get end(): number {
		if (this.currentMode !== "range" || !this.enhanced) {
			return Number.NaN;
		}
		return this.managedInputs()[1]?.valueAsNumber ?? Number.NaN;
	}

	/**
	 * Range end value. Assignment clamps to start and commits without events. In single-input mode,
	 * reads return NaN and writes do nothing.
	 */
	set end(value: number) {
		if (!this.ensureEnhanced() || this.currentMode !== "range") {
			return;
		}
		const inputs = this.managedInputs();
		const start = inputs[0];
		const end = inputs[1];
		if (start === undefined || end === undefined) {
			return;
		}

		this.setRangeValue(end, Math.max(value, start.valueAsNumber));
	}

	private reconcile = () => {
		if (!this.isValidMarkup()) {
			this.enhanced = false;
			this.currentMode = null;
			this.unbind();
			this.clearGeneratedOutputs();
			this.warnInvalidMarkup();
			return;
		}

		const mode = this.markupMode();
		if (mode === null) {
			return;
		}
		this.unbind();
		this.clearGeneratedOutputs();
		this.currentMode = mode;
		this.enhanced = true;
		this.bind(this.managedInputs());
		this.synchronizeAll();
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

	private ensureEnhanced = () => {
		if (!this.connected) {
			return false;
		}
		if (!this.enhanced) {
			this.reconcile();
		}
		return this.enhanced;
	};

	private nativeInput = () =>
		this.element instanceof HTMLInputElement && this.element.type === "range" ? this.element : null;

	private markupMode = (): SliderMode | null => {
		if (this.nativeInput() !== null) {
			return "single";
		}
		if (this.element instanceof HTMLInputElement) {
			return null;
		}
		if (this.inputTargets.length === 1) {
			return "single";
		}
		if (this.inputTargets.length === 2) {
			return "range";
		}
		return null;
	};

	private isRangeInput = (input: Element): input is HTMLInputElement =>
		input instanceof HTMLInputElement && input.type === "range";

	private isValidMarkup = () => {
		if (this.nativeInput() !== null) {
			return true;
		}
		if (this.element instanceof HTMLInputElement) {
			return false;
		}
		if (!this.isValidWrapperMarkup()) {
			return false;
		}
		return true;
	};

	private isValidWrapperMarkup = () => {
		if (this.inputTargets.length < 1 || this.inputTargets.length > 2) {
			return false;
		}
		if (!this.inputTargets.every((input) => this.isRangeInput(input))) {
			return false;
		}
		if (this.inputTargets.length === 1) {
			return true;
		}

		const start = this.inputTargets[0];
		const end = this.inputTargets[1];
		if (!(start instanceof HTMLInputElement) || !(end instanceof HTMLInputElement)) {
			return false;
		}

		return (
			this.nativeBound(start.min, 0) === this.nativeBound(end.min, 0) &&
			this.nativeBound(start.max, 100) === this.nativeBound(end.max, 100)
		);
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'slider controller: Use an <input type="range"> root or provide one or two <input type="range"> input targets. Two inputs must share min and max. Enhancement has been disabled.',
		);
	};

	private bind = (inputs: HTMLInputElement[]) => {
		this.boundInputs = [...inputs];
		for (const input of inputs) {
			input.addEventListener("pointerdown", this.handlePointerDown);
			input.addEventListener("pointerup", this.handlePointerEnd);
			input.addEventListener("pointercancel", this.handlePointerEnd);
			input.addEventListener("keydown", this.handleKeydown);
			input.addEventListener("input", this.handleInput);
			input.addEventListener("change", this.handleChange);
			if (input.form !== null) {
				this.boundForms.add(input.form);
			}
		}
		for (const form of this.boundForms) {
			form.addEventListener("reset", this.handleFormReset);
		}
	};

	private unbind = () => {
		this.resetTasks.cancel();
		for (const input of this.boundInputs) {
			input.removeEventListener("pointerdown", this.handlePointerDown);
			input.removeEventListener("pointerup", this.handlePointerEnd);
			input.removeEventListener("pointercancel", this.handlePointerEnd);
			input.removeEventListener("keydown", this.handleKeydown);
			input.removeEventListener("input", this.handleInput);
			input.removeEventListener("change", this.handleChange);
		}
		for (const form of this.boundForms) {
			form.removeEventListener("reset", this.handleFormReset);
		}
		this.boundInputs = [];
		this.boundForms.clear();
	};

	private handlePointerDown = (event: PointerEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		const input = this.inputFromEvent(event);
		if (input === null || input.disabled) {
			return;
		}
		this.pendingInteraction = this.captureInteraction(input, "pointer");
	};

	private handlePointerEnd = (event: PointerEvent) => {
		if (!event.isTrusted) {
			return;
		}
		if (event.type === "pointercancel") {
			this.pendingInteraction = null;
		}
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		const input = this.inputFromEvent(event);
		if (input === null || input.disabled) {
			return;
		}
		if (
			event.key !== "ArrowLeft" &&
			event.key !== "ArrowRight" &&
			event.key !== "ArrowUp" &&
			event.key !== "ArrowDown" &&
			event.key !== "Home" &&
			event.key !== "End" &&
			event.key !== "PageUp" &&
			event.key !== "PageDown"
		) {
			return;
		}
		this.pendingInteraction = this.captureInteraction(input, "keyboard");
	};

	private handleInput = (event: Event) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const input = this.inputFromEvent(event);
		if (input === null) {
			return;
		}
		this.synchronize(input);
		if (!event.isTrusted) {
			this.pendingInteraction = null;
		}
	};

	private handleChange = (event: Event) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const input = this.inputFromEvent(event);
		if (input === null) {
			return;
		}
		this.synchronize(input);
		if (!event.isTrusted) {
			this.pendingInteraction = null;
			return;
		}

		const pending = this.pendingInteraction;
		this.pendingInteraction = null;
		if (
			pending === null ||
			pending.input !== input ||
			input.valueAsNumber === pending.previousValue
		) {
			return;
		}

		const detail: SliderChangeDetail = {
			value: input.valueAsNumber,
			previousValue: pending.previousValue,
			reason: pending.reason,
		};
		const thumb = this.thumbFor(input);
		if (thumb !== undefined) {
			detail.thumb = thumb;
		}
		const beforeChange = new CustomEvent<SliderChangeDetail>("slider:beforechange", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		if (!this.element.dispatchEvent(beforeChange)) {
			input.value = pending.previousRawValue;
			this.synchronize(input);
			return;
		}

		this.element.dispatchEvent(
			new CustomEvent<SliderChangeDetail>("slider:change", {
				bubbles: true,
				detail,
			}),
		);
	};

	private handleFormReset = () => {
		this.pendingInteraction = null;
		this.resetTasks.schedule(() => {
			if (!this.connected || !this.enhanced) {
				return;
			}
			this.synchronizeAll();
		});
	};

	private captureInteraction = (input: HTMLInputElement, reason: ChangeReason) => ({
		input,
		previousRawValue: input.value,
		previousValue: input.valueAsNumber,
		reason,
	});

	private inputFromEvent = (event: Event) => {
		const target = event.target;
		return target instanceof HTMLInputElement && this.boundInputs.includes(target) ? target : null;
	};

	private thumbFor = (input: HTMLInputElement): SliderThumb | undefined => {
		if (this.currentMode !== "range") {
			return undefined;
		}
		const inputs = this.managedInputs();
		if (inputs[0] === input) {
			return "start";
		}
		if (inputs[1] === input) {
			return "end";
		}
		return undefined;
	};

	private synchronizeAll = () => {
		const inputs = this.managedInputs();
		if (this.currentMode === "range" && inputs.length === 2) {
			this.constrainRange(undefined, inputs[0], inputs[1]);
			this.synchronizeRange(inputs[0], inputs[1]);
			return;
		}
		if (this.currentMode === "single" && inputs.length === 1) {
			this.synchronizeSingle(inputs[0]);
		}
	};

	private synchronize = (input: HTMLInputElement) => {
		const inputs = this.managedInputs();
		if (this.currentMode === "range" && inputs.length === 2) {
			this.constrainRange(input, inputs[0], inputs[1]);
			this.synchronizeRange(inputs[0], inputs[1]);
			return;
		}
		if (this.currentMode === "single" && inputs[0] === input) {
			this.synchronizeSingle(input);
		}
	};

	private constrainRange = (
		changedInput: HTMLInputElement | undefined,
		start: HTMLInputElement,
		end: HTMLInputElement,
	) => {
		const startValue = start.valueAsNumber;
		const endValue = end.valueAsNumber;
		if (startValue > endValue) {
			if (changedInput === end) {
				end.valueAsNumber = startValue;
			} else {
				start.valueAsNumber = endValue;
			}
		}
	};

	private synchronizeSingle = (input: HTMLInputElement) => {
		const value = input.valueAsNumber;
		const min = this.nativeBound(input.min, 0);
		const max = this.nativeBound(input.max, 100);
		const state = value === min ? "min" : value === max ? "max" : "between";
		const normalized = this.normalizedValue(value, min, max);

		this.setRootState(state);
		this.element.style.setProperty("--slider-value", String(normalized));
		this.element.style.removeProperty("--slider-range-start");
		this.element.style.removeProperty("--slider-range-span");
	};

	private synchronizeRange = (start: HTMLInputElement, end: HTMLInputElement) => {
		const min = this.nativeBound(start.min, 0);
		const max = this.nativeBound(start.max, 100);
		const startValue = start.valueAsNumber;
		const endValue = end.valueAsNumber;
		const startState = startValue === min ? "min" : startValue === max ? "max" : "between";
		const endState = endValue === min ? "min" : endValue === max ? "max" : "between";
		const rootState =
			startValue === endValue
				? "empty"
				: startValue === min && endValue === max
					? "full"
					: "partial";
		const startNormalized = this.normalizedValue(startValue, min, max);
		const span = max === min ? 0 : (endValue - startValue) / (max - min);

		this.setRootState(rootState);
		this.setInputState(start, startState);
		this.setInputState(end, endState);
		this.element.style.removeProperty("--slider-value");
		this.element.style.setProperty("--slider-range-start", String(startNormalized));
		this.element.style.setProperty("--slider-range-span", String(span));
	};

	private setRangeValue = (input: HTMLInputElement, value: number) => {
		input.valueAsNumber = value;
		if (this.currentMode === "range") {
			this.synchronize(input);
		}
	};

	private normalizedValue = (value: number, min: number, max: number) => {
		const normalized = max === min ? 0 : (value - min) / (max - min);
		return normalized;
	};

	private setRootState = (state: string) => {
		this.element.dataset.state = state;
		this.rootStateOwned = true;
	};

	private setInputState = (input: HTMLInputElement, state: string) => {
		input.dataset.state = state;
		this.stateOwnedInputs.add(input);
	};

	private clearInputState = (input: HTMLElement) => {
		if (!(input instanceof HTMLInputElement) || !this.stateOwnedInputs.delete(input)) {
			return;
		}
		delete input.dataset.state;
	};

	private clearGeneratedOutputs = () => {
		if (this.rootStateOwned) {
			delete this.element.dataset.state;
			this.rootStateOwned = false;
		}
		for (const input of this.stateOwnedInputs) {
			delete input.dataset.state;
		}
		this.stateOwnedInputs.clear();
		this.element.style.removeProperty("--slider-value");
		this.element.style.removeProperty("--slider-range-start");
		this.element.style.removeProperty("--slider-range-span");
	};

	private singleInput = () => {
		const inputs = this.managedInputs();
		return inputs.length === 1 ? (inputs[0] ?? null) : null;
	};

	private managedInputs = () => {
		const rootInput = this.nativeInput();
		if (rootInput !== null) {
			return [rootInput];
		}
		return this.inputTargets.filter((input): input is HTMLInputElement => this.isRangeInput(input));
	};

	private nativeBound = (rawValue: string, fallback: number) => {
		if (rawValue === "") {
			return fallback;
		}
		const value = Number(rawValue);
		return Number.isFinite(value) ? value : fallback;
	};
}
