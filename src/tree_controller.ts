import { Controller } from "@hotwired/stimulus";

import { ensureElementId } from "./internal/ensure_element_id";
import { createTypeahead } from "./internal/typeahead";

type SelectionReason = "pointer" | "keyboard";
type ToggleReason = "pointer" | "keyboard";

export type TreeChangeDetail = {
	value: string;
	previousValue: string;
	reason: SelectionReason;
};

export type TreeToggleDetail = {
	value: string;
	expanded: boolean;
	previousExpanded: boolean;
	reason: ToggleReason;
};

type TreeList = HTMLUListElement | HTMLOListElement;

const isTreeList = (element: Element): element is TreeList =>
	element instanceof HTMLUListElement || element instanceof HTMLOListElement;

/**
 * Provides hierarchical tree navigation and selection with virtual focus.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/tree.contract.json
 */
export default class TreeController extends Controller<HTMLElement> {
	static targets = ["item", "toggle"];
	static values = {
		value: { type: String, default: "" },
		expanded: { type: Array, default: [] },
	};

	declare readonly itemTargets: HTMLElement[];
	declare readonly toggleTargets: HTMLElement[];
	declare valueValue: string;
	declare expandedValue: string[];

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private initialized = false;
	private reconcileQueued = false;
	private currentValue = "";
	private currentExpanded: string[] = [];
	private activeItem?: HTMLLIElement;
	private observer?: MutationObserver;
	private validItems: HTMLLIElement[] = [];
	private managedGroups = new WeakSet<TreeList>();
	private knownGroups = new Set<TreeList>();
	private keyboardToggleTarget?: HTMLButtonElement;
	private typeahead = createTypeahead();

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		if (!this.reconcile()) {
			return;
		}

		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, {
			attributes: true,
			attributeFilter: ["data-tree-target", "data-tree-value", "aria-disabled", "type"],
			childList: true,
			subtree: true,
		});
	};

	disconnect = () => {
		this.connected = false;
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.observer?.disconnect();
		this.observer = undefined;
		this.enhanced = false;
		this.keyboardToggleTarget = undefined;
		this.typeahead.disconnect();
	};

	itemTargetConnected = () => this.scheduleReconcile();
	itemTargetDisconnected = () => this.scheduleReconcile();
	toggleTargetConnected = () => this.scheduleReconcile();
	toggleTargetDisconnected = (toggle: HTMLElement) => {
		if (this.keyboardToggleTarget === toggle) {
			this.keyboardToggleTarget = undefined;
		}
		this.scheduleReconcile();
	};
	valueValueChanged = () => this.scheduleReconcile();
	expandedValueChanged = () => this.scheduleReconcile();

	/**
	 * Selected item value. Assignment synchronizes selection and state without custom events.
	 */
	get value(): string {
		return this.currentValue;
	}

	/**
	 * Selected item value. Assignment synchronizes selection and state without custom events.
	 */
	set value(value: string) {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitValue(value);
	}

	/**
	 * Expanded item values. Assignment synchronizes expansion and state without custom events.
	 */
	get expanded(): string[] {
		return [...this.currentExpanded];
	}

	/**
	 * Expanded item values. Assignment synchronizes expansion and state without custom events.
	 */
	set expanded(values: string[]) {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitExpanded(values);
	}

	/**
	 * Selects the item with the specified value without custom events.
	 *
	 * @returns No return value.
	 */
	select = (value: string) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitValue(value);
	};

	/**
	 * Expands the item with the specified value without custom events. Does nothing for an item
	 * without children.
	 *
	 * @returns No return value.
	 */
	expand = (value: string) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const item = this.itemForValue(value);
		if (item === undefined || !this.hasChildren(item)) {
			return;
		}
		this.commitExpanded([...this.currentExpanded, value]);
	};

	/**
	 * Collapses the item with the specified value without custom events.
	 *
	 * @returns No return value.
	 */
	collapse = (value: string) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitExpanded(this.currentExpanded.filter((candidate) => candidate !== value));
	};

	private ensureEnhanced = () => {
		if (this.connected && !this.enhanced) {
			this.reconcile();
		}
		return this.enhanced;
	};

	private scheduleReconcile = () => {
		if (!this.connected || !this.enhanced || this.reconcileQueued) {
			return;
		}

		this.reconcileQueued = true;
		queueMicrotask(() => {
			this.reconcileQueued = false;
			if (this.connected && this.enhanced) {
				this.reconcile();
			}
		});
	};

	private reconcile = () => {
		const items = this.validateMarkup();
		if (items === undefined) {
			this.enhanced = false;
			this.observer?.disconnect();
			this.observer = undefined;
			this.typeahead.disconnect();
			this.element.removeEventListener("click", this.handleClick);
			this.element.removeEventListener("keydown", this.handleKeydown);
			this.warnInvalidMarkup();
			return false;
		}

		this.validItems = items;
		this.enhanced = true;
		const completionAttributes = this.applyStructure();

		if (!this.initialized) {
			this.currentValue = this.normalizeValue(this.valueValue);
			this.currentExpanded = this.initialExpandedValues();
			this.initialized = true;
		} else {
			this.currentValue = this.normalizeValue(this.currentValue);
			this.currentExpanded = this.normalizeExpanded(this.currentExpanded);
		}

		if (this.activeItem !== undefined && !this.validItems.includes(this.activeItem)) {
			this.activeItem = undefined;
		}
		this.syncState();
		this.warnCompletion(completionAttributes);
		return true;
	};

	private validateMarkup = (): HTMLLIElement[] | undefined => {
		if (!isTreeList(this.element)) {
			return undefined;
		}
		if (!this.hasAccessibleName()) {
			return undefined;
		}
		const rootRole = this.element.getAttribute("role");
		if (rootRole !== null && rootRole !== "tree") {
			return undefined;
		}

		const targetItems = this.itemTargets.filter(
			(item): item is HTMLLIElement => item instanceof HTMLLIElement,
		);
		if (targetItems.length !== this.itemTargets.length || targetItems.length === 0) {
			return undefined;
		}

		const discoveredItems: HTMLLIElement[] = [];
		const discovered = new Set<HTMLLIElement>();
		const visitList = (list: TreeList): boolean => {
			for (const child of Array.from(list.children)) {
				if (!(child instanceof HTMLLIElement)) {
					return false;
				}
				discoveredItems.push(child);
				discovered.add(child);

				const nestedLists = Array.from(child.children).filter(isTreeList);
				if (nestedLists.length > 1) {
					return false;
				}
				for (const nestedList of nestedLists) {
					if (!visitList(nestedList)) {
						return false;
					}
				}
			}
			return true;
		};
		if (!visitList(this.element)) {
			return undefined;
		}
		if (
			discoveredItems.length !== targetItems.length ||
			targetItems.some((item) => !discovered.has(item))
		) {
			return undefined;
		}

		const values = targetItems.map((item) => item.dataset.treeValue ?? "");
		if (values.some((value) => value.trim() === "")) {
			return undefined;
		}
		if (new Set(values).size !== values.length) {
			return undefined;
		}

		const toggleOwners = new Map<HTMLLIElement, number>();
		for (const candidate of this.toggleTargets) {
			if (!(candidate instanceof HTMLButtonElement) || candidate.type !== "button") {
				return undefined;
			}
			const owner = this.closestItem(candidate, targetItems);
			if (owner === undefined) {
				return undefined;
			}
			const group = Array.from(owner.children).find(isTreeList);
			const hasChildren =
				group !== undefined &&
				Array.from(group.children).some(
					(child): child is HTMLLIElement =>
						child instanceof HTMLLIElement && targetItems.includes(child),
				);
			if (!hasChildren) {
				return undefined;
			}
			const count = (toggleOwners.get(owner) ?? 0) + 1;
			toggleOwners.set(owner, count);
			if (count > 1) {
				return undefined;
			}
		}

		return targetItems;
	};

	private hasAccessibleName = () =>
		(this.element.getAttribute("aria-label") ?? "").trim() !== "" ||
		(this.element.getAttribute("aria-labelledby") ?? "").trim() !== "";

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'tree controller: Use a named <ul> or <ol> root with one or more <li> item targets whose data-tree-value values are unique and nonempty. Each item with children requires exactly one <button type="button"> toggle target. Enhancement has been disabled.',
		);
	};

	private applyStructure = () => {
		const completionAttributes: string[] = [];
		const rootRoleMissing = !this.element.hasAttribute("role");
		if (!this.element.hasAttribute("role")) {
			this.element.setAttribute("role", "tree");
		}
		if (rootRoleMissing) {
			completionAttributes.push('role="tree"');
		}
		if (!this.element.hasAttribute("tabindex")) {
			this.element.setAttribute("tabindex", "0");
		}

		const groups = new Set<TreeList>();
		for (const item of this.validItems) {
			const itemRoleMissing = !item.hasAttribute("role");
			if (!item.hasAttribute("role")) {
				item.setAttribute("role", "treeitem");
			}
			if (itemRoleMissing) {
				completionAttributes.push('role="treeitem"');
			}
			if (item.id === "") {
				ensureElementId(item, "tree-item");
			}
			for (const child of Array.from(item.children).filter(isTreeList)) {
				groups.add(child);
				if (!child.hasAttribute("role")) {
					child.setAttribute("role", "group");
					completionAttributes.push('role="group"');
					this.managedGroups.add(child);
				}
			}
		}
		for (const group of this.knownGroups) {
			if (!groups.has(group) && this.managedGroups.has(group)) {
				group.removeAttribute("role");
			}
		}
		this.knownGroups = groups;
		return completionAttributes;
	};

	private warnCompletion = (attributes: string[]) => {
		if (attributes.length === 0 || this.completionWarningIssued) {
			return;
		}
		this.completionWarningIssued = true;
		console.warn(`tree controller: Added ${attributes.join(", ")}. Include them in your markup.`);
	};

	private syncState = () => {
		if (this.activeItem !== undefined) {
			this.element.setAttribute(
				"aria-activedescendant",
				ensureElementId(this.activeItem, "tree-item"),
			);
		} else {
			this.element.removeAttribute("aria-activedescendant");
		}

		for (const item of this.validItems) {
			const value = this.itemValue(item);
			const selected = value === this.currentValue;
			const disabled = this.isDisabled(item);
			const active = item === this.activeItem;
			item.setAttribute("aria-selected", String(selected));
			item.setAttribute("tabindex", "-1");
			if (this.hasChildren(item)) {
				item.setAttribute("aria-expanded", String(this.isExpanded(value)));
			} else {
				item.removeAttribute("aria-expanded");
			}
			item.dataset.state = disabled
				? "disabled"
				: active
					? "active"
					: selected
						? "selected"
						: "inactive";
		}
	};

	private initialExpandedValues = () => {
		const requested = new Set(this.expandedValue);
		const values = this.validItems
			.filter((item) => this.hasChildren(item))
			.filter((item) =>
				item.hasAttribute("aria-expanded")
					? item.getAttribute("aria-expanded") === "true"
					: requested.has(this.itemValue(item)),
			)
			.map((item) => this.itemValue(item));
		return [...new Set(values)];
	};

	private normalizeValue = (value: string) =>
		this.validItems.some((item) => this.itemValue(item) === value) ? value : "";

	private normalizeExpanded = (values: string[]) => {
		const expandable = new Set(
			this.validItems.filter((item) => this.hasChildren(item)).map((item) => this.itemValue(item)),
		);
		return [...new Set(values)].filter((value) => expandable.has(value));
	};

	private commitValue = (value: string) => {
		this.currentValue = this.normalizeValue(value);
		this.syncValues();
		this.syncState();
	};

	private commitExpanded = (values: string[]) => {
		this.currentExpanded = this.normalizeExpanded(values);
		this.syncValues();
		this.syncState();
	};

	private syncValues = () => {
		if (this.valueValue !== this.currentValue) {
			this.valueValue = this.currentValue;
		}
		if (!this.sameValues(this.expandedValue, this.currentExpanded)) {
			this.expandedValue = [...this.currentExpanded];
		}
	};

	private sameValues = (left: string[], right: string[]) =>
		left.length === right.length && left.every((value, index) => value === right[index]);

	private itemForValue = (value: string) =>
		this.validItems.find((item) => this.itemValue(item) === value);

	private itemValue = (item: HTMLLIElement) => item.dataset.treeValue ?? "";

	private itemLabel = (item: HTMLLIElement) => {
		const parts: string[] = [];
		const collect = (node: Node) => {
			for (const child of Array.from(node.childNodes)) {
				if (child.nodeType === Node.TEXT_NODE) {
					parts.push(child.textContent ?? "");
					continue;
				}
				if (!(child instanceof Element)) {
					continue;
				}
				if (isTreeList(child)) {
					continue;
				}
				if (child instanceof HTMLButtonElement && this.toggleTargets.includes(child)) {
					continue;
				}
				collect(child);
			}
		};
		collect(item);
		return parts.join("").trim();
	};

	private hasChildren = (item: HTMLLIElement) => this.childItems(item).length > 0;

	private childItems = (item: HTMLLIElement) => {
		const group = Array.from(item.children).find(isTreeList);
		if (group === undefined) {
			return [];
		}
		return Array.from(group.children).filter(
			(child): child is HTMLLIElement =>
				child instanceof HTMLLIElement && this.validItems.includes(child),
		);
	};

	private parentItem = (item: HTMLLIElement) => {
		const list = item.parentElement;
		const parent = list?.parentElement;
		return parent instanceof HTMLLIElement && this.validItems.includes(parent) ? parent : undefined;
	};

	private closestItem = (element: Element, items: HTMLLIElement[]) => {
		let current: Element | null = element;
		while (current !== null && current !== this.element) {
			if (current instanceof HTMLLIElement && items.includes(current)) {
				return current;
			}
			current = current.parentElement;
		}
		return undefined;
	};

	private isDisabled = (item: HTMLLIElement) => item.getAttribute("aria-disabled") === "true";

	private isExpanded = (value: string) => this.currentExpanded.includes(value);

	private isVisible = (item: HTMLLIElement) => {
		let parent = this.parentItem(item);
		while (parent !== undefined) {
			if (!this.isExpanded(this.itemValue(parent))) {
				return false;
			}
			parent = this.parentItem(parent);
		}
		return true;
	};

	private visibleItems = () => this.validItems.filter((item) => this.isVisible(item));

	private navigableItems = () => this.visibleItems().filter((item) => !this.isDisabled(item));

	private setActive = (item: HTMLLIElement | undefined) => {
		this.activeItem = item;
		this.syncState();
	};

	private requestSelection = (item: HTMLLIElement, reason: SelectionReason) => {
		if (this.isDisabled(item)) {
			return;
		}
		const value = this.itemValue(item);
		if (value === this.currentValue) {
			this.setActive(item);
			return;
		}

		const detail: TreeChangeDetail = {
			value,
			previousValue: this.currentValue,
			reason,
		};
		const beforeChange = this.element.dispatchEvent(
			new CustomEvent<TreeChangeDetail>("tree:beforechange", {
				bubbles: true,
				cancelable: true,
				detail,
			}),
		);
		if (!beforeChange) {
			return;
		}

		this.setActive(item);
		this.commitValue(value);
		this.element.dispatchEvent(
			new CustomEvent<TreeChangeDetail>("tree:change", { bubbles: true, detail }),
		);
	};

	private requestToggle = (item: HTMLLIElement, expanded: boolean, reason: ToggleReason) => {
		if (!this.hasChildren(item)) {
			return;
		}
		const value = this.itemValue(item);
		const previousExpanded = this.isExpanded(value);
		if (expanded === previousExpanded) {
			return;
		}
		const detail: TreeToggleDetail = { value, expanded, previousExpanded, reason };
		const beforeToggle = this.element.dispatchEvent(
			new CustomEvent<TreeToggleDetail>("tree:beforetoggle", {
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
				? [...this.currentExpanded, value]
				: this.currentExpanded.filter((candidate) => candidate !== value),
		);
		this.element.dispatchEvent(
			new CustomEvent<TreeToggleDetail>("tree:toggle", { bubbles: true, detail }),
		);
	};

	private eventItem = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLLIElement =>
					candidate instanceof HTMLLIElement && this.validItems.includes(candidate),
			);

	private eventToggle = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLButtonElement =>
					candidate instanceof HTMLButtonElement && this.toggleTargets.includes(candidate),
			);

	private handleClick = (event: MouseEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		this.element.focus();
		const toggle = this.eventToggle(event);
		if (toggle !== undefined) {
			const item = this.closestItem(toggle, this.validItems);
			if (item === undefined || this.isDisabled(item)) {
				return;
			}
			const reason: ToggleReason = this.keyboardToggleTarget === toggle ? "keyboard" : "pointer";
			this.keyboardToggleTarget = undefined;
			this.requestToggle(item, !this.isExpanded(this.itemValue(item)), reason);
			return;
		}

		const item = this.eventItem(event);
		if (item === undefined || this.isDisabled(item)) {
			return;
		}
		this.requestSelection(item, "pointer");
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		if (event.target instanceof HTMLButtonElement && this.toggleTargets.includes(event.target)) {
			if (event.key === "Enter" || event.key === " ") {
				this.keyboardToggleTarget = event.target;
			}
			return;
		}
		if (event.target !== this.element) {
			return;
		}

		const active = this.activeItem;
		const items = this.navigableItems();
		const typeaheadResult = this.typeahead.handleKeydown(
			event,
			items,
			(item) => this.itemLabel(item),
			active === undefined ? -1 : items.indexOf(active),
		);
		if (typeaheadResult.consumed) {
			event.preventDefault();
			if (typeaheadResult.index !== undefined) {
				this.setActive(items[typeaheadResult.index]);
			}
			return;
		}
		if (event.key === "Enter") {
			if (active !== undefined && items.includes(active)) {
				event.preventDefault();
				this.requestSelection(active, "keyboard");
			}
			return;
		}

		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			const index = active === undefined ? -1 : items.indexOf(active);
			const delta = event.key === "ArrowDown" ? 1 : -1;
			const nextIndex = index < 0 ? (delta > 0 ? 0 : items.length - 1) : index + delta;
			const next = items[nextIndex];
			if (next === undefined) {
				return;
			}
			event.preventDefault();
			this.setActive(next);
			return;
		}

		if (event.key === "Home" || event.key === "End") {
			const next = event.key === "Home" ? items[0] : items.at(-1);
			if (next === undefined) {
				return;
			}
			event.preventDefault();
			this.setActive(next);
			return;
		}

		if (active === undefined || !items.includes(active)) {
			return;
		}
		if (event.key === "ArrowRight") {
			event.preventDefault();
			if (!this.hasChildren(active)) {
				return;
			}
			if (!this.isExpanded(this.itemValue(active))) {
				this.requestToggle(active, true, "keyboard");
				return;
			}
			const child = this.childItems(active).find((item) => !this.isDisabled(item));
			if (child !== undefined && this.isVisible(child)) {
				this.setActive(child);
			}
			return;
		}

		if (event.key === "ArrowLeft") {
			event.preventDefault();
			if (this.hasChildren(active) && this.isExpanded(this.itemValue(active))) {
				this.requestToggle(active, false, "keyboard");
				return;
			}
			let parent = this.parentItem(active);
			while (parent !== undefined && this.isDisabled(parent)) {
				parent = this.parentItem(parent);
			}
			if (parent !== undefined) {
				this.setActive(parent);
			}
		}
	};
}

export { TreeController };
