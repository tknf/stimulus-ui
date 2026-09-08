import { Controller } from "@hotwired/stimulus";

type TreegridToggleReason = "pointer" | "keyboard";

export type TreegridToggleDetail = {
	value: string;
	expanded: boolean;
	reason: TreegridToggleReason;
};

export type TreegridChangeDetail = {
	selected: string[];
	previousSelected: string[];
	reason: TreegridToggleReason;
};

type TreegridRowInfo = {
	row: HTMLTableRowElement;
	value: string;
	level: number;
	parent?: TreegridRowInfo;
	children: TreegridRowInfo[];
	position: number;
	setSize: number;
};

/**
 * Adds cell navigation and hierarchical row expansion to an authored native table.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/treegrid.contract.json
 */
export default class TreegridController extends Controller<HTMLElement> {
	static targets = ["row", "toggle"];
	static values = {
		expanded: { type: Array, default: [] },
		pageSize: { type: Number, default: 10 },
		selection: { type: String, default: "none" },
		selected: { type: Array, default: [] },
	};

	declare readonly rowTargets: HTMLElement[];
	declare readonly toggleTargets: HTMLElement[];
	declare expandedValue: string[];
	declare pageSizeValue: number;
	declare selectionValue: string;
	declare selectedValue: string[];

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private initialized = false;
	private reconcileQueued = false;
	private currentExpanded: string[] = [];
	private currentSelected: string[] = [];
	private currentCell?: HTMLTableCellElement;
	private rowInfos: TreegridRowInfo[] = [];
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

	rowTargetConnected = () => this.scheduleReconcile();
	rowTargetDisconnected = () => this.scheduleReconcile();
	toggleTargetConnected = () => this.scheduleReconcile();
	toggleTargetDisconnected = () => this.scheduleReconcile();
	expandedValueChanged = () => this.scheduleReconcile();
	pageSizeValueChanged = () => this.scheduleReconcile();
	selectionValueChanged = () => this.scheduleReconcile();
	selectedValueChanged = () => this.scheduleReconcile();

	/**
	 * Expanded row values. Assignment commits expansion without events and ignores rows without
	 * children.
	 */
	get expanded(): string[] {
		return [...this.currentExpanded];
	}

	/**
	 * Expanded row values. Assignment commits expansion without events and ignores rows without
	 * children.
	 */
	set expanded(values: string[]) {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitExpanded(values);
	}

	/**
	 * Selected row values in DOM order. Assignment ignores unknown values and synchronizes
	 * selection, aria-selected, and data-selected without events. Single mode retains one value;
	 * none mode reads an empty array and ignores writes. Hidden rows can be selected.
	 */
	get selected(): string[] {
		return this.selectionEnabled() ? [...this.currentSelected] : [];
	}

	/**
	 * Selected row values in DOM order. Assignment ignores unknown values and synchronizes
	 * selection, aria-selected, and data-selected without events. Single mode retains one value;
	 * none mode reads an empty array and ignores writes. Hidden rows can be selected.
	 */
	set selected(values: string[]) {
		if (!this.selectionEnabled() || !this.ensureEnhanced()) {
			return;
		}
		this.commitSelected(values);
	}

