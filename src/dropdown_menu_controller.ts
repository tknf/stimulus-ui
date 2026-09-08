import { Controller } from "@hotwired/stimulus";

import { ensureElementId } from "./internal/ensure_element_id";
import { hasAccessibleTextName } from "./internal/accessible_text_name";
import { isImeKeydown } from "./internal/ime";

type UserReason = "pointer" | "keyboard";

export type DropdownMenuOpenDetail = {
	reason: UserReason;
	context?: HTMLElement;
};

export type DropdownMenuCloseDetail = {
	reason: UserReason;
	value: string;
	context?: HTMLElement;
};

export type DropdownMenuSelectDetail = {
	reason: UserReason;
	value: string;
	context?: HTMLElement;
};

type ContextRequest = {
	target: HTMLElement;
	region: HTMLElement;
	x: number;
	y: number;
};

type ContextPress = ContextRequest & {
	pointerId: number;
	time: number;
	trigger: HTMLButtonElement;
	menu: HTMLElement;
};

/**
 * Provides APG menu-button interaction and optional contextual opening for an authored action menu.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/dropdown-menu.contract.json
 */
export default class DropdownMenuController extends Controller<HTMLElement> {
	static targets = ["trigger", "menu", "item", "context"];
	static values = {
		open: { default: false, type: Boolean },
	};

