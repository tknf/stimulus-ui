import { Controller } from "@hotwired/stimulus";

// A fixed two-step consumer tour; dialog owns opening, closing, and focus containment.
export default class TourDemoController extends Controller<HTMLElement> {
	static targets = ["step", "heading", "previous", "next"];
	declare readonly stepTargets: HTMLElement[];
	declare readonly headingTargets: HTMLElement[];
	declare readonly previousTarget: HTMLButtonElement;
	declare readonly nextTarget: HTMLButtonElement;
	private index = 0;

	connect = () => this.render();
	reset = () => {
		this.index = 0;
		this.render();
	};
	previous = () => this.move(-1);
	next = () => this.move(1);
	focusStep = () => this.headingTargets[this.index]?.focus();

	private move = (delta: number) => {
		const next = Math.max(0, Math.min(this.stepTargets.length - 1, this.index + delta));
		if (next === this.index) return;
		this.index = next;
		this.render();
		this.focusStep();
	};

	private render = () => {
		for (const [index, step] of this.stepTargets.entries()) step.hidden = index !== this.index;
		this.previousTarget.disabled = this.index === 0;
		this.nextTarget.disabled = this.index === this.stepTargets.length - 1;
		this.element.dataset.step = String(this.index);
	};
}
