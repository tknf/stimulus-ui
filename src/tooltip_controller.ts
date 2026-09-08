import { Controller } from "@hotwired/stimulus";

import { ensureElementId } from "./internal/ensure_element_id";

type ToggleReason = "pointer" | "keyboard";

export type TooltipToggleDetail = {
	open: boolean;
	previousOpen: boolean;
	reason: ToggleReason;
};

/**
 * Shows an authored noninteractive tooltip on hover or focus.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/tooltip.contract.json
 */
export default class TooltipController extends Controller<HTMLElement> {
	static targets = ["trigger", "content"];
	static values = {
		delay: { type: Number, default: 0 },
	};

	declare readonly triggerTargets: HTMLElement[];
	declare readonly contentTargets: HTMLElement[];
	declare readonly delayValue: number;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private currentOpen = false;
	private triggerHovered = false;
	private contentHovered = false;
	private triggerFocused = false;
	private escapeDismissed = false;
	private openTimer?: ReturnType<typeof setTimeout>;
	private reconcileQueued = false;
	private boundTrigger: HTMLElement | null = null;
	private boundContent: HTMLElement | null = null;

	connect = () => {
		this.connected = true;
		this.enhanced = false;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.reconcile();
	};

	disconnect = () => {
		this.clearOpenTimer();
		this.unbind();
		this.connected = false;
		this.enhanced = false;
	};

	triggerTargetConnected = () => this.scheduleReconcile();
	triggerTargetDisconnected = () => this.scheduleReconcile();
	contentTargetConnected = () => this.scheduleReconcile();
	contentTargetDisconnected = () => this.scheduleReconcile();
	delayValueChanged = () => this.scheduleReconcile();

	/**
	 * Whether the tooltip is visible. Assignment changes visibility without custom events.
	 */
	get open() {
		return this.currentOpen;
	}

	/**
	 * Whether the tooltip is visible. Assignment changes visibility without custom events.
	 */
	set open(value: boolean) {
		this.commitOpen(Boolean(value));
	}

	/**
	 * Shows the tooltip without custom events.
	 *
	 * @returns No return value.
	 */
	show = () => {
		this.commitOpen(true);
	};

	/**
	 * Hides the tooltip without custom events.
	 *
	 * @returns No return value.
	 */
	hide = () => {
		this.commitOpen(false);
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
			this.clearOpenTimer();
			this.unbind();
			this.warnInvalidMarkup();
			return;
		}

