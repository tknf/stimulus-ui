import { Controller } from "@hotwired/stimulus";
import { createFormResetTasks } from "./internal/form_reset_tasks";

type TableSelectReason = "pointer" | "keyboard";

export type TableSelectChangeDetail = {
	selected: string[];
	previousSelected: string[];
	reason: TableSelectReason;
};

type SelectionTarget =
	| { kind: "item"; input: HTMLInputElement }
	| { kind: "all"; input: HTMLInputElement };

/**
 * Adds row-checkbox selection, a tri-state master checkbox, and Shift range selection to a native table.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/table-select.contract.json
 */
export default class TableSelectController extends Controller<HTMLTableElement> {
	static targets = ["item", "all"];

	declare readonly itemTargets: HTMLInputElement[];
	declare readonly allTargets: HTMLInputElement[];

	private resetTasks = createFormResetTasks();
	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private reconcileQueued = false;
	private anchor?: HTMLInputElement;
	private boundForms = new Set<HTMLFormElement>();
	private shiftKeyDown = false;

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.anchor = undefined;
		this.shiftKeyDown = false;
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.disableEnhancement();
		this.reconcileQueued = false;
	};

	itemTargetConnected = () => this.scheduleReconcile();
	itemTargetDisconnected = (item: HTMLInputElement) => {
		if (this.anchor === item) {
			this.anchor = undefined;
		}
		this.scheduleReconcile();
	};
	allTargetConnected = () => this.scheduleReconcile();
	allTargetDisconnected = () => this.scheduleReconcile();

	/**
	 * Checked row values in DOM order. Assignment ignores unknown values and synchronizes row and
	 * master checkboxes without custom events.
	 */
	get selected(): string[] {
		if (!this.ensureEnhanced()) {
			return [];
		}
		return this.selectedFromItems();
	}

	/**
	 * Checked row values in DOM order. Assignment ignores unknown values and synchronizes row and
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
		this.element.addEventListener("keydown", this.handleKeydown);
		this.element.addEventListener("keyup", this.handleKeyup);
		this.element.addEventListener("focusout", this.handleFocusout);
	};

	private disableEnhancement = () => {
		this.resetTasks.cancel();
		if (this.enhanced) {
			this.enhanced = false;
			this.element.removeEventListener("click", this.handleClick);
			this.element.removeEventListener("change", this.handleChange);
			this.element.removeEventListener("keydown", this.handleKeydown);
			this.element.removeEventListener("keyup", this.handleKeyup);
			this.element.removeEventListener("focusout", this.handleFocusout);
		}

		for (const form of this.boundForms) {
			form.removeEventListener("reset", this.handleFormReset);
		}
		this.boundForms.clear();
		this.anchor = undefined;
		this.shiftKeyDown = false;
	};

	private isValidMarkup = () => {
		const table = this.table();
		if (table === null || this.itemTargets.length === 0 || this.allTargets.length > 1) {
			return false;
		}

		const values = new Set<string>();
		const rows = new Set<HTMLTableRowElement>();
		for (const item of this.itemTargets) {
			if (!(item instanceof HTMLInputElement) || item.type !== "checkbox") {
				return false;
			}
			if (!table.contains(item)) {
				return false;
			}

			const row = item.closest("tr");
			if (!(row instanceof HTMLTableRowElement) || row.closest("table") !== table) {
				return false;
			}
			if (rows.has(row)) {
				return false;
			}
			rows.add(row);

			const value = item.dataset.tableSelectValue ?? "";
			if (value.trim() === "" || values.has(value)) {
				return false;
			}
			values.add(value);
		}

		const master = this.allTargets[0];
		if (master === undefined) {
			return true;
		}
		if (!(master instanceof HTMLInputElement) || master.type !== "checkbox") {
			return false;
		}
		if (!table.contains(master) || this.itemTargets.includes(master)) {
			return false;
		}
		if (Array.from(rows).some((row) => row.contains(master))) {
			return false;
		}

		return true;
	};

	private table = () => (this.element instanceof HTMLTableElement ? this.element : null);

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'table-select controller: Use a <table> root with one or more <input type="checkbox"> item targets inside <tr> elements. Each item must have a unique, nonempty data-table-select-value. If present, provide exactly one <input type="checkbox"> all target outside item rows. Enhancement has been disabled.',
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

	private handleKeydown = (event: KeyboardEvent) => {
		if (event.key === "Shift") {
			this.shiftKeyDown = true;
		}
	};

	private handleKeyup = (event: KeyboardEvent) => {
		if (event.key === "Shift") {
			this.shiftKeyDown = false;
		}
	};

	private handleFocusout = (event: FocusEvent) => {
		const relatedTarget = event.relatedTarget;
		if (!(relatedTarget instanceof Node) || !this.element.contains(relatedTarget)) {
			this.shiftKeyDown = false;
		}
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
			const isRange =
				(event.shiftKey || this.shiftKeyDown) &&
				this.anchor !== undefined &&
				items.includes(this.anchor);
			if (isRange) {
				const anchorIndex = items.indexOf(this.anchor!);
				const targetIndex = items.indexOf(target.input);
				const start = Math.min(anchorIndex, targetIndex);
				const end = Math.max(anchorIndex, targetIndex);
				for (const item of items.slice(start, end + 1)) {
					if (!item.disabled) {
						nextStates.set(item, nextChecked);
					}
				}
			}
		} else {
			for (const item of items) {
				if (!item.disabled) {
					nextStates.set(item, nextChecked);
				}
			}
		}

		const changed = items.some((item) => nextStates.get(item) !== previousStates.get(item));
		if (!changed) {
			if (target.kind === "item") {
				this.anchor = target.input;
			}
			this.syncMaster();
			return;
		}

		const reason: TableSelectReason = event.detail > 0 ? "pointer" : "keyboard";
		const selected = this.selectedFromStates(items, nextStates);
		const detail: TableSelectChangeDetail = { selected, previousSelected, reason };
		const beforeChange = new CustomEvent<TableSelectChangeDetail>("table-select:beforechange", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		const accepted = this.element.dispatchEvent(beforeChange);
		if (!accepted) {
			event.preventDefault();
			if (target.kind === "item") {
				this.anchor = target.input;
			}
			return;
		}

		for (const item of items) {
			item.checked = nextStates.get(item) === true;
		}
		this.syncMaster();
		if (target.kind === "item") {
			this.anchor = target.input;
		}
		this.element.dispatchEvent(
			new CustomEvent<TableSelectChangeDetail>("table-select:change", {
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

	private itemValue = (item: HTMLInputElement) => item.dataset.tableSelectValue ?? "";

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
