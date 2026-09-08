import { requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const roots = requiredAll<HTMLElement>(main, '[data-controller="accordion"]');
		const triggers = Array.from(
			roots[0]?.querySelectorAll<HTMLButtonElement>('[data-accordion-target="trigger"]') ?? [],
		);
		const secondTrigger = triggers[1];
		if (secondTrigger === undefined) throw new Error("Missing second accordion trigger");

		await userEvent.click(secondTrigger);
		secondTrigger.focus();
		await userEvent.keyboard("{Enter}");
		await userEvent.keyboard("{Space}");
		await settle();
	},
	skips: [],
};
