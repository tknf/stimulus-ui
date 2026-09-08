import { Controller } from "@hotwired/stimulus";
import { hasAccessibleTextName } from "./internal/accessible_text_name";
import { ensureElementId } from "./internal/ensure_element_id";

type Reason = "pointer" | "keyboard";
type Point = { x: number; y: number };
type Elements = {
	trigger: HTMLAnchorElement | HTMLButtonElement;
	preview: HTMLButtonElement | null;
	content: HTMLElement;
	close: HTMLButtonElement;
};

export type HoverCardToggleDetail = { open: boolean; previousOpen: boolean; reason: Reason };

/**
 * Opens an interactive authored preview from named native triggers.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/hover-card.contract.json
 */
export default class HoverCardController extends Controller<HTMLElement> {
	static targets = ["trigger", "preview", "content", "close"];
	static values = {
		openDelay: { type: Number, default: 300 },
		closeDelay: { type: Number, default: 150 },
	};
	declare readonly triggerTargets: HTMLElement[];
	declare readonly previewTargets: HTMLElement[];
	declare readonly contentTargets: HTMLElement[];
	declare readonly closeTargets: HTMLElement[];
	declare openDelayValue: number;
	declare closeDelayValue: number;
	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private reconcileQueued = false;
	private currentOpen = false;
	private dismissed = false;
	private pointerActive = false;
	private revision = 0;
	private completedControls = new WeakMap<HTMLElement, string>();
	private elements: Elements | null = null;
	private observer?: MutationObserver;
	private openTimer?: ReturnType<typeof setTimeout>;
	private closeTimer?: ReturnType<typeof setTimeout>;
	private hovered = new Set<HTMLElement>();
	private lastPointer?: Point;
	private corridor?: { origin: Point; destinations: HTMLElement[] };

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.dismissed = false;
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: [
				"id",
				"autofocus",
				"popover",
				"type",
				"href",
				"tabindex",
				"aria-label",
				"aria-labelledby",
				"hidden",
				"inert",
				"aria-hidden",
			],
		});
		this.reconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.enhanced = false;
		this.revision += 1;
		this.observer?.disconnect();
		this.observer = undefined;
		this.unbind();
	};

	triggerTargetConnected = () => this.scheduleReconcile();
	triggerTargetDisconnected = () => this.scheduleReconcile();
	previewTargetConnected = () => this.scheduleReconcile();
	previewTargetDisconnected = () => this.scheduleReconcile();
	contentTargetConnected = () => this.scheduleReconcile();
	contentTargetDisconnected = () => this.scheduleReconcile();
	closeTargetConnected = () => this.scheduleReconcile();
	closeTargetDisconnected = () => this.scheduleReconcile();
	openDelayValueChanged = () => this.scheduleReconcile();
	closeDelayValueChanged = () => this.scheduleReconcile();

	/**
	 * Current native popover state. Assignment clears pending timers and commits state without
	 * custom events.
	 */
	get open() {
		return this.currentOpen;
	}
	/**
	 * Current native popover state. Assignment clears pending timers and commits state without
	 * custom events.
	 */
	set open(value: boolean) {
		this.dismissed = false;
		this.commitOpen(Boolean(value));
	}
	/**
	 * Shows the card without moving focus or emitting custom events.
	 *
	 * @returns No return value.
	 */
	show = () => {
		this.open = true;
	};
	/**
	 * Closes the card without custom events. See the contract for focus restoration when focus is
	 * inside the card.
	 *
	 * @returns No return value.
	 */
	hide = () => {
		this.open = false;
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

	private readElements = (): Elements | null => {
		const trigger = this.triggerTargets[0];
		const content = this.contentTargets[0];
		const close = this.closeTargets[0];
		const preview = this.previewTargets[0] ?? null;
		if (
			this.triggerTargets.length !== 1 ||
			this.contentTargets.length !== 1 ||
			this.closeTargets.length !== 1 ||
			!(trigger instanceof HTMLButtonElement || trigger instanceof HTMLAnchorElement) ||
			!(content instanceof HTMLElement) ||
			!(close instanceof HTMLButtonElement) ||
			(preview !== null && !(preview instanceof HTMLButtonElement))
		) {
			return null;
		}
		return { trigger, content, close, preview };
	};

	private hasAutofocus = (element: Element): boolean =>
		element.hasAttribute("autofocus") || Array.from(element.children).some(this.hasAutofocus);

	private isValidMarkup = (elements: Elements | null): elements is Elements => {
		if (elements === null) {
			return false;
		}
		const { trigger, preview, content, close } = elements;
		const link = trigger instanceof HTMLAnchorElement;
		const buttons = [close, ...(preview ? [preview] : []), ...(!link ? [trigger] : [])];
		return (
			(link
				? trigger.hasAttribute("href") && this.previewTargets.length === 1
				: this.previewTargets.length === 0) &&
			buttons.every((button) => button instanceof HTMLButtonElement && button.type === "button") &&
			[trigger, close, ...(preview ? [preview] : [])].every((control) =>
				hasAccessibleTextName(control, true),
			) &&
			trigger.tabIndex >= 0 &&
			(!preview || preview.tabIndex >= 0) &&
			close.tabIndex >= 0 &&
			trigger.nextElementSibling === (preview ?? content) &&
			(!preview || preview.nextElementSibling === content) &&
			this.element.contains(trigger) &&
			this.element.contains(content) &&
			content.contains(close) &&
			!this.hasAutofocus(content) &&
			!content.hidden &&
			!content.inert &&
			content.getAttribute("aria-hidden") !== "true" &&
			(!content.hasAttribute("popover") || content.getAttribute("popover") === "manual") &&
			!(content instanceof HTMLDialogElement) &&
			typeof content.showPopover === "function" &&
			typeof content.hidePopover === "function" &&
			Number.isFinite(this.openDelayValue) &&
			this.openDelayValue >= 0 &&
			Number.isFinite(this.closeDelayValue) &&
			this.closeDelayValue >= 0
		);
	};

	private reconcile = () => {
		const next = this.readElements();
		const valid = this.isValidMarkup(next);
		const sameTargets =
			this.elements &&
			next &&
			this.elements.trigger === next.trigger &&
			this.elements.preview === next.preview &&
			this.elements.content === next.content &&
			this.elements.close === next.close;
		const previousContent = this.elements?.content;
		if (!valid || !sameTargets) {
			this.unbind();
			this.enhanced = false;
		}
		if (
			previousContent &&
			(!valid || previousContent !== next?.content) &&
			(this.currentOpen || previousContent.matches(":popover-open"))
		) {
			if (previousContent.matches(":popover-open")) {
				previousContent.hidePopover();
			}
			this.currentOpen = previousContent.matches(":popover-open");
			this.syncState();
		}
		this.elements = next;
		if (!valid) {
			if (!this.warningIssued) {
				this.warningIssued = true;
				console.warn(
					"hover-card controller: Provide named native trigger and close controls and manual popover content in the required order. Link triggers require a preview button. Do not use autofocus inside content. Set delay to a finite nonnegative number. Enhancement has been disabled.",
				);
			}
			return;
		}
		const attributes: string[] = [];
		const id = ensureElementId(next.content, "hover-card-content");
		if (!next.content.hasAttribute("popover")) {
			next.content.setAttribute("popover", "manual");
			attributes.push('popover="manual"');
		}
		for (const control of [next.trigger, ...(next.preview ? [next.preview] : [])]) {
			const current = control.getAttribute("aria-controls");
			if (current === null || this.completedControls.get(control) === current) {
				control.setAttribute("aria-controls", id);
				this.completedControls.set(control, id);
				if (current === null) {
					attributes.push("aria-controls");
				}
			}
		}
		if (next.trigger instanceof HTMLAnchorElement && !next.trigger.hasAttribute("tabindex")) {
			next.trigger.tabIndex = 0;
		}
		this.currentOpen = next.content.matches(":popover-open");
		if (!this.enhanced) {
			this.enhanced = true;
			this.bind();
		}
		this.syncState();
		if (attributes.length > 0 && !this.completionWarningIssued) {
			this.completionWarningIssued = true;
			console.warn(
				`hover-card controller: Added ${attributes.join(", ")}. Include them in your markup.`,
			);
		}
	};

	private regions = () =>
		this.elements
			? [
					this.elements.trigger,
					this.elements.content,
					...(this.elements.preview ? [this.elements.preview] : []),
				]
			: [];
	private regionFor = (target: EventTarget | null) =>
		target instanceof Node ? this.regions().find((region) => region.contains(target)) : undefined;
	private hasFocus = () => this.regionFor(this.element.ownerDocument.activeElement) !== undefined;
	private accepts = (event: Event) => event.isTrusted && this.connected && this.enhanced;
	private disabled = (element: EventTarget | null) =>
		element instanceof HTMLButtonElement && element.disabled;

	private bind = () => {
		for (const region of this.regions()) {
			region.addEventListener("pointerenter", this.handlePointerEnter);
			region.addEventListener("pointerleave", this.handlePointerLeave);
			region.addEventListener("focusin", this.handleFocusIn);
			region.addEventListener("focusout", this.handleFocusOut);
		}
		this.elements?.trigger.addEventListener("click", this.handleClick);
		this.elements?.preview?.addEventListener("click", this.handleClick);
		this.elements?.close.addEventListener("click", this.handleClick);
		this.elements?.content.addEventListener("toggle", this.handleToggle);
		this.element.ownerDocument.addEventListener("keydown", this.handleKeydown);
		this.element.ownerDocument.addEventListener("pointermove", this.handlePointerMove);
		this.element.ownerDocument.addEventListener("pointerdown", this.handlePointerActivity, true);
		this.element.ownerDocument.addEventListener("pointerup", this.handlePointerActivity, true);
		this.element.ownerDocument.addEventListener("pointercancel", this.handlePointerActivity, true);
	};

	private unbind = () => {
		this.clearTimers();
		this.corridor = undefined;
		this.hovered.clear();
		this.lastPointer = undefined;
		this.pointerActive = false;
		for (const region of this.regions()) {
			region.removeEventListener("pointerenter", this.handlePointerEnter);
			region.removeEventListener("pointerleave", this.handlePointerLeave);
			region.removeEventListener("focusin", this.handleFocusIn);
			region.removeEventListener("focusout", this.handleFocusOut);
		}
		this.elements?.trigger.removeEventListener("click", this.handleClick);
		this.elements?.preview?.removeEventListener("click", this.handleClick);
		this.elements?.close.removeEventListener("click", this.handleClick);
		this.elements?.content.removeEventListener("toggle", this.handleToggle);
		this.element.ownerDocument.removeEventListener("keydown", this.handleKeydown);
		this.element.ownerDocument.removeEventListener("pointermove", this.handlePointerMove);
		this.element.ownerDocument.removeEventListener("pointerdown", this.handlePointerActivity, true);
		this.element.ownerDocument.removeEventListener("pointerup", this.handlePointerActivity, true);
		this.element.ownerDocument.removeEventListener(
			"pointercancel",
			this.handlePointerActivity,
			true,
		);
	};

	private clearTimers = () => {
		clearTimeout(this.openTimer);
		clearTimeout(this.closeTimer);
		this.openTimer = undefined;
		this.closeTimer = undefined;
	};

	private syncState = () => {
		for (const element of [this.element, ...this.regions()]) {
			element.dataset.state = this.currentOpen ? "open" : "closed";
		}
		for (const control of [this.elements?.trigger, this.elements?.preview]) {
			control?.setAttribute("aria-expanded", String(this.currentOpen));
		}
	};

	private commitOpen = (open: boolean) => {
		this.revision += 1;
		this.clearTimers();
		this.corridor = undefined;
		if (
			!this.connected ||
			!this.enhanced ||
			!this.isValidMarkup(this.readElements()) ||
			!this.elements
		) {
			return false;
		}
		try {
			if (open) {
				this.elements.content.showPopover();
			} else {
				this.elements.content.hidePopover();
			}
		} catch {
			return false;
		}
		this.currentOpen = this.elements.content.matches(":popover-open");
		this.syncState();
		return this.currentOpen === open;
	};

	private requestToggle = (open: boolean, reason: Reason, restoreFocus = false) => {
		if (!this.connected || !this.enhanced || open === this.currentOpen) {
			return;
		}
		const previousOpen = this.currentOpen;
		const revision = this.revision;
		const elements = this.elements;
		const detail: HoverCardToggleDetail = { open, previousOpen, reason };
		if (
			!this.element.dispatchEvent(
				new CustomEvent<HoverCardToggleDetail>("hover-card:beforetoggle", {
					bubbles: true,
					cancelable: true,
					detail,
				}),
			)
		) {
			return;
		}
		const next = this.readElements();
		if (
			revision !== this.revision ||
			!elements ||
			!next ||
			Object.keys(elements).some((key) => Reflect.get(elements, key) !== Reflect.get(next, key))
		) {
			return;
		}
		if (!this.commitOpen(open)) {
			return;
		}
		if (!open) {
			this.dismissed = restoreFocus;
			if (restoreFocus && elements.content.contains(this.element.ownerDocument.activeElement)) {
				elements.trigger.focus();
			}
		}
		this.element.dispatchEvent(
			new CustomEvent<HoverCardToggleDetail>("hover-card:toggle", { bubbles: true, detail }),
		);
	};

	private scheduleClose = () => {
		clearTimeout(this.openTimer);
		this.openTimer = undefined;
		if (
			this.hasFocus() ||
			this.hovered.size > 0 ||
			this.corridor ||
			this.closeTimer !== undefined
		) {
			return;
		}
		this.closeTimer = setTimeout(() => {
			this.closeTimer = undefined;
			if (!this.hasFocus() && this.hovered.size === 0 && !this.corridor) {
				this.requestToggle(false, "pointer");
			}
		}, this.closeDelayValue);
	};

	private handlePointerEnter = (event: PointerEvent) => {
		if (
			!this.accepts(event) ||
			event.pointerType === "touch" ||
			this.disabled(event.currentTarget) ||
			!(event.currentTarget instanceof HTMLElement)
		) {
			return;
		}
		this.hovered.add(event.currentTarget);
		this.lastPointer = { x: event.clientX, y: event.clientY };
		this.corridor = undefined;
		this.clearTimers();
		if (this.currentOpen || this.dismissed || event.currentTarget === this.elements?.content) {
			return;
		}
		this.openTimer = setTimeout(() => {
			this.openTimer = undefined;
			if (
				!this.dismissed &&
				this.hovered.size > 0 &&
				!this.disabled(this.elements?.trigger ?? null)
			) {
				this.requestToggle(true, "pointer");
			}
		}, this.openDelayValue);
	};

	private handlePointerLeave = (event: PointerEvent) => {
		if (
			!this.accepts(event) ||
			event.pointerType === "touch" ||
			!(event.currentTarget instanceof HTMLElement)
		) {
			return;
		}
		this.hovered.delete(event.currentTarget);
		this.dismissed = false;
		const destination = this.regionFor(event.relatedTarget);
		if (destination) {
			this.hovered.add(destination);
			return;
		}
		if (this.currentOpen && this.elements) {
			this.corridor = {
				origin: this.lastPointer ?? { x: event.clientX, y: event.clientY },
				destinations:
					event.currentTarget === this.elements.content
						? [this.elements.trigger, ...(this.elements.preview ? [this.elements.preview] : [])]
						: [this.elements.content],
			};
			if (!this.insideCorridor({ x: event.clientX, y: event.clientY })) {
				this.corridor = undefined;
			}
		}
		this.scheduleClose();
	};

	private insideTriangle = (point: Point, a: Point, b: Point, c: Point) => {
		const cross = (p: Point, q: Point, r: Point) =>
			(q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
		if (Math.abs(cross(a, b, c)) < 0.001) {
			return false;
		}
		const values = [cross(a, b, point), cross(b, c, point), cross(c, a, point)];
		return values.every((value) => value >= -0.01) || values.every((value) => value <= 0.01);
	};

	private insideCorridor = (point: Point) => {
		const corridor = this.corridor;
		if (!corridor) {
			return false;
		}
		return corridor.destinations.some((destination) => {
			const { left, right, top, bottom } = destination.getBoundingClientRect();
			if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
				return true;
			}
			const corners = [
				{ x: left, y: top },
				{ x: right, y: top },
				{ x: right, y: bottom },
				{ x: left, y: bottom },
			];
			return corners.some((corner, index) =>
				this.insideTriangle(
					point,
					corridor.origin,
					corner,
					corners[(index + 1) % corners.length] ?? corner,
				),
			);
		});
	};

	private handlePointerMove = (event: PointerEvent) => {
		if (!this.accepts(event) || event.pointerType === "touch") {
			return;
		}
		this.lastPointer = { x: event.clientX, y: event.clientY };
		if (!this.corridor) {
			return;
		}
		if (!this.insideCorridor({ x: event.clientX, y: event.clientY })) {
			this.corridor = undefined;
			this.scheduleClose();
		}
	};

	private handleFocusIn = (event: FocusEvent) => {
		if (!this.accepts(event) || this.disabled(event.currentTarget)) {
			return;
		}
		this.clearTimers();
		this.corridor = undefined;
		if (!this.dismissed) {
			this.requestToggle(true, this.pointerActive ? "pointer" : "keyboard");
		}
	};

	private handleFocusOut = (event: FocusEvent) => {
		if (!this.accepts(event) || this.regionFor(event.relatedTarget)) {
			return;
		}
		this.dismissed = false;
		this.clearTimers();
		if (this.hovered.size === 0 && !this.corridor) {
			this.requestToggle(false, this.pointerActive ? "pointer" : "keyboard");
		}
	};

	private handlePointerActivity = (event: PointerEvent) => {
		if (this.accepts(event)) {
			this.pointerActive = event.type === "pointerdown";
		}
	};

	private handleClick = (event: Event) => {
		if (
			!(event instanceof MouseEvent) ||
			!this.accepts(event) ||
			!(event.currentTarget instanceof HTMLButtonElement) ||
			event.currentTarget.disabled
		) {
			return;
		}
		if (event.currentTarget === this.elements?.close) {
			this.requestToggle(false, event.detail === 0 ? "keyboard" : "pointer", true);
		} else {
			this.dismissed = false;
			this.requestToggle(true, event.detail === 0 ? "keyboard" : "pointer");
		}
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (this.accepts(event)) {
			this.pointerActive = false;
		}
		if (
			!this.accepts(event) ||
			event.defaultPrevented ||
			event.key !== "Escape" ||
			!this.currentOpen
		) {
			return;
		}
		if (
			event.target instanceof Element &&
			this.element.contains(event.target) &&
			event.target.closest('[data-controller~="hover-card"]') !== this.element
		) {
			return;
		}
		event.preventDefault();
		this.requestToggle(false, "keyboard", true);
	};

	private handleToggle = (event: Event) => {
		if (!this.accepts(event) || event.target !== this.elements?.content) {
			return;
		}
		this.currentOpen = this.elements.content.matches(":popover-open");
		if (!this.currentOpen) {
			this.clearTimers();
			this.corridor = undefined;
		}
		this.syncState();
	};
}

export { HoverCardController };
