import { required, requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const root = required<HTMLElement>(main, '[data-controller="table-select"]');
		const all = required<HTMLInputElement>(root, '[data-table-select-target="all"]');
		const items = requiredAll<HTMLInputElement>(root, '[data-table-select-target="item"]');
		const first = items[0];
		const second = items[1];
		if (first === undefined || second === undefined) throw new Error("Missing table-select items");

		await userEvent.click(first);
		second.focus();
		await userEvent.keyboard("{Shift>}{Space}{/Shift}");
		await userEvent.click(all);
		await settle();
	},
	skips: [],
};
