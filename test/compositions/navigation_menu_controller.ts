import { Controller } from "@hotwired/stimulus";
import DisclosureController from "../../src/disclosure_controller";

// Optional consumer hover/exit behavior; keep the panel beside its trigger inside details.
export default class NavigationDemoController extends Controller {
	static targets = ["trigger"];
	static outlets = ["disclosure"];
	declare readonly triggerTarget: HTMLElement;
	declare readonly disclosureOutlet: DisclosureController;

	enter = (event: PointerEvent) => {
		if (!event.isTrusted || event.pointerType !== "mouse") return;
		this.disclosureOutlet.show();
	};

	leave = (event: FocusEvent | PointerEvent) => {
		if (!event.isTrusted) return;
		if (
			event instanceof PointerEvent &&
			this.element.contains(this.element.ownerDocument.activeElement)
		)
			return;
		if (event.relatedTarget instanceof Node && this.element.contains(event.relatedTarget)) return;
		this.disclosureOutlet.hide();
	};

	escape = (event: KeyboardEvent) => {
		if (
			!event.isTrusted ||
			event.isComposing ||
			event.keyCode === 229 ||
			!this.disclosureOutlet.open
		)
			return;
		event.preventDefault();
		if (this.element.contains(this.element.ownerDocument.activeElement)) this.triggerTarget.focus();
		this.disclosureOutlet.hide();
	};
}
