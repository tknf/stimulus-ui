import { press, required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const root = required<HTMLElement>(main, '[data-controller="tree"]');
		const item = required<HTMLElement>(root, '[data-tree-value="development"]');
		const toggle = required<HTMLButtonElement>(root, '[data-tree-target="toggle"]');

		await userEvent.click(item);
		await userEvent.click(toggle);
		root.focus();
		await press(userEvent, [
			"ArrowDown",
			"ArrowUp",
			"ArrowRight",
			"ArrowLeft",
			"Home",
			"End",
			"Enter",
		]);
		await userEvent.keyboard("{Space}");
		await userEvent.keyboard("{Control>}{ArrowDown}{/Control}");
		await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
		await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
		await settle();
	},
	skips: [],
};
