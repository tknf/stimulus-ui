import { Controller } from "@hotwired/stimulus";
import { hasAccessibleTextName } from "./internal/accessible_text_name";
import { ensureElementId } from "./internal/ensure_element_id";
import { isImeKeydown } from "./internal/ime";

export type ListReorderChangeDetail = {
	item: string;
	from: number;
	to: number;
	order: readonly string[];
	previousOrder: readonly string[];
	reason: "pointer" | "keyboard";
};
type Entry = {
	item: HTMLLIElement;
	handle: HTMLButtonElement;
	previous: HTMLButtonElement;
	next: HTMLButtonElement;
};
type Markup = {
	list: HTMLUListElement | HTMLOListElement;
	instructions: HTMLElement;
	entries: Entry[];
};
type Rect = {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
};
type Geometry = { list: Rect; items: Rect[]; horizontal: boolean; rtl: boolean };
type Interaction = {
	source: Entry;
	index: number;
	disabled: string;
} & ({ kind: "keyboard" } | { kind: "pointer"; pointerId: number; geometry: Geometry });
const sameEntries = (left: Entry[], right: Entry[]) =>
	left.length === right.length &&
	left.every((entry, index) => {
		const other = right[index];
		return (
			other !== undefined &&
			entry.item === other.item &&
			entry.handle === other.handle &&
			entry.previous === other.previous &&
			entry.next === other.next
		);
	});
const reordered = <T>(items: readonly T[], from: number, to: number) => {
	const result = [...items];
	const [item] = result.splice(from, 1);
	if (item !== undefined) {
		result.splice(to, 0, item);
	}
	return result;
};

/**
 * Reorders existing native list items through dragging, keyboard commands, and adjacent-move buttons.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/list-reorder.contract.json
 */
