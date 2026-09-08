import { press, required, requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const roots = requiredAll<HTMLElement>(main, '[data-controller="treegrid"]');
		const first = roots[0];
		const single = roots[1];
		if (first === undefined || single === undefined)
			throw new Error("Missing treegrid configurations");
		const cell = required<HTMLElement>(first, '[tabindex="0"]');
		const selectedCell = required<HTMLElement>(
			single,
			'[data-treegrid-value="archive"] [tabindex]',
		);

		cell.focus();
		await userEvent.keyboard("{Enter}");
		await userEvent.keyboard("{Enter}");
		await userEvent.click(selectedCell);
		cell.focus();
		await press(userEvent, [
			"ArrowRight",
			"ArrowLeft",
			"ArrowDown",
			"ArrowUp",
			"Home",
			"End",
			"Enter",
		]);
		await userEvent.keyboard("{Control>}{Home}{/Control}");
		await userEvent.keyboard("{Control>}{End}{/Control}");
		await press(userEvent, ["PageUp", "PageDown"]);
		await userEvent.keyboard("{Shift>}{Space}{/Shift}");
		await settle();
	},
	skips: [],
};
