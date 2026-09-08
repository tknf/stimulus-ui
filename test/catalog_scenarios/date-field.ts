import { press, required, syncInput, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const field = required<HTMLInputElement>(main, '[data-controller="date-field"]');

		syncInput(field, "2026-01-01");
		syncInput(field, "2026-12-31");
		syncInput(field, "2026-09-02");
		field.min = "2020-01-01";
		field.max = "2030-12-31";
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
