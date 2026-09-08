import { Controller } from "@hotwired/stimulus";

import { ensureElementId } from "./internal/ensure_element_id";
import { horizontalArrowDelta, wrapNavigationIndex } from "./internal/roving_navigation";

type SelectionReason = "keyboard" | "pointer";

export type TabsChangeDetail = {
	previousValue: string;
	reason: SelectionReason;
	value: string;
};

type TabPair = {
	panel: HTMLElement;
	tab: HTMLButtonElement;
	value: string;
};

const TAB_ORIENTATIONS = ["horizontal", "vertical"] as const;
const TAB_ACTIVATIONS = ["automatic", "manual"] as const;

const isAllowedTabOrientation = (value: string) =>
	TAB_ORIENTATIONS.includes(value as (typeof TAB_ORIENTATIONS)[number]);

const isAllowedTabActivation = (value: string) =>
	TAB_ACTIVATIONS.includes(value as (typeof TAB_ACTIVATIONS)[number]);

/**
 * Provides single-select tabs with APG keyboard navigation and synchronized panels.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/tabs.contract.json
 */
export default class TabsController extends Controller<HTMLElement> {
	static targets = ["tablist", "tab", "tabpanel"];
	static values = {
		activation: { default: "automatic", type: String },
		orientation: { default: "horizontal", type: String },
		value: String,
	};

	declare readonly tablistTargets: HTMLElement[];
	declare readonly tabTargets: HTMLButtonElement[];
	declare readonly tabpanelTargets: HTMLElement[];
	declare activationValue: string;
	declare orientationValue: string;
	declare valueValue: string;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private currentValue = "";
	private reconcileQueued = false;
	private observer?: MutationObserver;
	private readonly managedOrientation = new WeakSet<HTMLElement>();

