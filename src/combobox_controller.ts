import { Controller } from "@hotwired/stimulus";

import { ensureElementId } from "./internal/ensure_element_id";
import { isImeKeydown } from "./internal/ime";
import {
	enabledVisibleOptions,
	isEnabledVisibleOption,
	nextListboxOption,
	syncListboxActiveDescendant,
} from "./internal/listbox_navigation";

type SelectionReason = "keyboard" | "pointer";

export type ComboboxChangeDetail = {
	value: string;
	previousValue?: string;
	reason: SelectionReason;
	selected?: string[];
	previousSelected?: string[];
};

export type ComboboxOpenDetail = {
	reason: "keyboard";
};

export type ComboboxCloseDetail = {
	reason: "keyboard";
};

type OptionCandidate = {
	option: HTMLLIElement;
	value: string;
};

/**
 * Adds single selection and listbox navigation to an authored editable combobox.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/combobox.contract.json
 */
export default class ComboboxController extends Controller<HTMLElement> {
	static targets = ["input", "listbox", "option"];
	static values = {
		autocomplete: { default: "list", type: String },
		multiple: { default: false, type: Boolean },
		open: { default: false, type: Boolean },
		selected: { default: [], type: Array },
		value: { default: "", type: String },
	};

	declare readonly inputTargets: HTMLInputElement[];
	declare readonly listboxTargets: HTMLElement[];
	declare readonly optionTargets: HTMLLIElement[];
	declare autocompleteValue: string;
	declare readonly multipleValue: boolean;
	declare openValue: boolean;
	declare selectedValue: string[];
	declare valueValue: string;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private composing = false;
	private currentOpen = false;
	private currentSelected: string[] = [];
	private currentValue = "";
	private activeOption?: HTMLLIElement;
	private reconcileQueued = false;
	private observer?: MutationObserver;
	private multipleValueInitialized = false;
	private shouldApplyOpenValue = true;

