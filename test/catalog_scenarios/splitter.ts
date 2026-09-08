import { press, required, requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const root = required<HTMLElement>(main, '[data-controller="splitter"]');
		const handle = required<HTMLElement>(root, '[data-splitter-target="handle"]');

		handle.focus();
		await press(userEvent, ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"]);
		await userEvent.keyboard("{Enter}");
		await userEvent.keyboard("{Enter}");
		await userEvent.click(handle);
		await settle();
		for (const component of requiredAll<HTMLElement>(main, '[data-controller="splitter"]')) {
			const separator = required<HTMLElement>(component, '[data-splitter-target="handle"]');
			const range = required<HTMLInputElement>(component, '[data-splitter-target="range"]');
			separator.focus();
			await userEvent.keyboard("{Home}");
			await userEvent.click(range);
			await settle();
			if (
				range.valueAsNumber <= 0 ||
				component.style.getPropertyValue("--splitter-value") !== range.value
			) {
				throw new Error("Native range track must change the pane without dragging");
			}
		}
	},
	skips: [],
};
