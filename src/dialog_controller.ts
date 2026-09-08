import { Controller } from "@hotwired/stimulus";

import { ensureElementId } from "./internal/ensure_element_id";
import { isImeKeydown } from "./internal/ime";

type UserReason = "keyboard" | "pointer";

export type DialogOpenDetail = {
	reason: UserReason;
};

export type DialogCloseDetail = {
	reason: UserReason;
	returnValue: string;
};

/** Non-modal dialog rectangle in percentages of its container, not pixels. */
export type DialogBounds = {
	/** Distance from the container's inline-start edge; clamped to 0..100-width. */
	x: number;
	/** Distance from the container's top edge; clamped to 0..100-height. */
	y: number;
	/** Width as a percentage of container width; clamped to minWidth..100. */
	width: number;
	/** Height as a percentage of container height; clamped to minHeight..100. */
	height: number;
};
export type DialogChangeDetail = {
	reason: UserReason;
	operation: "move" | "resize" | "set";
	bounds: DialogBounds;
	previousBounds: DialogBounds;
};
type PanelMarkup = {
	container: HTMLElement;
	move: HTMLButtonElement;
	resize: HTMLButtonElement;
	apply: HTMLButtonElement;
	instructions: HTMLElement;
	x: HTMLInputElement;
	y: HTMLInputElement;
	width: HTMLInputElement;
	height: HTMLInputElement;
};
type PanelDrag = {
	id: number;
	handle: HTMLButtonElement;
	operation: "move" | "resize";
	x: number;
	y: number;
	width: number;
	height: number;
	rtl: boolean;
	initial: DialogBounds;
	preview: DialogBounds;
};
const boundsFields = ["x", "y", "width", "height"] as const;
const finiteBounds = (value: unknown): value is DialogBounds =>
	typeof value === "object" &&
	value !== null &&
	boundsFields.every((field) => {
		const fieldValue: unknown = Reflect.get(value, field);
		return typeof fieldValue === "number" && Number.isFinite(fieldValue);
	});
const sameBounds = (left: DialogBounds, right: DialogBounds) =>
	boundsFields.every((field) => left[field] === right[field]);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Controls native modal dialogs and movable, resizable non-modal dialog panels.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/dialog.contract.json
 */
export default class DialogController extends Controller<HTMLElement> {
	static targets = [
		"dialog",
		"trigger",
		"close",
		"title",
		"container",
		"move",
		"resize",
		"apply",
		"instructions",
		"xControl",
		"yControl",
		"widthControl",
		"heightControl",
	];
	static values = {
		open: { default: false, type: Boolean },
		modal: { default: true, type: Boolean },
		x: { default: 0, type: Number },
		y: { default: 0, type: Number },
		width: { default: 50, type: Number },
		height: { default: 50, type: Number },
		minWidth: { default: 10, type: Number },
		minHeight: { default: 10, type: Number },
		step: { default: 1, type: Number },
	};

