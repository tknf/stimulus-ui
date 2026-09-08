import { press, required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const cell = required<HTMLElement>(main, '[data-controller="grid"] [tabindex="0"]');

		cell.focus();
		await press(userEvent, ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"]);
		await userEvent.keyboard("{Control>}{Home}{/Control}");
		await userEvent.keyboard("{Control>}{End}{/Control}");
		await press(userEvent, ["PageUp", "PageDown"]);
		await settle();
	},
	skips: [],
};