	declare readonly triggerTargets: HTMLButtonElement[];
	declare readonly menuTargets: HTMLElement[];
	declare readonly itemTargets: HTMLButtonElement[];
	declare readonly contextTargets: HTMLElement[];
	declare readonly openValue: boolean;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private reconcileQueued = false;
	private shouldApplyOpenValue = true;
	private currentOpen = false;
	private activeItem: HTMLButtonElement | null = null;
	private boundDocument: Document | null = null;
	private observer: MutationObserver | null = null;
	private revision = 0;
	private currentContext: HTMLElement | null = null;
	private returnFocus: HTMLElement | null = null;
	private press: ContextPress | null = null;
	private suppressClick: { target: HTMLElement; time: number } | null = null;
	private originalPosition?: { name: string; value: string; priority: string }[];

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.shouldApplyOpenValue = true;
		this.currentOpen = false;
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("click", this.handleContextClick, true);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.element.addEventListener("focusin", this.handleFocusin);
		this.element.addEventListener("contextmenu", this.handleContextMenu);
		this.element.addEventListener("pointerdown", this.handleContextPointerdown);
		this.element.addEventListener("pointermove", this.handleContextPointermove);
		this.element.addEventListener("pointerup", this.handleContextPointerup);
		this.element.addEventListener("pointercancel", this.clearPress);
		this.element.addEventListener("pointerleave", this.clearPress);
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, {
			attributes: true,
			subtree: true,
			childList: true,
			characterData: true,
			attributeFilter: ["disabled", "data-dropdown-menu-value", "aria-label", "aria-labelledby"],
		});
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.revision += 1;
		this.press = null;
		this.suppressClick = null;
		this.currentContext = null;
		this.returnFocus = null;
		this.restorePosition();
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("click", this.handleContextClick, true);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.element.removeEventListener("focusin", this.handleFocusin);
		this.element.removeEventListener("contextmenu", this.handleContextMenu);
		this.element.removeEventListener("pointerdown", this.handleContextPointerdown);
		this.element.removeEventListener("pointermove", this.handleContextPointermove);
		this.element.removeEventListener("pointerup", this.handleContextPointerup);
		this.element.removeEventListener("pointercancel", this.clearPress);
		this.element.removeEventListener("pointerleave", this.clearPress);
		this.observer?.disconnect();
		this.observer = null;
		this.unbindDocument();
		if (this.enhanced) {
			this.syncState(false);
		}
		this.currentOpen = false;
		this.activeItem = null;
		this.enhanced = false;
	};

	triggerTargetConnected = () => this.scheduleReconcile();
	triggerTargetDisconnected = () => this.scheduleReconcile();
	menuTargetConnected = () => this.scheduleReconcile();
	menuTargetDisconnected = () => this.scheduleReconcile();
	contextTargetConnected = () => this.scheduleReconcile();
	contextTargetDisconnected = () => this.scheduleReconcile();
	itemTargetConnected = () => this.scheduleReconcile();
	itemTargetDisconnected = (item: HTMLButtonElement) => {
		if (this.activeItem === item) {
			this.activeItem = null;
		}
		this.scheduleReconcile();
	};
	openValueChanged = () => {
		this.shouldApplyOpenValue = true;
		this.scheduleReconcile();
	};

	/**
	 * Whether the menu is open. Assignment commits state without events or focus movement.
	 */
	get open(): boolean {
		return this.currentOpen;
	}

	/**
	 * Whether the menu is open. Assignment commits state without events or focus movement.
	 */
	set open(value: boolean) {
		this.commitOpen(Boolean(value));
	}

	/**
	 * Opens the menu without setting initial focus or emitting custom events.
	 *
	 * @returns No return value.
	 */
	show = () => this.commitOpen(true);

	/**
	 * Closes the menu without moving focus or emitting custom events.
	 *
	 * @returns No return value.
	 */
	hide = () => this.commitOpen(false);

	/**
	 * Toggles the menu without moving focus or emitting custom events.
	 *
	 * @returns No return value.
	 */
	toggle = () => this.commitOpen(!this.currentOpen);

	/**
	 * Selects a known enabled item and closes the menu without custom events. Empty, unknown, or
	 * disabled values do nothing.
	 *
	 * @returns No return value.
	 */
	select = (value: string) => {
		const item = this.enabledItems().find(
			(candidate) => this.itemValue(candidate) === value && value !== "",
		);
		if (item === undefined) {
			return;
		}

		this.activeItem = item;
		this.commitOpen(false);
	};

	private commitOpen = (open: boolean) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		this.revision += 1;
		this.currentContext = null;
		this.returnFocus = null;
		if (open) {
			this.positionAtAnchor(this.currentTrigger());
		}
		this.currentOpen = open;
		if (!open) {
			this.activeItem = null;
		}
		this.syncState(open);
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
		if (this.press && !this.isContextPressCurrent(this.press)) {
			this.press = null;
		}
		if (this.currentContext && !this.currentContextRegion()?.contains(this.currentContext)) {
			this.revision += 1;
			this.currentOpen = false;
			this.activeItem = null;
			this.currentContext = null;
			this.returnFocus = null;
		}
		if (this.currentContextRegion() === null) {
			this.restorePosition();
		}
		if (!this.isValidMarkup()) {
			this.currentOpen = false;
			this.activeItem = null;
			if (this.enhanced) {
				this.syncState(false);
			}
			this.currentContext = null;
			this.returnFocus = null;
			this.press = null;
			this.restorePosition();
			this.enhanced = false;
			this.unbindDocument();
			this.warnInvalidMarkup();
			return;
		}

		const menu = this.currentMenu();
		const trigger = this.currentTrigger();
		if (menu === null || trigger === null) {
			return;
		}

		this.enhanced = true;
		this.bindDocument();
		const completionAttributes = this.applyStructure(menu, trigger);
		if (this.shouldApplyOpenValue) {
			this.revision += 1;
			this.shouldApplyOpenValue = false;
			this.currentOpen = this.openValue;
			this.currentContext = null;
			this.returnFocus = null;
			this.positionAtAnchor(trigger);
			if (!this.currentOpen) {
				this.activeItem = null;
			}
		}
		this.syncState(this.currentOpen);
		this.warnCompletion(completionAttributes);
	};

	private ensureEnhanced = () => {
		if (
			!this.connected ||
			!this.element.isConnected ||
			!(this.element.getAttribute("data-controller") ?? "").split(/\s+/).includes(this.identifier)
		) {
			return false;
		}
		this.reconcile();
		return this.enhanced;
	};

	private currentTrigger = () => (this.triggerTargets.length === 1 ? this.triggerTargets[0] : null);

	private currentMenu = () => (this.menuTargets.length === 1 ? this.menuTargets[0] : null);
	private currentContextRegion = () =>
		this.contextTargets.length === 1 ? (this.contextTargets[0] ?? null) : null;

	private isValidMarkup = () => {
		const trigger = this.currentTrigger();
		const menu = this.currentMenu();
		const triggerHaspopup = trigger?.getAttribute("aria-haspopup");
		const menuRole = menu?.getAttribute("role");
		const context = this.currentContextRegion();
		return (
			trigger !== null &&
			menu !== null &&
			trigger instanceof HTMLButtonElement &&
			trigger.type === "button" &&
			hasAccessibleTextName(trigger, true) &&
			(triggerHaspopup === null || triggerHaspopup === "menu" || triggerHaspopup === "true") &&
			trigger.parentElement !== null &&
			this.element.contains(trigger) &&
			menu.localName === "menu" &&
			(menuRole === null || menuRole === "menu") &&
			this.element.contains(menu) &&
			(!(menu.hasAttribute("aria-label") || menu.hasAttribute("aria-labelledby")) ||
				hasAccessibleTextName(menu, false)) &&
			this.contextTargets.length <= 1 &&
			(context === null ||
				(context instanceof HTMLElement &&
					context !== this.element &&
					this.element.contains(context) &&
					!context.contains(menu) &&
					!menu.contains(context))) &&
			this.itemTargets.every(
				(item) =>
					item instanceof HTMLButtonElement && item.type === "button" && menu.contains(item),
			) &&
			this.itemTargets.every((item) => {
				const role = item.getAttribute("role");
				return (role === null || role === "menuitem") && hasAccessibleTextName(item, true);
			})
		);
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'dropdown-menu controller: Provide exactly one native <button type="button"> trigger target and one native <menu> menu target. Optional item targets must be native <button type="button"> elements inside the menu. Explicit roles must be "menu" and "menuitem"; an explicit trigger aria-haspopup must be "menu" or "true". Name the trigger and items and keep explicit menu names nonempty. Provide at most one HTMLElement context target that neither contains nor is contained by the menu. Enhancement has been disabled.',
		);
	};

	private applyStructure = (menu: HTMLElement, trigger: HTMLButtonElement) => {
		const completionAttributes: string[] = [];
		const hasPopupMissing = !trigger.hasAttribute("aria-haspopup");
		if (!trigger.hasAttribute("aria-haspopup")) {
			trigger.setAttribute("aria-haspopup", "menu");
		}
		if (hasPopupMissing) {
			completionAttributes.push('aria-haspopup="menu"');
		}
		const menuRoleMissing = !menu.hasAttribute("role");
		if (!menu.hasAttribute("role")) {
			menu.setAttribute("role", "menu");
		}
		if (menuRoleMissing) {
			completionAttributes.push('role="menu"');
		}
		ensureElementId(menu, "dropdown-menu");
		const controlsMissing = !trigger.hasAttribute("aria-controls");
		if (!trigger.hasAttribute("aria-controls")) {
			trigger.setAttribute("aria-controls", menu.id);
		}
		if (controlsMissing) {
			completionAttributes.push("aria-controls");
		}
		if (!menu.hasAttribute("aria-label") && !menu.hasAttribute("aria-labelledby")) {
			menu.setAttribute("aria-labelledby", ensureElementId(trigger, "dropdown-menu-trigger"));
			completionAttributes.push("menu: aria-labelledby");
		}

		for (const item of this.itemTargets) {
			if (!item.hasAttribute("role")) {
				item.setAttribute("role", "menuitem");
				completionAttributes.push('role="menuitem"');
			}
			ensureElementId(item, "dropdown-menu-item");
		}
		return completionAttributes;
	};

	private warnCompletion = (attributes: string[]) => {
		if (attributes.length === 0 || this.completionWarningIssued) {
			return;
		}
		this.completionWarningIssued = true;
		console.warn(
			`dropdown-menu controller: Added ${attributes.join(", ")}. Include them in your markup.`,
		);
	};

	private syncState = (open: boolean) => {
		const state = open ? "open" : "closed";
		this.element.dataset.state = state;
		const trigger = this.currentTrigger();
		const menu = this.currentMenu();
		if (trigger !== null) {
			trigger.dataset.state = state;
			trigger.setAttribute("aria-expanded", String(open));
		}
		if (menu !== null) {
			menu.dataset.state = state;
			menu.hidden = !open;
		}
		this.syncItems();
	};

	private syncItems = () => {
		for (const item of this.itemTargets) {
			item.tabIndex = -1;
			if (item.matches(":disabled")) {
				item.dataset.state = "disabled";
			} else {
				item.dataset.state = this.activeItem === item ? "active" : "inactive";
			}
		}
	};

	private enabledItems = () => this.itemTargets.filter((item) => !item.matches(":disabled"));

	private itemValue = (item: HTMLButtonElement) =>
		(item.getAttribute("data-dropdown-menu-value") ?? "").trim();

	private itemFromEvent = (event: Event) => {
		const menu = this.currentMenu();
		return event
			.composedPath()
			.find(
				(candidate): candidate is HTMLButtonElement =>
					candidate instanceof HTMLButtonElement &&
					this.itemTargets.includes(candidate) &&
					menu?.contains(candidate) === true,
			);
	};

	private triggerFromEvent = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLButtonElement =>
					candidate instanceof HTMLButtonElement && this.triggerTargets.includes(candidate),
			);

	private contextFromEvent = (event: Event) => {
		const region = this.currentContextRegion();
		const target = event.composedPath().find((element) => element instanceof HTMLElement);
		if (
			region === null ||
			!(target instanceof HTMLElement) ||
			!region.contains(target) ||
			!this.scope.containsElement(target) ||
			this.currentMenu()?.contains(target) ||
			target.isContentEditable
		) {
			return null;
		}
		for (let element: HTMLElement | null = target; element; element = element.parentElement) {
			if (["input", "textarea", "select"].includes(element.localName)) {
				return null;
			}
			if (element === region) {
				break;
			}
		}
		return { target, region };
	};

	private isContextRequestCurrent = ({ target, region }: ContextRequest) =>
		region === this.currentContextRegion() &&
		region.contains(target) &&
		this.scope.containsElement(target) &&
		this.currentTrigger()?.matches(":disabled") === false;

	private isContextPressCurrent = (press: ContextPress) =>
		this.isContextRequestCurrent(press) &&
		press.trigger === this.currentTrigger() &&
		press.menu === this.currentMenu();

	private anchorPosition = (element: HTMLElement) => {
		const rect = element.getBoundingClientRect();
		return {
			x: getComputedStyle(element).direction === "rtl" ? rect.right : rect.left,
			y: rect.bottom,
		};
	};

	private positionAtAnchor = (element: HTMLElement | null | undefined) => {
		if (element) {
			const { x, y } = this.anchorPosition(element);
			this.setPosition(x, y);
		}
	};

	private setPosition = (x: number, y: number) => {
		if (this.currentContextRegion() === null) {
			return;
		}
		if (!this.originalPosition) {
			this.originalPosition = ["--dropdown-menu-x", "--dropdown-menu-y"].map((name) => ({
				name,
				value: this.element.style.getPropertyValue(name),
				priority: this.element.style.getPropertyPriority(name),
			}));
		}
		this.element.style.setProperty("--dropdown-menu-x", `${x}px`);
		this.element.style.setProperty("--dropdown-menu-y", `${y}px`);
	};

	private restorePosition = () => {
		for (const { name, value, priority } of this.originalPosition ?? []) {
			if (value === "") {
				this.element.style.removeProperty(name);
			} else {
				this.element.style.setProperty(name, value, priority);
			}
		}
		this.originalPosition = undefined;
	};

	private contextDetail = () => (this.currentContext ? { context: this.currentContext } : {});

	private handleContextMenu = (event: MouseEvent) => {
		if (!event.isTrusted || event.defaultPrevented || !this.ensureEnhanced()) {
			return;
		}
		const context = this.contextFromEvent(event);
		if (context === null || this.currentTrigger()?.matches(":disabled")) {
			return;
		}
		if (
			this.suppressClick &&
			event.timeStamp - this.suppressClick.time < 1000 &&
			event.composedPath().includes(this.suppressClick.target)
		) {
			event.preventDefault();
			return;
		}
		this.press = null;
		const pointer =
			event.button === 2 ||
			(event instanceof PointerEvent && ["touch", "pen"].includes(event.pointerType));
		const position = pointer
			? { x: event.clientX, y: event.clientY }
			: this.anchorPosition(context.target);
		if (this.openFromUser(pointer ? "pointer" : "keyboard", false, { ...context, ...position })) {
			event.preventDefault();
			if (pointer) {
				this.suppressClick = { target: context.target, time: event.timeStamp };
			}
		}
	};

	private clearPress = (event: PointerEvent) => {
		if (event.isTrusted) {
			this.press = null;
		}
	};

	private handleContextPointerdown = (event: PointerEvent) => {
		if (!event.isTrusted) {
			return;
		}
		this.press = null;
		this.suppressClick = null;
		if (
			event.defaultPrevented ||
			!event.isPrimary ||
			!["touch", "pen"].includes(event.pointerType) ||
			event.button !== 0 ||
			!this.ensureEnhanced() ||
			this.triggerFromEvent(event)
		) {
			return;
		}
		const context = this.contextFromEvent(event);
		const trigger = this.currentTrigger();
		const menu = this.currentMenu();
		if (context && trigger && menu && !trigger.matches(":disabled")) {
			this.press = {
				...context,
				x: event.clientX,
				y: event.clientY,
				pointerId: event.pointerId,
				time: event.timeStamp,
				trigger,
				menu,
			};
		}
	};

	private handleContextPointermove = (event: PointerEvent) => {
		if (
			event.isTrusted &&
			this.press &&
			(!this.isInsidePressRegion(this.press, event) ||
				event.pointerId !== this.press.pointerId ||
				Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > 8)
		) {
			this.press = null;
		}
	};

	private handleContextPointerup = (event: PointerEvent) => {
		if (!event.isTrusted) {
			return;
		}
		const press = this.press;
		this.press = null;
		if (
			event.defaultPrevented ||
			!press ||
			press.pointerId !== event.pointerId ||
			!this.isInsidePressRegion(press, event) ||
			event.timeStamp - press.time < 600 ||
			Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8 ||
			!this.ensureEnhanced() ||
			!this.isContextPressCurrent(press)
		) {
			return;
		}
		if (this.openFromUser("pointer", false, press)) {
			event.preventDefault();
			this.suppressClick = { target: press.target, time: event.timeStamp };
		}
	};

	private isInsidePressRegion = (press: ContextPress, event: PointerEvent) => {
		const rect = press.region.getBoundingClientRect();
		return (
			event.clientX >= rect.left &&
			event.clientX <= rect.right &&
			event.clientY >= rect.top &&
			event.clientY <= rect.bottom
		);
	};

	private handleContextClick = (event: MouseEvent) => {
		if (!event.isTrusted) {
			return;
		}
		const suppressed = this.suppressClick;
		this.suppressClick = null;
		if (
			suppressed &&
			event.timeStamp - suppressed.time < 1000 &&
			event.composedPath().includes(suppressed.target)
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	};

	private handleClick = (event: MouseEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		if (event.defaultPrevented) {
			return;
		}

		const trigger = this.triggerFromEvent(event);
		if (trigger !== undefined) {
			if (trigger.matches(":disabled")) {
				return;
			}
			if (this.currentOpen) {
				this.closeFromUser("pointer", "", "trigger");
			} else {
				this.openFromUser("pointer");
			}
			return;
		}

		const item = this.itemFromEvent(event);
		if (item === undefined || item.matches(":disabled")) {
			return;
		}
		this.selectFromUser(item, "pointer");
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}
		if (event.defaultPrevented || isImeKeydown(event)) {
			return;
		}
		this.suppressClick = null;
		this.press = null;
		const shortcut =
			!event.ctrlKey &&
			!event.altKey &&
			!event.metaKey &&
			((event.key === "F10" && event.shiftKey) || (event.key === "ContextMenu" && !event.shiftKey));
		if (shortcut && this.currentContextRegion() && !this.currentTrigger()?.matches(":disabled")) {
			const context = this.contextFromEvent(event);
			if (context) {
				event.preventDefault();
				this.openFromUser("keyboard", false, {
					...context,
					...this.anchorPosition(context.target),
				});
				return;
			}
			if (this.triggerFromEvent(event)) {
				event.preventDefault();
				this.openFromUser("keyboard");
				return;
			}
		}

		const trigger = this.triggerFromEvent(event);
		if (trigger !== undefined) {
			if (trigger.matches(":disabled")) {
				return;
			}
			if (!["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
				return;
			}
			event.preventDefault();
			if (this.currentOpen) {
				this.closeFromUser("keyboard", "", "trigger");
				return;
			}
			this.openFromUser("keyboard", event.key === "ArrowUp");
			return;
		}

		const item = this.itemFromEvent(event);
		if (item === undefined || item.matches(":disabled") || !this.currentOpen) {
			return;
		}

		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			this.moveFocus(event.key === "ArrowDown" ? 1 : -1, item);
			return;
		}
		if (event.key === "Home" || event.key === "End") {
			event.preventDefault();
			const items = this.enabledItems();
			const target = event.key === "Home" ? items[0] : items.at(-1);
			if (target !== undefined) {
				this.focusItem(target);
			}
			return;
		}
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			this.selectFromUser(item, "keyboard");
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			this.closeFromUser("keyboard", "", "context");
			return;
		}
		if (event.key === "Tab") {
			this.closeFromUser("keyboard", "", false);
		}
	};

	private handleFocusin = (event: FocusEvent) => {
		if (!this.enhanced) {
			return;
		}
		const item = this.itemFromEvent(event);
		if (item === undefined || item.matches(":disabled")) {
			return;
		}
		this.activeItem = item;
		this.syncItems();
	};

	private openFromUser = (reason: UserReason, last = false, context?: ContextRequest) => {
		if (!this.ensureEnhanced() || (this.currentOpen && !context)) {
			return false;
		}
		const trigger = this.currentTrigger();
		const menu = this.currentMenu();
		if (
			!trigger ||
			!menu ||
			trigger.matches(":disabled") ||
			(context && !this.isContextRequestCurrent(context))
		) {
			return false;
		}
		const revision = this.revision;
		const wasOpen = this.currentOpen;
		const openValue = this.element.getAttribute("data-dropdown-menu-open-value");
		const active = this.element.ownerDocument.activeElement;
		const detail = {
			reason,
			...(context ? { context: context.target } : {}),
		} satisfies DropdownMenuOpenDetail;
		if (
			!this.element.dispatchEvent(
				new CustomEvent<DropdownMenuOpenDetail>("dropdown-menu:beforeopen", {
					bubbles: true,
					cancelable: true,
					detail,
				}),
			)
		) {
			return false;
		}
		if (
			!this.ensureEnhanced() ||
			revision !== this.revision ||
			this.currentOpen !== wasOpen ||
			this.currentTrigger() !== trigger ||
			this.currentMenu() !== menu ||
			this.element.getAttribute("data-dropdown-menu-open-value") !== openValue ||
			trigger.matches(":disabled") ||
			(context && !this.isContextRequestCurrent(context))
		) {
			return false;
		}
		const committedRevision = ++this.revision;
		this.currentContext = context?.target ?? null;
		this.returnFocus =
			context && active instanceof HTMLElement && context.region.contains(active) ? active : null;
		if (context) {
			this.setPosition(context.x, context.y);
		} else {
			this.positionAtAnchor(trigger);
		}
		this.currentOpen = true;
		this.syncState(true);
		this.element.dispatchEvent(
			new CustomEvent<DropdownMenuOpenDetail>("dropdown-menu:open", { bubbles: true, detail }),
		);
		if (
			this.ensureEnhanced() &&
			this.revision === committedRevision &&
			this.currentOpen &&
			this.currentTrigger() === trigger &&
			this.currentMenu() === menu &&
			this.element.getAttribute("data-dropdown-menu-open-value") === openValue &&
			this.element.ownerDocument.activeElement === active
		) {
			const items = this.enabledItems();
			const item = last ? items.at(-1) : items[0];
			if (item !== undefined) {
				this.focusItem(item);
			}
		}
		return true;
	};

	private closeFromUser = (
		reason: UserReason,
		value: string,
		restoreFocus: "trigger" | "context" | false,
		item?: HTMLButtonElement,
	) => {
		if (!this.ensureEnhanced() || !this.currentOpen) {
			return false;
		}
		const revision = this.revision;
		const trigger = this.currentTrigger();
		const menu = this.currentMenu();
		const openValue = this.element.getAttribute("data-dropdown-menu-open-value");
		const active = this.element.ownerDocument.activeElement;
		const detail = { reason, value, ...this.contextDetail() } satisfies DropdownMenuCloseDetail;
		if (
			!this.element.dispatchEvent(
				new CustomEvent<DropdownMenuCloseDetail>("dropdown-menu:beforeclose", {
					bubbles: true,
					cancelable: true,
					detail,
				}),
			)
		) {
			return false;
		}
		if (
			!this.ensureEnhanced() ||
			revision !== this.revision ||
			!this.currentOpen ||
			this.currentTrigger() !== trigger ||
			this.currentMenu() !== menu ||
			this.element.getAttribute("data-dropdown-menu-open-value") !== openValue ||
			(item &&
				(!this.itemTargets.includes(item) ||
					item.matches(":disabled") ||
					this.itemValue(item) !== value))
		) {
			return false;
		}
		const committedRevision = ++this.revision;
		const returnFocus = restoreFocus === "context" ? this.returnFocus : null;
		const allowRestore = this.element.ownerDocument.activeElement === active;
		this.currentOpen = false;
		this.activeItem = null;
		this.currentContext = null;
		this.returnFocus = null;
		this.syncState(false);
		const activeAfterHide = this.element.ownerDocument.activeElement;
		this.element.dispatchEvent(
			new CustomEvent<DropdownMenuCloseDetail>("dropdown-menu:close", { bubbles: true, detail }),
		);
		if (
			!this.ensureEnhanced() ||
			this.revision !== committedRevision ||
			this.currentOpen ||
			this.currentTrigger() !== trigger ||
			this.currentMenu() !== menu ||
			this.element.getAttribute("data-dropdown-menu-open-value") !== openValue
		) {
			return false;
		}
		if (
			restoreFocus &&
			allowRestore &&
			this.element.ownerDocument.activeElement === activeAfterHide
		) {
			const target = this.canRestoreFocus(returnFocus) ? returnFocus : this.currentTrigger();
			target?.focus();
		}
		return (
			this.ensureEnhanced() &&
			this.revision === committedRevision &&
			!this.currentOpen &&
			this.currentTrigger() === trigger &&
			this.currentMenu() === menu &&
			this.element.getAttribute("data-dropdown-menu-open-value") === openValue
		);
	};

	private canRestoreFocus = (element: HTMLElement | null): element is HTMLElement => {
		if (
			!element?.isConnected ||
			element.matches(":disabled") ||
			element.getClientRects().length === 0 ||
			getComputedStyle(element).visibility !== "visible"
		) {
			return false;
		}
		for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
			if (parent.inert || parent.getAttribute("aria-hidden") === "true") {
				return false;
			}
		}
		return true;
	};

	private selectFromUser = (item: HTMLButtonElement, reason: UserReason) => {
		const value = this.itemValue(item);
		const context = this.contextDetail();
		if (value === "") {
			return;
		}
		if (!this.closeFromUser(reason, value, "context", item)) {
			return;
		}
		this.element.dispatchEvent(
			new CustomEvent<DropdownMenuSelectDetail>("dropdown-menu:select", {
				bubbles: true,
				detail: { value, reason, ...context },
			}),
		);
	};

	private moveFocus = (delta: number, current: HTMLButtonElement) => {
		const items = this.enabledItems();
		if (items.length === 0) {
			return;
		}
		const index = items.indexOf(current);
		const next = (index + delta + items.length) % items.length;
		const item = items[next];
		if (item === undefined) {
			return;
		}
		this.focusItem(item);
	};

	private focusItem = (item: HTMLButtonElement) => {
		this.activeItem = item;
		this.syncItems();
		item.focus();
	};

	private bindDocument = () => {
		const document = this.element.ownerDocument;
		if (this.boundDocument === document) {
			return;
		}
		this.unbindDocument();
		document.addEventListener("pointerdown", this.handleDocumentPointerdown);
		this.boundDocument = document;
	};

	private unbindDocument = () => {
		this.boundDocument?.removeEventListener("pointerdown", this.handleDocumentPointerdown);
		this.boundDocument = null;
	};

	private handleDocumentPointerdown = (event: PointerEvent) => {
		if (!this.enhanced || !this.currentOpen || !event.isTrusted) {
			return;
		}
		if (event.composedPath().includes(this.element)) {
			return;
		}
		if (this.closeFromUser("pointer", "", "trigger")) {
			event.preventDefault();
		}
	};
}

export { DropdownMenuController };
