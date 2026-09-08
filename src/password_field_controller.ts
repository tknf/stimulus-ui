import { Controller } from "@hotwired/stimulus";
import { createFormResetTasks } from "./internal/form_reset_tasks";

import { ensureElementId } from "./internal/ensure_element_id";

type ToggleReason = "pointer" | "keyboard";

export type PasswordFieldToggleDetail = {
	visible: boolean;
	previousVisible: boolean;
	reason: ToggleReason;
};

type Selection = {
	start: number;
	end: number;
	direction: "forward" | "backward" | "none" | null;
};

/**
 * Toggles a native password field's visibility while preserving focus and selection when supported.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/password-field.contract.json
 */
export default class PasswordFieldController extends Controller<HTMLElement> {
	static targets = ["input", "toggle"];

	static values = {
		visible: { type: Boolean, default: false },
		showLabel: { type: String, default: "Show password" },
		hideLabel: { type: String, default: "Hide password" },
	};

	declare readonly inputTargets: HTMLInputElement[];
	declare readonly toggleTargets: HTMLButtonElement[];
	declare visibleValue: boolean;
	declare showLabelValue: string;
	declare hideLabelValue: string;

	private resetTasks = createFormResetTasks();
	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private completionAttributes: string[] = [];
	private connectionVersion = 0;
	private reconcileQueued = false;
	private boundToggle: HTMLButtonElement | null = null;
	private boundForm: HTMLFormElement | null = null;
	private readonly ownedAriaLabels = new WeakSet<HTMLButtonElement>();
	private readonly ownedAriaControls = new WeakSet<HTMLButtonElement>();

	/**
	 * Whether the password is visible. Assignment commits visibility without events or focus
	 * movement.
	 */
	get visible(): boolean {
		return this.visibleValue;
	}

	/**
	 * Whether the password is visible. Assignment commits visibility without events or focus
	 * movement.
	 */
	set visible(visible: boolean) {
		this.commitVisible(Boolean(visible));
	}

	connect = () => {
		this.connected = true;
		this.enhanced = false;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.connectionVersion += 1;
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.completionAttributes = [];
		this.connectionVersion += 1;
		this.unbindToggle();
		this.unbindForm();
	};

	inputTargetConnected = () => this.scheduleReconcile();
	inputTargetDisconnected = () => this.scheduleReconcile();
	toggleTargetConnected = () => this.scheduleReconcile();
	toggleTargetDisconnected = () => this.scheduleReconcile();

	visibleValueChanged = (visible: boolean) => {
		if (!this.enhanced) {
			return;
		}
		this.syncState(visible);
	};

	showLabelValueChanged = () => {
		if (this.enhanced) {
			this.synchronizeToggleLabels();
		}
	};

	hideLabelValueChanged = () => {
		if (this.enhanced) {
			this.synchronizeToggleLabels();
		}
	};

	/**
	 * Reveals the password without events or focus movement.
	 *
	 * @returns No return value.
	 */
	show = () => {
		this.commitVisible(true);
	};

	/**
	 * Conceals the password without events or focus movement.
	 *
	 * @returns No return value.
	 */
	hide = () => {
		this.commitVisible(false);
	};

	/**
	 * Toggles password visibility without events or focus movement.
	 *
	 * @returns No return value.
	 */
	toggle = () => {
		this.commitVisible(!this.visibleValue);
	};

	private currentInput = () => (this.inputTargets.length === 1 ? this.inputTargets[0] : null);

	private currentToggle = () => (this.toggleTargets.length === 1 ? this.toggleTargets[0] : null);

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
		if (!this.isValidMarkup()) {
			this.disableEnhancement();
			if (!this.warningIssued) {
				this.warningIssued = true;
				console.warn(
					'password-field controller: Provide exactly one <input type="password"> input target and one <button type="button"> toggle target. Enhancement has been disabled.',
				);
			}
			return;
		}

