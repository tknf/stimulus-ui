import { required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const item = required<HTMLInputElement>(main, '[data-checkbox-group-value="email"]');

		await userEvent.click(item);
		item.focus();
		await userEvent.keyboard("{Space}");
		await settle();
	},
	skips: [],
};