		this.unbind();
		const completionAttributes = this.applyStructure();
		this.enhanced = true;
		this.currentOpen = this.isPopoverOpen();
		this.bind();
		this.syncState();
		this.warnCompletion(completionAttributes);
	};

	private isValidMarkup = () => {
		const trigger = this.currentTrigger();
		const content = this.currentContent();
		return (
			trigger !== null &&
			content !== null &&
			trigger instanceof HTMLElement &&
			content instanceof HTMLElement &&
			trigger !== content &&
			this.element.contains(trigger) &&
			this.element.contains(content) &&
			trigger.tabIndex >= 0 &&
			!this.hasFocusableContent(content) &&
			typeof content.showPopover === "function" &&
			typeof content.hidePopover === "function" &&
			Number.isFinite(this.delayValue) &&
			this.delayValue >= 0
		);
	};

	private hasFocusableContent = (content: HTMLElement) => {
		if (this.isFocusable(content)) {
			return true;
		}
		const visit = (parent: HTMLElement): boolean => {
			for (const child of Array.from(parent.children)) {
				if (!(child instanceof HTMLElement)) {
					continue;
				}
				if (this.isFocusable(child) || visit(child)) {
					return true;
				}
			}
			return false;
		};
		return visit(content);
	};

	private isFocusable = (element: HTMLElement) => {
		if (element.hasAttribute("disabled") || element.hidden) {
			return false;
		}
		return element.tabIndex >= 0;
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			"tooltip controller: Provide exactly one focusable trigger target inside the root and exactly one content target. Neither content nor its descendants may be focusable. Popover API support is required. Set delay to a finite nonnegative number. Enhancement has been disabled.",
		);
	};

	private currentTrigger = () => (this.triggerTargets.length === 1 ? this.triggerTargets[0] : null);

	private currentContent = () => (this.contentTargets.length === 1 ? this.contentTargets[0] : null);

	private applyStructure = () => {
		const completionAttributes: string[] = [];
		const trigger = this.currentTrigger();
		const content = this.currentContent();
		if (trigger === null || content === null) {
			return completionAttributes;
		}
		const contentId = ensureElementId(content, "tooltip-content");
		const roleMissing = !content.hasAttribute("role");
		if (!content.hasAttribute("role")) {
			content.setAttribute("role", "tooltip");
		}
		if (roleMissing) {
			completionAttributes.push('role="tooltip"');
		}
		const popoverMissing = !content.hasAttribute("popover");
		if (!content.hasAttribute("popover")) {
			content.setAttribute("popover", "manual");
		}
		if (popoverMissing) {
			completionAttributes.push('popover="manual"');
		}
		const describedBy = new Set(
			(trigger.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean),
		);
		describedBy.add(contentId);
		trigger.setAttribute("aria-describedby", [...describedBy].join(" "));
		return completionAttributes;
	};

	private warnCompletion = (attributes: string[]) => {
		if (attributes.length === 0 || this.completionWarningIssued) {
			return;
		}
		this.completionWarningIssued = true;
		console.warn(
			`tooltip controller: Added ${attributes.join(", ")}. Include them in your markup.`,
		);
	};

	private bind = () => {
		const trigger = this.currentTrigger();
		const content = this.currentContent();
		if (trigger === null || content === null) {
			return;
		}
		trigger.addEventListener("pointerenter", this.handleTriggerPointerEnter);
		trigger.addEventListener("pointerleave", this.handleTriggerPointerLeave);
		trigger.addEventListener("focus", this.handleTriggerFocus);
		trigger.addEventListener("blur", this.handleTriggerBlur);
		content.addEventListener("pointerenter", this.handleContentPointerEnter);
		content.addEventListener("pointerleave", this.handleContentPointerLeave);
		content.addEventListener("toggle", this.handlePopoverToggle);
		this.element.ownerDocument.addEventListener("keydown", this.handleDocumentKeydown);
		this.boundTrigger = trigger;
		this.boundContent = content;
	};

	private unbind = () => {
		this.clearOpenTimer();
		this.boundTrigger?.removeEventListener("pointerenter", this.handleTriggerPointerEnter);
		this.boundTrigger?.removeEventListener("pointerleave", this.handleTriggerPointerLeave);
		this.boundTrigger?.removeEventListener("focus", this.handleTriggerFocus);
		this.boundTrigger?.removeEventListener("blur", this.handleTriggerBlur);
		this.boundContent?.removeEventListener("pointerenter", this.handleContentPointerEnter);
		this.boundContent?.removeEventListener("pointerleave", this.handleContentPointerLeave);
		this.boundContent?.removeEventListener("toggle", this.handlePopoverToggle);
		this.element.ownerDocument.removeEventListener("keydown", this.handleDocumentKeydown);
		this.boundTrigger = null;
		this.boundContent = null;
	};

	private syncState = () => {
		this.element.dataset.state = this.currentOpen ? "open" : "closed";
		const content = this.contentTargets[0];
		if (content) {
			content.dataset.state = this.currentOpen ? "open" : "closed";
		}
	};

	private commitOpen = (open: boolean) => {
		if (!this.ensureEnhanced() || open === this.currentOpen) {
			return;
		}
		this.clearOpenTimer();
		const content = this.currentContent();
		if (content === null) {
			return;
		}
		try {
			if (open) {
				content.showPopover();
			} else {
				content.hidePopover();
			}
		} catch {
			return;
		}
		this.currentOpen = open;
		this.syncState();
	};

	private requestToggle = (open: boolean, reason: ToggleReason) => {
		if (!this.ensureEnhanced() || open === this.currentOpen) {
			return;
		}
		const previousOpen = this.currentOpen;
		const detail: TooltipToggleDetail = { open, previousOpen, reason };
		if (
			!this.element.dispatchEvent(
				new CustomEvent<TooltipToggleDetail>("tooltip:beforetoggle", {
					bubbles: true,
					cancelable: true,
					detail,
				}),
			)
		) {
			return;
		}
		this.commitOpen(open);
		if (this.currentOpen !== open) {
			return;
		}
		this.element.dispatchEvent(
			new CustomEvent<TooltipToggleDetail>("tooltip:toggle", { bubbles: true, detail }),
		);
	};

	private scheduleOpen = (reason: ToggleReason) => {
		this.clearOpenTimer();
		if (this.currentOpen) {
			return;
		}
		if (this.delayValue === 0) {
			this.requestToggle(true, reason);
			return;
		}
		this.openTimer = setTimeout(() => {
			this.openTimer = undefined;
			if (this.connected && this.enhanced && !this.escapeDismissed) {
				this.requestToggle(true, reason);
			}
		}, this.delayValue);
	};

	private clearOpenTimer = () => {
		if (this.openTimer === undefined) {
			return;
		}
		clearTimeout(this.openTimer);
		this.openTimer = undefined;
	};

	private movesInto = (target: HTMLElement | null, relatedTarget: EventTarget | null) =>
		target !== null && relatedTarget instanceof Node && target.contains(relatedTarget);

	private closeIfInactive = (reason: ToggleReason) => {
		if (this.triggerHovered || this.contentHovered || this.triggerFocused) {
			return;
		}
		this.clearOpenTimer();
		this.requestToggle(false, reason);
	};

	private handleTriggerPointerEnter = (event: PointerEvent) => {
		if (!event.isTrusted) {
			return;
		}
		this.triggerHovered = true;
		if (!this.escapeDismissed) {
			this.scheduleOpen("pointer");
		}
	};

	private handleTriggerPointerLeave = (event: PointerEvent) => {
		if (!event.isTrusted) {
			return;
		}
		this.triggerHovered = false;
		this.escapeDismissed = false;
		// Browsers fire pointerleave(trigger) before pointerenter(content).
		// Closing immediately would prevent moving into content (WCAG 1.4.13 hoverable).
		if (this.movesInto(this.boundContent, event.relatedTarget)) {
			this.contentHovered = true;
			return;
		}
		this.closeIfInactive("pointer");
	};

	private handleTriggerFocus = (event: FocusEvent) => {
		if (!event.isTrusted) {
			return;
		}
		this.triggerFocused = true;
		if (!this.escapeDismissed) {
			this.scheduleOpen("keyboard");
		}
	};

	private handleTriggerBlur = (event: FocusEvent) => {
		if (!event.isTrusted) {
			return;
		}
		this.triggerFocused = false;
		this.escapeDismissed = false;
		this.closeIfInactive("keyboard");
	};

	private handleContentPointerEnter = (event: PointerEvent) => {
		if (!event.isTrusted) {
			return;
		}
		this.contentHovered = true;
		this.clearOpenTimer();
	};

	private handleContentPointerLeave = (event: PointerEvent) => {
		if (!event.isTrusted) {
			return;
		}
		this.contentHovered = false;
		if (this.movesInto(this.boundTrigger, event.relatedTarget)) {
			this.triggerHovered = true;
			return;
		}
		this.closeIfInactive("pointer");
	};

	private handleDocumentKeydown = (event: KeyboardEvent) => {
		// Hover-opened tooltips have no focus, so current focus alone cannot identify them.
		// WCAG 1.4.13 also requires pointer-hovered content to be dismissible.
		if (event.key !== "Escape" || !event.isTrusted) {
			return;
		}
		if (!this.ensureEnhanced() || !this.currentOpen) {
			return;
		}
		event.preventDefault();
		this.escapeDismissed = true;
		this.requestToggle(false, "keyboard");
	};

	private handlePopoverToggle = (event: Event) => {
		if (!this.enhanced) {
			return;
		}
		const toggleEvent = event as ToggleEvent;
		this.currentOpen = toggleEvent.newState === "open";
		this.syncState();
	};

	private isPopoverOpen = () => {
		try {
			return this.contentTargets[0]?.matches(":popover-open") ?? false;
		} catch {
			return false;
		}
	};
}

export { TooltipController };
