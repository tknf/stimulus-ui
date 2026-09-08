import { Controller } from "@hotwired/stimulus";

/**
 * Adds two-dimensional keyboard navigation to an authored native table.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/grid.contract.json
 */
export default class GridController extends Controller<HTMLElement> {
	static values = {
		pageSize: { default: 10, type: Number },
	};

	declare pageSizeValue: number;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private reconcileQueued = false;
	private currentCell?: HTMLTableCellElement;
	private observer?: MutationObserver;

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, { childList: true, subtree: true });
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.disableEnhancement();
		this.observer?.disconnect();
		this.observer = undefined;
		this.reconcileQueued = false;
	};

	pageSizeValueChanged = () => this.scheduleReconcile();

	/**
	 * Cell currently holding tabindex="0", or undefined when no active cell is available.
	 */
	get activeCell(): HTMLTableCellElement | undefined {
		const cells = this.cells();
		return this.currentCell !== undefined && cells.includes(this.currentCell)
			? this.currentCell
			: undefined;
	}

	/**
	 * Moves focus to the cell at the specified zero-based row and column without custom events.
	 *
	 * @returns No return value.
	 */
	focusCell = (row: number, column: number): void => {
		if (!this.enhanced && this.connected) {
			this.reconcile();
		}
		if (!this.enhanced || !Number.isInteger(row) || !Number.isInteger(column)) {
			return;
		}

		const target = this.rows()[row]?.cells[column];
		if (!(target instanceof HTMLTableCellElement)) {
			return;
		}

		this.focusTarget(target);
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
			if (!this.warningIssued) {
				this.warningIssued = true;
				console.warn(
					"grid controller: Use a named native <table> root with at least one row and cell, equal cell counts in every row, and no rowspan or colspan. Set pageSize to a positive integer. Enhancement has been disabled.",
				);
			}
			return;
		}

		this.enableEnhancement();
		const completionAttributes = this.applyStructure();
		this.syncRovingTabindex();
		this.warnCompletion(completionAttributes);
	};

	private enableEnhancement = () => {
		if (this.enhanced) {
			return;
		}

		this.enhanced = true;
		this.element.addEventListener("keydown", this.handleKeydown);
		this.element.addEventListener("focusin", this.handleFocusin);
	};

	private disableEnhancement = () => {
		if (!this.enhanced) {
			return;
		}

		this.enhanced = false;
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.element.removeEventListener("focusin", this.handleFocusin);
	};

	private isValidMarkup = () => {
		const table = this.table();
		if (table === null || !this.hasAccessibleName(table)) {
			return false;
		}

		const rows = this.rows();
		if (rows.length === 0) {
			return false;
		}

		const cellCount = rows[0]?.cells.length ?? 0;
		if (cellCount === 0) {
			return false;
		}
		if (rows.some((row) => row.cells.length !== cellCount)) {
			return false;
		}
		if (
			rows.some((row) =>
				Array.from(row.cells).some(
					(cell) => cell.hasAttribute("rowspan") || cell.hasAttribute("colspan"),
				),
			)
		) {
			return false;
		}

		if (!Number.isInteger(this.pageSizeValue) || this.pageSizeValue < 1) {
			return false;
		}

		return true;
	};

	private hasAccessibleName = (table: HTMLTableElement) => {
		if (table.hasAttribute("aria-label")) {
			return table.getAttribute("aria-label")?.trim() !== "";
		}

		if (table.hasAttribute("aria-labelledby")) {
			const ids = table.getAttribute("aria-labelledby")?.trim().split(/\s+/) ?? [];
			return (
				ids.length > 0 &&
				ids.every((id) => table.ownerDocument.getElementById(id) !== null) &&
				ids.some((id) => table.ownerDocument.getElementById(id)?.textContent?.trim() !== "")
			);
		}

		return Boolean(table.caption?.textContent?.trim());
	};

	private applyStructure = () => {
		const completionAttributes: string[] = [];
		if (!this.element.hasAttribute("role")) {
			this.element.setAttribute("role", "grid");
			completionAttributes.push('role="grid"');
		}
		return completionAttributes;
	};

	private warnCompletion = (attributes: string[]) => {
		if (attributes.length === 0 || this.completionWarningIssued) {
			return;
		}
		this.completionWarningIssued = true;
		console.warn(`grid controller: Added ${attributes.join(", ")}. Include them in your markup.`);
	};

	private syncRovingTabindex = () => {
		const cells = this.cells();
		if (cells.length === 0) {
			this.currentCell = undefined;
			return;
		}

		if (this.currentCell === undefined || !cells.includes(this.currentCell)) {
			this.currentCell = cells.find((cell) => cell.getAttribute("tabindex") === "0") ?? cells[0];
		}

		for (const cell of cells) {
			cell.setAttribute("tabindex", cell === this.currentCell ? "0" : "-1");
		}
	};

	private focusTarget = (target: HTMLTableCellElement) => {
		if (!this.cells().includes(target)) {
			return;
		}

		this.currentCell = target;
		this.syncRovingTabindex();
		target.focus();
	};

	private handleFocusin = (event: FocusEvent) => {
		const cell = this.cellFromEvent(event);
		if (cell !== undefined) {
			this.currentCell = cell;
			this.syncRovingTabindex();
		}
	};

	private handleKeydown = (event: KeyboardEvent) => {
		const cell = this.cellFromEvent(event);
		if (cell === undefined) {
			return;
		}

		const rows = this.rows();
		const row = cell.parentElement;
		const actualRowIndex = row instanceof HTMLTableRowElement ? rows.indexOf(row) : -1;
		const columnIndex =
			row instanceof HTMLTableRowElement ? Array.from(row.cells).indexOf(cell) : -1;
		if (actualRowIndex < 0 || columnIndex < 0) {
			return;
		}

		let nextRow = actualRowIndex;
		let nextColumn = columnIndex;
		const lastRow = rows.length - 1;
		const lastColumn = rows[actualRowIndex]?.cells.length ?? 0;
		const lastColumnIndex = lastColumn - 1;

		if (event.ctrlKey && event.key === "Home") {
			nextRow = 0;
			nextColumn = 0;
		} else if (event.ctrlKey && event.key === "End") {
			nextRow = lastRow;
			nextColumn = (rows[lastRow]?.cells.length ?? 0) - 1;
		} else if (event.key === "Home") {
			nextColumn = 0;
		} else if (event.key === "End") {
			nextColumn = lastColumnIndex;
		} else if (event.key === "PageUp") {
			nextRow = Math.max(0, actualRowIndex - this.pageSizeValue);
		} else if (event.key === "PageDown") {
			nextRow = Math.min(lastRow, actualRowIndex + this.pageSizeValue);
		} else if (event.key === "ArrowUp") {
			nextRow = Math.max(0, actualRowIndex - 1);
		} else if (event.key === "ArrowDown") {
			nextRow = Math.min(lastRow, actualRowIndex + 1);
		} else if (event.key === "ArrowLeft") {
			const delta = getComputedStyle(this.element).direction === "rtl" ? 1 : -1;
			nextColumn = Math.max(0, Math.min(lastColumnIndex, columnIndex + delta));
		} else if (event.key === "ArrowRight") {
			const delta = getComputedStyle(this.element).direction === "rtl" ? -1 : 1;
			nextColumn = Math.max(0, Math.min(lastColumnIndex, columnIndex + delta));
		} else {
			return;
		}

		event.preventDefault();
		const target = rows[nextRow]?.cells[nextColumn];
		if (target instanceof HTMLTableCellElement) {
			this.focusTarget(target);
		}
	};

	private cellFromEvent = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLTableCellElement =>
					candidate instanceof HTMLTableCellElement && this.cells().includes(candidate),
			);

	private table = () => (this.element instanceof HTMLTableElement ? this.element : null);

	private rows = () => {
		const table = this.table();
		return table === null ? [] : Array.from(table.rows);
	};

	private cells = () => this.rows().flatMap((row) => Array.from(row.cells));
}

export { GridController };
