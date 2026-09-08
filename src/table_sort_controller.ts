import { Controller } from "@hotwired/stimulus";

type SortDirection = "ascending" | "descending" | "none";
type SortReason = "pointer" | "keyboard";

export type TableSortSortDetail = {
	column: string;
	direction: SortDirection;
	previousColumn: string;
	previousDirection: SortDirection;
	reason: SortReason;
};

const SORT_DIRECTIONS: readonly SortDirection[] = ["ascending", "descending", "none"];

const isSortDirection = (value: string): value is SortDirection =>
	SORT_DIRECTIONS.includes(value as SortDirection);

/**
 * Requests sorting from authored native table headers without rearranging rows.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/table-sort.contract.json
 */
export default class TableSortController extends Controller<HTMLElement> {
	static targets = ["sortable"];
	static values = {
		column: { default: "", type: String },
		direction: { default: "none", type: String },
	};

	declare readonly sortableTargets: HTMLTableCellElement[];
	declare columnValue: string;
	declare directionValue: string;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private reconcileQueued = false;

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.disableEnhancement();
		this.reconcileQueued = false;
	};

	sortableTargetConnected = () => this.scheduleReconcile();
	sortableTargetDisconnected = (sortable: HTMLTableCellElement) => {
		if (this.connected && this.element.isConnected && this.enhanced) {
			this.clearSortableState(sortable);
		}
		this.scheduleReconcile();
	};
	columnValueChanged = () => this.scheduleReconcile();
	directionValueChanged = () => this.scheduleReconcile();

	/**
	 * Current sort column. Assignment synchronizes aria-sort and state without custom events; the
	 * consumer remains responsible for sorting rows.
	 */
	get column(): string {
		return this.columnValue;
	}

	/**
	 * Current sort column. Assignment synchronizes aria-sort and state without custom events; the
	 * consumer remains responsible for sorting rows.
	 */
	set column(value: string) {
		this.columnValue = value.trim();
	}

	/**
	 * Current sort direction. Assignment synchronizes aria-sort and state without custom events; the
	 * consumer remains responsible for sorting rows.
	 */
	get direction(): SortDirection {
		return this.normalizedDirection();
	}

	/**
	 * Current sort direction. Assignment synchronizes aria-sort and state without custom events; the
	 * consumer remains responsible for sorting rows.
	 */
	set direction(value: string) {
		this.directionValue = isSortDirection(value) ? value : "none";
	}

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
					"table-sort controller: Use a <table> root and <th> sortable targets without colspan. Each sortable target must contain exactly one <button> and a unique, nonempty data-table-sort-column value. Enhancement has been disabled.",
				);
			}
			return;
		}

		this.enableEnhancement();
		const completionAttributes = this.applyStructure();
		this.syncState();
		this.warnCompletion(completionAttributes);
	};

	private enableEnhancement = () => {
		if (this.enhanced) {
			return;
		}

		this.enhanced = true;
		this.element.addEventListener("click", this.handleClick);
	};

	private disableEnhancement = () => {
		if (!this.enhanced) {
			return;
		}

		this.enhanced = false;
		this.element.removeEventListener("click", this.handleClick);
	};

	private isValidMarkup = () => {
		const table = this.table();
		if (table === null) {
			return false;
		}

		const columns = new Set<string>();
		for (const sortable of this.sortableTargets) {
			if (!(sortable instanceof HTMLTableCellElement) || sortable.tagName !== "TH") {
				return false;
			}
			if (!table.contains(sortable)) {
				return false;
			}
			if (sortable.getElementsByTagName("button").length !== 1) {
				return false;
			}
			if (sortable.hasAttribute("colspan")) {
				return false;
			}

			const column = this.columnOf(sortable);
			if (column === "" || columns.has(column)) {
				return false;
			}
			columns.add(column);
		}

		return true;
	};

	private applyStructure = () => {
		const completionAttributes: string[] = [];
		for (const sortable of this.sortableTargets) {
			if (!sortable.hasAttribute("scope")) {
				sortable.setAttribute("scope", "col");
				completionAttributes.push('scope="col"');
			}
		}
		return completionAttributes;
	};

	private warnCompletion = (attributes: string[]) => {
		if (attributes.length === 0 || this.completionWarningIssued) {
			return;
		}
		this.completionWarningIssued = true;
		console.warn(
			`table-sort controller: Added ${attributes.join(", ")}. Include them in your markup.`,
		);
	};

	private syncState = () => {
		const column = this.columnValue.trim();
		const direction = this.normalizedDirection();
		const active = direction !== "none" ? column : "";

		for (const sortable of this.sortableTargets) {
			const isActive = active !== "" && this.columnOf(sortable) === active;
			const state = isActive ? direction : "none";
			sortable.setAttribute("aria-sort", state);
			sortable.dataset.state = state;
		}
	};

	private clearSortableState = (sortable: HTMLTableCellElement) => {
		sortable.removeAttribute("aria-sort");
		delete sortable.dataset.state;
	};

	private handleClick = (event: MouseEvent) => {
		if (!event.isTrusted) {
			return;
		}
		const sortable = this.sortableFromEvent(event);
		if (sortable !== undefined) {
			const reason: SortReason = event.detail > 0 ? "pointer" : "keyboard";
			this.requestSort(sortable, reason);
		}
	};

	private requestSort = (sortable: HTMLTableCellElement, reason: SortReason) => {
		const column = this.columnOf(sortable);
		if (column === "") {
			return;
		}

		const previousColumn = this.columnValue.trim();
		const previousDirection = this.normalizedDirection();
		const direction = this.nextSortDirection(column, previousColumn, previousDirection);
		if (column === previousColumn && direction === previousDirection) {
			return;
		}

		const detail: TableSortSortDetail = {
			column,
			direction,
			previousColumn,
			previousDirection,
			reason,
		};
		const before = new CustomEvent<TableSortSortDetail>("table-sort:beforesort", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		if (!this.element.dispatchEvent(before)) {
			return;
		}

		this.columnValue = column;
		this.directionValue = direction;
		this.syncState();
		this.element.dispatchEvent(
			new CustomEvent<TableSortSortDetail>("table-sort:sort", { bubbles: true, detail }),
		);
	};

	private nextSortDirection = (
		column: string,
		previousColumn: string,
		previousDirection: SortDirection,
	): SortDirection => {
		if (column !== previousColumn) {
			return "ascending";
		}
		if (previousDirection === "ascending") {
			return "descending";
		}
		if (previousDirection === "descending") {
			return "none";
		}
		return "ascending";
	};

	private normalizedDirection = (): SortDirection =>
		isSortDirection(this.directionValue) ? this.directionValue : "none";

	private sortableFromEvent = (event: Event) => {
		const path = event.composedPath();
		const button = path.find(
			(candidate): candidate is HTMLButtonElement => candidate instanceof HTMLButtonElement,
		);
		if (button === undefined) {
			return undefined;
		}
		return path.find(
			(candidate): candidate is HTMLTableCellElement =>
				candidate instanceof HTMLTableCellElement &&
				this.sortableTargets.includes(candidate) &&
				candidate.contains(button),
		);
	};

	private columnOf = (cell: HTMLTableCellElement) =>
		(cell.getAttribute("data-table-sort-column") ?? "").trim();

	private table = () => (this.element instanceof HTMLTableElement ? this.element : null);
}

export { TableSortController };
