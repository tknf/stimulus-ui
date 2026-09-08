import { Controller } from "@hotwired/stimulus";

type UserReason = "pointer" | "keyboard";

export type ToastDetail = {
	reason: UserReason;
};

/**
 * Controls the visibility and duration of an authored toast and live region.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/toast.contract.json
 */
export default class ToastController extends Controller<HTMLElement> {
	static targets = ["dismiss"];
	static values = {
		duration: { type: Number, default: 0 },
		live: { type: String, default: "polite" },
	};

	declare readonly dismissTargets: HTMLButtonElement[];
	declare readonly durationValue: number;
	declare readonly liveValue: string;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private currentVisible = false;
	private popoverMode = false;
	private timer?: ReturnType<typeof setTimeout>;
	private reconcileQueued = false;

	connect = () => {
		this.connected = true;
		this.enhanced = false;
		this.warningIssued = false;
		this.reconcile();
	};

	disconnect = () => {
		this.clearTimer();
		this.unbind();
		this.connected = false;
		this.enhanced = false;
	};

	dismissTargetConnected = () => this.scheduleReconcile();
	dismissTargetDisconnected = () => this.scheduleReconcile();
	durationValueChanged = () => this.scheduleReconcile();
	liveValueChanged = () => this.scheduleReconcile();

	/**
	 * Whether the toast is visible. Assignment synchronizes visibility and data-state without custom
	 * events.
	 */
	get visible() {
		return this.currentVisible;
	}

	/**
	 * Whether the toast is visible. Assignment synchronizes visibility and data-state without custom
	 * events.
	 */
	set visible(value: boolean) {
		this.commitVisibility(Boolean(value));
	}

	/**
	 * Shows the toast without moving focus. A programmatic call emits no custom events; a trusted
	 * event supplied by a Stimulus action uses the user-interaction event path.
	 *
	 * @returns No return value.
	 */
	show = (event?: Event) => {
		if (!this.ensureEnhanced() || this.currentVisible) {
			return;
		}
		const reason = this.userReason(event);
		if (reason && !this.dispatchBefore("show", reason)) {
			return;
		}
		this.commitVisibility(true);
		if (reason) {
			this.dispatchAfter("show", reason);
		}
	};

