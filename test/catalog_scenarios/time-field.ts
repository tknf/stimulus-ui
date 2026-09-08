import { press, required, syncInput, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const field = required<HTMLInputElement>(main, '[data-controller="time-field"]');

		syncInput(field, "09:00");
		syncInput(field, "18:00");
		syncInput(field, "12:00");
		field.focus();
		await userEvent.keyboard("{ArrowUp}");
		await press(userEvent, ["PageUp", "PageDown"]);
		const focusAway = document.createElement("button");
		focusAway.type = "button";
		main.append(focusAway);
		focusAway.focus();
		await settle();
	},
	skips: [],
};
