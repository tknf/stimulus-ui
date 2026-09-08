import { required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const root = required<HTMLElement>(main, '[data-controller="tooltip"]');
		const trigger = required<HTMLButtonElement>(root, '[data-tooltip-target="trigger"]');

		await userEvent.hover(trigger);
		await new Promise((resolve) => setTimeout(resolve, 220));
		await userEvent.keyboard("{Escape}");
		await settle();
	},
	skips: [],
};
