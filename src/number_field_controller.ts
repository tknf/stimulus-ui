import { Controller } from "@hotwired/stimulus";
import { createFormResetTasks } from "./internal/form_reset_tasks";

type ChangeReason = "pointer" | "keyboard";

export type NumberFieldChangeDetail = {
	value: number;
	previousValue: number;
	reason: ChangeReason;
};

type PendingInteraction = {
	input: HTMLInputElement;
	previousRawValue: string;
	previousValue: number;
	reason: ChangeReason;
};

/**
 * Adds page stepping and cancelable user changes to a native number input.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/number-field.contract.json
 */
export default class NumberFieldController extends Controller<HTMLElement> {
	static values = {
		pageStep: { type: Number, default: 10 },
	};

	declare pageStepValue: number;

	private resetTasks = createFormResetTasks();
	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private pendingInteraction: PendingInteraction | null = null;
	private boundInput: HTMLInputElement | null = null;
	private boundForm: HTMLFormElement | null = null;
	private rootStateOwned = false;

	connect = () => {
		this.connected = true;
		this.enhanced = false;
		this.warningIssued = false;
		this.pendingInteraction = null;
		this.reconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.unbind();
		this.enhanced = false;
		this.pendingInteraction = null;
	};

	pageStepValueChanged = () => {
		if (this.connected) {
			this.reconcile();
		}
	};

	/**
	 * Current native input.valueAsNumber, or NaN when the input does not contain a number.
	 * Assignment synchronizes value and data-state without custom events.
	 */
	get value(): number {
		return this.nativeInput()?.valueAsNumber ?? Number.NaN;
	}

	/**
	 * Current native input.valueAsNumber, or NaN when the input does not contain a number.
	 * Assignment synchronizes value and data-state without custom events.
	 */
	set value(value: number) {
		if (!this.ensureEnhanced()) {
			return;
		}
		const input = this.nativeInput();
		if (input === null) {
			return;
		}

		input.valueAsNumber = value;
		this.syncState(input);
	}

