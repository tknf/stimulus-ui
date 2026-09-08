import { Controller } from "@hotwired/stimulus";
import EditableController from "../../src/editable_controller";

// Add editing, key isolation, and display updates only to consumer-selected cells.
export default class CellEditDemoController extends Controller<HTMLTableCellElement> {
	static targets = ["text"];
	static outlets = ["editable"];
	declare readonly textTarget: HTMLElement;
	declare readonly editableOutlet: EditableController;

	keydown = (event: KeyboardEvent) => {
		if (event.target !== this.element) {
			// After editable handles the event, stop propagation to table navigation.
			event.stopPropagation();
			return;
		}
		if (
			!event.isTrusted ||
			event.defaultPrevented ||
			event.isComposing ||
			event.keyCode === 229 ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			event.shiftKey ||
			event.key !== "Enter"
		)
			return;
		event.preventDefault();
		event.stopPropagation();
		this.editableOutlet.edit();
	};

	finish = (event: Event) => {
		if (event.target !== this.editableOutlet.element || this.editableOutlet.editing) return;
		this.textTarget.textContent = this.editableOutlet.value;
		if (
			this.element.isConnected &&
			this.element.contains(this.element.ownerDocument.activeElement)
		) {
			this.element.focus();
		}
	};
}
