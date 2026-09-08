import { Controller } from "@hotwired/stimulus";
import { createFormResetTasks } from "./internal/form_reset_tasks";
import { hasAccessibleTextName } from "./internal/accessible_text_name";
import { ensureElementId } from "./internal/ensure_element_id";
import { isImeKeydown } from "./internal/ime";

type EditableInput = HTMLInputElement | HTMLTextAreaElement;
type EditableAction = "edit" | "commit" | "cancel";
type UserReason = "pointer" | "keyboard";

export type EditableChangeDetail = {
	value: string;
	previousValue: string;
	reason: UserReason;
};

type EditableElements = {
	preview: HTMLElement;
	editor: HTMLElement;
	input: EditableInput;
	edit: HTMLButtonElement;
	save: HTMLButtonElement;
	cancel: HTMLButtonElement;
};

/**
 * Coordinates preview, editing, saving, and canceling for an authored native text editor.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/editable.contract.json
 */
export default class EditableController extends Controller<HTMLElement> {
	static targets = ["preview", "editor", "input", "edit", "save", "cancel"];
	declare readonly previewTargets: HTMLElement[];
	declare readonly editorTargets: HTMLElement[];
	declare readonly inputTargets: HTMLElement[];
	declare readonly editTargets: HTMLElement[];
	declare readonly saveTargets: HTMLElement[];
	declare readonly cancelTargets: HTMLElement[];

