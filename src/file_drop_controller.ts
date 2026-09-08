import { Controller } from "@hotwired/stimulus";

export type FileDropDetail = {
	files: File[];
};

/**
 * Adds file dropping and drag-over state to an authored native file-input control.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/file-drop.contract.json
 */
export default class FileDropController extends Controller<HTMLElement> {
	static targets = ["input"];

	declare readonly inputTargets: HTMLElement[];

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private reconcileQueued = false;
	private dragDepth = 0;
	private rootStateOwned = false;

	connect = () => {
		this.connected = true;
		this.enhanced = false;
		this.warningIssued = false;
		this.dragDepth = 0;
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.disableEnhancement();
		this.dragDepth = 0;
		this.reconcileQueued = false;
	};

	inputTargetConnected = () => this.scheduleReconcile();
	inputTargetDisconnected = () => this.scheduleReconcile();

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
			this.clearGeneratedState();
			this.dragDepth = 0;
			this.warnInvalidMarkup();
			return;
		}

		this.enableEnhancement();
	};

	private enableEnhancement = () => {
		if (this.enhanced) {
			return;
		}

		this.enhanced = true;
		this.dragDepth = 0;
		this.element.addEventListener("dragenter", this.handleDragenter);
		this.element.addEventListener("dragover", this.handleDragover);
		this.element.addEventListener("dragleave", this.handleDragleave);
		this.element.addEventListener("drop", this.handleDrop);
		this.syncState();
	};

	private disableEnhancement = () => {
		if (!this.enhanced) {
			return;
		}

		this.enhanced = false;
		this.element.removeEventListener("dragenter", this.handleDragenter);
		this.element.removeEventListener("dragover", this.handleDragover);
		this.element.removeEventListener("dragleave", this.handleDragleave);
		this.element.removeEventListener("drop", this.handleDrop);
		this.dragDepth = 0;
	};

	private isValidMarkup = () => {
		if (!(this.element instanceof HTMLElement) || this.element instanceof HTMLInputElement) {
			return false;
		}

		return (
			this.inputTargets.length === 1 &&
			this.inputTargets[0] instanceof HTMLInputElement &&
			this.inputTargets[0].type === "file"
		);
	};

	private nativeInput = () => {
		const input = this.inputTargets[0];
		return input instanceof HTMLInputElement && input.type === "file" ? input : null;
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'file-drop controller: Use an HTMLElement root other than HTMLInputElement and exactly one native <input type="file"> input target. Enhancement has been disabled.',
		);
	};

	private isFileDrag = (event: DragEvent) =>
		Array.from(event.dataTransfer?.types ?? []).includes("Files");

	private resetDragState = () => {
		this.dragDepth = 0;
		if (this.enhanced) {
			this.syncState();
		}
	};

	private syncState = () => {
		const state = this.dragDepth > 0 ? "dragover" : "idle";
		this.element.dataset.state = state;
		this.rootStateOwned = true;
	};

	private clearGeneratedState = () => {
		if (!this.rootStateOwned) {
			return;
		}
		delete this.element.dataset.state;
		this.rootStateOwned = false;
	};

	private handleDragenter = (event: DragEvent) => {
		if (!this.connected || !this.enhanced || !this.isFileDrag(event)) {
			return;
		}

		const input = this.nativeInput();
		if (input === null || input.disabled) {
			this.resetDragState();
			return;
		}

		event.preventDefault();
		this.dragDepth += 1;
		this.syncState();
	};

	private handleDragover = (event: DragEvent) => {
		if (!this.connected || !this.enhanced || !this.isFileDrag(event)) {
			return;
		}

		const input = this.nativeInput();
		if (input === null || input.disabled) {
			this.resetDragState();
			return;
		}

		event.preventDefault();
		this.syncState();
	};

	private handleDragleave = (event: DragEvent) => {
		if (!this.connected || !this.enhanced || !this.isFileDrag(event)) {
			return;
		}

		const input = this.nativeInput();
		if (input === null || input.disabled) {
			this.resetDragState();
			return;
		}

		this.dragDepth = Math.max(0, this.dragDepth - 1);
		this.syncState();
	};

	private handleDrop = (event: DragEvent) => {
		if (!this.connected || !this.enhanced || !this.isFileDrag(event)) {
			return;
		}

		event.preventDefault();
		this.resetDragState();

		const input = this.nativeInput();
		if (input === null) {
			return;
		}
		if (input.disabled) {
			return;
		}

		const dataTransfer = event.dataTransfer;
		if (dataTransfer === null) {
			return;
		}
		const files = Array.from(dataTransfer.files);
		if (files.length === 0) {
			return;
		}
		if (!input.multiple && files.length > 1) {
			return;
		}

		const detail: FileDropDetail = { files };
		const beforeDrop = new CustomEvent<FileDropDetail>("file-drop:beforedrop", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		if (!this.element.dispatchEvent(beforeDrop)) {
			return;
		}
		if (!this.connected || !this.enhanced || this.nativeInput() !== input || input.disabled) {
			return;
		}

		input.files = dataTransfer.files;
		this.element.dispatchEvent(
			new CustomEvent<FileDropDetail>("file-drop:drop", {
				bubbles: true,
				detail,
			}),
		);
	};
}