	/**
	 * Hides the toast without moving focus. A programmatic call emits no custom events; a trusted
	 * dismiss-button or Stimulus-action event uses the user-interaction event path.
	 *
	 * @returns No return value.
	 */
	hide = (event?: Event) => {
		if (!this.ensureEnhanced() || !this.currentVisible) {
			return;
		}
		const reason = this.userReason(event);
		if (reason && !this.dispatchBefore("hide", reason)) {
			return;
		}
		this.commitVisibility(false);
		if (reason) {
			this.dispatchAfter("hide", reason);
		}
	};

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
			this.enhanced = false;
			this.clearTimer();
			this.unbind();
			this.warnInvalidMarkup();
			return;
		}

		this.unbind();
		this.enhanced = true;
		this.applyStructure();
		this.popoverMode = this.element.hasAttribute("popover");
		this.currentVisible = this.popoverMode ? this.isPopoverOpen() : !this.element.hidden;
		this.bind();
		this.syncState();
	};

	private isValidMarkup = () => {
		const dismissIsValid = this.dismissTargets.every(
			(button) =>
				button instanceof HTMLButtonElement &&
				button.type === "button" &&
				this.element.contains(button),
		);
		const durationIsValid = Number.isFinite(this.durationValue) && this.durationValue >= 0;
		const liveIsValid = this.liveValue === "polite" || this.liveValue === "assertive";
		const popoverIsValid =
			!this.element.hasAttribute("popover") || typeof this.element.showPopover === "function";
		return (
			this.element instanceof HTMLElement &&
			this.dismissTargets.length <= 1 &&
			dismissIsValid &&
			durationIsValid &&
			liveIsValid &&
			popoverIsValid
		);
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'toast controller: Use an HTML root and, if present, exactly one <button type="button"> dismiss target inside it. Set duration to a finite nonnegative number and live to polite or assertive. Using popover requires Popover API support. Enhancement has been disabled.',
		);
	};

	private applyStructure = () => {
		if (!this.element.hasAttribute("role")) {
			this.element.setAttribute("role", this.liveValue === "assertive" ? "alert" : "status");
		}
		if (!this.element.hasAttribute("aria-live")) {
			this.element.setAttribute("aria-live", this.liveValue);
		}
	};

	private bind = () => {
		this.element.addEventListener("click", this.handleClick);
		if (this.popoverMode) {
			this.element.addEventListener("toggle", this.handleToggle);
		}
		this.element.addEventListener("focusin", this.handleFocusIn);
		this.element.addEventListener("focusout", this.handleFocusOut);
	};

	private unbind = () => {
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("toggle", this.handleToggle);
		this.element.removeEventListener("focusin", this.handleFocusIn);
		this.element.removeEventListener("focusout", this.handleFocusOut);
	};

	private syncState = () => {
		this.element.dataset.state = this.currentVisible ? "visible" : "hidden";
		if (this.currentVisible && this.durationValue > 0) {
			this.scheduleTimer();
		} else {
			this.clearTimer();
		}
	};

	private commitVisibility = (visible: boolean) => {
		if (!this.enhanced || visible === this.currentVisible) {
			return;
		}
		if (this.popoverMode) {
			try {
				if (visible) {
					this.element.showPopover();
				} else {
					this.element.hidePopover();
				}
			} catch {
				return;
			}
		} else {
			this.element.hidden = !visible;
		}
		this.currentVisible = visible;
		this.syncState();
	};

	private handleClick = (event: MouseEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		const dismiss = event
			.composedPath()
			.find(
				(candidate): candidate is HTMLButtonElement =>
					candidate instanceof HTMLButtonElement && this.dismissTargets.includes(candidate),
			);
		if (!dismiss || dismiss.disabled) {
			return;
		}
		this.hide(event);
	};

	private handleToggle = (event: Event) => {
		if (!this.enhanced) {
			return;
		}
		const toggleEvent = event as ToggleEvent;
		this.currentVisible = toggleEvent.newState === "open";
		this.syncState();
	};

	private handleFocusIn = () => {
		this.clearTimer();
	};

	private handleFocusOut = (event: FocusEvent) => {
		if (event.relatedTarget instanceof Node && this.element.contains(event.relatedTarget)) {
			return;
		}
		if (this.currentVisible && this.durationValue > 0) {
			this.scheduleTimer();
		}
	};

	private userReason = (event?: Event): UserReason | undefined => {
		if (!event?.isTrusted) {
			return undefined;
		}
		if (event instanceof KeyboardEvent) {
			return "keyboard";
		}
		if (event instanceof MouseEvent) {
			return event.detail === 0 ? "keyboard" : "pointer";
		}
		return undefined;
	};

	private dispatchBefore = (action: "show" | "hide", reason: UserReason) =>
		this.element.dispatchEvent(
			new CustomEvent<ToastDetail>(`toast:before${action}`, {
				bubbles: true,
				cancelable: true,
				detail: { reason },
			}),
		);

	private dispatchAfter = (action: "show" | "hide", reason: UserReason) => {
		this.element.dispatchEvent(
			new CustomEvent<ToastDetail>(`toast:${action}`, {
				bubbles: true,
				detail: { reason },
			}),
		);
	};

	private scheduleTimer = () => {
		this.clearTimer();
		if (this.element.contains(this.element.ownerDocument.activeElement)) {
			return;
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			if (this.connected && this.enhanced && this.currentVisible) {
				this.commitVisibility(false);
			}
		}, this.durationValue);
	};

	private clearTimer = () => {
		if (this.timer === undefined) {
			return;
		}
		clearTimeout(this.timer);
		this.timer = undefined;
	};

	private isPopoverOpen = () => {
		try {
			return this.element.matches(":popover-open");
		} catch {
			return false;
		}
	};
}

export { ToastController };
