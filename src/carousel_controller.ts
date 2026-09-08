import { Controller } from "@hotwired/stimulus";

type ChangeReason = "keyboard" | "pointer" | "timer";

export type CarouselChangeDetail = {
	index: number;
	previousIndex: number;
	reason: ChangeReason;
};

/**
 * Navigates authored slides and controls timed rotation with APG carousel semantics.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/carousel.contract.json
 */
export default class CarouselController extends Controller<HTMLElement> {
	static targets = ["slide", "previous", "next", "play"];
	static values = {
		index: { default: 0, type: Number },
		interval: { default: 0, type: Number },
	};

	declare readonly slideTargets: HTMLElement[];
	declare readonly previousTargets: HTMLElement[];
	declare readonly nextTargets: HTMLElement[];
	declare readonly playTargets: HTMLElement[];
	declare indexValue: number;
	declare readonly intervalValue: number;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private initialized = false;
	private reconcileQueued = false;
	private interactionBound = false;
	private currentIndex = 0;
	private playingState = false;
	private timerId: ReturnType<typeof setTimeout> | undefined;
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
		this.stopTimer();
		this.playingState = false;
		this.keyboardActivationTarget = null;
		this.enhanced = false;
	};

	slideTargetConnected = () => this.scheduleReconcile();
	slideTargetDisconnected = () => this.scheduleReconcile();
	previousTargetConnected = () => this.scheduleReconcile();
	previousTargetDisconnected = () => this.scheduleReconcile();
	nextTargetConnected = () => this.scheduleReconcile();
	nextTargetDisconnected = () => this.scheduleReconcile();
	playTargetConnected = () => this.scheduleReconcile();
	playTargetDisconnected = () => this.scheduleReconcile();
	indexValueChanged = () => this.scheduleReconcile();
	intervalValueChanged = () => this.scheduleReconcile();

	/**
	 * Zero-based index of the visible slide. Assignment synchronizes visibility and state without
	 * custom events.
	 */
	get index() {
		return this.currentIndex;
	}

	/**
	 * Zero-based index of the visible slide. Assignment synchronizes visibility and state without
	 * custom events.
	 */
	set index(value: number) {
		if (!this.ensureEnhanced()) {
			return;
		}
		const index = this.normalizeRequestedIndex(value);
		this.commitIndex(index);
	}

	/**
	 * Whether automatic slide rotation is running.
	 */
	get playing() {
		return this.playingState;
	}

	/**
	 * Shows the next slide, wrapping from the last slide to the first. Does not emit custom events.
	 *
	 * @returns No return value.
	 */
	next = () => {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitIndex((this.currentIndex + 1) % this.slideTargets.length);
	};

	/**
	 * Shows the previous slide, wrapping from the first slide to the last. Does not emit custom
	 * events.
	 *
	 * @returns No return value.
	 */
	previous = () => {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.commitIndex((this.currentIndex - 1 + this.slideTargets.length) % this.slideTargets.length);
	};

	/**
	 * Starts automatic slide rotation without emitting a custom event for this call.
	 *
	 * @returns No return value.
	 */
	play = () => {
		if (!this.ensureEnhanced() || this.intervalValue <= 0) {
			return;
		}
		if (!this.playingState) {
			this.playingState = true;
		}
		this.startTimer();
		this.syncState();
	};

	/**
	 * Stops automatic slide rotation without custom events.
	 *
	 * @returns No return value.
	 */
	pause = () => {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.playingState = false;
		this.stopTimer();
		this.syncState();
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
		const violations = this.markupViolations();
		if (violations.length > 0) {
			this.enhanced = false;
			this.unbindInteraction();
			this.playingState = false;
			this.stopTimer();
			this.warnInvalidMarkup(violations);
			return;
		}

		this.enhanced = true;
		this.bindInteraction();
		const completionAttributes = this.applyStructure();

		const count = this.slideTargets.length;
		if (!this.initialized) {
			this.currentIndex = this.normalizeRequestedIndex(this.indexValue);
			this.initialized = true;
		} else if (this.currentIndex < 0 || this.currentIndex >= count) {
			this.currentIndex = Math.min(Math.max(this.currentIndex, 0), count - 1);
		} else if (this.indexValue !== this.currentIndex) {
			this.currentIndex = this.normalizeRequestedIndex(this.indexValue);
		}
		if (this.indexValue !== this.currentIndex) {
			this.indexValue = this.currentIndex;
		}

		if (this.intervalValue <= 0) {
			this.playingState = false;
			this.stopTimer();
		} else if (this.playingState) {
			this.stopTimer();
			this.startTimer();
		}
		this.syncState();
		this.warnCompletion(completionAttributes);
	};

	private markupViolations = () => {
		const violations: string[] = [];
		if (this.slideTargets.length < 2) {
			violations.push("fewer than two slide targets");
		}
		if (this.previousTargets.length > 1) {
			violations.push("more than one previous target");
		}
		if (this.nextTargets.length > 1) {
			violations.push("more than one next target");
		}
		if (this.playTargets.length > 1) {
			violations.push("more than one play target");
		}
		if (!this.hasAccessibleName(this.element)) {
			violations.push("the root has no accessible name");
		}
		if (!this.slideTargets.every((slide) => this.hasAccessibleName(slide))) {
			violations.push("a slide has no accessible name");
		}
		if (!this.buttonTargetsValid(this.previousTargets)) {
			violations.push('the previous target is not a native <button type="button">');
		}
		if (!this.buttonTargetsValid(this.nextTargets)) {
			violations.push('the next target is not a native <button type="button">');
		}
		if (!this.buttonTargetsValid(this.playTargets)) {
			violations.push('the play target is not a native <button type="button">');
		}
		if (!Number.isFinite(this.intervalValue) || this.intervalValue < 0) {
			violations.push("interval is not a finite nonnegative number");
		}
		if (this.intervalValue > 0 && this.playTargets.length !== 1) {
			violations.push("a positive interval requires exactly one play target");
		}
		return violations;
	};

	private hasAccessibleName = (element: HTMLElement) =>
		["aria-label", "aria-labelledby"].some((attribute) => {
			const value = element.getAttribute(attribute);
			return value !== null && value.trim() !== "";
		});

	private buttonTargetsValid = (targets: HTMLElement[]) =>
		targets.every((target) => target instanceof HTMLButtonElement && target.type === "button");

	private warnInvalidMarkup = (violations: string[]) => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(`carousel controller: ${violations.join("; ")}. Enhancement has been disabled.`);
	};

	private applyStructure = () => {
		const completionAttributes: string[] = [];
		const rootRoleMissing = !this.element.hasAttribute("role");
		if (!this.element.hasAttribute("role")) {
			this.element.setAttribute("role", "group");
		}
		if (rootRoleMissing) {
			completionAttributes.push('role="group"');
		}
		if (!this.element.hasAttribute("aria-roledescription")) {
			this.element.setAttribute("aria-roledescription", "carousel");
			completionAttributes.push('aria-roledescription="carousel"');
		}
		for (const slide of this.slideTargets) {
			if (!slide.hasAttribute("role")) {
				slide.setAttribute("role", "group");
				completionAttributes.push('role="group"');
			}
			if (!slide.hasAttribute("aria-roledescription")) {
				slide.setAttribute("aria-roledescription", "slide");
				completionAttributes.push('aria-roledescription="slide"');
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
			`carousel controller: Added ${attributes.join(", ")}. Include them in your markup.`,
		);
	};

	private syncState = () => {
		this.element.dataset.state = this.playingState ? "playing" : "paused";
		for (let index = 0; index < this.slideTargets.length; index += 1) {
			const slide = this.slideTargets[index];
			const active = index === this.currentIndex;
			slide.hidden = !active;
			slide.dataset.state = active ? "active" : "inactive";
		}
		const play = this.playTargets[0];
		if (play !== undefined) {
			play.dataset.state = this.playingState ? "playing" : "paused";
		}
	};

	private normalizeRequestedIndex = (value: number) =>
		Number.isFinite(value) &&
		Number.isInteger(value) &&
		value >= 0 &&
		value < this.slideTargets.length
			? value
			: 0;

	private commitIndex = (index: number) => {
		if (index === this.currentIndex) {
			if (this.indexValue !== index) {
				this.indexValue = index;
			}
			this.syncState();
			return;
		}
		this.currentIndex = index;
		this.indexValue = index;
		this.syncState();
	};

	private requestChange = (index: number, reason: ChangeReason, trusted: boolean) => {
		if (index === this.currentIndex) {
			return;
		}
		if (!trusted) {
			this.commitIndex(index);
			return;
		}

		const detail: CarouselChangeDetail = {
			index,
			previousIndex: this.currentIndex,
			reason,
		};
		const beforeChange = new CustomEvent<CarouselChangeDetail>("carousel:beforechange", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		if (!this.element.dispatchEvent(beforeChange)) {
			return;
		}
		this.commitIndex(index);
		this.element.dispatchEvent(
			new CustomEvent<CarouselChangeDetail>("carousel:change", { bubbles: true, detail }),
		);
	};

	private bindInteraction = () => {
		if (this.interactionBound) {
			return;
		}
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.element.addEventListener("focusin", this.handleFocusIn);
		this.interactionBound = true;
	};

	private unbindInteraction = () => {
		if (!this.interactionBound) {
			return;
		}
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.element.removeEventListener("focusin", this.handleFocusIn);
		this.interactionBound = false;
	};

	private eventButton = (event: Event, targets: HTMLElement[]) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLButtonElement =>
					candidate instanceof HTMLButtonElement && targets.includes(candidate),
			);

	private handleKeydown = (event: KeyboardEvent) => {
		if (!event.isTrusted || (event.key !== "Enter" && event.key !== " ")) {
			return;
		}
		const button = this.eventButton(event, [
			...this.previousTargets,
			...this.nextTargets,
			...this.playTargets,
		]);
		if (button !== undefined) {
			this.keyboardActivationTarget = button;
		}
	};

	private handleClick = (event: MouseEvent) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const button = this.eventButton(event, [
			...this.previousTargets,
			...this.nextTargets,
			...this.playTargets,
		]);
		if (button === undefined || button.disabled) {
			return;
		}

		const reason: ChangeReason = this.keyboardActivationTarget === button ? "keyboard" : "pointer";
		this.keyboardActivationTarget = null;

		if (this.playTargets.includes(button)) {
			if (this.playingState) {
				this.pause();
			} else {
				this.play();
			}
			return;
		}

		const delta = this.previousTargets.includes(button) ? -1 : 1;
		const index = (this.currentIndex + delta + this.slideTargets.length) % this.slideTargets.length;
		this.requestChange(index, reason, event.isTrusted);
	};

	private handleFocusIn = () => {
		if (this.playingState && this.enhanced) {
			this.pause();
		}
	};

	private startTimer = () => {
		if (!this.playingState || this.timerId !== undefined || this.intervalValue <= 0) {
			return;
		}
		this.timerId = setTimeout(this.handleTimer, this.intervalValue);
	};

	private stopTimer = () => {
		if (this.timerId === undefined) {
			return;
		}
		clearTimeout(this.timerId);
		this.timerId = undefined;
	};

	private handleTimer = () => {
		this.timerId = undefined;
		if (!this.connected || !this.enhanced || !this.playingState) {
			return;
		}
		const index = (this.currentIndex + 1) % this.slideTargets.length;
		this.requestChange(index, "timer", true);
		this.startTimer();
	};
}

export { CarouselController };
