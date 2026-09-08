import { Controller } from "@hotwired/stimulus";
import { createFormResetTasks } from "./internal/form_reset_tasks";

type ChangeReason = "pointer" | "keyboard";

export type DateFieldChangeDetail = {
	value: string;
	previousValue: string;
	reason: ChangeReason;
};

type PendingInteraction = {
	input: HTMLInputElement;
	previousRawValue: string;
	previousValue: string;
	reason: ChangeReason;
};

/**
 * Adds cancelable user changes and state outputs to a native date input.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/date-field.contract.json
 */
export default class DateFieldController extends Controller<HTMLElement> {
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

	/**
	 * Native date input value in YYYY-MM-DD format, or an empty string for missing or invalid input.
	 * Assignment synchronizes the value and data-state without custom events.
	 */
	get value(): string {
		return this.nativeInput()?.value ?? "";
	}

	/**
	 * Native date input value in YYYY-MM-DD format, or an empty string for missing or invalid input.
	 * Assignment synchronizes the value and data-state without custom events.
	 */
	set value(value: string) {
		if (!this.ensureEnhanced()) {
			return;
		}
		const input = this.nativeInput();
		if (input === null) {
			return;
		}

		input.value = value;
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
		this.element instanceof HTMLInputElement && this.element.type === "date" ? this.element : null;

	private isValidMarkup = () => this.nativeInput() !== null;

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'date-field controller: Use a native <input type="date"> root. Enhancement has been disabled.',
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
			this.sameValue(input.value, pending.previousValue)
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

	private commitChange = (input: HTMLInputElement, pending: PendingInteraction) => {
		const detail: DateFieldChangeDetail = {
			value: input.value,
			previousValue: pending.previousValue,
			reason: pending.reason,
		};
		const beforeChange = new CustomEvent<DateFieldChangeDetail>("date-field:beforechange", {
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
			new CustomEvent<DateFieldChangeDetail>("date-field:change", {
				bubbles: true,
				cancelable: false,
				detail,
			}),
		);
	};

	private captureInteraction = (input: HTMLInputElement, reason: ChangeReason) => ({
		input,
		previousRawValue: input.value,
		previousValue: input.value,
		reason,
	});

	private inputFromEvent = (event: Event) => {
		const target = event.target;
		return target instanceof HTMLInputElement && target === this.boundInput ? target : null;
	};

	private syncState = (input: HTMLInputElement) => {
		const value = input.value;
		const min = input.min === "" ? null : input.min;
		const max = input.max === "" ? null : input.max;
		const state =
			min !== null && value === min ? "min" : max !== null && value === max ? "max" : "between";

		this.element.dataset.state = state;
		this.rootStateOwned = true;
	};

	private sameValue = (value: string, previousValue: string) => value === previousValue;
}
