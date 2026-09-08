import { required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const button = required<HTMLButtonElement>(main, '[data-table-sort-column="name"] button');

		await userEvent.click(button);
		await userEvent.click(button);
		await userEvent.click(button);
		button.focus();
		await userEvent.keyboard("{Enter}");
		await settle();
	},
	skips: [],
};
