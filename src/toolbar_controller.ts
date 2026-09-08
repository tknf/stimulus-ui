import { Controller } from "@hotwired/stimulus";

import { horizontalArrowDelta, wrapNavigationIndex } from "./internal/roving_navigation";

/**
 * Provides roving keyboard focus among authored toolbar controls.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/toolbar.contract.json
 */
export default class ToolbarController extends Controller<HTMLElement> {
	static targets = ["control"];
	static values = {
		orientation: { default: "horizontal", type: String },
	};

	declare readonly controlTargets: HTMLElement[];
	declare orientationValue: string;

	private connected = false;
	private enhanced = false;
	private reconcileQueued = false;
	private warningIssued = false;
	private currentControl?: HTMLElement;
	private observer?: MutationObserver;
	private managedOrientation = false;

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.disableEnhancement();
	};

	controlTargetConnected = () => this.scheduleReconcile();
	controlTargetDisconnected = () => this.scheduleReconcile();
	orientationValueChanged = () => this.scheduleReconcile();

	/**
	 * Current roving-tabindex Tab stop, or undefined when no enabled control is available.
	 */
	get activeControl() {
		return this.currentControl && this.isEnabled(this.currentControl)
			? this.currentControl
			: undefined;
	}

	/**
	 * Focuses the first enabled control. Does nothing when no destination is available.
	 *
	 * @returns No return value.
	 */
	focusFirst = () => {
		if (!this.enhanced) {
			return;
		}
		const first = this.enabledControls()[0];
		if (first) {
			this.focusControl(first);
		}
	};

	/**
	 * Focuses the last enabled control. Does nothing when no destination is available.
	 *
	 * @returns No return value.
	 */
	focusLast = () => {
		if (!this.enhanced) {
			return;
		}
		const controls = this.enabledControls();
		const last = controls.at(-1);
		if (last) {
			this.focusControl(last);
		}
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
					"toolbar controller: Provide one or more control targets inside the root and set orientation to horizontal or vertical. Enhancement has been disabled.",
				);
			}
			this.currentControl = undefined;
			return;
		}

		this.enableEnhancement();
		this.applyStructure();

		const controls = this.enabledControls();
		const current =
			this.currentControl && controls.includes(this.currentControl)
				? this.currentControl
				: (controls.find((control) => control.getAttribute("tabindex") === "0") ?? controls[0]);
		this.currentControl = current;
		this.syncTabIndexes(current);
	};

	private isValidMarkup = () =>
		(this.orientationValue === "horizontal" || this.orientationValue === "vertical") &&
		this.controlTargets.length > 0 &&
		this.controlTargets.every((control) => this.element.contains(control));

	private enableEnhancement = () => {
		if (this.enhanced) {
			return;
		}

		this.enhanced = true;
		this.element.addEventListener("focusin", this.handleFocusin);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, {
			attributeFilter: ["aria-disabled", "disabled"],
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
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.observer?.disconnect();
		this.observer = undefined;
	};

	private applyStructure = () => {
		if (!this.element.hasAttribute("role")) {
			this.element.setAttribute("role", "toolbar");
		}

		if (this.orientationValue === "vertical") {
			if (!this.element.hasAttribute("aria-orientation")) {
				this.element.setAttribute("aria-orientation", "vertical");
				this.managedOrientation = true;
			}
		} else if (this.managedOrientation) {
			this.element.removeAttribute("aria-orientation");
			this.managedOrientation = false;
		}
	};

	private isEnabled = (control: HTMLElement) => {
		const disabled = Reflect.get(control, "disabled");
		if (typeof disabled === "boolean") {
			return !disabled;
		}
		return control.getAttribute("aria-disabled") !== "true";
	};

	private enabledControls = () => this.controlTargets.filter((control) => this.isEnabled(control));

	private syncTabIndexes = (active: HTMLElement | undefined) => {
		for (const control of this.controlTargets) {
			control.setAttribute("tabindex", control === active ? "0" : "-1");
		}
	};

	private focusControl = (control: HTMLElement) => {
		if (!this.isEnabled(control)) {
			return;
		}
		this.currentControl = control;
		this.syncTabIndexes(control);
		control.focus();
	};

	private eventControl = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLElement =>
					candidate instanceof HTMLElement && this.controlTargets.includes(candidate),
			);

	private handleFocusin = (event: FocusEvent) => {
		const control = this.eventControl(event);
		if (!control || !this.isEnabled(control)) {
			return;
		}
		this.currentControl = control;
		this.syncTabIndexes(control);
	};

	private handleKeydown = (event: KeyboardEvent) => {
		const control = this.eventControl(event);
		if (!control || !this.isEnabled(control)) {
			return;
		}

		const controls = this.enabledControls();
		const index = controls.indexOf(control);
		if (index < 0) {
			return;
		}

		let nextIndex: number | undefined;
		if (event.key === "Home") {
			nextIndex = 0;
		}
		if (event.key === "End") {
			nextIndex = controls.length - 1;
		}

		const direction = getComputedStyle(this.element).direction;
		const delta =
			this.orientationValue === "vertical"
				? event.key === "ArrowUp"
					? -1
					: event.key === "ArrowDown"
						? 1
						: undefined
				: horizontalArrowDelta(event.key, direction);
		if (delta !== undefined) {
			nextIndex = wrapNavigationIndex(index + delta, controls.length);
		}
		if (nextIndex === undefined) {
			return;
		}

		event.preventDefault();
		const next = controls[nextIndex];
		if (next) {
			this.focusControl(next);
		}
	};
}

export { ToolbarController };
