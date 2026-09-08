import { press, required, requiredAll, syncInput, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const single = required<HTMLInputElement>(main, 'input[data-controller="slider"]');
		const rangeInputs = requiredAll<HTMLInputElement>(
			main,
			'.catalog-slider-range [data-slider-target="input"]',
		);
		const rangeStart = rangeInputs[0];
		const rangeEnd = rangeInputs[1];
		if (rangeStart === undefined || rangeEnd === undefined) {
			throw new Error("Expected two slider range inputs");
		}

		syncInput(single, "0");
		syncInput(single, "100");
		syncInput(single, "40");
		syncInput(rangeEnd, "20");
		syncInput(rangeStart, "0");
		rangeEnd.value = "100";
		rangeEnd.dispatchEvent(new Event("input", { bubbles: true }));
		single.focus();
		await press(userEvent, ["Home", "End", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"]);
		await settle();

		// Each native track must provide a non-drag pointer route, including both range values.
		syncInput(rangeStart, "0");
		syncInput(rangeEnd, "100");
		for (const input of requiredAll<HTMLInputElement>(main, 'input[type="range"]')) {
			if (input !== rangeStart && input !== rangeEnd) syncInput(input, "0");
			const previousValue = input.valueAsNumber;
			await userEvent.click(input);
			await settle();
			if (input.valueAsNumber === previousValue) {
				throw new Error(`Native track click did not change ${input.id}`);
			}
		}
	},
	skips: [],
};