	private resetTasks = createFormResetTasks();
	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private reconcileQueued = false;
	private currentEditing = false;
	private committedValue = "";
	private revision = 0;
	private elements?: EditableElements;
	private original?: {
		previewHidden: string | null;
		editorHidden: string | null;
		editExpanded: string | null;
	};
	private observer?: MutationObserver;
	private boundDocument?: Document;
	private boundForm: HTMLFormElement | null = null;

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.boundDocument = this.element.ownerDocument;
		this.boundDocument.addEventListener("reset", this.handleFormReset, true);
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: [
				"type",
				"disabled",
				"readonly",
				"aria-label",
				"aria-labelledby",
				"id",
				"form",
				"for",
			],
		});
		this.reconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.enhanced = false;
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.boundDocument?.removeEventListener("reset", this.handleFormReset, true);
		this.boundDocument = undefined;
		this.observer?.disconnect();
		this.observer = undefined;
		this.releaseElements();
	};

	previewTargetConnected = () => this.scheduleReconcile();
	previewTargetDisconnected = () => this.scheduleReconcile();
	editorTargetConnected = () => this.scheduleReconcile();
	editorTargetDisconnected = () => this.scheduleReconcile();
	inputTargetConnected = () => this.scheduleReconcile();
	inputTargetDisconnected = () => this.scheduleReconcile();
	editTargetConnected = () => this.scheduleReconcile();
	editTargetDisconnected = () => this.scheduleReconcile();
	saveTargetConnected = () => this.scheduleReconcile();
	saveTargetDisconnected = () => this.scheduleReconcile();
	cancelTargetConnected = () => this.scheduleReconcile();
	cancelTargetDisconnected = () => this.scheduleReconcile();

	/**
	 * Committed value: the native input value while viewing, or the value at edit start while
	 * editing. Assignment updates both committed value and draft without events and preserves edit
	 * mode. Invalid or disconnected reads return an empty string and writes do nothing.
	 */
	get value(): string {
		if (!this.enhanced || !this.elements) {
			return "";
		}
		return this.currentEditing ? this.committedValue : this.elements.input.value;
	}

	/**
	 * Committed value: the native input value while viewing, or the value at edit start while
	 * editing. Assignment updates both committed value and draft without events and preserves edit
	 * mode. Invalid or disconnected reads return an empty string and writes do nothing.
	 */
	set value(value: string) {
		if (!this.ensureEnhanced() || !this.elements) {
			return;
		}
		this.revision += 1;
		this.elements.input.value = value;
		this.committedValue = this.elements.input.value;
	}

	/**
	 * Whether the field is in edit mode.
	 */
	get editing(): boolean {
		return this.currentEditing;
	}

	/**
	 * Starts editing and focuses the input without custom events. Returns false when already
	 * editing, markup is invalid, or the input is disabled or readonly.
	 *
	 * @returns Whether the operation succeeded.
	 */
	edit = () => this.perform("edit");
	/**
	 * Commits the draft and returns to viewing when native checkValidity succeeds, without custom
	 * events. Returns false when not editing, the input is disabled or readonly, or validation
	 * fails.
	 *
	 * @returns Whether the operation succeeded.
	 */
	commit = () => this.perform("commit");
	/**
	 * Restores the committed value from edit start and returns to viewing without custom events.
	 * Returns false when not editing.
	 *
	 * @returns Whether the operation succeeded.
	 */
	cancel = () => this.perform("cancel");

	private isAttached = () =>
		this.connected &&
		this.element.isConnected &&
		(this.element.getAttribute("data-controller") ?? "").split(/\s+/).includes(this.identifier);

	private ensureEnhanced = () => {
		if (!this.isAttached()) {
			return false;
		}
		this.reconcile();
		return this.enhanced;
	};

	private hasInputName = (input: EditableInput) => {
		const references = (input.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
		if (
			references.some((id) => input.ownerDocument.getElementById(id) !== null) ||
			(input.getAttribute("aria-label") ?? "").trim() !== ""
		) {
			return hasAccessibleTextName(input, false);
		}
		return Array.from(input.labels ?? []).some(
			(label) => label.control === input && hasAccessibleTextName(label, true),
		);
	};

	private readElements = (): EditableElements | undefined => {
		const targets = [
			this.previewTargets,
			this.editorTargets,
			this.inputTargets,
			this.editTargets,
			this.saveTargets,
			this.cancelTargets,
		];
		if (!targets.every((group) => group.length === 1)) {
			return undefined;
		}
		const [preview] = this.previewTargets;
		const [editor] = this.editorTargets;
		const [input] = this.inputTargets;
		const [edit] = this.editTargets;
		const [save] = this.saveTargets;
		const [cancel] = this.cancelTargets;
		if (
			!(preview instanceof HTMLElement) ||
			!(editor instanceof HTMLElement) ||
			!(
				(input instanceof HTMLInputElement && input.type === "text") ||
				input instanceof HTMLTextAreaElement
			) ||
			!(edit instanceof HTMLButtonElement) ||
			!(save instanceof HTMLButtonElement) ||
			!(cancel instanceof HTMLButtonElement)
		) {
			return undefined;
		}
		const elements = { preview, editor, input, edit, save, cancel };
		if (
			new Set(Object.values(elements)).size !== 6 ||
			!Object.values(elements).every(
				(element) => element !== this.element && this.element.contains(element),
			) ||
			preview.contains(editor) ||
			editor.contains(preview) ||
			!preview.contains(edit) ||
			![input, save, cancel].every((element) => editor.contains(element)) ||
			![edit, save, cancel].every(
				(button) => button.type === "button" && hasAccessibleTextName(button, true),
			) ||
			!this.hasInputName(input)
		) {
			return undefined;
		}
		return elements;
	};

	private scheduleReconcile = () => {
		if (!this.connected || this.reconcileQueued) {
			return;
		}
		this.reconcileQueued = true;
		queueMicrotask(() => {
			this.reconcileQueued = false;
			if (this.isAttached()) {
				this.reconcile();
			}
		});
	};

	private reconcile = () => {
		const elements = this.readElements();
		if (!elements) {
			this.enhanced = false;
			this.releaseElements();
			if (!this.warningIssued) {
				this.warningIssued = true;
				console.warn(
					"editable controller: Provide exactly one preview, editor, and named text input or textarea, with one button type=button edit target in preview and one save and cancel target in editor. Enhancement has been disabled.",
				);
			}
			return;
		}
		if (
			!this.elements ||
			Object.values(elements).some(
				(element, index) => element !== Object.values(this.elements ?? {})[index],
			)
		) {
			this.releaseElements();
			this.elements = elements;
			this.original = {
				previewHidden: elements.preview.getAttribute("hidden"),
				editorHidden: elements.editor.getAttribute("hidden"),
				editExpanded: elements.edit.getAttribute("aria-expanded"),
			};
			this.committedValue = elements.input.value;
			elements.input.addEventListener("invalid", this.handleInvalid);
		}
		this.enhanced = true;
		if (this.boundForm !== elements.input.form) {
			this.revision += 1;
			this.boundForm = elements.input.form;
		}
		if (!elements.edit.hasAttribute("aria-controls")) {
			elements.edit.setAttribute(
				"aria-controls",
				ensureElementId(elements.editor, "editable-editor"),
			);
			if (!this.completionWarningIssued) {
				this.completionWarningIssued = true;
				console.warn("editable controller: Added aria-controls. Include them in your markup.");
			}
		}
		this.syncState();
	};

	private restoreAttribute = (element: HTMLElement, name: string, value: string | null) => {
		if (value === null) {
			element.removeAttribute(name);
		} else {
			element.setAttribute(name, value);
		}
	};

	private releaseElements = () => {
		this.resetTasks.cancel();
		this.revision += 1;
		if (this.elements) {
			if (this.currentEditing) {
				this.elements.input.value = this.committedValue;
			}
			this.elements.input.removeEventListener("invalid", this.handleInvalid);
			if (this.original) {
				this.restoreAttribute(this.elements.preview, "hidden", this.original.previewHidden);
				this.restoreAttribute(this.elements.editor, "hidden", this.original.editorHidden);
				this.restoreAttribute(this.elements.edit, "aria-expanded", this.original.editExpanded);
			}
		}
		this.boundForm = null;
		this.currentEditing = false;
		this.elements = undefined;
		this.original = undefined;
		this.element.removeAttribute("data-state");
	};

	private canPerform = (action: EditableAction, elements: EditableElements) => {
		if ((action === "edit") === this.currentEditing) {
			return false;
		}
		return (
			action === "cancel" || (!elements.input.matches(":disabled") && !elements.input.readOnly)
		);
	};

	private perform = (action: EditableAction, reason?: UserReason) => {
		if (!this.ensureEnhanced() || !this.elements) {
			return false;
		}
		const elements = this.elements;
		const button = action === "commit" ? elements.save : elements[action];
		if (!this.canPerform(action, elements) || (reason && button.matches(":disabled"))) {
			return false;
		}
		if (
			action === "commit" &&
			!(reason ? elements.input.reportValidity() : elements.input.checkValidity())
		) {
			return false;
		}
		const draft = elements.input.value;
		const value = action === "cancel" ? this.committedValue : draft;
		const previousValue = action === "commit" ? this.committedValue : draft;
		const active = this.element.ownerDocument.activeElement;
		if (reason) {
			const revision = this.revision;
			const detail = { value, previousValue, reason } satisfies EditableChangeDetail;
			const event = this.dispatch(`before${action}`, { detail, bubbles: true, cancelable: true });
			if (
				event.defaultPrevented ||
				!this.ensureEnhanced() ||
				this.elements !== elements ||
				revision !== this.revision ||
				elements.input.value !== draft ||
				!this.canPerform(action, elements) ||
				button.matches(":disabled")
			) {
				return false;
			}
			if (action === "commit" && !elements.input.reportValidity()) {
				return false;
			}
		}
		const changed =
			action === "edit"
				? this.commitEdit(this.element.ownerDocument.activeElement === active)
				: this.commitFinish(value, true);
		if (changed && reason) {
			this.dispatch(action, {
				detail: { value, previousValue, reason } satisfies EditableChangeDetail,
				bubbles: true,
				cancelable: false,
			});
		}
		return changed;
	};

	private commitEdit = (focus: boolean) => {
		const elements = this.elements;
		if (!elements) {
			return false;
		}
		const revision = ++this.revision;
		this.committedValue = elements.input.value;
		this.currentEditing = true;
		this.syncState();
		if (focus) {
			elements.input.focus();
		}
		return (
			this.ensureEnhanced() &&
			this.elements === elements &&
			revision === this.revision &&
			this.currentEditing
		);
	};

	private commitFinish = (value: string, focus: boolean) => {
		const elements = this.elements;
		if (!elements) {
			return false;
		}
		const active = this.element.ownerDocument.activeElement;
		const restoreFocus =
			active === this.element.ownerDocument.body ||
			(active !== null && elements.editor.contains(active));
		const revision = ++this.revision;
		elements.input.value = value;
		this.committedValue = elements.input.value;
		this.currentEditing = false;
		this.syncState();
		if (focus && restoreFocus) {
			elements.edit.focus();
		}
		return (
			this.ensureEnhanced() &&
			this.elements === elements &&
			revision === this.revision &&
			!this.currentEditing &&
			elements.input.value === value
		);
	};

	private syncState = () => {
		if (!this.elements) {
			return;
		}
		this.element.dataset.state = this.currentEditing ? "editing" : "viewing";
		this.elements.preview.hidden = this.currentEditing;
		this.elements.editor.hidden = !this.currentEditing;
		this.elements.edit.setAttribute("aria-expanded", String(this.currentEditing));
	};

	private handleClick = (event: MouseEvent) => {
		if (
			!event.isTrusted ||
			event.defaultPrevented ||
			!this.ensureEnhanced() ||
			!this.elements ||
			!(event.target instanceof Node)
		) {
			return;
		}
		const reason = event.detail === 0 ? "keyboard" : "pointer";
		for (const action of ["edit", "commit", "cancel"] as const) {
			const button = action === "commit" ? this.elements.save : this.elements[action];
			if (button.contains(event.target)) {
				this.perform(action, reason);
				return;
			}
		}
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (
			!event.isTrusted ||
			event.defaultPrevented ||
			isImeKeydown(event) ||
			!this.ensureEnhanced() ||
			!this.elements ||
			event.target !== this.elements.input ||
			!this.currentEditing
		) {
			return;
		}
		const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
		const multilineCommit =
			this.elements.input instanceof HTMLTextAreaElement &&
			!event.altKey &&
			!event.shiftKey &&
			event.ctrlKey !== event.metaKey;
		if (event.key === "Escape" && plain) {
			event.preventDefault();
			this.perform("cancel", "keyboard");
		} else if (
			event.key === "Enter" &&
			((plain && this.elements.input instanceof HTMLInputElement) || multilineCommit)
		) {
			event.preventDefault();
			this.perform("commit", "keyboard");
		}
	};

	private handleInvalid = (event: Event) => {
		if (
			event.isTrusted &&
			!this.currentEditing &&
			this.ensureEnhanced() &&
			event.target === this.elements?.input
		) {
			this.commitEdit(false);
		}
	};

	private handleFormReset = (event: Event) => {
		if (!event.isTrusted || !this.ensureEnhanced() || event.target !== this.boundForm) {
			return;
		}
		const form = this.boundForm;
		const revision = this.revision;
		this.resetTasks.schedule(() => {
			if (
				!event.defaultPrevented &&
				this.ensureEnhanced() &&
				this.boundForm === form &&
				this.revision === revision &&
				this.elements
			) {
				this.commitFinish(this.elements.input.value, false);
			}
		});
	};
}
