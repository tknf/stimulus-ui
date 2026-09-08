import { press, required, requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const calendars = requiredAll<HTMLElement>(main, '[data-controller="calendar"]');
		const single = calendars[0];
		if (single === undefined) throw new Error("Missing single calendar");
		const day = required<HTMLButtonElement>(single, '[data-calendar-value="2026-09-11"]');

		await userEvent.click(day);
		day.focus();
		await press(userEvent, [
			"ArrowLeft",
			"ArrowRight",
			"ArrowUp",
			"ArrowDown",
			"Enter",
			"Space",
			"Home",
			"End",
			"PageUp",
			"PageDown",
			"Tab",
		]);
		await settle();
	},
	skips: [],
};
