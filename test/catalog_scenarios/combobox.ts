import { press, required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const root = required<HTMLElement>(main, '[data-controller="combobox"]');
		const input = required<HTMLInputElement>(root, '[data-combobox-target="input"]');

		input.focus();
		await press(userEvent, ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"]);
		await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
		await settle();
	},
	skips: [],
};
