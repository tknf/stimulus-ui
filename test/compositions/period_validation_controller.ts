import { Controller } from "@hotwired/stimulus";

// Consumer validation for two fixed inputs requiring the end to be at or after the start.
export default class PeriodValidationController extends Controller<HTMLFormElement> {
	static targets = ["start", "end", "message"];
	declare readonly startTarget: HTMLInputElement;
	declare readonly endTarget: HTMLInputElement;
	declare readonly messageTarget: HTMLElement;
	private connected = false;
	private resetTimer?: ReturnType<typeof setTimeout>;

	connect = () => {
		this.connected = true;
		this.sync();
	};

	disconnect = () => {
		this.connected = false;
		clearTimeout(this.resetTimer);
		this.endTarget.setCustomValidity("");
	};

	sync = () => {
		const reversed = this.startTarget.valueAsNumber > this.endTarget.valueAsNumber;
		this.endTarget.setCustomValidity(
			reversed ? (this.messageTarget.textContent?.trim() ?? "") : "",
		);
	};

	reset = (event: Event) => {
		clearTimeout(this.resetTimer);
		// Trusted reset-button microtasks can run before native value restoration.
		this.resetTimer = setTimeout(() => {
			if (this.connected && !event.defaultPrevented) this.sync();
		}, 0);
	};
}
