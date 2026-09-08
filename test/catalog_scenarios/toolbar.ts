import { press, requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const controls = requiredAll<HTMLButtonElement>(
			main,
			'[data-controller="toolbar"] [data-toolbar-target="control"]',
		);
		const first = controls[0];
		if (first === undefined) throw new Error("Missing toolbar controls");

		first.focus();
		await press(userEvent, [
			"ArrowLeft",
			"ArrowRight",
			"ArrowUp",
			"ArrowDown",
			"Home",
			"End",
			"Tab",
		]);
		await settle();
	},
	skips: [],
};
