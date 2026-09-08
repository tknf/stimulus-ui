import { Controller } from "@hotwired/stimulus";
import { createFormResetTasks } from "./internal/form_reset_tasks";

type CheckboxGroupReason = "pointer" | "keyboard";

export type CheckboxGroupChangeDetail = {
	selected: string[];
	previousSelected: string[];
	reason: CheckboxGroupReason;
};

type SelectionTarget =
	| { kind: "item"; input: HTMLInputElement }
	| { kind: "all"; input: HTMLInputElement };

/**
 * Synchronizes a master checkbox with an authored group of native checkboxes.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/checkbox-group.contract.json
 */
export default class CheckboxGroupController extends Controller<HTMLElement> {
	static targets = ["item", "all"];

	declare readonly itemTargets: HTMLInputElement[];
	declare readonly allTargets: HTMLInputElement[];

	private resetTasks = createFormResetTasks();
	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private reconcileQueued = false;
	private boundForms = new Set<HTMLFormElement>();

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.disableEnhancement();
		this.reconcileQueued = false;
	};

	itemTargetConnected = () => this.scheduleReconcile();
	itemTargetDisconnected = () => this.scheduleReconcile();
	allTargetConnected = () => this.scheduleReconcile();
	allTargetDisconnected = () => this.scheduleReconcile();

	/**
	 * Checked item values in DOM order. Assignment ignores unknown values and synchronizes item and
	 * master checkboxes without custom events.
	 */
	get selected(): string[] {
		if (!this.ensureEnhanced()) {
			return [];
		}
		return this.selectedFromItems();
	}

	/**
	 * Checked item values in DOM order. Assignment ignores unknown values and synchronizes item and
	 * master checkboxes without custom events.
	 */
	set selected(values: string[]) {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitSelected(values);
	}

	private ensureEnhanced = () => {
		if (!this.connected) {
			return false;
		}
		if (!this.enhanced) {
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
			this.disableEnhancement();
			this.warnInvalidMarkup();
			return;
		}

		this.enableEnhancement();
		this.syncFormListeners();
		this.syncMaster();
	};

	private enableEnhancement = () => {
		if (this.enhanced) {
			return;
		}

		this.enhanced = true;
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("change", this.handleChange);
	};

	private disableEnhancement = () => {
		this.resetTasks.cancel();
		if (this.enhanced) {
			this.enhanced = false;
			this.element.removeEventListener("click", this.handleClick);
			this.element.removeEventListener("change", this.handleChange);
		}

		for (const form of this.boundForms) {
			form.removeEventListener("reset", this.handleFormReset);
		}
		this.boundForms.clear();
	};

	private isValidMarkup = () => {
		if (this.itemTargets.length === 0 || this.allTargets.length !== 1) {
			return false;
		}

		const values = new Set<string>();
		for (const item of this.itemTargets) {
			if (!(item instanceof HTMLInputElement) || item.type !== "checkbox") {
				return false;
			}

			const value = item.dataset.checkboxGroupValue ?? "";
			if (value.trim() === "" || values.has(value)) {
				return false;
			}
			values.add(value);
		}

		const master = this.allTargets[0];
		if (!(master instanceof HTMLInputElement) || master.type !== "checkbox") {
			return false;
		}
		if (this.itemTargets.includes(master)) {
			return false;
		}

		return true;
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'checkbox-group controller: Provide one or more <input type="checkbox"> item targets with unique, nonempty data-checkbox-group-value values and exactly one separate <input type="checkbox"> all target. Enhancement has been disabled.',
		);
	};

	private syncFormListeners = () => {
		const forms = new Set<HTMLFormElement>();
		for (const item of this.itemTargets) {
			if (item.form !== null) {
				forms.add(item.form);
			}
		}

		for (const form of this.boundForms) {
			if (!forms.has(form)) {
				form.removeEventListener("reset", this.handleFormReset);
				this.boundForms.delete(form);
			}
		}
		for (const form of forms) {
			if (this.boundForms.has(form)) {
				continue;
			}
			form.addEventListener("reset", this.handleFormReset);
			this.boundForms.add(form);
		}
	};

	private handleFormReset = () => {
		this.resetTasks.schedule(() => {
			if (!this.connected || !this.enhanced) {
				return;
			}
			this.syncMaster();
		});
	};

	private handleChange = () => {
		this.syncMaster();
	};

	private handleClick = (event: MouseEvent) => {
		let target = this.selectionTargetFromEvent(event);
		let labelActivation = false;
		if (target === undefined) {
			if (!event.isTrusted) {
				this.syncMaster();
				return;
			}
			target = this.labelTargetFromEvent(event);
			if (target === undefined) {
				return;
			}
			labelActivation = true;
			event.preventDefault();
		}

		if (!event.isTrusted) {
			this.syncMaster();
			return;
		}

		if (target.input.disabled) {
			this.syncMaster();
			return;
		}
		if (labelActivation) {
			target.input.focus();
		}

		const items = this.itemsInDomOrder();
		const previousStates = new Map(items.map((item) => [item, item.checked]));
		const nextChecked = labelActivation ? !target.input.checked : target.input.checked;
		if (target.kind === "item" && !labelActivation) {
			previousStates.set(target.input, !target.input.checked);
		}
		const previousSelected = this.selectedFromStates(items, previousStates);
		const nextStates = new Map(previousStates);

		if (target.kind === "item") {
			nextStates.set(target.input, nextChecked);
		} else {
			for (const item of items) {
				if (!item.disabled) {
					nextStates.set(item, nextChecked);
				}
			}
		}

		const changed = items.some((item) => nextStates.get(item) !== previousStates.get(item));
		if (!changed) {
			this.syncMaster();
			return;
		}

		const reason: CheckboxGroupReason = event.detail > 0 ? "pointer" : "keyboard";
		const selected = this.selectedFromStates(items, nextStates);
		const detail: CheckboxGroupChangeDetail = { selected, previousSelected, reason };
		const beforeChange = new CustomEvent<CheckboxGroupChangeDetail>("checkbox-group:beforechange", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		const accepted = this.element.dispatchEvent(beforeChange);
		if (!accepted) {
			event.preventDefault();
			return;
		}

		for (const item of items) {
			item.checked = nextStates.get(item) === true;
		}
		this.syncMaster();
		this.element.dispatchEvent(
			new CustomEvent<CheckboxGroupChangeDetail>("checkbox-group:change", {
				bubbles: true,
				detail,
			}),
		);
	};

	private labelTargetFromEvent = (event: MouseEvent): SelectionTarget | undefined => {
		const label = event
			.composedPath()
			.find((candidate): candidate is HTMLLabelElement => candidate instanceof HTMLLabelElement);
		const control = label?.control;
		if (!(control instanceof HTMLInputElement)) {
			return undefined;
		}

		if (this.itemTargets.includes(control)) {
			return { kind: "item", input: control };
		}
		if (this.allTargets.includes(control)) {
			return { kind: "all", input: control };
		}
		return undefined;
	};

	private selectionTargetFromEvent = (event: Event): SelectionTarget | undefined => {
		const path = event.composedPath();
		const item = path.find(
			(candidate): candidate is HTMLInputElement =>
				candidate instanceof HTMLInputElement && this.itemTargets.includes(candidate),
		);
		if (item !== undefined) {
			return { kind: "item", input: item };
		}

		const master = path.find(
			(candidate): candidate is HTMLInputElement =>
				candidate instanceof HTMLInputElement && this.allTargets.includes(candidate),
		);
		if (master !== undefined) {
			return { kind: "all", input: master };
		}
		return undefined;
	};

	private itemsInDomOrder = () =>
		[...this.itemTargets].sort((left, right) => {
			if (left === right) {
				return 0;
			}
			return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
		});

	private selectedFromItems = () =>
		this.itemsInDomOrder()
			.filter((item) => item.checked)
			.map((item) => this.itemValue(item));

	private selectedFromStates = (
		items: HTMLInputElement[],
		states: Map<HTMLInputElement, boolean>,
	) => items.filter((item) => states.get(item) === true).map((item) => this.itemValue(item));

	private itemValue = (item: HTMLInputElement) => item.dataset.checkboxGroupValue ?? "";

	private commitSelected = (values: string[]) => {
		const selected = new Set(values);
		for (const item of this.itemTargets) {
			item.checked = selected.has(this.itemValue(item));
		}
		this.syncMaster();
	};

	private syncMaster = () => {
		const master = this.allTargets[0];
		if (master === undefined) {
			return;
		}

		const items = this.itemsInDomOrder().filter((item) => !item.disabled);
		const selectedCount = items.filter((item) => item.checked).length;
		master.checked = items.length > 0 && selectedCount === items.length;
		master.indeterminate = selectedCount > 0 && selectedCount < items.length;
	};
}