		this.enableEnhancement();
		this.completionAttributes = [];
		this.synchronize();
		this.rebindToggle();
		this.rebindForm();
		this.warnCompletion();
	};

	private enableEnhancement = () => {
		this.enhanced = true;
	};

	private disableEnhancement = () => {
		if (!this.enhanced) {
			return;
		}

		this.enhanced = false;
		this.unbindForm();
		this.unbindToggle();
	};

	private isValidMarkup = () => {
		const input = this.currentInput();
		const toggle = this.currentToggle();
		return (
			input !== null &&
			input instanceof HTMLInputElement &&
			(input.type === "password" || input.type === "text") &&
			toggle !== null &&
			toggle instanceof HTMLButtonElement &&
			toggle.type === "button"
		);
	};

	private synchronize = () => {
		for (const input of this.inputTargets) {
			ensureElementId(input, "password-field-input");
		}
		for (const toggle of this.toggleTargets) {
			this.ensureToggleLabel(toggle);
		}
		this.synchronizeAriaControls();
		this.syncState(this.visibleValue);
	};

	private syncState = (visible: boolean) => {
		const state = visible ? "visible" : "hidden";
		this.element.dataset.state = state;

		for (const input of this.inputTargets) {
			input.type = visible ? "text" : "password";
		}

		for (const toggle of this.toggleTargets) {
			toggle.dataset.state = state;
		}

		this.synchronizeToggleLabels();
	};

	private commitVisible = (visible: boolean) => {
		if (!this.enhanced) {
			return;
		}
		if (this.visibleValue !== visible) {
			this.visibleValue = visible;
		}
		this.syncState(visible);
	};

	private ensureToggleLabel = (toggle: HTMLButtonElement) => {
		if (this.ownedAriaLabels.has(toggle)) {
			this.updateOwnedToggleLabel(toggle);
			return;
		}

		const hasAriaLabel = (toggle.getAttribute("aria-label") ?? "").trim() !== "";
		const hasAriaLabelledby = (toggle.getAttribute("aria-labelledby") ?? "").trim() !== "";
		const hasText = (toggle.textContent ?? "").trim() !== "";
		if (hasAriaLabel || hasAriaLabelledby || hasText) {
			return;
		}

		this.ownedAriaLabels.add(toggle);
		this.updateOwnedToggleLabel(toggle);
	};

	private updateOwnedToggleLabel = (toggle: HTMLButtonElement) => {
		const label = this.visibleValue ? this.hideLabelValue : this.showLabelValue;
		toggle.setAttribute("aria-label", label);
	};

	private synchronizeToggleLabels = () => {
		for (const toggle of this.toggleTargets) {
			this.ensureToggleLabel(toggle);
		}
	};

	private synchronizeAriaControls = () => {
		const input = this.currentInput();
		if (input === null) {
			return;
		}

		ensureElementId(input, "password-field-input");
		for (const toggle of this.toggleTargets) {
			if (this.ownedAriaControls.has(toggle)) {
				toggle.setAttribute("aria-controls", input.id);
			} else if (!toggle.hasAttribute("aria-controls")) {
				toggle.setAttribute("aria-controls", input.id);
				this.ownedAriaControls.add(toggle);
				this.completionAttributes.push("aria-controls");
			}
		}
	};

	private warnCompletion = () => {
		if (!this.connected || this.completionWarningIssued || this.completionAttributes.length === 0) {
			return;
		}
		this.completionWarningIssued = true;
		console.warn(
			`password-field controller: Added ${this.completionAttributes.join(", ")}. Include them in your markup.`,
		);
		this.completionAttributes = [];
	};

	private rebindToggle = () => {
		const toggle = this.currentToggle();
		if (this.boundToggle === toggle) {
			return;
		}

		this.unbindToggle();
		if (toggle === null) {
			return;
		}
		toggle.addEventListener("click", this.handleToggleClick);
		this.boundToggle = toggle;
	};

	private unbindToggle = () => {
		this.boundToggle?.removeEventListener("click", this.handleToggleClick);
		this.boundToggle = null;
	};

	private rebindForm = () => {
		const form = this.currentInput()?.form ?? null;
		if (this.boundForm === form) {
			return;
		}

		this.unbindForm();
		if (form === null) {
			return;
		}
		form.addEventListener("submit", this.handleFormSubmit);
		form.addEventListener("reset", this.handleFormReset);
		this.boundForm = form;
	};

	private unbindForm = () => {
		this.resetTasks.cancel();
		this.boundForm?.removeEventListener("submit", this.handleFormSubmit);
		this.boundForm?.removeEventListener("reset", this.handleFormReset);
		this.boundForm = null;
	};

	private handleToggleClick = (event: MouseEvent) => {
		if (!this.enhanced) {
			return;
		}
		const input = this.currentInput();
		const toggle = this.currentToggle();
		if (input === null || toggle === null || event.currentTarget !== toggle) {
			return;
		}

		if (!event.isTrusted) {
			this.toggle();
			return;
		}
		if (input.disabled || toggle.disabled) {
			return;
		}

		const reason: ToggleReason = event.detail > 0 ? "pointer" : "keyboard";
		const previousVisible = this.visibleValue;
		const visible = !previousVisible;
		const selection = reason === "pointer" ? this.readSelection(input) : null;
		const detail: PasswordFieldToggleDetail = { visible, previousVisible, reason };
		const beforeToggle = new CustomEvent<PasswordFieldToggleDetail>("password-field:beforetoggle", {
			bubbles: true,
			cancelable: true,
			detail,
		});

		if (!this.element.dispatchEvent(beforeToggle)) {
			return;
		}

		this.commitVisible(visible);
		this.element.dispatchEvent(
			new CustomEvent<PasswordFieldToggleDetail>("password-field:toggle", {
				bubbles: true,
				cancelable: false,
				detail: { visible, previousVisible, reason },
			}),
		);

		if (reason === "pointer") {
			this.restoreFocusAndSelection(input, selection);
		}
	};

	private readSelection = (input: HTMLInputElement): Selection | null => {
		try {
			const start = input.selectionStart;
			const end = input.selectionEnd;
			if (start === null || end === null) {
				return null;
			}
			return { start, end, direction: input.selectionDirection };
		} catch {
			return null;
		}
	};

	private restoreFocusAndSelection = (input: HTMLInputElement, selection: Selection | null) => {
		if (this.currentInput() !== input || !input.isConnected) {
			return;
		}

		input.focus();
		if (selection === null) {
			return;
		}
		try {
			input.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
		} catch {
			// Preserve focus even when selection APIs are unavailable after changing type.
		}
	};

	private handleFormSubmit = () => {
		if (!this.enhanced) {
			return;
		}
		this.hide();
	};

	private handleFormReset = (event: Event) => {
		if (!this.enhanced) {
			return;
		}
		const form = event.currentTarget;
		const connectionVersion = this.connectionVersion;

		this.resetTasks.schedule(() => {
			if (
				event.defaultPrevented ||
				!this.connected ||
				this.connectionVersion !== connectionVersion ||
				this.boundForm !== form
			) {
				return;
			}
			this.hide();
		});
	};
}
