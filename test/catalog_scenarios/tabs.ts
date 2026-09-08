import { press, requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const roots = requiredAll<HTMLElement>(main, '[data-controller="tabs"]');
		const root = roots[0];
		if (root === undefined) throw new Error("Missing tabs root");
		const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tabs-target="tab"]'));
		const first = tabs[0];
		const second = tabs[1];
		if (first === undefined || second === undefined) throw new Error("Missing tab pair");

		await userEvent.click(second);
		first.focus();
		await press(userEvent, [
			"ArrowLeft",
			"ArrowRight",
			"ArrowUp",
			"ArrowDown",
			"Home",
			"End",
			"Enter",
			"Space",
			"Tab",
		]);
		await settle();
	},
	skips: [],
};
