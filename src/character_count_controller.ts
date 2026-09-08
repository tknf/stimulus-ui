import { Controller } from "@hotwired/stimulus";
import { createFormResetTasks } from "./internal/form_reset_tasks";

import { ensureElementId } from "./internal/ensure_element_id";

type CharacterCountField = HTMLInputElement | HTMLTextAreaElement;

type MaxResolution = {
	hasLimit: boolean;
	value: number;
};

/**
 * Exposes a native text field's length, effective limit, and overflow state to CSS.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/character-count.contract.json
 */
export default class CharacterCountController extends Controller<HTMLElement> {
	static targets = ["field", "counter"];
	static values = {
		max: { type: Number, default: 0 },
	};

	declare readonly fieldTargets: HTMLElement[];
	declare readonly counterTargets: HTMLElement[];
	declare maxValue: number;

	private resetTasks = createFormResetTasks();
	private connected = false;
	private enhanced = false;
	private reconcileQueued = false;
	private warningIssued = false;
	private boundField: CharacterCountField | null = null;
	private boundForm: HTMLFormElement | null = null;
	private rootStateOwned = false;
	private generatedPropertiesOwned = false;
	private describedByWiring: {
		field: CharacterCountField;
		counterId: string;
		authored: boolean;
	} | null = null;

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.disableEnhancement();
		this.reconcileQueued = false;
	};

	fieldTargetConnected = () => this.scheduleReconcile();
	fieldTargetDisconnected = () => this.scheduleReconcile();
	counterTargetConnected = () => this.scheduleReconcile();
	counterTargetDisconnected = () => this.scheduleReconcile();
	maxValueChanged = () => this.scheduleReconcile();

	/**
	 * Current field length in UTF-16 code units. Returns zero when field markup is invalid.
	 */
	get length(): number {
		if (!this.isValidMarkup()) {
			return 0;
		}
		return this.currentField()?.value.length ?? 0;
	}

	/**
	 * Effective length limit, or zero when no limit applies.
	 */
	get max(): number {
		const field = this.currentField();
		if (field === null || !this.isValidMarkup()) {
			return 0;
		}
		return this.resolveMax(field).value;
	}

	/**
	 * Whether an effective limit exists and the current length exceeds it.
	 */
	get over(): boolean {
		if (!this.isValidMarkup()) {
			return false;
		}
		const field = this.currentField();
		if (field === null) {
			return false;
		}
		const max = this.resolveMax(field);
		return max.hasLimit && field.value.length > max.value;
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
			this.clearGeneratedOutputs();
			this.clearDescribedByWiring();
			this.warnInvalidMarkup();
			return;
		}

		this.disableEnhancement();
		this.enableEnhancement();
	};

	private enableEnhancement = () => {
		if (this.enhanced) {
			return;
		}

		const field = this.currentField();
		if (field === null) {
			return;
		}

		this.enhanced = true;
		field.addEventListener("input", this.handleInput);
		this.boundField = field;

		const form = field.form;
		if (form !== null) {
			form.addEventListener("reset", this.handleFormReset);
			this.boundForm = form;
		}

		this.syncState();
		this.applyCounterWiring();
	};

	private disableEnhancement = () => {
		this.resetTasks.cancel();
		if (!this.enhanced && this.boundField === null && this.boundForm === null) {
			return;
		}

		this.enhanced = false;
		this.boundField?.removeEventListener("input", this.handleInput);
		this.boundForm?.removeEventListener("reset", this.handleFormReset);
		this.boundField = null;
		this.boundForm = null;
	};

	private isValidMarkup = () => {
		const field = this.currentField();
		return (
			field !== null &&
			this.counterTargets.length <= 1 &&
			this.counterTargets.every((counter) => this.isDescendant(counter))
		);
	};

	private currentField = (): CharacterCountField | null => {
		if (this.fieldTargets.length !== 1) {
			return null;
		}
		const field = this.fieldTargets[0];
		return field !== undefined && this.isSupportedField(field) && this.isDescendant(field)
			? field
			: null;
	};

	private isSupportedField = (element: HTMLElement): element is CharacterCountField => {
		if (element.tagName === "TEXTAREA") {
			return element instanceof HTMLTextAreaElement;
		}
		if (element.tagName !== "INPUT" || !(element instanceof HTMLInputElement)) {
			return false;
		}

		return ["text", "search", "url", "tel", "email", "password"].includes(element.type);
	};

	private isDescendant = (element: HTMLElement) =>
		element !== this.element && this.element.contains(element);

	private resolveMax = (field: CharacterCountField): MaxResolution => {
		const rawMaxLength = field.getAttribute("maxlength");
		if (rawMaxLength !== null) {
			const value = Number(rawMaxLength);
			return Number.isInteger(value) && value >= 0
				? { hasLimit: true, value }
				: { hasLimit: false, value: 0 };
		}

		return Number.isFinite(this.maxValue) && this.maxValue > 0
			? { hasLimit: true, value: this.maxValue }
			: { hasLimit: false, value: 0 };
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			"character-count controller: Provide exactly one <textarea> or input[type=text|search|url|tel|email|password] field target inside the root and at most one counter target. Enhancement has been disabled.",
		);
	};

	private handleInput = (event: Event) => {
		if (!this.connected || !this.enhanced || event.target !== this.boundField) {
			return;
		}
		this.syncState();
	};

	private handleFormReset = () => {
		this.resetTasks.schedule(() => {
			if (!this.connected || !this.enhanced) {
				return;
			}
			this.syncState();
		});
	};

	private syncState = () => {
		if (!this.enhanced) {
			return;
		}
		const field = this.currentField();
		if (field === null || !this.isValidMarkup()) {
			return;
		}

		const value = field.value.length;
		const max = this.resolveMax(field);
		this.element.style.setProperty("--character-count-value", String(value));
		if (max.hasLimit) {
			this.element.style.setProperty("--character-count-max", String(max.value));
		} else {
			this.element.style.removeProperty("--character-count-max");
		}
		this.generatedPropertiesOwned = true;

		if (max.hasLimit && value > max.value) {
			this.element.dataset.state = "over";
			this.rootStateOwned = true;
		} else {
			delete this.element.dataset.state;
			this.rootStateOwned = false;
		}
	};

	private clearGeneratedOutputs = () => {
		if (this.rootStateOwned) {
			delete this.element.dataset.state;
			this.rootStateOwned = false;
		}
		if (!this.generatedPropertiesOwned) {
			return;
		}

		this.element.style.removeProperty("--character-count-value");
		this.element.style.removeProperty("--character-count-max");
		this.generatedPropertiesOwned = false;
	};

	private applyCounterWiring = () => {
		const field = this.currentField();
		const counter = this.counterTargets.length === 1 ? this.counterTargets[0] : undefined;
		if (field === null || counter === undefined) {
			this.clearDescribedByWiring();
			return;
		}

		const counterId = ensureElementId(counter, "character-count-counter");
		const currentTokens = new Set(
			(field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean),
		);
		if (
			this.describedByWiring?.field === field &&
			this.describedByWiring.counterId === counterId &&
			currentTokens.has(counterId)
		) {
			return;
		}

		this.clearDescribedByWiring();
		const describedBy = new Set(
			(field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean),
		);
		const authored = describedBy.has(counterId);
		describedBy.add(counterId);
		field.setAttribute("aria-describedby", [...describedBy].join(" "));
		this.describedByWiring = { field, counterId, authored };
	};

	private clearDescribedByWiring = () => {
		const wiring = this.describedByWiring;
		if (wiring === null) {
			return;
		}
		this.describedByWiring = null;
		if (wiring.authored) {
			return;
		}

		const describedBy = new Set(
			(wiring.field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean),
		);
		describedBy.delete(wiring.counterId);
		if (describedBy.size === 0) {
			wiring.field.removeAttribute("aria-describedby");
		} else {
			wiring.field.setAttribute("aria-describedby", [...describedBy].join(" "));
		}
	};
}
