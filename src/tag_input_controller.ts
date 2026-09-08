import { Controller } from "@hotwired/stimulus";

import { isImeKeydown } from "./internal/ime";
import { horizontalArrowDelta } from "./internal/roving_navigation";

type TagInputRemoveReason = "pointer" | "keyboard";

export type TagInputAddDetail = {
	value: string;
	reason: "keyboard";
};

export type TagInputRemoveDetail = {
	value: string;
	chip: HTMLElement;
	reason: TagInputRemoveReason;
};

type PendingRemoval = {
	index: number;
	focused: boolean;
};

/**
 * Adds chip navigation and cancelable addition and removal to an authored tag list.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/tag-input.contract.json
 */
export default class TagInputController extends Controller<HTMLElement> {
	static targets = ["input", "chip", "remove", "fallback"];
	static values = {
		delimiter: { default: "", type: String },
	};

	declare readonly inputTargets: HTMLInputElement[];
	declare readonly fallbackTargets: HTMLButtonElement[];
	declare readonly chipTargets: HTMLLIElement[];
	declare readonly removeTargets: HTMLButtonElement[];
	declare delimiterValue: string;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private reconcileQueued = false;
	private currentRemove?: HTMLButtonElement;
	private observer?: MutationObserver;
	private pendingRemovals = new Map<HTMLLIElement, PendingRemoval>();

	connect = () => {
		this.connected = true;
		this.enhanced = false;
		this.warningIssued = false;
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.disableEnhancement();
		this.pendingRemovals.clear();
		this.currentRemove = undefined;
	};

	inputTargetConnected = () => this.scheduleReconcile();
	inputTargetDisconnected = () => this.scheduleReconcile();
	fallbackTargetConnected = () => this.scheduleReconcile();
	fallbackTargetDisconnected = () => this.scheduleReconcile();
	chipTargetConnected = () => this.scheduleReconcile();
	chipTargetDisconnected = (chip: HTMLLIElement) => {
		const pending = this.pendingRemovals.get(chip);
		this.pendingRemovals.delete(chip);
		const shouldRestoreFocus =
			pending !== undefined && this.shouldRestoreFocusAfterRemoval(chip, pending);
		const removalIndex = pending?.index ?? -1;
		if (shouldRestoreFocus && pending !== undefined) {
			this.focusAfterRemoval(removalIndex, chip, pending);
		}
		this.scheduleReconcile();
	};
	removeTargetConnected = () => this.scheduleReconcile();
	removeTargetDisconnected = () => this.scheduleReconcile();

