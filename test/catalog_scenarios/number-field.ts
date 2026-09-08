import { press, required, syncInput, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const field = required<HTMLInputElement>(main, '[data-controller="number-field"]');

		syncInput(field, "0");
		syncInput(field, "100");
		syncInput(field, "10");
		field.focus();
		await press(userEvent, ["PageUp", "PageDown", "Home", "End"]);
		await settle();
	},
	skips: [],
};