	connect = () => {
		this.connected = true;
		this.enhanced = false;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, {
			attributeFilter: ["data-tabs-value", "disabled", "type"],
			attributes: true,
			subtree: true,
		});
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.observer?.disconnect();
		this.observer = undefined;
	};

	tablistTargetConnected = () => this.scheduleReconcile();
	tablistTargetDisconnected = () => this.scheduleReconcile();
	tabTargetConnected = () => this.scheduleReconcile();
	tabTargetDisconnected = () => this.scheduleReconcile();
	tabpanelTargetConnected = () => this.scheduleReconcile();
	tabpanelTargetDisconnected = () => this.scheduleReconcile();
	valueValueChanged = () => this.scheduleReconcile();
	orientationValueChanged = () => this.scheduleReconcile();
	activationValueChanged = () => this.scheduleReconcile();

	/**
	 * Selected data-tabs-value, or an empty string without a selection. Assignment follows select
	 * and stays synchronized with the Stimulus value attribute, without custom events.
	 */
	get value() {
		return this.currentValue;
	}

	/**
	 * Selected data-tabs-value, or an empty string without a selection. Assignment follows select
	 * and stays synchronized with the Stimulus value attribute, without custom events.
	 */
	set value(value: string) {
		this.select(value);
	}

	/**
	 * Selects a known enabled tab/panel pair without custom events. Empty or unknown values, invalid
	 * pairs, and disabled tabs do nothing.
	 *
	 * @returns No return value.
	 */
	select = (value: string) => {
		const pair = this.enabledPairs().find((candidate) => candidate.value === value);
		if (!pair) {
			return;
		}

		this.commit(value);
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
					'tabs controller: Provide exactly one tablist target and use <button type="button"> tab targets. Match tabs and tabpanels one-to-one using unique, nonempty data-tabs-value values. Set orientation to horizontal or vertical and activation to automatic or manual. Enhancement has been disabled.',
				);
			}
			return;
		}

		this.enableEnhancement();
		const completionAttributes = this.applyStructure();
		const pairs = this.enabledPairs();
		const current = pairs.find((pair) => pair.value === this.currentValue);
		const requested = pairs.find((pair) => pair.value === this.valueValue);
		const selected = current ? (requested ?? current) : (requested ?? pairs[0]);

		this.currentValue = selected?.value ?? "";
		this.syncRootValue(this.currentValue);
		this.syncState();
		this.warnCompletion(completionAttributes);
	};

	private enableEnhancement = () => {
		this.enhanced = true;
	};

	private disableEnhancement = () => {
		this.enhanced = false;
	};

	private isValidMarkup = () => {
		if (this.tablistTargets.length !== 1 || this.tabTargets.length === 0) {
			return false;
		}

		const tablist = this.tablistTargets[0];
		if (
			!this.tabTargets.every(
				(tab) => tab instanceof HTMLButtonElement && tab.type === "button" && tablist.contains(tab),
			)
		) {
			return false;
		}

		if (
			this.tabTargets.some((tab) => (tab.dataset.tabsValue ?? "").trim() === "") ||
			this.tabpanelTargets.some((panel) => (panel.dataset.tabsValue ?? "").trim() === "")
		) {
			return false;
		}

		if (!isAllowedTabOrientation(this.orientationValue)) {
			return false;
		}
		if (!isAllowedTabActivation(this.activationValue)) {
			return false;
		}

		const tabValues = this.tabTargets.map((tab) => tab.dataset.tabsValue ?? "");
		const panelValues = this.tabpanelTargets.map((panel) => panel.dataset.tabsValue ?? "");
		const panelValueSet = new Set(panelValues);
		if (panelValueSet.size !== panelValues.length) {
			return false;
		}
		if (
			!tabValues.every((value) => panelValueSet.has(value)) ||
			!panelValues.every((value) => tabValues.includes(value))
		) {
			return false;
		}

		const pairs = this.validPairs(true);
		return pairs.length === this.tabTargets.length;
	};

	private applyStructure = () => {
		const completionAttributes: string[] = [];
		for (const tablist of this.tablistTargets) {
			if (!tablist.hasAttribute("role")) {
				tablist.setAttribute("role", "tablist");
				completionAttributes.push('role="tablist"');
			}
			if (this.orientationValue === "vertical") {
				if (!tablist.hasAttribute("aria-orientation") || this.managedOrientation.has(tablist)) {
					tablist.setAttribute("aria-orientation", "vertical");
					this.managedOrientation.add(tablist);
				}
			} else if (this.managedOrientation.has(tablist)) {
				tablist.removeAttribute("aria-orientation");
				this.managedOrientation.delete(tablist);
			}
		}

		for (const tab of this.tabTargets) {
			if (!tab.hasAttribute("role")) {
				tab.setAttribute("role", "tab");
				completionAttributes.push('role="tab"');
			}
			ensureElementId(tab, "tabs-tab");
		}
		for (const panel of this.tabpanelTargets) {
			if (!panel.hasAttribute("role")) {
				panel.setAttribute("role", "tabpanel");
				completionAttributes.push('role="tabpanel"');
			}
			if (!panel.hasAttribute("tabindex")) {
				panel.setAttribute("tabindex", "0");
			}
			ensureElementId(panel, "tabs-tabpanel");
		}

		for (const pair of this.validPairs()) {
			if (!pair.tab.hasAttribute("aria-controls")) {
				pair.tab.setAttribute("aria-controls", pair.panel.id);
				completionAttributes.push("aria-controls");
			}
			if (!pair.panel.hasAttribute("aria-labelledby")) {
				pair.panel.setAttribute("aria-labelledby", pair.tab.id);
				completionAttributes.push("aria-labelledby");
			}
		}
		return completionAttributes;
	};

	private warnCompletion = (attributes: string[]) => {
		if (attributes.length === 0 || this.completionWarningIssued) {
			return;
		}
		this.completionWarningIssued = true;
		console.warn(`tabs controller: Added ${attributes.join(", ")}. Include them in your markup.`);
	};

	private validPairs = (ignoreEnhancement = false) => {
		if (!ignoreEnhancement && !this.enhanced) {
			return [];
		}

		const tablist = this.tablistTargets.length === 1 ? this.tablistTargets[0] : undefined;
		if (!tablist) {
			return [];
		}

		const pairs: TabPair[] = [];
		for (const tab of this.tabTargets) {
			const value = tab.dataset.tabsValue ?? "";
			if (!value || !tablist.contains(tab)) {
				continue;
			}
			const matchingTabs = this.tabTargets.filter(
				(candidate) => candidate.dataset.tabsValue === value,
			);
			const matchingPanels = this.tabpanelTargets.filter(
				(panel) => panel.dataset.tabsValue === value,
			);
			if (matchingTabs.length === 1 && matchingPanels.length === 1) {
				pairs.push({ panel: matchingPanels[0], tab, value });
			}
		}
		return pairs;
	};

	private enabledPairs = () => this.validPairs().filter((pair) => !pair.tab.disabled);

	private syncRootValue = (value: string) => {
		if (this.valueValue !== value) {
			this.valueValue = value;
		}
	};

	private syncState = () => {
		const selected = this.currentValue;
		for (const tab of this.tabTargets) {
			const active = Boolean(selected) && tab.dataset.tabsValue === selected;
			tab.setAttribute("aria-selected", String(active));
			tab.setAttribute("tabindex", active ? "0" : "-1");
			tab.dataset.state = active ? "active" : "inactive";
		}
		for (const panel of this.tabpanelTargets) {
			const active = Boolean(selected) && panel.dataset.tabsValue === selected;
			panel.hidden = !active;
			panel.dataset.state = active ? "active" : "inactive";
		}
	};

	private commit = (value: string) => {
		this.currentValue = value;
		this.syncRootValue(value);
		this.syncState();
	};

	private requestSelection = (value: string, reason: SelectionReason) => {
		if (value === this.currentValue) {
			return;
		}
		const pair = this.enabledPairs().find((candidate) => candidate.value === value);
		if (!pair) {
			return;
		}

		const detail: TabsChangeDetail = { previousValue: this.currentValue, reason, value };
		const beforeChange = new CustomEvent<TabsChangeDetail>("tabs:beforechange", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		if (!this.element.dispatchEvent(beforeChange)) {
			return;
		}

		this.commit(value);
		this.element.dispatchEvent(
			new CustomEvent<TabsChangeDetail>("tabs:change", { bubbles: true, detail }),
		);
	};

	private eventTab = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLButtonElement =>
					candidate instanceof HTMLButtonElement && this.tabTargets.includes(candidate),
			);

	private handleClick = (event: MouseEvent) => {
		if (!event.isTrusted) {
			return;
		}
		const tab = this.eventTab(event);
		if (!tab || tab.disabled) {
			return;
		}
		this.requestSelection(tab.dataset.tabsValue ?? "", "pointer");
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (!event.isTrusted) {
			return;
		}
		if (!this.enhanced) {
			return;
		}
		const tab = this.eventTab(event);
		if (!tab || tab.disabled) {
			return;
		}

		if (this.activationValue === "manual" && (event.key === "Enter" || event.key === " ")) {
			event.preventDefault();
			this.requestSelection(tab.dataset.tabsValue ?? "", "keyboard");
			return;
		}

		const pairs = this.enabledPairs();
		const index = pairs.findIndex((pair) => pair.tab === tab);
		if (index < 0) {
			return;
		}

		let nextIndex: number | undefined;
		if (event.key === "Home") {
			nextIndex = 0;
		}
		if (event.key === "End") {
			nextIndex = pairs.length - 1;
		}

		const direction = getComputedStyle(this.tablistTargets[0] ?? this.element).direction;
		let delta: -1 | 1 | undefined;
		if (this.orientationValue === "vertical") {
			if (event.key === "ArrowUp") {
				delta = -1;
			} else if (event.key === "ArrowDown") {
				delta = 1;
			}
		} else {
			delta = horizontalArrowDelta(event.key, direction);
		}
		if (delta !== undefined) {
			nextIndex = wrapNavigationIndex(index + delta, pairs.length);
		}
		if (nextIndex === undefined) {
			return;
		}

		event.preventDefault();
		const next = pairs[nextIndex];
		next.tab.focus();
		if (this.activationValue !== "manual") {
			this.requestSelection(next.value, "keyboard");
		}
	};
}

export { TabsController };