	private reconcile = () => {
		if (!this.isValidMarkup()) {
			this.disableEnhancement();
			this.clearGeneratedState();
			this.warnInvalidMarkup();
			return;
		}

		this.disableEnhancement();
		this.enhanced = true;
		const input = this.nativeInput();
		if (input === null) {
			return;
		}
		this.bind(input);
		this.syncState(input);
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
		this.element instanceof HTMLInputElement && this.element.type === "number"
			? this.element
			: null;

	private isValidMarkup = () =>
		this.nativeInput() !== null && Number.isInteger(this.pageStepValue) && this.pageStepValue > 0;

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'number-field controller: Use an <input type="number"> root and a positive integer pageStep. Enhancement has been disabled.',
		);
	};

	private bind = (input: HTMLInputElement) => {
		this.boundInput = input;
		input.addEventListener("pointerdown", this.handlePointerDown);
		input.addEventListener("keydown", this.handleKeydown);
		input.addEventListener("input", this.handleInput);
		input.addEventListener("change", this.handleChange);

		const form = input.form;
		if (form === null) {
			return;
		}
		form.addEventListener("reset", this.handleFormReset);
		this.boundForm = form;
	};

	private unbind = () => {
		this.resetTasks.cancel();
		this.boundInput?.removeEventListener("pointerdown", this.handlePointerDown);
		this.boundInput?.removeEventListener("keydown", this.handleKeydown);
		this.boundInput?.removeEventListener("input", this.handleInput);
		this.boundInput?.removeEventListener("change", this.handleChange);
		this.boundForm?.removeEventListener("reset", this.handleFormReset);
		this.boundInput = null;
		this.boundForm = null;
	};

	private disableEnhancement = () => {
		this.unbind();
		this.enhanced = false;
		this.pendingInteraction = null;
	};

	private clearGeneratedState = () => {
		if (!this.rootStateOwned) {
			return;
		}
		delete this.element.dataset.state;
		this.rootStateOwned = false;
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

	private handleKeydown = (event: KeyboardEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		const input = this.inputFromEvent(event);
		if (input === null || input.disabled) {
			return;
		}

		if (event.key === "PageUp" || event.key === "PageDown") {
			this.pendingInteraction = null;
			if (input.readOnly) {
				return;
			}
			event.preventDefault();
			this.handlePageKey(input, event.key);
			return;
		}

		if (this.pendingInteraction === null) {
			this.pendingInteraction = this.captureInteraction(input, "keyboard");
		}
	};

	private handleInput = (event: Event) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const input = this.inputFromEvent(event);
		if (input === null) {
			return;
		}

		this.syncState(input);
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

		this.syncState(input);
		if (!event.isTrusted) {
			this.pendingInteraction = null;
			return;
		}

		const pending = this.pendingInteraction;
		this.pendingInteraction = null;
		if (
			pending === null ||
			pending.input !== input ||
			this.sameValue(input.valueAsNumber, pending.previousValue)
		) {
			return;
		}

		this.commitChange(input, pending);
	};

	private handleFormReset = () => {
		this.pendingInteraction = null;
		this.resetTasks.schedule(() => {
			if (!this.connected || !this.enhanced) {
				return;
			}
			const input = this.nativeInput();
			if (input !== null) {
				this.syncState(input);
			}
		});
	};

	private handlePageKey = (input: HTMLInputElement, key: "PageUp" | "PageDown") => {
		const previousRawValue = input.value;
		const previousValue = input.valueAsNumber;

		const changed = this.applyPageStep(input, key === "PageUp");
		this.pendingInteraction = null;
		if (!changed) {
			this.syncState(input);
			return;
		}

		const pending: PendingInteraction = {
			input,
			previousRawValue,
			previousValue,
			reason: "keyboard",
		};
		this.commitChange(input, pending);
	};

	private applyPageStep = (input: HTMLInputElement, increase: boolean) => {
		const previousValue = input.valueAsNumber;
		try {
			if (input.step === "any") {
				if (!Number.isFinite(previousValue)) {
					return false;
				}
				const delta = increase ? this.pageStepValue : -this.pageStepValue;
				const value = this.clampToBounds(input, previousValue + delta);
				input.valueAsNumber = value;
			} else if (increase) {
				input.stepUp(this.pageStepValue);
			} else {
				input.stepDown(this.pageStepValue);
			}
		} catch {
			return false;
		}

		return !this.sameValue(input.valueAsNumber, previousValue);
	};

	private commitChange = (input: HTMLInputElement, pending: PendingInteraction) => {
		const detail: NumberFieldChangeDetail = {
			value: input.valueAsNumber,
			previousValue: pending.previousValue,
			reason: pending.reason,
		};
		const beforeChange = new CustomEvent<NumberFieldChangeDetail>("number-field:beforechange", {
			bubbles: true,
			cancelable: true,
			detail,
		});

		if (!this.element.dispatchEvent(beforeChange)) {
			input.value = pending.previousRawValue;
			this.syncState(input);
			return;
		}

		this.syncState(input);
		this.element.dispatchEvent(
			new CustomEvent<NumberFieldChangeDetail>("number-field:change", {
				bubbles: true,
				cancelable: false,
				detail,
			}),
		);
	};

	private captureInteraction = (input: HTMLInputElement, reason: ChangeReason) => ({
		input,
		previousRawValue: input.value,
		previousValue: input.valueAsNumber,
		reason,
	});

	private inputFromEvent = (event: Event) => {
		const target = event.target;
		return target instanceof HTMLInputElement && target === this.boundInput ? target : null;
	};

	private syncState = (input: HTMLInputElement) => {
		const value = input.valueAsNumber;
		const min = this.nativeBound(input.min);
		const max = this.nativeBound(input.max);
		const state =
			min !== null && value === min ? "min" : max !== null && value === max ? "max" : "between";

		this.element.dataset.state = state;
		this.rootStateOwned = true;
	};

	private nativeBound = (rawValue: string) => {
		if (rawValue === "") {
			return null;
		}
		const value = Number(rawValue);
		return Number.isFinite(value) ? value : null;
	};

	private clampToBounds = (input: HTMLInputElement, value: number) => {
		const min = this.nativeBound(input.min);
		const max = this.nativeBound(input.max);
		let clamped = value;
		if (min !== null && clamped < min) {
			clamped = min;
		}
		if (max !== null && clamped > max) {
			clamped = max;
		}
		return clamped;
	};

	private sameValue = (value: number, previousValue: number) =>
		value === previousValue || (Number.isNaN(value) && Number.isNaN(previousValue));
}
