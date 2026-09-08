import { Controller } from "@hotwired/stimulus";

/**
 * Moves focus between authored semantic landmarks with F6 and Shift+F6.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/landmark-navigation.contract.json
 */
export default class LandmarkNavigationController extends Controller<HTMLElement> {
	static targets = ["landmark"];

	declare readonly landmarkTargets: Element[];

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private reconcileQueued = false;
	private boundWindow: Window | null = null;
	private lastFocused = new Map<HTMLElement, HTMLElement>();
	private temporaryTabindex = new Set<HTMLElement>();

	connect = () => {
		this.connected = true;
		this.enhanced = false;
		this.warningIssued = false;
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.reconcileQueued = false;
		this.disableEnhancement();
	};

	landmarkTargetConnected = () => this.scheduleReconcile();
	landmarkTargetDisconnected = (target: Element) => {
		this.cleanupTarget(target);
		this.scheduleReconcile();
	};

	/**
	 * Moves focus to the next available landmark from the active element, or to the first when
	 * outside the landmarks. Does nothing without a destination and emits no custom events.
	 *
	 * @returns No return value.
	 */
	focusNext = () => {
		this.focusInDirection(1);
	};

	/**
	 * Moves focus to the previous available landmark from the active element, or to the last when
	 * outside the landmarks. Does nothing without a destination and emits no custom events.
	 *
	 * @returns No return value.
	 */
	focusPrevious = () => {
		this.focusInDirection(-1);
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
					"landmark-navigation controller: Use the owner document body as the single root and provide at least two semantic landmark HTMLElement targets. Enhancement has been disabled.",
				);
			}
			return;
		}

		this.enableEnhancement();
	};

	private isValidMarkup = () =>
		this.element instanceof HTMLBodyElement &&
		this.element.ownerDocument.body === this.element &&
		this.landmarkTargets.length >= 2 &&
		this.landmarkTargets.every(
			(target) =>
				target instanceof HTMLElement && target !== this.element && this.element.contains(target),
		);

	private enableEnhancement = () => {
		if (this.enhanced) {
			return;
		}

		const view = this.element.ownerDocument.defaultView;
		if (view === null) {
			return;
		}

		this.enhanced = true;
		this.boundWindow = view;
		view.addEventListener("keydown", this.handleKeydown, true);
		this.element.addEventListener("focusin", this.handleFocusin);
		this.element.addEventListener("focusout", this.handleFocusout);
	};

	private disableEnhancement = () => {
		if (this.boundWindow !== null) {
			this.boundWindow.removeEventListener("keydown", this.handleKeydown, true);
			this.boundWindow = null;
		}
		this.element.removeEventListener("focusin", this.handleFocusin);
		this.element.removeEventListener("focusout", this.handleFocusout);
		this.enhanced = false;
		this.cleanupAllTemporaryTabindex();
		this.lastFocused.clear();
	};

	private cleanupTarget = (target: Element) => {
		if (target instanceof HTMLElement) {
			this.cleanupTemporaryTabindexForTarget(target);
			this.lastFocused.delete(target);
		}
	};

	private cleanupTemporaryTabindexForTarget = (target: HTMLElement) => {
		if (!this.temporaryTabindex.has(target)) {
			return;
		}
		if (target.getAttribute("tabindex") === "-1") {
			target.removeAttribute("tabindex");
		}
		this.temporaryTabindex.delete(target);
	};

	private cleanupAllTemporaryTabindex = () => {
		for (const target of this.temporaryTabindex) {
			this.cleanupTemporaryTabindexForTarget(target);
		}
	};

	private handleFocusin = (event: FocusEvent) => {
		if (!(event.target instanceof HTMLElement)) {
			return;
		}
		const target = this.innermostTargetContaining(event.target, this.orderedTargets());
		if (target === undefined || target === event.target) {
			return;
		}
		this.lastFocused.set(target, event.target);
	};

	private handleFocusout = (event: FocusEvent) => {
		const relatedTarget = event.relatedTarget;
		for (const target of this.temporaryTabindex) {
			if (!(relatedTarget instanceof Node) || !target.contains(relatedTarget)) {
				this.cleanupTemporaryTabindexForTarget(target);
			}
		}
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (!this.enhanced || event.defaultPrevented || event.key !== "F6") {
			return;
		}
		if (event.ctrlKey || event.altKey || event.metaKey) {
			return;
		}

		const moved = this.focusInDirection(event.shiftKey ? -1 : 1);
		if (moved && event.cancelable) {
			event.preventDefault();
		}
	};

	private focusInDirection = (direction: 1 | -1) => {
		if (!this.enhanced) {
			return false;
		}

		const targets = this.orderedTargets();
		const activeElement = this.element.ownerDocument.activeElement;
		const current =
			activeElement === null ? undefined : this.innermostTargetContaining(activeElement, targets);
		const currentIndex = current === undefined ? -1 : targets.indexOf(current);
		const startIndex = currentIndex < 0 ? (direction === 1 ? -1 : targets.length) : currentIndex;

		for (let offset = 1; offset <= targets.length; offset += 1) {
			const index = (startIndex + direction * offset + targets.length) % targets.length;
			const target = targets[index];
			if (target === undefined || target === current || !this.isAvailable(target)) {
				continue;
			}
			if (this.focusTarget(target)) {
				return true;
			}
		}

		return false;
	};

	private orderedTargets = () => {
		const targets = this.landmarkTargets.filter(
			(target): target is HTMLElement => target instanceof HTMLElement,
		);
		return targets.sort((left, right) => {
			const position = left.compareDocumentPosition(right);
			if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
				return -1;
			}
			if (position & Node.DOCUMENT_POSITION_PRECEDING) {
				return 1;
			}
			return 0;
		});
	};

	private innermostTargetContaining = (activeElement: Element, targets: readonly HTMLElement[]) => {
		const containing = targets.filter((target) => target.contains(activeElement));
		return containing.find(
			(target) =>
				!containing.some((candidate) => candidate !== target && target.contains(candidate)),
		);
	};

	private isAvailable = (target: HTMLElement) =>
		target.isConnected && this.element.contains(target) && !this.hasUnavailableAncestor(target);

	private hasUnavailableAncestor = (element: HTMLElement) => {
		let current: HTMLElement | null = element;
		while (current !== null) {
			if (
				current.hidden ||
				current.hasAttribute("inert") ||
				current.getAttribute("aria-hidden")?.toLowerCase() === "true"
			) {
				return true;
			}
			current = current.parentElement;
		}
		return false;
	};

	private focusTarget = (target: HTMLElement) => {
		const descendant = this.lastFocused.get(target);
		if (
			descendant !== undefined &&
			descendant !== target &&
			target.contains(descendant) &&
			descendant.isConnected &&
			!this.hasUnavailableAncestor(descendant) &&
			this.focusElement(descendant)
		) {
			return true;
		}

		if (target.hasAttribute("tabindex")) {
			return this.focusElement(target);
		}

		target.setAttribute("tabindex", "-1");
		this.temporaryTabindex.add(target);
		if (this.focusElement(target)) {
			return true;
		}

		this.cleanupTemporaryTabindexForTarget(target);
		return false;
	};

	private focusElement = (element: HTMLElement) => {
		element.focus();
		return this.element.ownerDocument.activeElement === element;
	};
}

export { LandmarkNavigationController };