	declare readonly dialogTargets: HTMLElement[];
	declare readonly triggerTargets: HTMLElement[];
	declare readonly closeTargets: HTMLElement[];
	declare readonly titleTargets: HTMLElement[];
	declare readonly openValue: boolean;
	declare readonly modalValue: boolean;
	declare readonly xValue: number;
	declare readonly yValue: number;
	declare readonly widthValue: number;
	declare readonly heightValue: number;
	declare readonly minWidthValue: number;
	declare readonly minHeightValue: number;
	declare readonly stepValue: number;
	declare readonly containerTargets: HTMLElement[];
	declare readonly moveTargets: HTMLElement[];
	declare readonly resizeTargets: HTMLElement[];
	declare readonly applyTargets: HTMLElement[];
	declare readonly instructionsTargets: HTMLElement[];
	declare readonly xControlTargets: HTMLElement[];
	declare readonly yControlTargets: HTMLElement[];
	declare readonly widthControlTargets: HTMLElement[];
	declare readonly heightControlTargets: HTMLElement[];
	private panel: PanelMarkup | null = null;
	private panelBounds: DialogBounds = { x: 0, y: 0, width: 50, height: 50 };
	private drag: PanelDrag | null = null;
	private revision = 0;
	private shouldApplyBoundsValue = true;
	private activeModal = true;
	private requestingBounds = false;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private reconcileQueued = false;
	private shouldApplyOpenValue = true;
	private boundDialog: HTMLDialogElement | null = null;
	private boundTriggers: HTMLElement[] = [];
	private lastTrigger: HTMLButtonElement | null = null;
	private pendingUserClose: DialogCloseDetail | null = null;

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.shouldApplyOpenValue = true;
		this.shouldApplyBoundsValue = true;
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.element.addEventListener("pointerdown", this.handlePanelPointerdown);
		this.element.addEventListener("pointermove", this.handlePanelPointermove);
		this.element.addEventListener("pointerup", this.handlePanelPointerup);
		this.element.addEventListener("pointercancel", this.handlePanelPointercancel);
		this.element.addEventListener("lostpointercapture", this.handlePanelPointercancel);
		this.element.ownerDocument.defaultView?.addEventListener("blur", this.cancelDrag);
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.element.removeEventListener("pointerdown", this.handlePanelPointerdown);
		this.element.removeEventListener("pointermove", this.handlePanelPointermove);
		this.element.removeEventListener("pointerup", this.handlePanelPointerup);
		this.element.removeEventListener("pointercancel", this.handlePanelPointercancel);
		this.element.removeEventListener("lostpointercapture", this.handlePanelPointercancel);
		this.element.ownerDocument.defaultView?.removeEventListener("blur", this.cancelDrag);
		this.cancelDrag();
		this.panel = null;
		const dialog = this.boundDialog;
		this.unbindDialog();
		if (dialog?.open) {
			dialog.close();
		}
		this.pendingUserClose = null;
		this.lastTrigger = null;
		this.boundTriggers = [];
		this.enhanced = false;
	};

	dialogTargetConnected = () => this.scheduleReconcile();
	dialogTargetDisconnected = () => this.scheduleReconcile();
	triggerTargetConnected = () => this.scheduleReconcile();
	triggerTargetDisconnected = (trigger: HTMLElement) => {
		if (this.lastTrigger === trigger) {
			this.lastTrigger = null;
		}
		this.scheduleReconcile();
	};
	closeTargetConnected = () => this.scheduleReconcile();
	closeTargetDisconnected = () => this.scheduleReconcile();
	titleTargetConnected = () => this.scheduleReconcile();
	titleTargetDisconnected = () => this.scheduleReconcile();
	openValueChanged = () => {
		this.shouldApplyOpenValue = true;
		this.scheduleReconcile();
	};
	containerTargetConnected = () => this.scheduleReconcile();
	containerTargetDisconnected = () => this.scheduleReconcile();
	moveTargetConnected = () => this.scheduleReconcile();
	moveTargetDisconnected = () => this.scheduleReconcile();
	resizeTargetConnected = () => this.scheduleReconcile();
	resizeTargetDisconnected = () => this.scheduleReconcile();
	applyTargetConnected = () => this.scheduleReconcile();
	applyTargetDisconnected = () => this.scheduleReconcile();
	instructionsTargetConnected = () => this.scheduleReconcile();
	instructionsTargetDisconnected = () => this.scheduleReconcile();
	xControlTargetConnected = () => this.scheduleReconcile();
	xControlTargetDisconnected = () => this.scheduleReconcile();
	yControlTargetConnected = () => this.scheduleReconcile();
	yControlTargetDisconnected = () => this.scheduleReconcile();
	widthControlTargetConnected = () => this.scheduleReconcile();
	widthControlTargetDisconnected = () => this.scheduleReconcile();
	heightControlTargetConnected = () => this.scheduleReconcile();
	heightControlTargetDisconnected = () => this.scheduleReconcile();
	modalValueChanged = () => this.scheduleReconcile();
	xValueChanged = () => this.boundsValueChanged();
	yValueChanged = () => this.boundsValueChanged();
	widthValueChanged = () => this.boundsValueChanged();
	heightValueChanged = () => this.boundsValueChanged();
	minWidthValueChanged = () => this.scheduleReconcile();
	minHeightValueChanged = () => this.scheduleReconcile();
	stepValueChanged = () => this.scheduleReconcile();
	private boundsValueChanged = () => {
		this.shouldApplyBoundsValue = true;
		this.scheduleReconcile();
	};
	/**
	 * Copy of the committed non-modal rectangle. Assignment requires four finite numbers, clamps
	 * size to its minimum through 100 and position to the remaining area, and cancels dragging
	 * without notifications. Invalid values, modal mode, and disconnected writes are ignored.
	 * Initial Stimulus values are not rewritten.
	 */
	get bounds(): DialogBounds {
		return { ...this.panelBounds };
	}
	/**
	 * Copy of the committed non-modal rectangle. Assignment requires four finite numbers, clamps
	 * size to its minimum through 100 and position to the remaining area, and cancels dragging
	 * without notifications. Invalid values, modal mode, and disconnected writes are ignored.
	 * Initial Stimulus values are not rewritten.
	 */
	set bounds(value: DialogBounds) {
		if (!this.ensureEnhanced() || this.panel === null || !finiteBounds(value)) {
			return;
		}
		this.cancelDrag();
		this.commitBounds(this.normalizeBounds(value));
	}

	/**
	 * Whether the native dialog is open. Assignment delegates to show or close without custom
	 * events; native dialog focus behavior still applies.
	 */
	get open() {
		return this.currentDialog()?.open ?? false;
	}

	/**
	 * Whether the native dialog is open. Assignment delegates to show or close without custom
	 * events; native dialog focus behavior still applies.
	 */
	set open(value: boolean) {
		if (value) {
			this.show();
		} else {
			this.close();
		}
	}

	/**
	 * Opens the native dialog using showModal in modal mode or show in non-modal mode. Synchronizes
	 * ARIA and state without custom events. Native dialog focus behavior applies.
	 *
	 * @returns No return value.
	 */
	show = () => {
		this.cancelDrag();
		if (!this.ensureEnhanced()) {
			return;
		}
		const dialog = this.currentDialog();
		if (dialog === null) {
			return;
		}
		if (!dialog.open) {
			try {
				if (this.modalValue) {
					dialog.showModal();
				} else {
					dialog.show();
				}
			} catch {
				return;
			}
		}
		this.syncState(dialog);
	};

	/**
	 * Closes the native dialog with the supplied return value, defaulting to an empty string. Does
	 * not emit custom events. Native dialog focus restoration applies.
	 *
	 * @returns No return value.
	 */
	close = (returnValue = "") => {
		this.cancelDrag();
		if (!this.ensureEnhanced()) {
			return;
		}
		const dialog = this.currentDialog();
		if (dialog === null || !dialog.open) {
			return;
		}
		this.pendingUserClose = null;
		dialog.close(returnValue);
		this.syncState(dialog);
	};

	/**
	 * Toggles the native dialog through show or close without custom events. Native dialog focus
	 * behavior applies.
	 *
	 * @returns No return value.
	 */
	toggle = () => {
		if (this.open) {
			this.close();
		} else {
			this.show();
		}
	};

	private scheduleReconcile = () => {
		this.cancelDrag();
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
		this.cancelDrag();
		if (this.activeModal !== this.modalValue) {
			this.pendingUserClose = null;
			const previousDialog = this.boundDialog;
			if (previousDialog?.open) {
				previousDialog.close();
				this.syncState(previousDialog, this.boundTriggers);
			}
			this.shouldApplyOpenValue = true;
			this.activeModal = this.modalValue;
		}
		if (!this.isValidMarkup()) {
			if (this.panel !== null && this.boundDialog?.open) {
				this.pendingUserClose = null;
				this.boundDialog.close();
				this.syncState(this.boundDialog, this.boundTriggers);
			}
			this.panel = null;
			this.enhanced = false;
			this.unbindDialog();
			this.warnInvalidMarkup();
			return;
		}

		const dialog = this.nativeDialogTarget();
		if (dialog === null) {
			return;
		}
		this.enhanced = true;
		this.boundTriggers = [...this.triggerTargets];
		this.panel = this.modalValue ? null : this.panelMarkup(dialog);
		this.bindDialog(dialog);
		const completionAttributes = this.applyStructure(dialog);
		if (this.panel !== null) {
			this.applyPanelStructure(this.panel, completionAttributes);
			const value = this.shouldApplyBoundsValue ? this.initialBounds() : this.panelBounds;
			this.shouldApplyBoundsValue = false;
			this.commitBounds(this.normalizeBounds(value));
		} else {
			for (const field of boundsFields) {
				dialog.style.removeProperty(`--dialog-${field}`);
			}
		}

		if (this.shouldApplyOpenValue) {
			this.shouldApplyOpenValue = false;
			if (this.openValue) {
				this.show();
			} else if (dialog.open) {
				dialog.close();
			}
		}
		this.syncState(dialog);
		this.warnCompletion(completionAttributes);
	};

	private ensureEnhanced = () => {
		if (!this.enhanced && this.connected) {
			this.reconcile();
		}
		return this.enhanced;
	};

	private currentDialog = () => {
		if (!this.enhanced) {
			return null;
		}
		return this.nativeDialogTarget();
	};

	private nativeDialogTarget = () => {
		if (this.dialogTargets.length !== 1) {
			return null;
		}
		const dialog = this.dialogTargets[0];
		return dialog instanceof HTMLDialogElement ? dialog : null;
	};

	private isValidMarkup = () => {
		const dialog = this.nativeDialogTarget();
		if (dialog === null || this.triggerTargets.length === 0 || this.titleTargets.length > 1) {
			return false;
		}

		const triggersValid = this.triggerTargets.every(
			(target) => target instanceof HTMLButtonElement && target.type === "button",
		);
		const closeTargetsValid = this.closeTargets.every(
			(target) => target instanceof HTMLButtonElement && target.type === "button",
		);
		const title = this.titleTargets[0];
		const titleValid = title === undefined || dialog.contains(title);
		const ariaLabel = dialog.getAttribute("aria-label");
		const ariaLabelledBy = dialog.getAttribute("aria-labelledby");
		const hasName =
			(ariaLabel !== null && ariaLabel.trim() !== "") ||
			(ariaLabelledBy !== null && ariaLabelledBy.trim() !== "") ||
			title !== undefined;
		return triggersValid && closeTargetsValid && titleValid && hasName && this.validPanel(dialog);
	};

	private initialBounds = (): DialogBounds => ({
		x: this.xValue,
		y: this.yValue,
		width: this.widthValue,
		height: this.heightValue,
	});

	private panelMarkup = (dialog: HTMLDialogElement): PanelMarkup | null => {
		const groups = [
			this.containerTargets,
			this.moveTargets,
			this.resizeTargets,
			this.applyTargets,
			this.instructionsTargets,
			this.xControlTargets,
			this.yControlTargets,
			this.widthControlTargets,
			this.heightControlTargets,
		];
		if (groups.some((targets) => targets.length !== 1)) {
			return null;
		}
		const [container] = this.containerTargets;
		const [move] = this.moveTargets;
		const [resize] = this.resizeTargets;
		const [apply] = this.applyTargets;
		const [instructions] = this.instructionsTargets;
		const [x] = this.xControlTargets;
		const [y] = this.yControlTargets;
		const [width] = this.widthControlTargets;
		const [height] = this.heightControlTargets;
		if (
			!(container instanceof HTMLElement) ||
			!(instructions instanceof HTMLElement) ||
			!(move instanceof HTMLButtonElement) ||
			!(resize instanceof HTMLButtonElement) ||
			!(apply instanceof HTMLButtonElement) ||
			!(x instanceof HTMLInputElement) ||
			!(y instanceof HTMLInputElement) ||
			!(width instanceof HTMLInputElement) ||
			!(height instanceof HTMLInputElement)
		) {
			return null;
		}
		const elements = [move, resize, apply, instructions, x, y, width, height];
		if (
			new Set([container, ...elements]).size !== 9 ||
			container !== dialog.parentElement ||
			elements.some((element) => element === dialog || !dialog.contains(element))
		) {
			return null;
		}
		return { container, move, resize, apply, instructions, x, y, width, height };
	};

	private hasPanelName = (element: HTMLElement) => {
		const labelledBy = element.getAttribute("aria-labelledby");
		if (labelledBy !== null) {
			const ids = labelledBy.trim().split(/\s+/).filter(Boolean);
			return (
				ids.length > 0 &&
				ids.every((id) => Boolean(element.ownerDocument.getElementById(id)?.textContent?.trim()))
			);
		}
		if (element.hasAttribute("aria-label")) {
			return Boolean(element.getAttribute("aria-label")?.trim());
		}
		if (element instanceof HTMLInputElement) {
			return Array.from(element.labels ?? []).some(
				(label) => label.control === element && Boolean(label.textContent?.trim()),
			);
		}
		return Boolean(element.textContent?.trim());
	};

	private validPanel = (dialog: HTMLDialogElement) => {
		if (this.modalValue) {
			return [
				this.containerTargets,
				this.moveTargets,
				this.resizeTargets,
				this.applyTargets,
				this.instructionsTargets,
				this.xControlTargets,
				this.yControlTargets,
				this.widthControlTargets,
				this.heightControlTargets,
			].every((targets) => targets.length === 0);
		}
		const panel = this.panelMarkup(dialog);
		if (panel === null || !finiteBounds(this.initialBounds())) {
			return false;
		}
		if (
			![this.minWidthValue, this.minHeightValue, this.stepValue].every(
				(value) => Number.isFinite(value) && value > 0 && value <= 100,
			)
		) {
			return false;
		}
		if (
			![null, "dialog"].includes(dialog.getAttribute("role")) ||
			![null, "false"].includes(dialog.getAttribute("aria-modal")) ||
			![null, "none"].includes(dialog.getAttribute("closedby"))
		) {
			return false;
		}
		const view = dialog.ownerDocument.defaultView;
		if (
			view === null ||
			view.getComputedStyle(dialog).direction !==
				view.getComputedStyle(panel.container).direction ||
			view.getComputedStyle(panel.container).writingMode !== "horizontal-tb" ||
			view.getComputedStyle(dialog).writingMode !== "horizontal-tb"
		) {
			return false;
		}
		if (
			![panel.move, panel.resize, panel.apply].every(
				(button) =>
					button.type === "button" && !button.matches(":disabled") && this.hasPanelName(button),
			)
		) {
			return false;
		}
		if (
			!boundsFields.every((field) => {
				const input = panel[field];
				return (
					input.type === "number" &&
					!input.readOnly &&
					!input.matches(":disabled") &&
					!input.hasAttribute("min") &&
					!input.hasAttribute("max") &&
					(!input.hasAttribute("step") || input.step === "any") &&
					this.hasPanelName(input)
				);
			})
		) {
			return false;
		}
		return Boolean(panel.instructions.textContent?.trim());
	};

	private applyPanelStructure = (panel: PanelMarkup, completed: string[]) => {
		const id = ensureElementId(panel.instructions, "dialog-instructions");
		for (const handle of [panel.move, panel.resize]) {
			const ids = (handle.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
			if (!ids.includes(id)) {
				handle.setAttribute("aria-describedby", [...ids, id].join(" "));
			}
		}
		for (const field of boundsFields) {
			const input = panel[field];
			if (!input.hasAttribute("step")) {
				input.step = "any";
				completed.push(`${field}Control: step`);
			}
			if (!input.required) {
				input.required = true;
				completed.push(`${field}Control: required`);
			}
		}
	};

	private normalizeBounds = (value: DialogBounds): DialogBounds => {
		const width = clamp(value.width, this.minWidthValue, 100);
		const height = clamp(value.height, this.minHeightValue, 100);
		return { x: clamp(value.x, 0, 100 - width), y: clamp(value.y, 0, 100 - height), width, height };
	};

	private syncBounds = (value = this.panelBounds) => {
		const dialog = this.boundDialog;
		const panel = this.panel;
		if (dialog === null || panel === null) {
			return;
		}
		for (const field of boundsFields) {
			dialog.style.setProperty(`--dialog-${field}`, String(value[field]));
			panel[field].value = String(value[field]);
		}
	};

	private commitBounds = (value: DialogBounds) => {
		this.revision++;
		this.panelBounds = { ...value };
		this.syncBounds();
	};

	private usablePanel = () => {
		const panel = this.panel;
		if (
			!this.connected ||
			!this.element.isConnected ||
			!this.enhanced ||
			this.modalValue ||
			!this.open ||
			panel === null
		) {
			return null;
		}
		const dialog = this.currentDialog();
		const current = dialog === null ? null : this.panelMarkup(dialog);
		if (
			dialog === null ||
			current === null ||
			!this.validPanel(dialog) ||
			Object.keys(current).some((key) => Reflect.get(current, key) !== Reflect.get(panel, key))
		) {
			this.cancelDrag();
			this.scheduleReconcile();
			return null;
		}
		return this.panel;
	};

	private requestBounds = (
		candidate: DialogBounds,
		reason: UserReason,
		operation: DialogChangeDetail["operation"],
	) => {
		if (this.requestingBounds || this.usablePanel() === null) {
			return;
		}
		const value = this.normalizeBounds(candidate);
		this.syncBounds();
		if (sameBounds(value, this.panelBounds)) {
			return;
		}
		const revision = this.revision;
		const configuration = this.panelConfiguration();
		const panel = this.panel;
		const previousBounds = this.bounds;
		const detail = (): DialogChangeDetail => ({
			reason,
			operation,
			bounds: { ...value },
			previousBounds: { ...previousBounds },
		});
		this.requestingBounds = true;
		let accepted: boolean;
		try {
			accepted = this.element.dispatchEvent(
				new CustomEvent<DialogChangeDetail>("dialog:beforechange", {
					bubbles: true,
					cancelable: true,
					detail: detail(),
				}),
			);
		} finally {
			this.requestingBounds = false;
		}
		if (
			!accepted ||
			revision !== this.revision ||
			configuration !== this.panelConfiguration() ||
			this.usablePanel() !== panel
		) {
			return;
		}
		this.commitBounds(value);
		this.element.dispatchEvent(
			new CustomEvent<DialogChangeDetail>("dialog:change", { bubbles: true, detail: detail() }),
		);
	};
	private panelConfiguration = () =>
		JSON.stringify([
			this.modalValue,
			this.openValue,
			this.initialBounds(),
			this.minWidthValue,
			this.minHeightValue,
			this.stepValue,
		]);

	private offsetBounds = (
		value: DialogBounds,
		operation: "move" | "resize",
		x: number,
		y: number,
	): DialogBounds => {
		if (operation === "move") {
			return this.normalizeBounds({ ...value, x: value.x + x, y: value.y + y });
		}
		return {
			...value,
			width: clamp(value.width + x, this.minWidthValue, 100 - value.x),
			height: clamp(value.height + y, this.minHeightValue, 100 - value.y),
		};
	};

	private cancelDrag = () => {
		this.revision++;
		const drag = this.drag;
		this.drag = null;
		if (drag !== null) {
			if (drag.handle.hasPointerCapture(drag.id)) {
				drag.handle.releasePointerCapture(drag.id);
			}
			this.syncBounds();
		}
	};

	private handlePanelPointerdown = (event: PointerEvent) => {
		if (!event.isTrusted || !event.isPrimary || event.button !== 0 || this.drag !== null) {
			return;
		}
		const panel = this.usablePanel();
		if (panel === null) {
			return;
		}
		const handle = this.eventButton(event, [panel.move, panel.resize]);
		if (handle === undefined || handle.matches(":disabled")) {
			return;
		}
		const rect = panel.container.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return;
		}
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			return;
		}
		const revision = this.revision;
		handle.focus();
		if (revision !== this.revision || this.usablePanel() !== panel) {
			if (handle.hasPointerCapture(event.pointerId)) {
				handle.releasePointerCapture(event.pointerId);
			}
			return;
		}
		event.preventDefault();
		this.drag = {
			id: event.pointerId,
			handle,
			operation: handle === panel.move ? "move" : "resize",
			x: event.clientX,
			y: event.clientY,
			width: rect.width,
			height: rect.height,
			rtl: getComputedStyle(panel.container).direction === "rtl",
			initial: this.bounds,
			preview: this.bounds,
		};
	};

	private updateDrag = (event: PointerEvent) => {
		const drag = this.drag;
		if (drag === null || !event.isTrusted || event.pointerId !== drag.id) {
			return null;
		}
		const panel = this.usablePanel();
		if (panel === null) {
			return null;
		}
		const rect = panel.container.getBoundingClientRect();
		if (
			rect.width !== drag.width ||
			rect.height !== drag.height ||
			(getComputedStyle(panel.container).direction === "rtl") !== drag.rtl
		) {
			this.cancelDrag();
			return null;
		}
		drag.preview = this.offsetBounds(
			drag.initial,
			drag.operation,
			((event.clientX - drag.x) / drag.width) * 100 * (drag.rtl ? -1 : 1),
			((event.clientY - drag.y) / drag.height) * 100,
		);
		return drag;
	};

	private handlePanelPointermove = (event: PointerEvent) => {
		const drag = this.updateDrag(event);
		if (drag !== null) {
			event.preventDefault();
			this.syncBounds(drag.preview);
		}
	};

	private handlePanelPointerup = (event: PointerEvent) => {
		const drag = this.updateDrag(event);
		if (drag === null) {
			return;
		}
		this.cancelDrag();
		this.requestBounds(drag.preview, "pointer", drag.operation);
	};

	private handlePanelPointercancel = (event: PointerEvent) => {
		if (event.isTrusted && event.pointerId === this.drag?.id) {
			this.cancelDrag();
		}
	};

	private handlePanelKeydown = (event: KeyboardEvent) => {
		if (
			!event.isTrusted ||
			event.defaultPrevented ||
			isImeKeydown(event) ||
			event.ctrlKey ||
			event.altKey ||
			event.metaKey
		) {
			return false;
		}
		const panel = this.usablePanel();
		if (
			panel === null ||
			!this.boundDialog?.contains(event.target instanceof Node ? event.target : null)
		) {
			return false;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			if (this.drag !== null) {
				this.cancelDrag();
			} else {
				this.requestClose("keyboard", "");
			}
			return true;
		}
		if (event.key === "Enter" && boundsFields.some((field) => event.target === panel[field])) {
			event.preventDefault();
			return true;
		}
		const handle = this.eventButton(event, [panel.move, panel.resize]);
		if (
			handle === undefined ||
			handle.matches(":disabled") ||
			!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
		) {
			return false;
		}
		event.preventDefault();
		this.cancelDrag();
		const step = this.stepValue * (event.shiftKey ? 10 : 1);
		const rtl = getComputedStyle(panel.container).direction === "rtl";
		const x =
			(event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0) * (rtl ? -1 : 1);
		const y = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
		const operation = handle === panel.move ? "move" : "resize";
		this.requestBounds(this.offsetBounds(this.panelBounds, operation, x, y), "keyboard", operation);
		return true;
	};

	private handlePanelClick = (event: MouseEvent) => {
		const panel = this.usablePanel();
		if (panel === null || this.eventButton(event, [panel.apply]) === undefined) {
			return false;
		}
		const reason = this.keyboardActivationTarget === panel.apply ? "keyboard" : "pointer";
		this.keyboardActivationTarget = null;
		if (!event.isTrusted || panel.apply.matches(":disabled")) {
			return true;
		}
		this.cancelDrag();
		for (const field of boundsFields) {
			if (!Number.isFinite(panel[field].valueAsNumber) || !panel[field].checkValidity()) {
				panel[field].reportValidity();
				return true;
			}
		}
		this.requestBounds(
			{
				x: panel.x.valueAsNumber,
				y: panel.y.valueAsNumber,
				width: panel.width.valueAsNumber,
				height: panel.height.valueAsNumber,
			},
			reason,
			"set",
		);
		return true;
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'dialog controller: Provide exactly one native <dialog> dialog target and one or more native <button type="button"> trigger targets. Optional close targets must be native <button type="button"> elements. Provide at most one title target inside the named dialog. Non-modal dialogs require container, move, resize, apply, and instructions targets, four labeled number inputs, and finite settings as specified in the contract. Enhancement has been disabled.',
		);
	};

	private applyStructure = (dialog: HTMLDialogElement) => {
		const completionAttributes: string[] = [];
		const dialogId = ensureElementId(dialog, "dialog");
		const title = this.titleTargets[0];
		if (
			title !== undefined &&
			!dialog.hasAttribute("aria-label") &&
			!dialog.hasAttribute("aria-labelledby")
		) {
			dialog.setAttribute("aria-labelledby", ensureElementId(title, "dialog-title"));
			completionAttributes.push("aria-labelledby");
		}
		for (const trigger of this.triggerTargets) {
			const controlsMissing = !trigger.hasAttribute("aria-controls");
			if (!trigger.hasAttribute("aria-controls")) {
				trigger.setAttribute("aria-controls", dialogId);
			}
			if (controlsMissing) {
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
		console.warn(`dialog controller: Added ${attributes.join(", ")}. Include them in your markup.`);
	};

	private syncState = (dialog: HTMLDialogElement, triggers = this.triggerTargets) => {
		const state = dialog.open ? "open" : "closed";
		this.element.dataset.state = state;
		dialog.dataset.state = state;
		for (const trigger of triggers) {
			trigger.dataset.state = state;
			trigger.setAttribute("aria-expanded", String(dialog.open));
		}
	};

	private bindDialog = (dialog: HTMLDialogElement) => {
		if (this.boundDialog === dialog) {
			return;
		}
		this.unbindDialog();
		dialog.addEventListener("cancel", this.handleCancel);
		dialog.addEventListener("close", this.handleNativeClose);
		this.boundDialog = dialog;
	};

	private unbindDialog = () => {
		this.boundDialog?.removeEventListener("cancel", this.handleCancel);
		this.boundDialog?.removeEventListener("close", this.handleNativeClose);
		this.boundDialog = null;
	};

	private eventButton = (event: Event, targets: HTMLElement[]) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLButtonElement =>
					candidate instanceof HTMLButtonElement && targets.includes(candidate),
			);

	private handleClick = (event: MouseEvent) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		if (this.handlePanelClick(event)) {
			return;
		}
		const trigger = this.eventButton(event, this.triggerTargets);
		if (trigger !== undefined) {
			if (trigger.disabled || this.open) {
				return;
			}
			if (!event.isTrusted) {
				this.keyboardActivationTarget = null;
				this.show();
				return;
			}
			const reason = this.keyboardActivationTarget === trigger ? "keyboard" : "pointer";
			this.keyboardActivationTarget = null;
			this.requestOpen(reason, trigger);
			return;
		}

		const close = this.eventButton(event, this.closeTargets);
		if (close === undefined || close.disabled || !this.open) {
			return;
		}
		if (!event.isTrusted) {
			this.keyboardActivationTarget = null;
			this.close();
			return;
		}
		const reason = this.keyboardActivationTarget === close ? "keyboard" : "pointer";
		this.keyboardActivationTarget = null;
		this.requestClose(reason, "");
	};

	private keyboardActivationTarget: HTMLButtonElement | null = null;

	private handleKeydown = (event: KeyboardEvent) => {
		if (
			!event.isTrusted ||
			event.defaultPrevented ||
			isImeKeydown(event) ||
			event.ctrlKey ||
			event.altKey ||
			event.metaKey
		) {
			return;
		}
		if (this.handlePanelKeydown(event)) {
			return;
		}
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}
		const button = this.eventButton(event, [
			...this.triggerTargets,
			...this.closeTargets,
			...this.applyTargets,
		]);
		if (button !== undefined) {
			this.keyboardActivationTarget = button;
		}
	};

	private requestOpen = (reason: UserReason, trigger: HTMLButtonElement) => {
		const dialog = this.currentDialog();
		if (dialog === null || dialog.open) {
			return;
		}
		const beforeOpen = new CustomEvent<DialogOpenDetail>("dialog:beforeopen", {
			bubbles: true,
			cancelable: true,
			detail: { reason },
		});
		if (!this.element.dispatchEvent(beforeOpen)) {
			return;
		}
		this.lastTrigger = trigger;
		this.show();
		if (dialog.open) {
			this.element.dispatchEvent(
				new CustomEvent<DialogOpenDetail>("dialog:open", {
					bubbles: true,
					detail: { reason },
				}),
			);
		}
	};

	private requestClose = (reason: UserReason, returnValue: string) => {
		const dialog = this.currentDialog();
		if (dialog === null || !dialog.open) {
			return;
		}
		const detail: DialogCloseDetail = { reason, returnValue };
		const beforeClose = new CustomEvent<DialogCloseDetail>("dialog:beforeclose", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		if (!this.element.dispatchEvent(beforeClose)) {
			return;
		}
		this.cancelDrag();
		this.pendingUserClose = detail;
		dialog.close(returnValue);
	};

	private handleCancel = (event: Event) => {
		if (!event.isTrusted) {
			return;
		}
		event.preventDefault();
		if (this.drag !== null) {
			this.cancelDrag();
			return;
		}
		this.requestClose("keyboard", "");
	};

	private handleNativeClose = () => {
		const dialog = this.boundDialog;
		if (dialog?.open !== false) {
			return;
		}
		this.cancelDrag();
		const pending = this.pendingUserClose;
		this.pendingUserClose = null;
		this.syncState(dialog);
		if (pending === null) {
			return;
		}

		const trigger = this.lastTrigger;
		if (
			this.activeModal &&
			trigger !== null &&
			trigger.isConnected &&
			!trigger.disabled &&
			this.element.contains(trigger)
		) {
			trigger.focus();
		}
		this.element.dispatchEvent(
			new CustomEvent<DialogCloseDetail>("dialog:close", {
				bubbles: true,
				detail: { reason: pending.reason, returnValue: dialog.returnValue },
			}),
		);
	};
}

export { DialogController };