	/**
	 * Expands a row without custom events. Unknown values, rows without children, and already
	 * expanded rows do nothing.
	 *
	 * @returns No return value.
	 */
	expand = (value: string) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const info = this.infoForValue(value);
		if (info === undefined || info.children.length === 0 || this.isExpanded(info.value)) {
			return;
		}
		this.commitExpanded([...this.currentExpanded, value]);
	};

	/**
	 * Collapses a row without custom events. Unknown values, rows without children, and already
	 * collapsed rows do nothing.
	 *
	 * @returns No return value.
	 */
	collapse = (value: string) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const info = this.infoForValue(value);
		if (info === undefined || info.children.length === 0 || !this.isExpanded(info.value)) {
			return;
		}
		this.commitExpanded(this.currentExpanded.filter((candidate) => candidate !== value));
	};

	/**
	 * Toggles row expansion without custom events. Unknown values and rows without children do
	 * nothing.
	 *
	 * @returns No return value.
	 */
	toggle = (value: string) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const info = this.infoForValue(value);
		if (info === undefined || info.children.length === 0) {
			return;
		}
		if (this.isExpanded(info.value)) {
			this.commitExpanded(this.currentExpanded.filter((candidate) => candidate !== value));
		} else {
			this.commitExpanded([...this.currentExpanded, value]);
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
			this.disableEnhancement();
			this.warnInvalidMarkup();
			return;
		}

		this.enableEnhancement();
		this.rowInfos = this.buildRowInfos();
		const firstReconcile = !this.initialized;
		if (!this.initialized) {
			this.currentExpanded = this.normalizeExpanded(this.expandedValue);
			this.initialized = true;
		} else if (!this.sameValues(this.expandedValue, this.currentExpanded)) {
			this.currentExpanded = this.normalizeExpanded(this.expandedValue);
		} else {
			this.currentExpanded = this.normalizeExpanded(this.currentExpanded);
		}
		if (this.selectionEnabled()) {
			if (firstReconcile) {
				this.currentSelected = this.normalizeSelected(this.selectedValue);
			} else if (!this.sameValues(this.selectedValue, this.currentSelected)) {
				this.currentSelected = this.normalizeSelected(this.selectedValue);
			} else {
				this.currentSelected = this.normalizeSelected(this.currentSelected);
			}
		}

		const completionAttributes = this.applyStructure();
		this.syncExpandedValue();
		if (this.selectionEnabled()) {
			this.syncSelectedValue();
		}
		this.syncState();
		this.warnCompletion(completionAttributes);
	};

	private enableEnhancement = () => {
		if (this.enhanced) {
			return;
		}

		this.enhanced = true;
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.element.addEventListener("focusin", this.handleFocusin);
	};

	private disableEnhancement = () => {
		if (!this.enhanced) {
			return;
		}

		this.enhanced = false;
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.element.removeEventListener("focusin", this.handleFocusin);
	};

	private isValidMarkup = () => {
		const table = this.table();
		if (table === null || !this.hasAccessibleName(table)) {
			return false;
		}

		const targets = Array.from(this.rowTargets);
		if (
			targets.length === 0 ||
			targets.some((target) => !(target instanceof HTMLTableRowElement))
		) {
			return false;
		}
		const rows = targets as HTMLTableRowElement[];
		if (rows.some((row) => !table.contains(row) || row.closest("table") !== table)) {
			return false;
		}

		const values = new Set<string>();
		let previousLevel = 0;
		for (const [index, row] of rows.entries()) {
			const level = this.parseLevel(row.dataset.treegridLevel);
			if (level === undefined || (index === 0 ? level !== 1 : level > previousLevel + 1)) {
				return false;
			}
			previousLevel = level;

			const value = row.dataset.treegridValue ?? "";
			if (value.trim() === "" || values.has(value)) {
				return false;
			}
			values.add(value);

			if (row.cells.length === 0) {
				return false;
			}
			if (
				Array.from(row.cells).some(
					(cell) => cell.hasAttribute("rowspan") || cell.hasAttribute("colspan"),
				)
			) {
				return false;
			}
		}

		const cellCount = rows[0]?.cells.length ?? 0;
		if (rows.some((row) => row.cells.length !== cellCount)) {
			return false;
		}
		if (!Number.isInteger(this.pageSizeValue) || this.pageSizeValue < 1) {
			return false;
		}
		if (!["none", "single", "multiple"].includes(this.selectionValue)) {
			return false;
		}

		return this.toggleTargets.every(
			(toggle) =>
				toggle instanceof HTMLButtonElement &&
				toggle.type === "button" &&
				this.rowForElement(toggle, rows) !== undefined,
		);
	};

	private table = () => (this.element instanceof HTMLTableElement ? this.element : null);

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

		return false;
	};

	private parseLevel = (value: string | undefined) => {
		if (value === undefined || value.trim() === "") {
			return undefined;
		}
		const level = Number(value);
		return Number.isInteger(level) && level > 0 ? level : undefined;
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'treegrid controller: Use a named <table> root. Provide <tr> row targets with data-treegrid-level and unique, nonempty data-treegrid-value values. Levels must be positive integers, start at 1, and increase by at most 1 between adjacent rows. Rows must have equal cell counts without rowspan or colspan. Use <button type="button"> toggle targets, a positive integer pageSize, and selection of none, single, or multiple. Enhancement has been disabled.',
		);
	};

	private applyStructure = () => {
		const completionAttributes: string[] = [];
		if (!this.element.hasAttribute("role")) {
			this.element.setAttribute("role", "treegrid");
			completionAttributes.push('role="treegrid"');
		}

		for (const info of this.rowInfos) {
			info.row.setAttribute("aria-level", String(info.level));
			info.row.setAttribute("aria-posinset", String(info.position));
			info.row.setAttribute("aria-setsize", String(info.setSize));
		}
		return completionAttributes;
	};

	private warnCompletion = (attributes: string[]) => {
		if (attributes.length === 0 || this.completionWarningIssued) {
			return;
		}
		this.completionWarningIssued = true;
		console.warn(
			`treegrid controller: Added ${attributes.join(", ")}. Include them in your markup.`,
		);
	};

	private buildRowInfos = () => {
		const rows = this.rowElements();
		const infos: TreegridRowInfo[] = rows.map((row) => ({
			row,
			value: row.dataset.treegridValue ?? "",
			level: this.parseLevel(row.dataset.treegridLevel) ?? 0,
			children: [],
			position: 0,
			setSize: 0,
		}));
		const stack: TreegridRowInfo[] = [];

		for (const info of infos) {
			while (stack.at(-1) !== undefined && (stack.at(-1)?.level ?? 0) >= info.level) {
				stack.pop();
			}
			const parent = stack.at(-1);
			if (parent !== undefined) {
				info.parent = parent;
				parent.children.push(info);
			}
			stack.push(info);
		}

		const roots = infos.filter((info) => info.parent === undefined);
		for (const info of infos) {
			const siblings = info.parent?.children ?? roots;
			info.position = siblings.indexOf(info) + 1;
			info.setSize = siblings.length;
		}

		return infos;
	};

	private syncState = () => {
		for (const info of this.rowInfos) {
			const expandable = info.children.length > 0;
			if (expandable) {
				const expanded = this.isExpanded(info.value);
				info.row.setAttribute("aria-expanded", String(expanded));
				info.row.dataset.state = expanded ? "expanded" : "collapsed";
			} else {
				info.row.removeAttribute("aria-expanded");
				delete info.row.dataset.state;
			}
			info.row.hidden = !this.isRowVisible(info);
		}

		this.syncSelectionState();
		this.syncRovingTabindex();
	};

	private syncSelectionState = () => {
		if (!this.selectionEnabled()) {
			return;
		}

		const multiple = this.selectionValue === "multiple";
		if (multiple) {
			this.element.setAttribute("aria-multiselectable", "true");
		}
		for (const info of this.rowInfos) {
			const selected = this.currentSelected.includes(info.value);
			if (multiple) {
				info.row.setAttribute("aria-selected", String(selected));
			} else if (selected) {
				info.row.setAttribute("aria-selected", "true");
			} else {
				info.row.removeAttribute("aria-selected");
			}
			if (selected) {
				info.row.dataset.selected = "true";
			} else {
				delete info.row.dataset.selected;
			}
		}
	};

	private syncRovingTabindex = () => {
		const cells = this.cells();
		const visibleCells = this.visibleCells();
		if (visibleCells.length === 0) {
			this.currentCell = undefined;
			for (const cell of cells) {
				cell.setAttribute("tabindex", "-1");
			}
			return;
		}

		if (this.currentCell !== undefined && !visibleCells.includes(this.currentCell)) {
			this.currentCell = this.fallbackCellForHiddenCell(this.currentCell);
		}
		if (this.currentCell === undefined || !visibleCells.includes(this.currentCell)) {
			this.currentCell =
				visibleCells.find((cell) => cell.getAttribute("tabindex") === "0") ?? visibleCells[0];
		}

		for (const cell of cells) {
			cell.setAttribute("tabindex", cell === this.currentCell ? "0" : "-1");
		}
	};

	private fallbackCellForHiddenCell = (cell: HTMLTableCellElement) => {
		const info = this.infoForCell(cell);
		let parent = info?.parent;
		while (parent !== undefined) {
			if (!this.isExpanded(parent.value) && this.isRowVisible(parent)) {
				return parent.row.cells[0];
			}
			parent = parent.parent;
		}
		return this.visibleCells()[0];
	};

	private focusTarget = (target: HTMLTableCellElement) => {
		if (!this.visibleCells().includes(target)) {
			return;
		}
		this.currentCell = target;
		this.syncRovingTabindex();
		target.focus();
	};

	private handleFocusin = (event: FocusEvent) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const cell = this.cellFromEvent(event);
		if (cell === undefined || !this.visibleCells().includes(cell)) {
			return;
		}
		this.currentCell = cell;
		this.syncRovingTabindex();
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		if (this.toggleFromEvent(event) !== undefined) {
			return;
		}

		const cell = this.cellFromEvent(event);
		if (cell === undefined || !this.visibleCells().includes(cell)) {
			return;
		}
		const info = this.infoForCell(cell);
		if (info === undefined) {
			return;
		}

		if (event.key === " " && event.shiftKey && this.selectionEnabled()) {
			event.preventDefault();
			this.requestSelection(info, "keyboard");
			return;
		}

		if (event.key === "Enter") {
			if (info.children.length > 0 && cell === info.row.cells[0]) {
				event.preventDefault();
				this.requestToggle(info, !this.isExpanded(info.value), "keyboard");
			}
			return;
		}

		const visibleRows = this.visibleRows();
		const rowIndex = visibleRows.indexOf(info);
		const columnIndex = Array.from(info.row.cells).indexOf(cell);
		if (rowIndex < 0 || columnIndex < 0) {
			return;
		}

		let nextRow = rowIndex;
		let nextColumn = columnIndex;
		const lastRow = visibleRows.length - 1;
		const lastColumnIndex = info.row.cells.length - 1;

		if (event.ctrlKey && event.key === "Home") {
			nextRow = 0;
			nextColumn = 0;
		} else if (event.ctrlKey && event.key === "End") {
			nextRow = lastRow;
			nextColumn = (visibleRows.at(-1)?.row.cells.length ?? 0) - 1;
		} else if (event.key === "Home") {
			nextColumn = 0;
		} else if (event.key === "End") {
			nextColumn = lastColumnIndex;
		} else if (event.key === "PageUp") {
			nextRow = Math.max(0, rowIndex - this.navigationPageSize());
		} else if (event.key === "PageDown") {
			nextRow = Math.min(lastRow, rowIndex + this.navigationPageSize());
		} else if (event.key === "ArrowUp") {
			nextRow = Math.max(0, rowIndex - 1);
		} else if (event.key === "ArrowDown") {
			nextRow = Math.min(lastRow, rowIndex + 1);
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
		const target = visibleRows[nextRow]?.row.cells[nextColumn];
		if (target instanceof HTMLTableCellElement) {
			this.focusTarget(target);
		}
	};

	private handleClick = (event: MouseEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}

		const toggle = this.toggleFromEvent(event);
		if (toggle !== undefined) {
			if (toggle.disabled) {
				return;
			}
			const info = this.infoForElement(toggle);
			if (info === undefined || info.children.length === 0) {
				return;
			}

			this.requestToggle(
				info,
				!this.isExpanded(info.value),
				event.detail === 0 ? "keyboard" : "pointer",
			);
			return;
		}
		if (!this.selectionEnabled()) {
			return;
		}
		if (this.interactiveFromEvent(event) !== undefined) {
			return;
		}

		const cell = this.cellFromEvent(event);
		if (cell === undefined || !this.visibleCells().includes(cell)) {
			return;
		}
		const info = this.infoForCell(cell);
		if (info === undefined) {
			return;
		}
		this.requestSelection(info, event.detail === 0 ? "keyboard" : "pointer");
	};

	private requestToggle = (
		info: TreegridRowInfo,
		expanded: boolean,
		reason: TreegridToggleReason,
	) => {
		if (info.children.length === 0) {
			return;
		}
		const previousExpanded = this.isExpanded(info.value);
		if (expanded === previousExpanded) {
			return;
		}

		const detail: TreegridToggleDetail = { value: info.value, expanded, reason };
		const beforeToggle = this.element.dispatchEvent(
			new CustomEvent<TreegridToggleDetail>("treegrid:beforetoggle", {
				bubbles: true,
				cancelable: true,
				detail,
			}),
		);
		if (!beforeToggle) {
			return;
		}

		this.commitExpanded(
			expanded
				? [...this.currentExpanded, info.value]
				: this.currentExpanded.filter((candidate) => candidate !== info.value),
		);
		this.element.dispatchEvent(
			new CustomEvent<TreegridToggleDetail>("treegrid:toggle", {
				bubbles: true,
				detail,
			}),
		);
	};

	private commitExpanded = (values: string[]) => {
		this.currentExpanded = this.normalizeExpanded(values);
		this.syncExpandedValue();
		this.syncState();
	};

	private commitSelected = (values: unknown) => {
		if (!this.enhanced) {
			return;
		}
		this.currentSelected = this.normalizeSelected(values);
		this.syncSelectedValue();
		this.syncState();
	};

	private syncExpandedValue = () => {
		if (!this.sameValues(this.expandedValue, this.currentExpanded)) {
			this.expandedValue = [...this.currentExpanded];
		}
	};

	private syncSelectedValue = () => {
		if (!this.sameValues(this.selectedValue, this.currentSelected)) {
			this.selectedValue = [...this.currentSelected];
		}
	};

	private normalizeExpanded = (values: unknown) => {
		if (!Array.isArray(values)) {
			return [];
		}
		const expandable = new Set(
			this.rowInfos.filter((info) => info.children.length > 0).map((info) => info.value),
		);
		const normalized: string[] = [];
		for (const value of values) {
			if (typeof value === "string" && expandable.has(value) && !normalized.includes(value)) {
				normalized.push(value);
			}
		}
		return normalized;
	};

	private normalizeSelected = (values: unknown) => {
		if (!this.selectionEnabled() || !Array.isArray(values)) {
			return [];
		}
		const selectedValues = new Set(
			values.filter((value): value is string => typeof value === "string"),
		);
		const normalized = this.rowInfos
			.filter((info) => selectedValues.has(info.value))
			.map((info) => info.value);
		return this.selectionValue === "single" ? normalized.slice(0, 1) : normalized;
	};

	private requestSelection = (info: TreegridRowInfo, reason: TreegridToggleReason) => {
		if (!this.selectionEnabled()) {
			return;
		}
		const previousSelected = [...this.currentSelected];
		if (this.selectionValue === "single" && previousSelected.includes(info.value)) {
			return;
		}

		const candidate =
			this.selectionValue === "single"
				? [info.value]
				: previousSelected.includes(info.value)
					? previousSelected.filter((value) => value !== info.value)
					: [...previousSelected, info.value];
		const selected = this.normalizeSelected(candidate);
		const detail: TreegridChangeDetail = {
			selected: [...selected],
			previousSelected,
			reason,
		};
		const beforeChange = new CustomEvent<TreegridChangeDetail>("treegrid:beforechange", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		if (!this.element.dispatchEvent(beforeChange)) {
			return;
		}

		this.commitSelected(selected);
		this.element.dispatchEvent(
			new CustomEvent<TreegridChangeDetail>("treegrid:change", { bubbles: true, detail }),
		);
	};

	private sameValues = (left: unknown, right: string[]) =>
		Array.isArray(left) &&
		left.length === right.length &&
		left.every((value, index) => value === right[index]);

	private selectionEnabled = () =>
		this.selectionValue === "single" || this.selectionValue === "multiple";

	private isExpanded = (value: string) => this.currentExpanded.includes(value);

	private isRowVisible = (info: TreegridRowInfo) => {
		let parent = info.parent;
		while (parent !== undefined) {
			if (!this.isExpanded(parent.value)) {
				return false;
			}
			parent = parent.parent;
		}
		return true;
	};

	private navigationPageSize = () =>
		Number.isInteger(this.pageSizeValue) && this.pageSizeValue > 0 ? this.pageSizeValue : 0;

	private infoForValue = (value: string) => this.rowInfos.find((info) => info.value === value);

	private infoForCell = (cell: HTMLTableCellElement) =>
		this.rowInfos.find((info) => info.row === cell.parentElement);

	private infoForElement = (element: Element) =>
		this.rowInfos.find((info) => info.row === this.rowForElement(element, this.rowElements()));

	private rowForElement = (element: Element, rows: HTMLTableRowElement[]) => {
		let current: Element | null = element;
		while (current !== null && current !== this.element) {
			if (current instanceof HTMLTableRowElement && rows.includes(current)) {
				return current;
			}
			current = current.parentElement;
		}
		return undefined;
	};

	private toggleFromEvent = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLButtonElement =>
					candidate instanceof HTMLButtonElement && this.toggleTargets.includes(candidate),
			);

	private interactiveFromEvent = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate) =>
					(candidate instanceof HTMLButtonElement && !this.toggleTargets.includes(candidate)) ||
					(candidate instanceof HTMLAnchorElement && candidate.hasAttribute("href")) ||
					candidate instanceof HTMLInputElement ||
					candidate instanceof HTMLSelectElement ||
					candidate instanceof HTMLTextAreaElement ||
					candidate instanceof HTMLLabelElement,
			);

	private cellFromEvent = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLTableCellElement =>
					candidate instanceof HTMLTableCellElement && this.cells().includes(candidate),
			);

	private rowElements = () =>
		this.rowTargets.filter(
			(target): target is HTMLTableRowElement => target instanceof HTMLTableRowElement,
		);

	private visibleRows = () => this.rowInfos.filter((info) => this.isRowVisible(info));

	private cells = () => this.rowInfos.flatMap((info) => Array.from(info.row.cells));

	private visibleCells = () =>
		this.rowInfos
			.filter((info) => this.isRowVisible(info))
			.flatMap((info) => Array.from(info.row.cells));
}

export { TreegridController };
