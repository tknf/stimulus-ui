import { Controller } from "@hotwired/stimulus";

type UserReason = "keyboard" | "pointer";

export type DisclosureToggleDetail = {
	open: boolean;
	previousOpen: boolean;
	reason: UserReason;
};

type PendingToggle = DisclosureToggleDetail;

/**
 * Synchronizes native details and summary behavior with state outputs and events.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/disclosure.contract.json
 */
export default class DisclosureController extends Controller<HTMLElement> {
	static targets = ["trigger", "panel"];
	static values = {
		open: { default: false, type: Boolean },
	};

	declare readonly triggerTargets: HTMLElement[];
	declare readonly panelTargets: HTMLElement[];
	declare readonly openValue: boolean;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private reconcileQueued = false;
	private shouldApplyOpenValue = true;
	private boundDetails: HTMLDetailsElement | null = null;
	private keyboardActivationTarget: HTMLElement | null = null;
	private pendingToggle: PendingToggle | null = null;
	private blockedOpen: boolean | null = null;

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.shouldApplyOpenValue = true;
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.unbindDetails();
		this.keyboardActivationTarget = null;
		this.pendingToggle = null;
		this.blockedOpen = null;
		this.enhanced = false;
	};

	triggerTargetConnected = () => this.scheduleReconcile();
	triggerTargetDisconnected = () => this.scheduleReconcile();
	panelTargetConnected = () => this.scheduleReconcile();
	panelTargetDisconnected = () => this.scheduleReconcile();
	openValueChanged = () => {
		this.shouldApplyOpenValue = true;
		this.scheduleReconcile();
	};

	/**
	 * Current native details.open state. Assignment changes it without custom events or focus
	 * movement.
	 */
	get open(): boolean {
		return this.currentDetails()?.open ?? false;
	}

	/**
	 * Current native details.open state. Assignment changes it without custom events or focus
	 * movement.
	 */
	set open(value: boolean) {
		this.commitOpen(Boolean(value));
	}

	/**
	 * Sets native details.open to true without custom events or focus movement.
	 *
	 * @returns No return value.
	 */
	show = () => this.commitOpen(true);

	/**
	 * Sets native details.open to false without custom events or focus movement.
	 *
	 * @returns No return value.
	 */
	hide = () => this.commitOpen(false);

	/**
	 * Toggles native details.open without custom events or focus movement.
	 *
	 * @returns No return value.
	 */
	toggle = () => this.commitOpen(!this.open);

	private commitOpen = (open: boolean) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const details = this.currentDetails();
		if (details === null) {
			return;
		}
		details.open = open;
		this.syncState(details);
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
			this.unbindDetails();
			this.warnInvalidMarkup();
			return;
		}

		const details = this.nativeDetails();
		if (details === null) {
			return;
		}

		this.enhanced = true;
		this.bindDetails(details);
		if (this.shouldApplyOpenValue) {
			this.shouldApplyOpenValue = false;
			if (!details.hasAttribute("open")) {
				details.open = this.openValue;
			}
		}
		this.syncState(details);
	};

	private ensureEnhanced = () => {
		if (!this.enhanced && this.connected) {
			this.reconcile();
		}
		return this.enhanced;
	};

	private currentDetails = () => (this.enhanced ? this.nativeDetails() : null);

	private nativeDetails = () => {
		if (!(this.element instanceof HTMLDetailsElement)) {
			return null;
		}
		return this.element;
	};

	private isValidMarkup = () => {
		const details = this.nativeDetails();
		const trigger = this.triggerTargets.length === 1 ? this.triggerTargets[0] : undefined;
		const panel = this.panelTargets.length === 1 ? this.panelTargets[0] : undefined;
		return (
			details !== null &&
			trigger !== undefined &&
			trigger instanceof HTMLElement &&
			trigger.localName === "summary" &&
			trigger.parentElement === details &&
			panel !== undefined &&
			panel instanceof HTMLElement &&
			panel.localName !== "summary" &&
			panel !== trigger &&
			details.contains(panel)
		);
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			"disclosure controller: Use a native <details> root with exactly one direct native <summary> trigger target and one nonsummary panel target inside the root. Enhancement has been disabled.",
		);
	};

	private bindDetails = (details: HTMLDetailsElement) => {
		if (this.boundDetails === details) {
			return;
		}
		this.unbindDetails();
		details.addEventListener("toggle", this.handleNativeToggle);
		this.boundDetails = details;
	};

	private unbindDetails = () => {
		this.boundDetails?.removeEventListener("toggle", this.handleNativeToggle);
		this.boundDetails = null;
	};

	private triggerFromEvent = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLElement =>
					candidate instanceof HTMLElement && this.triggerTargets.includes(candidate),
			);

	private isDisabled = (trigger: HTMLElement) =>
		trigger.hasAttribute("disabled") || trigger.getAttribute("aria-disabled") === "true";

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
		const details = this.currentDetails();
		if (trigger === undefined || details === null) {
			return;
		}
		if (this.isDisabled(trigger)) {
			this.blockedOpen = details.open;
			event.preventDefault();
			this.keyboardActivationTarget = null;
			queueMicrotask(() => {
				if (this.blockedOpen === null) {
					return;
				}
				details.open = this.blockedOpen;
				this.syncState(details);
				this.blockedOpen = null;
			});
			return;
		}

		if (!event.isTrusted) {
			this.keyboardActivationTarget = null;
			return;
		}

		const previousOpen = details.open;
		const open = !previousOpen;
		if (open === previousOpen) {
			return;
		}
		const reason: UserReason = this.keyboardActivationTarget === trigger ? "keyboard" : "pointer";
		this.keyboardActivationTarget = null;
		const detail: DisclosureToggleDetail = { open, previousOpen, reason };
		const beforeToggle = new CustomEvent<DisclosureToggleDetail>("disclosure:beforetoggle", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		if (!this.element.dispatchEvent(beforeToggle)) {
			event.preventDefault();
			return;
		}
		this.pendingToggle = detail;
	};

	private handleNativeToggle = () => {
		const details = this.boundDetails;
		if (details === null) {
			return;
		}
		if (this.blockedOpen !== null) {
			const blockedOpen = this.blockedOpen;
			this.blockedOpen = null;
			details.open = blockedOpen;
			this.syncState(details);
			return;
		}
		this.syncState(details);
		const pending = this.pendingToggle;
		this.pendingToggle = null;
		if (pending === null || pending.open !== details.open) {
			return;
		}
		this.element.dispatchEvent(
			new CustomEvent<DisclosureToggleDetail>("disclosure:toggle", {
				bubbles: true,
				detail: pending,
			}),
		);
	};

	private syncState = (details: HTMLDetailsElement) => {
		const state = details.open ? "open" : "closed";
		this.element.dataset.state = state;
		const trigger = this.triggerTargets[0];
		const panel = this.panelTargets[0];
		if (trigger !== undefined) {
			trigger.dataset.state = state;
		}
		if (panel !== undefined) {
			panel.dataset.state = state;
		}
	};
}

export { DisclosureController };
