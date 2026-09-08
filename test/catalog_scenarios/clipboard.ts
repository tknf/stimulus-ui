import { required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const root = required<HTMLElement>(main, '[data-clipboard-source-value="text"]');
		const trigger = required<HTMLButtonElement>(root, '[data-clipboard-target="trigger"]');

		await userEvent.click(trigger);
		await settle();
	},
	skips: [],
};
