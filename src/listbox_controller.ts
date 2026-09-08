import { Controller } from "@hotwired/stimulus";

import { ensureElementId } from "./internal/ensure_element_id";
import {
	enabledVisibleOptions,
	isEnabledVisibleOption,
	nextListboxOption,
	syncListboxActiveDescendant,
} from "./internal/listbox_navigation";
import { createTypeahead } from "./internal/typeahead";

type SelectionReason = "pointer" | "keyboard";
export type ListboxChangeDetail = {
	values: string[];
	previousValues: string[];
	reason: SelectionReason;
};

/**
 * Provides APG listbox selection and virtual focus for an authored list.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/listbox.contract.json
 */
export default class ListboxController extends Controller<HTMLElement> {
	static targets = ["option"];
	static values = {
		multiple: { type: Boolean, default: false },
		value: { type: String, default: "" },
	};

	declare readonly optionTargets: HTMLLIElement[];
	declare readonly multipleValue: boolean;
	declare readonly valueValue: string;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private initialized = false;
	private currentValues: string[] = [];
	private activeOption?: HTMLLIElement;
	private observer?: MutationObserver;
	private reconcileQueued = false;
	private typeahead = createTypeahead();

	connect = () => {
		this.connected = true;
		this.enhanced = false;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, {
			attributes: true,
			subtree: true,
			// applyStructure writes role; observing it would repeatedly reconcile our own writes.
			attributeFilter: ["aria-disabled", "data-listbox-target", "data-listbox-value", "hidden"],
		});
		this.reconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.observer?.disconnect();
		this.observer = undefined;
		this.enhanced = false;
		this.activeOption = undefined;
		this.typeahead.disconnect();
	};

	optionTargetConnected = () => this.scheduleReconcile();
	optionTargetDisconnected = (option: HTMLLIElement) => {
		if (this.activeOption === option) {
			this.activeOption = undefined;
		}
		this.scheduleReconcile();
	};
	multipleValueChanged = () => this.scheduleReconcile();
	valueValueChanged = () => this.scheduleReconcile();

	/**
	 * Current selected option values. Assignment changes selection without custom events.
	 */
	get values() {
		return [...this.currentValues];
	}

	/**
	 * Current selected option values. Assignment changes selection without custom events.
	 */
	set values(values: string[]) {
		if (this.ensureEnhanced()) {
			this.commitValues(values);
		}
	}

	/**
	 * Selects a registered option without custom events.
	 *
	 * @returns No return value.
	 */
	select = (value: string) => {
		if (!this.ensureEnhanced() || !this.optionForValue(value)) {
			return;
		}
		this.commitValues(this.multipleValue ? [...this.currentValues, value] : [value]);
	};

	/**
	 * Deselects an option without custom events.
	 *
	 * @returns No return value.
	 */
	deselect = (value: string) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitValues(this.currentValues.filter((candidate) => candidate !== value));
	};

	/**
	 * Selects all enabled options in multiple mode without custom events.
	 *
	 * @returns No return value.
	 */
	selectAll = () => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const values = enabledVisibleOptions(
			this.optionTargets,
			(option) => option.dataset.listboxValue ?? "",
		).map((entry) => entry.value);
		this.commitValues(this.multipleValue ? values : values.slice(0, 1));
	};

	/**
	 * Clears selection without custom events.
	 *
	 * @returns No return value.
	 */
	clear = () => {
		if (this.ensureEnhanced()) {
			this.commitValues([]);
		}
	};

	private ensureEnhanced = () => {
		if (this.connected && !this.enhanced) {
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
			this.warnInvalidMarkup();
			return;
		}
		this.enhanced = true;
		const completionAttributes = this.applyStructure();
		const known = new Set(this.optionTargets.map((option) => option.dataset.listboxValue ?? ""));
		if (!this.initialized) {
			const requested = this.element.hasAttribute("data-listbox-value-value")
				? this.valueValue.split(",").filter(Boolean)
				: this.optionTargets
						.filter((option) => option.getAttribute("aria-selected") === "true")
						.map((option) => option.dataset.listboxValue ?? "");
			this.currentValues = this.normalizeValues(requested, known);
			this.initialized = true;
		} else {
			this.currentValues = this.normalizeValues(this.currentValues, known);
		}
		// Resynchronization must not activate a selected option when no option is active.
		// Doing so would suppress data-state="selected" and leave aria-activedescendant without focus.
		const active = this.activeOption;
		this.activeOption =
			active !== undefined && this.optionTargets.includes(active) && isEnabledVisibleOption(active)
				? active
				: undefined;
		this.syncState();
		this.warnCompletion(completionAttributes);
	};

	private firstSelectedOption = () =>
		this.optionTargets.find(
			(option) =>
				this.currentValues.includes(option.dataset.listboxValue ?? "") &&
				isEnabledVisibleOption(option),
		);

	private isValidMarkup = () => {
		const rootValid =
			this.element instanceof HTMLUListElement || this.element instanceof HTMLOListElement;
		const nameValid =
			(this.element.getAttribute("aria-label") ?? "").trim() !== "" ||
			(this.element.getAttribute("aria-labelledby") ?? "").trim() !== "";
		const roleValid =
			this.element.getAttribute("role") === null || this.element.getAttribute("role") === "listbox";
		const optionsValid =
			this.optionTargets.length > 0 &&
			this.optionTargets.every(
				(option) =>
					option instanceof HTMLLIElement &&
					this.element.contains(option) &&
					(option.getAttribute("role") === null || option.getAttribute("role") === "option") &&
					(option.dataset.listboxValue ?? "") !== "",
			);
		const values = this.optionTargets.map((option) => option.dataset.listboxValue ?? "");
		return (
			rootValid && nameValid && roleValid && optionsValid && new Set(values).size === values.length
		);
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			"listbox controller: Use a named <ul> or <ol> root with one or more <li> option targets whose data-listbox-value values are unique and nonempty. Explicit roles must be listbox on the root and option on options. Enhancement has been disabled.",
		);
	};

	private applyStructure = () => {
		const completionAttributes: string[] = [];
		if (!this.element.hasAttribute("role")) {
			this.element.setAttribute("role", "listbox");
			completionAttributes.push('role="listbox"');
		}
		if (!this.element.hasAttribute("tabindex")) {
			this.element.setAttribute("tabindex", "0");
		}
		if (this.multipleValue) {
			this.element.setAttribute("aria-multiselectable", "true");
		}
		for (const option of this.optionTargets) {
			if (!option.hasAttribute("role")) {
				option.setAttribute("role", "option");
				completionAttributes.push('role="option"');
			}
			ensureElementId(option, "listbox-option");
		}
		return completionAttributes;
	};

	private warnCompletion = (attributes: string[]) => {
		if (attributes.length === 0 || this.completionWarningIssued) {
			return;
		}
		this.completionWarningIssued = true;
		console.warn(
			`listbox controller: Added ${attributes.join(", ")}. Include them in your markup.`,
		);
	};

	private syncState = () => {
		const options = enabledVisibleOptions(
			this.optionTargets,
			(option) => option.dataset.listboxValue ?? "",
		);
		syncListboxActiveDescendant(this.element, this.activeOption, options, "listbox-option");
		for (const option of this.optionTargets) {
			const value = option.dataset.listboxValue ?? "";
			const selected = this.currentValues.includes(value);
			option.setAttribute("aria-selected", String(selected));
			option.dataset.state = !isEnabledVisibleOption(option)
				? "disabled"
				: this.activeOption === option
					? "active"
					: selected
						? "selected"
						: "inactive";
		}
	};

	private normalizeValues = (values: string[], known: Set<string>) => {
		const unique = [...new Set(values)].filter((value) => known.has(value));
		return this.multipleValue ? unique : unique.slice(0, 1);
	};

	private optionForValue = (value: string) =>
		this.optionTargets.find(
			(option) => option.dataset.listboxValue === value && isEnabledVisibleOption(option),
		);

	private commitValues = (values: string[]) => {
		if (!this.enhanced) {
			return;
		}
		const known = new Set(this.optionTargets.map((option) => option.dataset.listboxValue ?? ""));
		this.currentValues = this.normalizeValues(values, known);
		this.syncState();
		if (this.element.getAttribute("data-listbox-value-value") !== this.currentValues.join(",")) {
			this.element.setAttribute("data-listbox-value-value", this.currentValues.join(","));
		}
	};

	private requestSelection = (values: string[], reason: SelectionReason) => {
		const next = this.normalizeValues(
			values,
			new Set(this.optionTargets.map((option) => option.dataset.listboxValue ?? "")),
		);
		if (next.join("\u0000") === this.currentValues.join("\u0000")) {
			return;
		}
		const detail: ListboxChangeDetail = {
			values: [...next],
			previousValues: [...this.currentValues],
			reason,
		};
		if (
			!this.element.dispatchEvent(
				new CustomEvent<ListboxChangeDetail>("listbox:beforechange", {
					bubbles: true,
					cancelable: true,
					detail,
				}),
			)
		) {
			return;
		}
		this.commitValues(next);
		this.element.dispatchEvent(
			new CustomEvent<ListboxChangeDetail>("listbox:change", { bubbles: true, detail }),
		);
	};

	private setActive = (option: HTMLLIElement | undefined) => {
		this.activeOption = option;
		if (option) {
			try {
				option.scrollIntoView({ block: "nearest" });
			} catch {
				/* Do nothing when scrollIntoView() options are unsupported. */
			}
		}
		this.syncState();
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
		const value = option.dataset.listboxValue ?? "";
		const next = this.multipleValue
			? this.currentValues.includes(value)
				? this.currentValues.filter((candidate) => candidate !== value)
				: [...this.currentValues, value]
			: [value];
		this.setActive(option);
		this.requestSelection(next, "pointer");
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted || event.target !== this.element) {
			return;
		}
		const options = enabledVisibleOptions(
			this.optionTargets,
			(option) => option.dataset.listboxValue ?? "",
		);
		// Start keyboard navigation from the selected option when no option is active.
		const active = this.activeOption ?? this.firstSelectedOption();
		if (
			event.key === "ArrowUp" ||
			event.key === "ArrowDown" ||
			event.key === "Home" ||
			event.key === "End"
		) {
			const next = nextListboxOption(options, active, event.key);
			if (!next) {
				return;
			}
			event.preventDefault();
			this.setActive(next);
			if (
				this.multipleValue &&
				event.shiftKey &&
				(event.key === "ArrowUp" || event.key === "ArrowDown")
			) {
				const value = next.dataset.listboxValue ?? "";
				this.requestSelection(
					this.currentValues.includes(value)
						? this.currentValues.filter((candidate) => candidate !== value)
						: [...this.currentValues, value],
					"keyboard",
				);
			}
			return;
		}
		if (event.key === " " && active) {
			event.preventDefault();
			const value = active.dataset.listboxValue ?? "";
			this.requestSelection(
				this.multipleValue
					? this.currentValues.includes(value)
						? this.currentValues.filter((candidate) => candidate !== value)
						: [...this.currentValues, value]
					: [value],
				"keyboard",
			);
		}

		const result = this.typeahead.handleKeydown(
			event,
			options,
			(entry) => entry.option.textContent ?? "",
			options.findIndex(({ option }) => option === active),
		);
		if (!result.consumed) {
			return;
		}
		event.preventDefault();
		if (result.index !== undefined) {
			this.setActive(options[result.index]?.option);
		}
	};
}

export { ListboxController };
