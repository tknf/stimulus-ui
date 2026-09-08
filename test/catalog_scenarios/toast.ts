import { required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const root = required<HTMLElement>(main, '[data-controller="toast"]');
		const cycle = required<HTMLButtonElement>(root, '[data-action*="toast#show"]');
		const dismiss = required<HTMLButtonElement>(root, '[data-toast-target="dismiss"]');

		await userEvent.click(cycle);
		await userEvent.click(dismiss);
		await settle();
	},
	skips: [],
};
