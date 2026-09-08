import { required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const details = required<HTMLDetailsElement>(main, '[data-controller="disclosure"]');
		const trigger = required<HTMLElement>(details, '[data-disclosure-target="trigger"]');

		await userEvent.click(trigger);
		await userEvent.click(trigger);
		trigger.focus();
		await userEvent.keyboard("{Enter}");
		await userEvent.keyboard("{Space}");
		await settle();
	},
	skips: [],
};
