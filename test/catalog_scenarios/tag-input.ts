import { expect } from "vite-plus/test";
import { press, required, requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const root = required<HTMLElement>(main, '[data-controller="tag-input"]');
		const input = required<HTMLInputElement>(root, '[data-tag-input-target="input"]');
		const removes = requiredAll<HTMLButtonElement>(root, '[data-tag-input-target="remove"]');
		const remove = removes[0];
		if (remove === undefined) throw new Error("Missing tag-input remove control");

		await userEvent.type(input, "new");
		await userEvent.keyboard("{Enter}");
		await userEvent.type(input, "other");
		await userEvent.keyboard(",");
		await userEvent.click(remove);
		remove.focus();
		await press(userEvent, [
			"ArrowLeft",
			"ArrowRight",
			"ArrowUp",
			"ArrowDown",
			"Home",
			"End",
			"Delete",
			"Backspace",
			"Space",
		]);
		input.focus();
		await userEvent.keyboard("{Tab}");
		await settle();

		const inputless = required<HTMLElement>(main, "[data-inputless]");
		const inputlessRemoves = requiredAll<HTMLButtonElement>(
			inputless,
			'[data-tag-input-target="remove"]',
		);
		const first = inputlessRemoves[0];
		const last = inputlessRemoves[2];
		if (!first || !last) throw new Error("Missing remove controls in inputless configuration");
		const fallback = required<HTMLButtonElement>(inputless, '[data-tag-input-target="fallback"]');
		for (const direction of ["ltr", "rtl"]) {
			inputless.dir = direction;
			first.focus();
			await userEvent.keyboard(direction === "ltr" ? "{ArrowRight}" : "{ArrowLeft}");
			expect(document.activeElement).toBe(last);
			await press(userEvent, ["Home", "End"]);
			expect(document.activeElement).toBe(last);
			await press(userEvent, ["Delete", "Backspace"]);
			await userEvent.keyboard("{Tab}");
			expect(document.activeElement).toBe(fallback);
		}
		await userEvent.click(first);
		await settle();
	},
	skips: [],
};
