import { Controller } from "@hotwired/stimulus";
import ComboboxController from "../../src/combobox_controller";
import DialogController from "../../src/dialog_controller";

// Consumer-owned search and command execution; this controller is not distributed.
export default class PaletteDemoController extends Controller {
	static targets = ["input", "option", "group", "empty", "result", "trigger"];
	static outlets = ["combobox", "dialog"];
	declare readonly inputTarget: HTMLInputElement;
	declare readonly optionTargets: HTMLLIElement[];
	declare readonly groupTargets: HTMLElement[];
	declare readonly emptyTarget: HTMLElement;
	declare readonly resultTarget: HTMLOutputElement;
	declare readonly triggerTarget: HTMLButtonElement;
	declare readonly comboboxOutlet: ComboboxController;
	declare readonly dialogOutlet: DialogController;

	reset = () => {
		this.comboboxOutlet.value = "";
		this.filter();
	};

	filter = () => {
		const query = this.inputTarget.value.trim();
		for (const option of this.optionTargets) {
			option.hidden = !(option.textContent ?? "").includes(query);
		}
		for (const group of this.groupTargets) {
			group.hidden = !this.optionTargets.some((option) => group.contains(option) && !option.hidden);
		}
		const empty = this.optionTargets.every((option) => option.hidden);
		this.emptyTarget.hidden = !empty;
		this.comboboxOutlet.open = !empty;
	};

	execute = (event: Event) => {
		if (!(event instanceof CustomEvent)) return;
		const detail: unknown = event.detail;
		if (typeof detail !== "object" || detail === null || !("value" in detail)) return;
		if (typeof detail.value !== "string") return;
		this.resultTarget.value = detail.value;
		this.dialogOutlet.close();
		this.triggerTarget.focus();
	};
}