export default class ListReorderController extends Controller<HTMLElement> {
	static targets = ["list", "item", "handle", "previous", "next", "instructions"];
	static values = { orientation: { type: String, default: "vertical" } };
	declare readonly listTargets: HTMLElement[];
	declare readonly itemTargets: HTMLElement[];
	declare readonly handleTargets: HTMLElement[];
	declare readonly previousTargets: HTMLElement[];
	declare readonly nextTargets: HTMLElement[];
	declare readonly instructionsTargets: HTMLElement[];
	declare readonly orientationValue: string;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private reconcileQueued = false;
	private boundMarkup: Markup | null = null;
	private boundDocument: Document | null = null;
	private boundWindow: Window | null = null;
	private boundOrientation = "";
	private currentOrder: string[] = [];
	private interaction: Interaction | null = null;
	private observer: MutationObserver | null = null;
	private revision = 0;
	private requesting = false;
	private descriptions = new WeakMap<HTMLElement, string>();

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.observer?.disconnect();
		this.observer = new MutationObserver((records) => {
			const targets =
				this.boundMarkup?.entries.flatMap((entry) => [entry.handle, entry.previous, entry.next]) ??
				[];
			if (
				records.some(
					({ target }) =>
						target instanceof HTMLElement &&
						(target.contains(this.element) || targets.some((button) => target.contains(button))),
				)
			) {
				this.scheduleReconcile();
			}
		});
		this.observer.observe(this.element.ownerDocument, {
			attributes: true,
			subtree: true,
			attributeFilter: ["disabled", "dir"],
		});
		this.reconcile();
	};
	disconnect = () => {
		this.cancel();
		this.connected = false;
		this.enhanced = false;
		this.unbind();
		this.observer?.disconnect();
		this.observer = null;
		this.reconcileQueued = false;
	};
	listTargetConnected = () => this.scheduleReconcile();
	listTargetDisconnected = () => this.scheduleReconcile();
	itemTargetConnected = () => this.scheduleReconcile();
	itemTargetDisconnected = () => this.scheduleReconcile();
	handleTargetConnected = () => this.scheduleReconcile();
	handleTargetDisconnected = () => this.scheduleReconcile();
	previousTargetConnected = () => this.scheduleReconcile();
	previousTargetDisconnected = () => this.scheduleReconcile();
	nextTargetConnected = () => this.scheduleReconcile();
	nextTargetDisconnected = () => this.scheduleReconcile();
	instructionsTargetConnected = () => this.scheduleReconcile();
	instructionsTargetDisconnected = () => this.scheduleReconcile();
	orientationValueChanged = () => this.scheduleReconcile();

	/**
	 * Copy of valid item IDs in the most recently synchronized DOM order. Empty before the first
	 * valid connection. External DOM edits appear after target-callback synchronization.
	 */
	get order(): readonly string[] {
		return [...this.currentOrder];
	}
	/**
	 * ID of the item being moved, or null when no operation is active.
	 */
	get pickedItem(): string | null {
		return this.interaction?.source.item.id ?? null;
	}
	/**
	 * Proposed zero-based destination index, or null when no operation is active. The proposal does
	 * not change DOM order until committed.
	 */
	get targetIndex(): number | null {
		return this.interaction?.index ?? null;
	}
	/**
	 * Synchronously moves an existing item to a zero-based destination index. Requires a finite
	 * integer within the list. Unknown IDs, invalid indexes, disconnected state, and invalid markup
	 * do nothing. Cancels any proposal and applies even when disabled, without custom events.
	 */
	move = (itemId: string, index: number) => {
		if (
			!this.ensureEnhanced() ||
			this.boundMarkup === null ||
			!Number.isInteger(index) ||
			index < 0 ||
			index >= this.boundMarkup.entries.length
		) {
			return;
		}
		const entry = this.boundMarkup.entries.find(({ item }) => item.id === itemId);
		if (entry === undefined) {
			return;
		}
		this.cancel();
		this.commitMove(entry, index, null);
	};
	/**
	 * Discards the current proposal and pointer capture without changing DOM order, emitting events,
	 * or moving focus.
	 */
	cancel = () => {
		this.revision++;
		const previous = this.interaction;
		this.interaction = null;
		if (
			previous?.kind === "pointer" &&
			previous.source.handle.hasPointerCapture(previous.pointerId)
		) {
			previous.source.handle.releasePointerCapture(previous.pointerId);
		}
		this.syncState();
	};

	private scheduleReconcile = () => {
		if (!this.connected) {
			return;
		}
		this.cancel();
		if (this.reconcileQueued) {
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
		if (!this.connected) {
			return;
		}
		this.cancel();
		this.unbind();
		const markup = this.getMarkup();
		if (markup === null || !this.isValidMarkup(markup)) {
			this.enhanced = false;
			if (!this.warningIssued) {
				this.warningIssued = true;
				console.warn(
					"list-reorder controller: Provide a named group, native list and li elements, named handle/previous/next buttons for each item, instructions, and a linear orientation as specified in the contract. Enhancement has been disabled.",
				);
			}
			return;
		}
		this.applyStructure(markup);
		this.enhanced = true;
		this.boundOrientation = this.orientationValue;
		this.currentOrder = markup.entries.map(({ item }) => item.id);
		this.bind(markup);
		this.syncState();
	};
	private getMarkup = (): Markup | null => {
		if (
			!(this.element instanceof HTMLDivElement) ||
			this.listTargets.length !== 1 ||
			this.instructionsTargets.length !== 1
		) {
			return null;
		}
		const [list] = this.listTargets;
		const [instructions] = this.instructionsTargets;
		if (
			!(list instanceof HTMLUListElement || list instanceof HTMLOListElement) ||
			!(instructions instanceof HTMLElement)
		) {
			return null;
		}
		const children = Array.from(list.children);
		const items = this.itemTargets;
		if (
			items.length !== children.length ||
			children.some((child) => !(child instanceof HTMLLIElement) || !items.includes(child))
		) {
			return null;
		}
		if (
			[this.handleTargets, this.previousTargets, this.nextTargets].some(
				(targets) => targets.length !== items.length,
			)
		) {
			return null;
		}
		const entries: Entry[] = [];
		for (const item of children) {
			if (!(item instanceof HTMLLIElement)) {
				return null;
			}
			const controls = [this.handleTargets, this.previousTargets, this.nextTargets].map((targets) =>
				targets.filter((target) => item.contains(target)),
			);
			if (controls.some((targets) => targets.length !== 1)) {
				return null;
			}
			const handle = controls[0]?.[0];
			const previous = controls[1]?.[0];
			const next = controls[2]?.[0];
			if (
				!(handle instanceof HTMLButtonElement) ||
				!(previous instanceof HTMLButtonElement) ||
				!(next instanceof HTMLButtonElement)
			) {
				return null;
			}
			entries.push({ item, handle, previous, next });
		}
		return { list, instructions, entries };
	};
	private allowedRole = (element: HTMLElement, role: string) =>
		!element.hasAttribute("role") || element.getAttribute("role") === role;
	private hasInteractiveAncestor = (element: HTMLElement) => {
		for (
			let ancestor = element.parentElement;
			ancestor !== null;
			ancestor = ancestor.parentElement
		) {
			if (
				ancestor instanceof HTMLButtonElement ||
				ancestor instanceof HTMLAnchorElement ||
				ancestor instanceof HTMLLabelElement ||
				ancestor instanceof HTMLSelectElement ||
				ancestor instanceof HTMLTextAreaElement
			) {
				return true;
			}
		}
		return false;
	};
	private isValidMarkup = (markup: Markup) => {
		const { list, instructions, entries } = markup;
		if (
			!this.allowedRole(this.element, "group") ||
			!hasAccessibleTextName(this.element, false) ||
			this.hasInteractiveAncestor(this.element)
		) {
			return false;
		}
		if (
			!["vertical", "horizontal"].includes(this.orientationValue) ||
			list.ownerDocument.defaultView?.getComputedStyle(list).writingMode !== "horizontal-tb"
		) {
			return false;
		}
		if (
			list === this.element ||
			instructions === this.element ||
			!this.element.contains(list) ||
			!this.element.contains(instructions) ||
			list.contains(instructions) ||
			!hasAccessibleTextName(instructions, true) ||
			this.hasInteractiveAncestor(instructions) ||
			!this.allowedRole(list, "list")
		) {
			return false;
		}
		const live = list.getAttribute("aria-live");
		const atomic = list.getAttribute("aria-atomic");
		const relevant = list.getAttribute("aria-relevant");
		if (
			(live !== null && !["polite", "assertive"].includes(live)) ||
			(atomic !== null && !["true", "false"].includes(atomic))
		) {
			return false;
		}
		if (relevant !== null) {
			const tokens = relevant.trim().split(/\s+/);
			if (
				tokens.some((token) => !["additions", "removals", "text", "all"].includes(token)) ||
				(!tokens.includes("additions") && !tokens.includes("all"))
			) {
				return false;
			}
		}
		const ids = entries.map(({ item }) => item.id).filter((id) => id !== "");
		if (new Set(ids).size !== ids.length || ids.some((id) => /\s/.test(id))) {
			return false;
		}
		return entries.every(({ item, handle, previous, next }) => {
			const buttons = [handle, previous, next];
			return (
				new Set(buttons).size === 3 &&
				!item.hidden &&
				item.getAttribute("aria-hidden") !== "true" &&
				this.allowedRole(item, "listitem") &&
				!this.hasInteractiveAncestor(item) &&
				buttons.every(
					(button) =>
						button.type === "button" &&
						!button.hidden &&
						button.getAttribute("aria-hidden") !== "true" &&
						this.allowedRole(button, "button") &&
						hasAccessibleTextName(button, true) &&
						!this.hasInteractiveAncestor(button) &&
						button.matches(":disabled") === handle.matches(":disabled"),
				)
			);
		});
	};
	private bindingCurrent = () => {
		const markup = this.getMarkup();
		return (
			this.connected &&
			this.element.isConnected &&
			this.enhanced &&
			this.boundMarkup !== null &&
			markup !== null &&
			markup.list === this.boundMarkup.list &&
			markup.instructions === this.boundMarkup.instructions &&
			sameEntries(markup.entries, this.boundMarkup.entries) &&
			markup.entries.every(({ item }, index) => item.id === this.currentOrder[index]) &&
			this.boundOrientation === this.orientationValue &&
			this.isValidMarkup(markup)
		);
	};
	private ensureEnhanced = () => {
		if (!this.connected || !this.element.isConnected) {
			return false;
		}
		if (!this.bindingCurrent()) {
			this.reconcile();
		}
		return this.bindingCurrent();
	};
	private applyStructure = (markup: Markup) => {
		const completed: string[] = [];
		const complete = (element: HTMLElement, name: string, value: string, target: string) => {
			if (!element.hasAttribute(name)) {
				element.setAttribute(name, value);
				completed.push(`${target}: ${name}`);
			}
		};
		complete(this.element, "role", "group", "root");
		complete(markup.list, "role", "list", "list");
		complete(markup.list, "aria-live", "polite", "list");
		complete(markup.list, "aria-atomic", "false", "list");
		complete(markup.list, "aria-relevant", "additions", "list");
		const instructions = ensureElementId(markup.instructions, "list-reorder-instructions");
		for (const { item, handle } of markup.entries) {
			ensureElementId(item, "list-reorder-item");
			if (!item.hasAttribute("tabindex")) {
				item.tabIndex = -1;
			}
			for (const target of [item, handle]) {
				const previous = this.descriptions.get(target);
				const ids = (target.getAttribute("aria-describedby") ?? "")
					.split(/\s+/)
					.filter((id) => id !== "" && id !== previous);
				if (!ids.includes(instructions)) {
					ids.push(instructions);
					this.descriptions.set(target, instructions);
				}
				target.setAttribute("aria-describedby", ids.join(" "));
			}
		}
		if (completed.length > 0 && !this.completionWarningIssued) {
			this.completionWarningIssued = true;
			console.warn(
				`list-reorder controller: Added ${completed.join(", ")}. Include them in your markup.`,
			);
		}
	};
	private syncState = () => {
		const markup = this.boundMarkup;
		if (markup === null) {
			return;
		}
		const interaction = this.interaction;
		const from =
			interaction === null
				? -1
				: markup.entries.findIndex(({ item }) => item === interaction.source.item);
		for (const [index, entry] of markup.entries.entries()) {
			const picked = interaction?.source.item === entry.item;
			entry.item.dataset.state = picked ? "picked" : "idle";
			entry.item.dataset.dropPosition =
				interaction !== null && index === interaction.index && index !== from
					? index < from
						? "before"
						: "after"
					: "none";
			entry.handle.setAttribute("aria-pressed", String(picked));
			entry.item.setAttribute("aria-posinset", String(index + 1));
			entry.item.setAttribute("aria-setsize", String(markup.entries.length));
		}
	};
	private bind = (markup: Markup) => {
		this.boundMarkup = markup;
		this.boundDocument = this.element.ownerDocument;
		this.boundWindow = this.boundDocument.defaultView;
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.element.addEventListener("pointerdown", this.handlePointerdown);
		this.element.addEventListener("lostpointercapture", this.handlePointercancel);
		this.boundDocument.addEventListener("pointermove", this.handlePointermove);
		this.boundDocument.addEventListener("pointerup", this.handlePointerup);
		this.boundDocument.addEventListener("pointercancel", this.handlePointercancel);
		this.boundDocument.addEventListener("focusin", this.handleFocusin);
		this.boundWindow?.addEventListener("blur", this.handleWindowBlur);
	};
	private unbind = () => {
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.element.removeEventListener("pointerdown", this.handlePointerdown);
		this.element.removeEventListener("lostpointercapture", this.handlePointercancel);
		this.boundDocument?.removeEventListener("pointermove", this.handlePointermove);
		this.boundDocument?.removeEventListener("pointerup", this.handlePointerup);
		this.boundDocument?.removeEventListener("pointercancel", this.handlePointercancel);
		this.boundDocument?.removeEventListener("focusin", this.handleFocusin);
		this.boundWindow?.removeEventListener("blur", this.handleWindowBlur);
		this.boundMarkup = null;
		this.boundDocument = null;
		this.boundWindow = null;
	};
	private disabledSignature = () =>
		JSON.stringify(
			this.boundMarkup?.entries.flatMap(({ handle, previous, next }) =>
				[handle, previous, next].map((button) => button.matches(":disabled")),
			) ?? [],
		);
	private currentInteraction = () => {
		const interaction = this.interaction;
		if (interaction === null) {
			return null;
		}
		if (!this.bindingCurrent() || interaction.disabled !== this.disabledSignature()) {
			this.scheduleReconcile();
			return null;
		}
		return interaction;
	};
	private buttonFor = (event: Event) => {
		for (const entry of this.boundMarkup?.entries ?? []) {
			for (const kind of ["handle", "previous", "next"] as const) {
				if (event.composedPath().includes(entry[kind])) {
					return { entry, kind };
				}
			}
		}
		return null;
	};
	private focusCandidate = () => {
		const interaction = this.currentInteraction();
		const entry = interaction === null ? undefined : this.boundMarkup?.entries[interaction.index];
		if (interaction?.kind !== "keyboard" || entry === undefined) {
			return;
		}
		entry.item.focus();
		if (
			this.interaction === interaction &&
			(!this.bindingCurrent() || entry.item.ownerDocument.activeElement !== entry.item)
		) {
			this.cancel();
		}
	};
	private startKeyboard = (source: Entry) => {
		if (this.boundMarkup === null || source.handle.matches(":disabled")) {
			return;
		}
		this.cancel();
		this.interaction = {
			kind: "keyboard",
			source,
			index: this.boundMarkup.entries.findIndex(({ item }) => item === source.item),
			disabled: this.disabledSignature(),
		};
		this.syncState();
		this.focusCandidate();
	};
	private handleClick = (event: MouseEvent) => {
		if (
			!event.isTrusted ||
			event.defaultPrevented ||
			!this.ensureEnhanced() ||
			this.boundMarkup === null
		) {
			return;
		}
		const button = this.buttonFor(event);
		if (
			button === null ||
			button.entry[button.kind].matches(":disabled") ||
			button.entry.handle.matches(":disabled")
		) {
			return;
		}
		if (button.kind === "handle") {
			if (event.detail === 0) {
				this.startKeyboard(button.entry);
			}
			return;
		}
		const from = this.boundMarkup.entries.findIndex(({ item }) => item === button.entry.item);
		const to = from + (button.kind === "previous" ? -1 : 1);
		this.cancel();
		this.requestMove(button.entry, to, event.detail === 0 ? "keyboard" : "pointer", null);
	};
	private handleKeydown = (event: KeyboardEvent) => {
		if (
			!event.isTrusted ||
			event.defaultPrevented ||
			isImeKeydown(event) ||
			event.ctrlKey ||
			event.altKey ||
			event.metaKey ||
			!this.ensureEnhanced() ||
			this.boundMarkup === null
		) {
			return;
		}
		const button = this.buttonFor(event);
		const item = this.boundMarkup.entries.find((entry) => entry.item === event.target);
		if (button === null && item === undefined) {
			return;
		}
		if (
			event.repeat &&
			(event.key === "Enter" || event.key === " ") &&
			(button?.kind === "handle" || item !== undefined)
		) {
			event.preventDefault();
			return;
		}
		const interaction = this.currentInteraction();
		if (interaction === null) {
			return;
		}
		if (event.key === "Tab" || event.key === "Escape") {
			this.cancel();
			if (event.key === "Escape") {
				event.preventDefault();
				if (
					!interaction.source.handle.matches(":disabled") &&
					interaction.source.handle.isConnected
				) {
					interaction.source.handle.focus();
				}
			}
			return;
		}
		if (interaction.kind !== "keyboard" || item === undefined) {
			return;
		}
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			this.cancel();
			const revision = this.revision;
			this.requestMove(
				interaction.source,
				interaction.index,
				"keyboard",
				interaction.source.handle,
			);
			if (
				revision === this.revision &&
				this.bindingCurrent() &&
				item.item.ownerDocument.activeElement === item.item
			) {
				interaction.source.handle.focus();
			}
			return;
		}
		const horizontal = this.orientationValue === "horizontal";
		const rtl = this.boundWindow?.getComputedStyle(this.boundMarkup.list).direction === "rtl";
		const delta = horizontal
			? (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0) * (rtl ? -1 : 1)
			: event.key === "ArrowDown"
				? 1
				: event.key === "ArrowUp"
					? -1
					: 0;
		if (delta === 0 && event.key !== "Home" && event.key !== "End") {
			return;
		}
		event.preventDefault();
		interaction.index =
			event.key === "Home"
				? 0
				: event.key === "End"
					? this.boundMarkup.entries.length - 1
					: Math.max(0, Math.min(this.boundMarkup.entries.length - 1, interaction.index + delta));
		this.syncState();
		this.focusCandidate();
	};
	private rect = (element: HTMLElement): Rect => {
		const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
		return { left, top, right, bottom, width, height };
	};
	private geometry = (): Geometry | null => {
		const markup = this.boundMarkup;
		if (markup === null) {
			return null;
		}
		const list = this.rect(markup.list);
		const items = markup.entries.map(({ item }) => this.rect(item));
		if (
			[list, ...items].some(
				(rect) =>
					rect.width <= 0 || rect.height <= 0 || !Object.values(rect).every(Number.isFinite),
			)
		) {
			return null;
		}
		const horizontal = this.orientationValue === "horizontal";
		const rtl = this.boundWindow?.getComputedStyle(markup.list).direction === "rtl";
		const centers = items.map((rect) =>
			horizontal ? ((rect.left + rect.right) / 2) * (rtl ? -1 : 1) : (rect.top + rect.bottom) / 2,
		);
		if (centers.some((center, index) => index > 0 && center <= (centers[index - 1] ?? center))) {
			return null;
		}
		return { list, items, horizontal, rtl };
	};
	private handlePointerdown = (event: PointerEvent) => {
		if (
			!event.isTrusted ||
			!event.isPrimary ||
			event.button !== 0 ||
			event.defaultPrevented ||
			event.ctrlKey ||
			event.altKey ||
			event.metaKey ||
			!this.ensureEnhanced() ||
			this.boundMarkup === null
		) {
			return;
		}
		const button = this.buttonFor(event);
		if (button?.kind !== "handle" || button.entry.handle.matches(":disabled")) {
			return;
		}
		if (this.interaction?.kind === "pointer" && this.interaction.pointerId !== event.pointerId) {
			return;
		}
		const geometry = this.geometry();
		if (geometry === null) {
			return;
		}
		this.cancel();
		const revision = this.revision;
		try {
			button.entry.handle.setPointerCapture(event.pointerId);
		} catch {
			return;
		}
		event.preventDefault();
		button.entry.handle.focus();
		if (
			revision !== this.revision ||
			!this.bindingCurrent() ||
			button.entry.handle.matches(":disabled")
		) {
			if (button.entry.handle.hasPointerCapture(event.pointerId)) {
				button.entry.handle.releasePointerCapture(event.pointerId);
			}
			return;
		}
		this.interaction = {
			kind: "pointer",
			source: button.entry,
			index: this.boundMarkup.entries.findIndex(({ item }) => item === button.entry.item),
			pointerId: event.pointerId,
			geometry,
			disabled: this.disabledSignature(),
		};
		this.syncState();
	};
	private updatePointer = (event: PointerEvent) => {
		if (!event.isTrusted || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
			return null;
		}
		const interaction = this.currentInteraction();
		if (
			interaction?.kind !== "pointer" ||
			interaction.pointerId !== event.pointerId ||
			this.boundMarkup === null
		) {
			return null;
		}
		const geometry = this.geometry();
		if (geometry === null || JSON.stringify(geometry) !== JSON.stringify(interaction.geometry)) {
			this.cancel();
			return null;
		}
		const coordinate = geometry.horizontal
			? event.clientX * (geometry.rtl ? -1 : 1)
			: event.clientY;
		interaction.index = geometry.items.filter((rect, index) => {
			if (this.boundMarkup?.entries[index]?.item === interaction.source.item) {
				return false;
			}
			const center = geometry.horizontal
				? ((rect.left + rect.right) / 2) * (geometry.rtl ? -1 : 1)
				: (rect.top + rect.bottom) / 2;
			return coordinate >= center;
		}).length;
		this.syncState();
		return interaction;
	};
	private handlePointermove = (event: PointerEvent) => {
		if (this.updatePointer(event) !== null) {
			event.preventDefault();
		}
	};
	private handlePointerup = (event: PointerEvent) => {
		if (!event.isTrusted || event.button !== 0) {
			return;
		}
		const interaction = this.updatePointer(event);
		if (interaction === null) {
			return;
		}
		const rect = interaction.geometry.list;
		const inside =
			event.clientX >= rect.left &&
			event.clientX <= rect.right &&
			event.clientY >= rect.top &&
			event.clientY <= rect.bottom;
		this.cancel();
		if (inside) {
			this.requestMove(interaction.source, interaction.index, "pointer", null);
		}
	};
	private handlePointercancel = (event: PointerEvent) => {
		if (
			event.isTrusted &&
			this.interaction?.kind === "pointer" &&
			this.interaction.pointerId === event.pointerId
		) {
			this.cancel();
		}
	};
	private handleFocusin = (event: FocusEvent) => {
		const interaction = this.interaction;
		if (interaction === null) {
			return;
		}
		const expected =
			interaction.kind === "pointer"
				? interaction.source.handle
				: this.boundMarkup?.entries[interaction.index]?.item;
		if (event.target !== expected) {
			this.cancel();
		}
	};
	private handleWindowBlur = () => this.cancel();
	private requestMove = (
		entry: Entry,
		to: number,
		reason: ListReorderChangeDetail["reason"],
		focus: HTMLElement | null,
	) => {
		if (
			this.requesting ||
			!this.ensureEnhanced() ||
			this.boundMarkup === null ||
			entry.handle.matches(":disabled")
		) {
			return;
		}
		const from = this.boundMarkup.entries.findIndex(({ item }) => item === entry.item);
		if (from < 0 || to < 0 || to >= this.boundMarkup.entries.length || from === to) {
			return;
		}
		const previousOrder = [...this.currentOrder];
		const order = reordered(previousOrder, from, to);
		const revision = this.revision;
		const disabled = this.disabledSignature();
		const detail = (): ListReorderChangeDetail => ({
			item: entry.item.id,
			from,
			to,
			previousOrder: [...previousOrder],
			order: [...order],
			reason,
		});
		this.requesting = true;
		let accepted: boolean;
		try {
			accepted = this.element.dispatchEvent(
				new CustomEvent<ListReorderChangeDetail>("list-reorder:beforechange", {
					bubbles: true,
					cancelable: true,
					detail: detail(),
				}),
			);
		} finally {
			this.requesting = false;
		}
		if (
			!accepted ||
			revision !== this.revision ||
			!this.bindingCurrent() ||
			disabled !== this.disabledSignature()
		) {
			return;
		}
		if (!this.commitMove(entry, to, focus)) {
			return;
		}
		this.element.dispatchEvent(
			new CustomEvent<ListReorderChangeDetail>("list-reorder:change", {
				bubbles: true,
				detail: detail(),
			}),
		);
	};
	private commitMove = (entry: Entry, to: number, focus: HTMLElement | null) => {
		const markup = this.boundMarkup;
		if (markup === null || !this.bindingCurrent()) {
			return false;
		}
		const from = markup.entries.findIndex(({ item }) => item === entry.item);
		if (from < 0 || from === to) {
			return false;
		}
		const expected = reordered(markup.entries, from, to);
		const reference = expected[to + 1]?.item ?? null;
		const document = entry.item.ownerDocument;
		const active = document.activeElement;
		const restore =
			focus ?? (active instanceof HTMLElement && entry.item.contains(active) ? active : null);
		this.revision++;
		// Some browsers update native ol numbering incorrectly with moveBefore.
		markup.list.insertBefore(entry.item, reference);
		this.reconcile();
		if (this.boundMarkup === null || !sameEntries(this.boundMarkup.entries, expected)) {
			return false;
		}
		const revision = this.revision;
		if (
			restore !== null &&
			restore.isConnected &&
			this.element.contains(restore) &&
			!restore.matches(":disabled") &&
			(document.activeElement === active ||
				document.activeElement === document.body ||
				document.activeElement === null)
		) {
			restore.focus();
		}
		return (
			revision === this.revision &&
			this.bindingCurrent() &&
			this.boundMarkup !== null &&
			sameEntries(this.boundMarkup.entries, expected)
		);
	};
}

export { ListReorderController };
