import { press, required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const root = required<HTMLElement>(main, '[data-controller="listbox"]');
		const option = required<HTMLElement>(root, '[data-listbox-value="blue"]');

		root.focus();
		await press(userEvent, ["ArrowUp", "ArrowDown", "Home", "End", "Space"]);
		await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
		await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
		await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
		await userEvent.keyboard("{Escape}");
		await userEvent.click(option);
		await settle();
	},
	skips: [],
};
