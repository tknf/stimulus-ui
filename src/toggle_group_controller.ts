import { hasAccessibleTextName } from "./internal/accessible_text_name";
import { Controller } from "@hotwired/stimulus";
import { isImeKeydown } from "./internal/ime";
import { horizontalArrowDelta, wrapNavigationIndex } from "./internal/roving_navigation";

export type ToggleGroupChangeDetail = {
	selected: string[];
	previousSelected: string[];
	reason: "pointer" | "keyboard";
};

/**
 * Manages single or multiple selection among authored toggle buttons.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/toggle-group.contract.json
 */
export default class ToggleGroupController extends Controller<HTMLElement> {
	static targets = ["item"];
	static values = {
		multiple: { type: Boolean, default: false },
		selected: { type: Array, default: [] },
		orientation: { type: String, default: "horizontal" },
	};

	declare readonly itemTargets: HTMLElement[];
	declare multipleValue: boolean;
	declare selectedValue: unknown[];
	declare orientationValue: string;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private reconcileQueued = false;
	private currentSelected: string[] = [];
	private currentItem?: HTMLButtonElement;
	private observer?: MutationObserver;
	private revision = 0;

	connect = () => {
		if (this.connected) {
			return;
		}
		this.connected = true;
		this.revision += 1;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.element.addEventListener("focusin", this.handleFocusin);
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, {
			attributes: true,
			attributeFilter: [
				"data-controller",
				"data-toggle-group-selected-value",
				"data-toggle-group-multiple-value",
				"data-toggle-group-orientation-value",
				"data-toggle-group-target",
				"data-toggle-group-value",
				"aria-label",
				"aria-labelledby",
				"id",
				"disabled",
				"type",
			],
			childList: true,
			characterData: true,
			subtree: true,
		});
		for (let ancestor = this.element.parentElement; ancestor; ancestor = ancestor.parentElement) {
			if (ancestor instanceof HTMLFieldSetElement) {
				this.observer.observe(ancestor, { attributes: true, attributeFilter: ["disabled"] });
			}
		}
		this.reconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.enhanced = false;
		this.revision += 1;
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.element.removeEventListener("focusin", this.handleFocusin);
		this.observer?.disconnect();
		this.observer = undefined;
	};

	itemTargetConnected = () => this.scheduleReconcile();
	itemTargetDisconnected = () => this.scheduleReconcile();

	/**
	 * Selected values in DOM order. Assignment removes unknown and duplicate values and keeps only
	 * the first DOM-order value in single mode. Disabled items can be selected programmatically.
	 * Does not move focus or emit events.
	 */
	get selected(): string[] {
		return [...this.currentSelected];
	}

	/**
	 * Selected values in DOM order. Assignment removes unknown and duplicate values and keeps only
	 * the first DOM-order value in single mode. Disabled items can be selected programmatically.
	 * Does not move focus or emit events.
	 */
	set selected(values: string[]) {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.revision += 1;
		this.commitSelected(values);
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

	private ensureEnhanced = () => {
		if (!this.isAttached()) {
			return false;
		}
		this.reconcile();
		return this.enhanced;
	};

	private isAttached = () =>
		this.connected &&
		this.element.isConnected &&
		(this.element.getAttribute("data-controller") ?? "").split(/\s+/).includes(this.identifier);

	private readSelected = (): string[] | undefined => {
		// Stimulus parses Array values before Changed callbacks; use the getter to
		// reject invalid JSON and observe only attribute change notifications.
		try {
			const values = this.selectedValue;
			return values.every((value): value is string => typeof value === "string")
				? values
				: undefined;
		} catch {
			return undefined;
		}
	};

	private reconcile = () => {
		const values = this.readSelected();
		if (values === undefined || !this.isValidMarkup()) {
			this.enhanced = false;
			if (!this.warningIssued) {
				this.warningIssued = true;
				console.warn(
					'toggle-group controller: Name the root and provide one or more named <button type="button"> item targets inside it with unique, nonempty data-toggle-group-value values. Set selected to an array of strings and orientation to horizontal or vertical. Enhancement has been disabled.',
				);
			}
			return;
		}
		this.enhanced = true;
		if (!this.element.hasAttribute("role")) {
			this.element.setAttribute("role", "group");
			if (!this.completionWarningIssued) {
				this.completionWarningIssued = true;
				console.warn('toggle-group controller: Added role="group". Include them in your markup.');
			}
		}
		this.commitSelected(values);
	};

	private isValidMarkup = () => {
		const items = this.itemTargets;
		const values = items.map(this.itemValue);
		return (
			hasAccessibleTextName(this.element, false) &&
			(this.orientationValue === "horizontal" || this.orientationValue === "vertical") &&
			items.length > 0 &&
			new Set(values).size === values.length &&
			items.every(
				(item) =>
					item instanceof HTMLButtonElement &&
					item.type === "button" &&
					item !== this.element &&
					this.element.contains(item) &&
					this.itemValue(item).trim() !== "" &&
					hasAccessibleTextName(item, true),
			)
		);
	};

	private itemValue = (item: HTMLElement) => item.getAttribute("data-toggle-group-value") ?? "";
	private isEnabled = (item: HTMLButtonElement) => !item.matches(":disabled");
	private buttons = () =>
		this.itemTargets.filter((item): item is HTMLButtonElement => item instanceof HTMLButtonElement);
	private enabledItems = () => this.buttons().filter(this.isEnabled);

	private normalizeSelected = (values: readonly string[]) => {
		const requested = new Set(values);
		const selected = this.itemTargets.map(this.itemValue).filter((value) => requested.has(value));
		return this.multipleValue ? selected : selected.slice(0, 1);
	};

	private commitSelected = (values: readonly string[]) => {
		const selected = this.normalizeSelected(values);
		if (
			selected.length !== this.currentSelected.length ||
			selected.some((value, index) => value !== this.currentSelected[index])
		) {
			this.revision += 1;
		}
		this.currentSelected = selected;
		const configured = this.readSelected();
		if (
			configured === undefined ||
			configured.length !== this.currentSelected.length ||
			configured.some((value, index) => value !== this.currentSelected[index])
		) {
			this.selectedValue = [...this.currentSelected];
		}
		this.syncState();
	};

	private syncState = () => {
		const enabled = this.enabledItems();
		const active =
			this.currentItem !== undefined && enabled.includes(this.currentItem)
				? this.currentItem
				: (enabled.find((item) => this.currentSelected.includes(this.itemValue(item))) ??
					enabled[0]);
		for (const item of this.buttons()) {
			const selected = this.currentSelected.includes(this.itemValue(item));
			item.setAttribute("aria-pressed", String(selected));
			item.dataset.state = selected ? "on" : "off";
			item.tabIndex = item === active ? 0 : -1;
		}
	};

	private eventItem = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLButtonElement =>
					candidate instanceof HTMLButtonElement && this.itemTargets.includes(candidate),
			);

	private handleFocusin = (event: FocusEvent) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const item = this.eventItem(event);
		if (item === undefined || !this.isEnabled(item)) {
			return;
		}
		this.currentItem = item;
		this.syncState();
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (
			!event.isTrusted ||
			event.defaultPrevented ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			isImeKeydown(event) ||
			!this.ensureEnhanced()
		) {
			return;
		}
		const item = this.eventItem(event);
		if (item === undefined || !this.isEnabled(item)) {
			return;
		}
		const items = this.enabledItems();
		const delta =
			this.orientationValue === "horizontal"
				? horizontalArrowDelta(event.key, getComputedStyle(this.element).direction)
				: event.key === "ArrowUp"
					? -1
					: event.key === "ArrowDown"
						? 1
						: undefined;
		const index =
			event.key === "Home"
				? 0
				: event.key === "End"
					? items.length - 1
					: delta === undefined
						? undefined
						: wrapNavigationIndex(items.indexOf(item) + delta, items.length);
		const next = index === undefined ? undefined : items[index];
		if (next === undefined) {
			return;
		}
		event.preventDefault();
		next.focus();
	};

	private handleClick = (event: MouseEvent) => {
		if (!event.isTrusted || event.defaultPrevented || !this.ensureEnhanced()) {
			return;
		}
		const item = this.eventItem(event);
		if (item === undefined || !this.isEnabled(item)) {
			return;
		}
		const value = this.itemValue(item);
		const previousSelected = [...this.currentSelected];
		const selected = this.normalizeSelected(
			previousSelected.includes(value)
				? previousSelected.filter((candidate) => candidate !== value)
				: this.multipleValue
					? [...previousSelected, value]
					: [value],
		);
		const reason = event.detail > 0 ? "pointer" : "keyboard";
		const detail = (): ToggleGroupChangeDetail => ({
			selected: [...selected],
			previousSelected: [...previousSelected],
			reason,
		});
		const revision = this.revision;
		const items = this.itemTargets;
		this.observer?.takeRecords();
		const accepted = this.element.dispatchEvent(
			new CustomEvent<ToggleGroupChangeDetail>("toggle-group:beforechange", {
				bubbles: true,
				cancelable: true,
				detail: detail(),
			}),
		);
		const markupChanged = this.operationMarkupChanged(items, this.observer?.takeRecords() ?? []);
		if (
			!this.isAttached() ||
			this.revision !== revision ||
			markupChanged ||
			!this.isValidMarkup() ||
			!this.isEnabled(item)
		) {
			if (this.isAttached()) {
				this.reconcile();
			}
			return;
		}
		if (!accepted) {
			return;
		}
		this.commitSelected(selected);
		this.element.dispatchEvent(
			new CustomEvent<ToggleGroupChangeDetail>("toggle-group:change", {
				bubbles: true,
				detail: detail(),
			}),
		);
	};

	private operationMarkupChanged = (items: HTMLElement[], records: MutationRecord[]) => {
		const current = this.itemTargets;
		if (items.length !== current.length || items.some((item, index) => item !== current[index])) {
			return true;
		}
		return records.some((record) => {
			if (items.some((item) => item.contains(record.target))) {
				return true;
			}
			if (record.type === "attributes") {
				return (
					record.target === this.element ||
					(record.attributeName === "disabled" &&
						record.target instanceof HTMLFieldSetElement &&
						items.some((item) => record.target.contains(item)))
				);
			}
			return (
				record.type === "childList" &&
				[...record.addedNodes, ...record.removedNodes].some((node) =>
					items.some((item) => node.contains(item)),
				)
			);
		});
	};
}
