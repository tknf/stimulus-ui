import { Controller } from "@hotwired/stimulus";

import { ensureElementId } from "./internal/ensure_element_id";

type UserReason = "keyboard" | "pointer";

export type AccordionToggleDetail = {
	index: number;
	open: boolean;
	previousOpen: boolean;
	reason: UserReason;
};

/**
 * Opens and closes author-provided panels with APG accordion semantics.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/accordion.contract.json
 */
export default class AccordionController extends Controller<HTMLElement> {
	static targets = ["trigger", "panel"];
	static values = {
		multiple: { default: false, type: Boolean },
		open: { default: [], type: Array },
	};

	declare readonly triggerTargets: HTMLElement[];
	declare readonly panelTargets: HTMLElement[];
	declare readonly multipleValue: boolean;
	declare readonly openValue: number[];

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private initialized = false;
	private reconcileQueued = false;
	private interactionBound = false;
	private keyboardActivationTarget: HTMLButtonElement | null = null;

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.unbindInteraction();
		this.keyboardActivationTarget = null;
		this.enhanced = false;
	};

	triggerTargetConnected = () => this.scheduleReconcile();
	triggerTargetDisconnected = () => this.scheduleReconcile();
	panelTargetConnected = () => this.scheduleReconcile();
	panelTargetDisconnected = () => this.scheduleReconcile();
	multipleValueChanged = () => this.scheduleReconcile();

	/**
	 * Indexes of open panels. Assignment synchronizes panel visibility and state without custom
	 * events.
	 */
	get open(): number[] {
		return this.openIndexes();
	}

	/**
	 * Indexes of open panels. Assignment synchronizes panel visibility and state without custom
	 * events.
	 */
	set open(value: number[]) {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitOpenIndexes(value);
	}

	/**
	 * Opens the panel at the specified zero-based index without custom events.
	 *
	 * @returns No return value.
	 */
	show = (index: number) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitIndex(index, true);
	};

	/**
	 * Closes the panel at the specified zero-based index without custom events.
	 *
	 * @returns No return value.
	 */
	hide = (index: number) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitIndex(index, false);
	};

	/**
	 * Toggles the panel at the specified zero-based index without custom events.
	 *
	 * @returns No return value.
	 */
	toggle = (index: number) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const panel = this.panelTargets[index];
		if (!(panel instanceof HTMLElement)) {
			return;
		}
		this.commitIndex(index, Boolean(panel.hidden));
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
			this.unbindInteraction();
			this.warnInvalidMarkup();
			return;
		}

		this.enhanced = true;
		this.bindInteraction();
		const completionAttributes = this.applyStructure();

		if (!this.initialized) {
			this.initialized = true;
			if (!this.panelTargets.some((panel) => panel.hasAttribute("hidden"))) {
				this.commitOpenIndexes(this.openValue);
			}
		}

		if (!this.multipleValue) {
			this.keepFirstOpen();
		}
		this.syncState();
		this.warnCompletion(completionAttributes);
	};

	private isValidMarkup = () => {
		if (
			this.triggerTargets.length === 0 ||
			this.triggerTargets.length !== this.panelTargets.length
		) {
			return false;
		}

		return (
			this.triggerTargets.every(
				(trigger) =>
					trigger instanceof HTMLButtonElement &&
					trigger.type === "button" &&
					this.element.contains(trigger),
			) &&
			this.panelTargets.every(
				(panel) => panel instanceof HTMLElement && this.element.contains(panel),
			)
		);
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'accordion controller: Provide one or more native <button type="button"> trigger targets inside the root with the same number of panel targets. Enhancement has been disabled.',
		);
	};

	private applyStructure = () => {
		const completionAttributes: string[] = [];
		for (let index = 0; index < this.panelTargets.length; index += 1) {
			const trigger = this.triggerTargets[index];
			const panel = this.panelTargets[index];
			if (!(trigger instanceof HTMLButtonElement) || !(panel instanceof HTMLElement)) {
				continue;
			}

			const panelId = ensureElementId(panel, "accordion-panel");
			if (!trigger.hasAttribute("aria-controls")) {
				trigger.setAttribute("aria-controls", panelId);
				completionAttributes.push("aria-controls");
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
			`accordion controller: Added ${attributes.join(", ")}. Include them in your markup.`,
		);
	};

	private syncState = () => {
		for (let index = 0; index < this.panelTargets.length; index += 1) {
			const trigger = this.triggerTargets[index];
			const panel = this.panelTargets[index];
			if (!(trigger instanceof HTMLButtonElement) || !(panel instanceof HTMLElement)) {
				continue;
			}

			const state = panel.hidden ? "closed" : "open";
			trigger.setAttribute("aria-expanded", String(!panel.hidden));
			trigger.dataset.state = state;
			panel.dataset.state = state;
		}
	};

	private openIndexes = () =>
		this.panelTargets.reduce<number[]>((indexes, panel, index) => {
			if (!panel.hidden) {
				indexes.push(index);
			}
			return indexes;
		}, []);

	private normalizeIndexes = (indexes: number[]) => {
		const normalized = [...new Set(indexes)].filter(
			(index) => Number.isInteger(index) && index >= 0 && index < this.panelTargets.length,
		);
		return this.multipleValue ? normalized : normalized.slice(0, 1);
	};

	private commitOpenIndexes = (indexes: number[]) => {
		const open = new Set(this.normalizeIndexes(indexes));
		for (let index = 0; index < this.panelTargets.length; index += 1) {
			this.panelTargets[index].hidden = !open.has(index);
		}
		this.syncState();
	};

	private commitIndex = (index: number, open: boolean) => {
		const panel = this.panelTargets[index];
		if (!(panel instanceof HTMLElement)) {
			return;
		}
		if (!open && panel.hidden) {
			return;
		}
		if (open && !panel.hidden) {
			return;
		}

		const next = open
			? this.multipleValue
				? [...this.openIndexes(), index]
				: [index]
			: this.openIndexes().filter((candidate) => candidate !== index);
		this.commitOpenIndexes(next);
	};

	private keepFirstOpen = () => {
		const indexes = this.openIndexes();
		if (indexes.length > 1) {
			this.commitOpenIndexes(indexes.slice(0, 1));
		}
	};

	private triggerFromEvent = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLButtonElement =>
					candidate instanceof HTMLButtonElement && this.triggerTargets.includes(candidate),
			);

	private bindInteraction = () => {
		if (this.interactionBound) {
			return;
		}
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.interactionBound = true;
	};

	private unbindInteraction = () => {
		if (!this.interactionBound) {
			return;
		}
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.interactionBound = false;
	};

	// APG recommends aria-disabled when an open panel cannot be collapsed.
	// Native disabled would prevent keyboard users from focusing that panel's trigger.
	private isDisabled = (trigger: HTMLButtonElement) =>
		trigger.disabled || trigger.getAttribute("aria-disabled") === "true";

	private handleKeydown = (event: KeyboardEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}
		const trigger = this.triggerFromEvent(event);
		if (trigger === undefined || this.isDisabled(trigger)) {
			return;
		}
		this.keyboardActivationTarget = trigger;
	};

	private handleClick = (event: MouseEvent) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const trigger = this.triggerFromEvent(event);
		if (trigger === undefined || this.isDisabled(trigger)) {
			return;
		}

		const index = this.triggerTargets.indexOf(trigger);
		if (index < 0) {
			return;
		}

		const previousOpen = !this.panelTargets[index].hidden;
		const open = !previousOpen;
		const reason: UserReason = this.keyboardActivationTarget === trigger ? "keyboard" : "pointer";
		this.keyboardActivationTarget = null;

		if (!event.isTrusted) {
			this.commitIndex(index, open);
			return;
		}

		const detail: AccordionToggleDetail = { index, open, previousOpen, reason };
		const beforeToggle = new CustomEvent<AccordionToggleDetail>("accordion:beforetoggle", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		if (!this.element.dispatchEvent(beforeToggle)) {
			return;
		}

		this.commitIndex(index, open);
		this.element.dispatchEvent(
			new CustomEvent<AccordionToggleDetail>("accordion:toggle", {
				bubbles: true,
				detail,
			}),
		);
	};
}

export { AccordionController };
