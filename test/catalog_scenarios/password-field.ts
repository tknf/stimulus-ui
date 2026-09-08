import { required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const toggle = required<HTMLButtonElement>(main, '[data-password-field-target="toggle"]');

		await userEvent.click(toggle);
		await userEvent.click(toggle);
		toggle.focus();
		await userEvent.keyboard("{Enter}");
		await userEvent.keyboard("{Space}");
		await settle();
	},
	skips: [],
};