	/**
	 * Chip target values in DOM order. Consumers add or remove chip DOM themselves; this controller
	 * does not provide mutation methods.
	 */
	get values() {
		return this.chipTargets.map((chip) => chip.getAttribute("data-tag-input-value") ?? "");
	}

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
					'tag-input controller: Provide at most one input target. Without an input, provide exactly one visible, enabled, tabbable <button type="button"> fallback target outside chips. Name the fallback and each remove target. Use <li> chip targets inside <ul> or <ol>, each with a nonempty data-tag-input-value and exactly one <button type="button"> remove target. Enhancement has been disabled.',
				);
			}
			this.currentRemove = undefined;
			return;
		}

		this.enableEnhancement();
		const enabledRemoves = this.enabledRemoves();
		const current =
			this.currentRemove && enabledRemoves.includes(this.currentRemove)
				? this.currentRemove
				: (enabledRemoves.find((remove) => remove.getAttribute("tabindex") === "0") ??
					enabledRemoves[0]);
		this.currentRemove = current;
		this.syncTabIndexes(current);
	};

	private isValidMarkup = () => {
		if (
			this.inputTargets.length > 1 ||
			this.inputTargets.some(
				(input) => !(input instanceof HTMLInputElement) || !this.element.contains(input),
			) ||
			this.fallbackTargets.length > 1 ||
			(this.inputTargets.length === 0 && this.fallbackTargets.length === 0)
		) {
			return false;
		}
		const fallbackValid = this.fallbackTargets.every(
			(fallback) =>
				fallback instanceof HTMLButtonElement &&
				fallback.type === "button" &&
				!fallback.disabled &&
				!fallback.hidden &&
				fallback.tabIndex >= 0 &&
				this.element.contains(fallback) &&
				!this.chipTargets.some((chip) => chip.contains(fallback)) &&
				this.hasAccessibleNameMaterial(fallback),
		);
		if (!fallbackValid) {
			return false;
		}

		const chipsValid = this.chipTargets.every(
			(chip) =>
				chip instanceof HTMLLIElement &&
				this.element.contains(chip) &&
				(chip.parentElement instanceof HTMLUListElement ||
					chip.parentElement instanceof HTMLOListElement) &&
				(chip.getAttribute("data-tag-input-value") ?? "").trim() !== "" &&
				this.removeTargets.filter((remove) => chip.contains(remove)).length === 1,
		);
		if (!chipsValid || this.removeTargets.length !== this.chipTargets.length) {
			return false;
		}

		return this.removeTargets.every(
			(remove) =>
				remove instanceof HTMLButtonElement &&
				remove.type === "button" &&
				this.element.contains(remove) &&
				this.chipTargets.some((chip) => chip.contains(remove)) &&
				this.hasAccessibleNameMaterial(remove),
		);
	};

	private hasAccessibleNameMaterial = (remove: HTMLButtonElement) =>
		["aria-label", "aria-labelledby"].some((attribute) => {
			const value = remove.getAttribute(attribute);
			return value !== null && value.trim() !== "";
		}) || (remove.textContent ?? "").trim() !== "";

	private enableEnhancement = () => {
		if (this.enhanced) {
			return;
		}

		this.enhanced = true;
		this.element.addEventListener("focusin", this.handleFocusin);
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.observer = new MutationObserver((records) => {
			// Roving focus writes remove tabindex, so revalidate only fallback changes.
			if (
				records.some(
					(record) =>
						record.attributeName !== "tabindex" ||
						this.fallbackTargets.some((fallback) => fallback === record.target),
				)
			) {
				this.scheduleReconcile();
			}
		});
		this.observer.observe(this.element, {
			attributeFilter: [
				"aria-label",
				"aria-labelledby",
				"data-tag-input-target",
				"data-tag-input-value",
				"disabled",
				"hidden",
				"tabindex",
				"type",
			],
			attributes: true,
			subtree: true,
		});
	};

	private disableEnhancement = () => {
		if (!this.enhanced) {
			return;
		}

		this.enhanced = false;
		this.element.removeEventListener("focusin", this.handleFocusin);
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.observer?.disconnect();
		this.observer = undefined;
	};

	private enabledRemoves = () => this.removeTargets.filter((remove) => !remove.disabled);

	private syncTabIndexes = (current: HTMLButtonElement | undefined) => {
		for (const remove of this.removeTargets) {
			remove.setAttribute("tabindex", remove === current ? "0" : "-1");
		}
	};

	private focusRemove = (remove: HTMLButtonElement) => {
		if (remove.disabled) {
			return;
		}
		this.currentRemove = remove;
		this.syncTabIndexes(remove);
		remove.focus();
	};

	private eventInput = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLInputElement =>
					candidate instanceof HTMLInputElement && this.inputTargets.includes(candidate),
			);

	private eventRemove = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLButtonElement =>
					candidate instanceof HTMLButtonElement && this.removeTargets.includes(candidate),
			);

	private chipForRemove = (remove: HTMLButtonElement) =>
		this.chipTargets.find((chip) => chip.contains(remove));

	private handleFocusin = (event: FocusEvent) => {
		if (event.target instanceof Node) {
			for (const [chip, pending] of this.pendingRemovals) {
				pending.focused = chip.contains(event.target);
			}
		}
		if (!this.enhanced) {
			return;
		}
		const remove = this.eventRemove(event);
		if (!remove || remove.disabled) {
			return;
		}
		this.currentRemove = remove;
		this.syncTabIndexes(remove);
	};

	private handleClick = (event: MouseEvent) => {
		if (!this.enhanced || !event.isTrusted) {
			return;
		}
		const remove = this.eventRemove(event);
		if (!remove || remove.disabled) {
			return;
		}
		const chip = this.chipForRemove(remove);
		if (!chip) {
			return;
		}
		this.requestRemove(chip, event.detail > 0 ? "pointer" : "keyboard");
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (isImeKeydown(event)) {
			return;
		}
		if (!this.enhanced) {
			return;
		}

		const input = this.eventInput(event);
		if (input) {
			this.handleInputKeydown(input, event);
			return;
		}

		const remove = this.eventRemove(event);
		if (!remove || remove.disabled) {
			return;
		}
		const chip = this.chipForRemove(remove);
		if (!chip) {
			return;
		}
		this.handleChipKeydown(chip, remove, event);
	};

	private handleInputKeydown = (input: HTMLInputElement, event: KeyboardEvent) => {
		const delta = horizontalArrowDelta(event.key, getComputedStyle(this.element).direction);
		if (delta === -1 && this.isCaretAtStart(input)) {
			const last = this.enabledRemoves().at(-1);
			if (last) {
				event.preventDefault();
				this.focusRemove(last);
			}
			return;
		}

		if (event.key === "Backspace" && input.value === "") {
			const last = this.enabledRemoves().at(-1);
			if (last) {
				event.preventDefault();
				this.focusRemove(last);
			}
			return;
		}

		const isEnter = event.key === "Enter";
		const isDelimiter = this.delimiterValue !== "" && event.key === this.delimiterValue;
		if ((isEnter || isDelimiter) && input.value !== "") {
			event.preventDefault();
			if (!event.isTrusted) {
				return;
			}
			this.requestAdd(input);
		}
	};

	private isCaretAtStart = (input: HTMLInputElement) => {
		try {
			return input.selectionStart === 0 && input.selectionEnd === 0;
		} catch {
			return false;
		}
	};

	private handleChipKeydown = (
		chip: HTMLLIElement,
		remove: HTMLButtonElement,
		event: KeyboardEvent,
	) => {
		const delta = horizontalArrowDelta(event.key, getComputedStyle(this.element).direction);
		if (delta !== undefined) {
			const removes = this.enabledRemoves();
			const index = removes.indexOf(remove);
			if (index < 0) {
				return;
			}
			const nextIndex = index + delta;
			event.preventDefault();
			if (nextIndex >= removes.length) {
				this.inputTargets[0]?.focus();
				return;
			}
			const next = removes[Math.max(0, nextIndex)];
			if (next) {
				this.focusRemove(next);
			}
			return;
		}

		if (event.key === "Home") {
			event.preventDefault();
			const first = this.enabledRemoves()[0];
			if (first) {
				this.focusRemove(first);
			}
			return;
		}

		if (event.key === "End") {
			event.preventDefault();
			const input = this.inputTargets[0];
			if (input) {
				input.focus();
			} else {
				const last = this.enabledRemoves().at(-1);
				if (last) {
					this.focusRemove(last);
				}
			}
			return;
		}

		if (event.key !== "Delete" && event.key !== "Backspace") {
			return;
		}
		if (!event.isTrusted) {
			return;
		}
		event.preventDefault();
		this.requestRemove(chip, "keyboard");
	};

	private requestAdd = (input: HTMLInputElement) => {
		const value = input.value;
		if (value === "") {
			return;
		}

		const detail: TagInputAddDetail = { reason: "keyboard", value };
		const beforeAdd = new CustomEvent<TagInputAddDetail>("tag-input:beforeadd", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		if (!this.element.dispatchEvent(beforeAdd)) {
			return;
		}

		input.value = "";
		this.element.dispatchEvent(
			new CustomEvent<TagInputAddDetail>("tag-input:add", { bubbles: true, detail }),
		);
	};

	private requestRemove = (chip: HTMLLIElement, reason: TagInputRemoveReason) => {
		const value = chip.getAttribute("data-tag-input-value") ?? "";
		if (value.trim() === "") {
			return;
		}

		const detail: TagInputRemoveDetail = { chip, reason, value };
		const beforeRemove = new CustomEvent<TagInputRemoveDetail>("tag-input:beforeremove", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		if (!this.element.dispatchEvent(beforeRemove)) {
			return;
		}

		this.pendingRemovals.set(chip, {
			focused: chip.contains(this.element.ownerDocument.activeElement),
			index: this.chipTargets.indexOf(chip),
		});
		this.element.dispatchEvent(
			new CustomEvent<TagInputRemoveDetail>("tag-input:remove", { bubbles: true, detail }),
		);
	};

	private shouldRestoreFocusAfterRemoval = (chip: HTMLLIElement, pending: PendingRemoval) => {
		if (!pending.focused) {
			return false;
		}

		const ownerDocument = this.element.ownerDocument;
		const activeElement = ownerDocument.activeElement;
		return (
			activeElement === null ||
			activeElement === ownerDocument.body ||
			activeElement === ownerDocument.documentElement ||
			chip.contains(activeElement)
		);
	};

	private focusAfterRemoval = (index: number, chip: HTMLLIElement, pending: PendingRemoval) => {
		queueMicrotask(() => {
			if (!this.connected || !this.enhanced) {
				return;
			}
			if (!this.shouldRestoreFocusAfterRemoval(chip, pending)) {
				return;
			}

			for (
				let chipIndex = Math.max(0, index);
				chipIndex < this.chipTargets.length;
				chipIndex += 1
			) {
				const remove = this.enabledRemoveForChip(this.chipTargets[chipIndex]);
				if (remove) {
					this.focusRemove(remove);
					return;
				}
			}

			for (
				let chipIndex = Math.min(index - 1, this.chipTargets.length - 1);
				chipIndex >= 0;
				chipIndex -= 1
			) {
				const remove = this.enabledRemoveForChip(this.chipTargets[chipIndex]);
				if (remove) {
					this.focusRemove(remove);
					return;
				}
			}

			const fallback = this.inputTargets[0] ?? this.fallbackTargets[0];
			fallback?.focus();
		});
	};

	private enabledRemoveForChip = (chip: HTMLLIElement) =>
		this.removeTargets.find((remove) => chip.contains(remove) && !remove.disabled);
}

export { TagInputController };