	connect = () => {
		this.connected = true;
		this.enhanced = false;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.currentSelected = [];
		this.multipleValueInitialized = false;
		this.shouldApplyOpenValue = true;
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("compositionstart", this.handleCompositionStart);
		this.element.addEventListener("compositionend", this.handleCompositionEnd);
		this.element.addEventListener("focusout", this.handleFocusOut);
		this.element.addEventListener("input", this.handleInput);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.element.ownerDocument.addEventListener("focusin", this.handleDocumentFocusIn);
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, {
			attributeFilter: [
				"aria-disabled",
				"data-combobox-value",
				"hidden",
				"role",
				"data-combobox-target",
			],
			attributes: true,
			subtree: true,
		});
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("compositionstart", this.handleCompositionStart);
		this.element.removeEventListener("compositionend", this.handleCompositionEnd);
		this.element.removeEventListener("focusout", this.handleFocusOut);
		this.element.removeEventListener("input", this.handleInput);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.element.ownerDocument.removeEventListener("focusin", this.handleDocumentFocusIn);
		this.observer?.disconnect();
		this.observer = undefined;
		this.composing = false;
		this.activeOption = undefined;
		if (this.enhanced) {
			this.currentOpen = false;
			this.syncState();
		}
		this.enhanced = false;
	};

	inputTargetConnected = () => this.scheduleReconcile();
	inputTargetDisconnected = () => this.scheduleReconcile();
	listboxTargetConnected = () => this.scheduleReconcile();
	listboxTargetDisconnected = () => this.scheduleReconcile();
	optionTargetConnected = () => this.scheduleReconcile();
	optionTargetDisconnected = (option: HTMLLIElement) => {
		if (this.activeOption === option) {
			this.activeOption = undefined;
		}
		this.scheduleReconcile();
	};
	autocompleteValueChanged = () => this.scheduleReconcile();
	multipleValueChanged = () => this.scheduleReconcile();
	openValueChanged = () => {
		if (this.enhanced && !this.shouldApplyOpenValue && this.openValue === this.currentOpen) {
			return;
		}
		this.shouldApplyOpenValue = true;
		this.scheduleReconcile();
	};
	selectedValueChanged = () => this.scheduleReconcile();
	valueValueChanged = () => this.scheduleReconcile();

	/**
	 * Current input value. Assignment synchronizes input and selection state without events, focus
	 * movement, or filtering.
	 */
	get value() {
		return this.inputTargets[0]?.value ?? this.currentValue;
	}

	/**
	 * Current input value. Assignment synchronizes input and selection state without events, focus
	 * movement, or filtering.
	 */
	set value(value: string) {
		if (!this.enhanced || !this.inputTargets[0]) {
			return;
		}
		this.commitValue(value);
	}

	/**
	 * Selected option values in multiple mode. Assignment ignores unknown values and synchronizes
	 * selection without events or changing the input value. In single mode, reads return an empty
	 * array and writes do nothing.
	 */
	get selected() {
		return this.multipleValue ? [...this.currentSelected] : [];
	}

	/**
	 * Selected option values in multiple mode. Assignment ignores unknown values and synchronizes
	 * selection without events or changing the input value. In single mode, reads return an empty
	 * array and writes do nothing.
	 */
	set selected(values: string[]) {
		if (!this.multipleValue || !this.ensureEnhanced()) {
			return;
		}
		this.commitSelected(values);
	}

	/**
	 * Whether the listbox popup is open. Assignment commits state without events or focus movement.
	 */
	get open() {
		return this.currentOpen;
	}

	/**
	 * Whether the listbox popup is open. Assignment commits state without events or focus movement.
	 */
	set open(open: boolean) {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitOpen(open);
	}

	/**
	 * Opens the listbox without events or focus movement.
	 *
	 * @returns No return value.
	 */
	show = () => {
		if (this.ensureEnhanced()) {
			this.commitOpen(true);
		}
	};

	/**
	 * Closes the listbox without events, focus movement, or changing the input value.
	 *
	 * @returns No return value.
	 */
	hide = () => {
		if (this.ensureEnhanced()) {
			this.commitOpen(false);
		}
	};

	/**
	 * Toggles the listbox without events or focus movement.
	 *
	 * @returns No return value.
	 */
	toggle = () => {
		if (this.ensureEnhanced()) {
			this.commitOpen(!this.currentOpen);
		}
	};

	/**
	 * Selects a known enabled option. In single mode, synchronizes the input and selection; in
	 * multiple mode, adds to selection without changing the input. Does not emit events, move focus,
	 * or change popup visibility.
	 *
	 * @returns No return value.
	 */
	select = (value: string) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const candidate = this.enabledOptions().find((option) => option.value === value);
		if (!candidate) {
			return;
		}
		if (this.multipleValue) {
			this.commitSelected([...this.currentSelected, candidate.value]);
			return;
		}
		this.commitValue(candidate.value);
	};

	/**
	 * Removes a value from multiple selection without events, focus movement, or changing popup
	 * visibility or input text. Does nothing in single mode or for unknown or unselected values.
	 *
	 * @returns No return value.
	 */
	deselect = (value: string) => {
		if (!this.multipleValue || !this.ensureEnhanced()) {
			return;
		}
		this.commitSelected(this.currentSelected.filter((candidate) => candidate !== value));
	};

	private ensureEnhanced = () => {
		if (!this.enhanced && this.connected) {
			this.reconcile();
		}
		return this.enhanced;
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
		if (!this.isValidMarkup()) {
			this.enhanced = false;
			return;
		}

		this.enhanced = true;
		const completionAttributes = this.applyStructure();
		const input = this.inputTargets[0];
		const requestedValue = this.element.hasAttribute("data-combobox-value-value")
			? this.valueValue
			: (input?.value ?? this.valueValue);
		if (this.multipleValue) {
			if (!this.multipleValueInitialized || this.valueValue !== this.currentValue) {
				if (input) {
					input.value = requestedValue;
				}
			}
			this.multipleValueInitialized = true;
		} else if (input) {
			input.value = requestedValue;
		}
		this.currentValue = requestedValue;
		if (this.multipleValue) {
			const requestedSelected = this.sameValues(this.selectedValue, this.currentSelected)
				? this.currentSelected
				: this.selectedValue;
			this.currentSelected = this.normalizeSelected(requestedSelected);
			this.syncSelectedValue();
		} else {
			this.currentSelected = [];
			this.multipleValueInitialized = false;
		}
		if (this.shouldApplyOpenValue) {
			this.currentOpen = this.openValue;
			this.shouldApplyOpenValue = false;
		}
		this.syncValueAttribute(this.currentValue);
		this.syncState();
		this.warnCompletion(completionAttributes);
	};

	private isValidMarkup = () => {
		const input = this.inputTargets.length === 1 ? this.inputTargets[0] : undefined;
		const listbox = this.listboxTargets.length === 1 ? this.listboxTargets[0] : undefined;
		const inputType = input?.type ?? "";
		const inputRole = input?.getAttribute("role");
		const listboxRole = listbox?.getAttribute("role");

		const valid =
			(input instanceof HTMLInputElement &&
				(inputType === "text" || inputType === "search") &&
				listbox instanceof HTMLUListElement === true) ||
			(input instanceof HTMLInputElement &&
				(inputType === "text" || inputType === "search") &&
				listbox instanceof HTMLOListElement === true);
		const hasName =
			input instanceof HTMLInputElement &&
			((input.getAttribute("aria-label") ?? "").trim() !== "" ||
				(input.getAttribute("aria-labelledby") ?? "").trim() !== "" ||
				(input.labels?.length ?? 0) > 0);
		const rolesAreValid =
			(inputRole === null || inputRole === "combobox") &&
			(listboxRole === null || listboxRole === "listbox");
		const optionsAreValid = this.optionTargets.every(
			(option) =>
				option instanceof HTMLLIElement &&
				listbox instanceof HTMLElement &&
				listbox.contains(option) &&
				(option.getAttribute("role") === null || option.getAttribute("role") === "option") &&
				(option.dataset.comboboxValue ?? "") !== "",
		);
		const values = this.optionTargets.map((option) => option.dataset.comboboxValue ?? "");
		const valuesAreUnique = new Set(values).size === values.length;
		const autocompleteIsValid =
			this.autocompleteValue === "list" || this.autocompleteValue === "none";

		if (
			valid &&
			hasName &&
			rolesAreValid &&
			optionsAreValid &&
			valuesAreUnique &&
			autocompleteIsValid
		) {
			return true;
		}
		if (!this.warningIssued) {
			this.warningIssued = true;
			console.warn(
				'combobox controller: Provide exactly one named native <input type="text"> or <input type="search"> input target and one native <ul> or <ol> listbox target. Use native <li> option targets inside the listbox with unique, nonempty data-combobox-value values. Explicit roles must be "combobox", "listbox", and "option" respectively; autocomplete must be "list" or "none". Enhancement has been disabled.',
			);
		}
		return false;
	};

	private applyStructure = () => {
		const completionAttributes: string[] = [];
		const input = this.inputTargets[0];
		const listbox = this.listboxTargets[0];
		if (!input || !listbox) {
			return completionAttributes;
		}

		const inputRoleMissing = !input.hasAttribute("role");
		if (!input.hasAttribute("role")) {
			input.setAttribute("role", "combobox");
		}
		if (inputRoleMissing) {
			completionAttributes.push('role="combobox"');
		}
		const listboxRoleMissing = !listbox.hasAttribute("role");
		if (!listbox.hasAttribute("role")) {
			listbox.setAttribute("role", "listbox");
		}
		if (listboxRoleMissing) {
			completionAttributes.push('role="listbox"');
		}
		ensureElementId(input, "combobox-input");
		ensureElementId(listbox, "combobox-listbox");
		const inputControlsMissing = !input.hasAttribute("aria-controls");
		if (!input.hasAttribute("aria-controls")) {
			input.setAttribute("aria-controls", listbox.id);
		}
		if (inputControlsMissing) {
			completionAttributes.push("aria-controls");
		}
		input.setAttribute("aria-autocomplete", this.autocompleteValue);
		for (const option of this.optionTargets) {
			if (!option.hasAttribute("role")) {
				option.setAttribute("role", "option");
				completionAttributes.push('role="option"');
			}
			ensureElementId(option, "combobox-option");
		}
		return completionAttributes;
	};

	private warnCompletion = (attributes: string[]) => {
		if (attributes.length === 0 || this.completionWarningIssued) {
			return;
		}
		this.completionWarningIssued = true;
		console.warn(
			`combobox controller: Added ${attributes.join(", ")}. Include them in your markup.`,
		);
	};

	private syncState = () => {
		const input = this.inputTargets[0];
		const listbox = this.listboxTargets[0];
		if (!input || !listbox) {
			return;
		}

		const activeOption = this.activeOption;
		this.activeOption =
			activeOption !== undefined && this.optionTargets.includes(activeOption)
				? activeOption
				: undefined;
		if (this.activeOption && !isEnabledVisibleOption(this.activeOption)) {
			this.activeOption = undefined;
		}
		this.element.dataset.state = this.currentOpen ? "open" : "closed";
		input.dataset.state = this.currentOpen ? "open" : "closed";
		listbox.dataset.state = this.currentOpen ? "open" : "closed";
		input.setAttribute("aria-expanded", String(this.currentOpen));
		if (this.multipleValue) {
			listbox.setAttribute("aria-multiselectable", "true");
		}
		if (listbox.hidden !== !this.currentOpen) {
			listbox.hidden = !this.currentOpen;
		}
		syncListboxActiveDescendant(
			input,
			this.activeOption,
			enabledVisibleOptions(this.optionTargets, (option) => option.dataset.comboboxValue ?? ""),
			"combobox-option",
		);

		for (const option of this.optionTargets) {
			const optionValue = option.dataset.comboboxValue ?? "";
			const selected =
				!option.hidden &&
				isEnabledVisibleOption(option) &&
				(this.multipleValue
					? this.currentSelected.includes(optionValue)
					: optionValue === this.currentValue);
			option.setAttribute("aria-selected", String(selected));
			option.setAttribute("tabindex", "-1");
			option.dataset.state = !isEnabledVisibleOption(option)
				? "disabled"
				: this.activeOption === option
					? "active"
					: selected
						? "selected"
						: "inactive";
		}
	};

	private commitValue = (value: string) => {
		const input = this.inputTargets[0];
		if (!input) {
			return;
		}
		input.value = value;
		this.currentValue = value;
		this.syncValueAttribute(value);
		this.syncState();
	};

	private syncValueAttribute = (value: string) => {
		if (this.valueValue !== value) {
			this.valueValue = value;
		}
	};

	private commitSelected = (values: unknown) => {
		if (!this.enhanced) {
			return;
		}
		this.currentSelected = this.normalizeSelected(values);
		this.syncSelectedValue();
		this.syncState();
	};

	private syncSelectedValue = () => {
		if (!this.sameValues(this.selectedValue, this.currentSelected)) {
			this.selectedValue = [...this.currentSelected];
		}
	};

	private commitOpen = (open: boolean) => {
		this.currentOpen = open;
		if (this.openValue !== open) {
			this.openValue = open;
		}
		this.shouldApplyOpenValue = false;
		this.syncState();
	};

	private enabledOptions = () =>
		enabledVisibleOptions(this.optionTargets, (option) => option.dataset.comboboxValue ?? "");

	private setActive = (option: HTMLLIElement | undefined) => {
		this.activeOption = option;
		this.syncState();
	};

	private requestSelection = (candidate: OptionCandidate, reason: SelectionReason) => {
		let detail: ComboboxChangeDetail;
		let nextSelected: string[] | undefined;
		if (this.multipleValue) {
			const previousSelected = [...this.currentSelected];
			const isSelected = previousSelected.includes(candidate.value);
			nextSelected = isSelected
				? previousSelected.filter((value) => value !== candidate.value)
				: [...previousSelected, candidate.value];
			detail = {
				previousSelected,
				reason,
				selected: [...nextSelected],
				value: candidate.value,
			};
		} else {
			if (candidate.value === this.currentValue) {
				return;
			}
			detail = {
				previousValue: this.currentValue,
				reason,
				value: candidate.value,
			};
		}
		const beforeChange = new CustomEvent<ComboboxChangeDetail>("combobox:beforechange", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		if (!this.element.dispatchEvent(beforeChange)) {
			return;
		}
		if (this.multipleValue) {
			this.commitSelected(nextSelected ?? []);
		} else {
			this.commitValue(candidate.value);
		}
		this.element.dispatchEvent(
			new CustomEvent<ComboboxChangeDetail>("combobox:change", { bubbles: true, detail }),
		);
	};

	private normalizeSelected = (values: unknown) => {
		if (!Array.isArray(values)) {
			return [];
		}
		const known = new Set(this.optionTargets.map((option) => option.dataset.comboboxValue ?? ""));
		const normalized: string[] = [];
		for (const value of values) {
			if (typeof value === "string" && known.has(value) && !normalized.includes(value)) {
				normalized.push(value);
			}
		}
		return normalized;
	};

	private sameValues = (left: unknown, right: string[]) =>
		Array.isArray(left) &&
		left.length === right.length &&
		left.every((value, index) => value === right[index]);

	private handleInput = () => {
		if (!this.enhanced || !this.inputTargets[0]) {
			return;
		}
		this.currentValue = this.inputTargets[0].value;
		this.syncValueAttribute(this.currentValue);
		this.syncState();
	};

	private handleCompositionStart = () => {
		const activeElement = this.element.ownerDocument.activeElement;
		if (activeElement instanceof HTMLInputElement && this.inputTargets.includes(activeElement)) {
			this.composing = true;
		}
	};

	private handleCompositionEnd = () => {
		this.composing = false;
	};

	private handleClick = (event: MouseEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted || event.detail === 0) {
			return;
		}
		const option = event
			.composedPath()
			.find(
				(candidate): candidate is HTMLLIElement =>
					candidate instanceof HTMLLIElement && this.optionTargets.includes(candidate),
			);
		if (!option || !isEnabledVisibleOption(option)) {
			return;
		}
		this.requestSelection({ option, value: option.dataset.comboboxValue ?? "" }, "pointer");
	};

	private handleKeydown = (event: KeyboardEvent) => {
		const input = this.inputTargets[0];
		if (
			!this.ensureEnhanced() ||
			!event.isTrusted ||
			event.target !== input ||
			isImeKeydown(event) ||
			this.composing
		) {
			return;
		}
		const options = this.enabledOptions();
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			if (options.length === 0) {
				return;
			}
			event.preventDefault();
			this.setActive(
				nextListboxOption(
					options,
					this.activeOption,
					event.key === "ArrowDown" ? "ArrowDown" : "ArrowUp",
				),
			);
			if (!this.currentOpen) {
				this.commitOpen(true);
				this.element.dispatchEvent(
					new CustomEvent<ComboboxOpenDetail>("combobox:open", {
						bubbles: true,
						detail: { reason: "keyboard" },
					}),
				);
			}
			return;
		}

		if ((event.key === "Home" || event.key === "End") && this.currentOpen && options.length > 0) {
			event.preventDefault();
			this.setActive(nextListboxOption(options, this.activeOption, event.key));
			return;
		}

		if (event.key === "Enter" && this.currentOpen && this.activeOption) {
			const candidate = options.find(({ option }) => option === this.activeOption);
			if (!candidate) {
				return;
			}
			event.preventDefault();
			this.requestSelection(candidate, "keyboard");
			return;
		}

		if (event.key === "Escape" && this.currentOpen) {
			event.preventDefault();
			this.commitOpen(false);
			this.element.dispatchEvent(
				new CustomEvent<ComboboxCloseDetail>("combobox:close", {
					bubbles: true,
					detail: { reason: "keyboard" },
				}),
			);
		}
	};

	private handleFocusOut = (event: FocusEvent) => {
		if (!this.enhanced || !this.currentOpen) {
			return;
		}
		if (event.relatedTarget instanceof Node && this.element.contains(event.relatedTarget)) {
			return;
		}
		this.commitOpen(false);
	};

	private handleDocumentFocusIn = (event: FocusEvent) => {
		if (!this.enhanced || !this.currentOpen) {
			return;
		}
		if (!(event.target instanceof Node) || !this.element.contains(event.target)) {
			this.commitOpen(false);
		}
	};
}

export { ComboboxController };
