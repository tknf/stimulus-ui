import { required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const field = required<HTMLTextAreaElement>(main, '[data-character-count-target="field"]');

		await userEvent.type(field, "abcd");
		await settle();
	},
	skips: [],
};
