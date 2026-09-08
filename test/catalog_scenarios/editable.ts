import { expect } from "vite-plus/test";
import { required, requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	run: async ({ main, userEvent }) => {
		for (const root of requiredAll<HTMLElement>(main, '[data-controller="editable"]')) {
			const edit = required<HTMLButtonElement>(root, '[data-editable-target="edit"]');
			const save = required<HTMLButtonElement>(root, '[data-editable-target="save"]');
			const cancel = required<HTMLButtonElement>(root, '[data-editable-target="cancel"]');
			const input = required<HTMLInputElement | HTMLTextAreaElement>(
				root,
				'[data-editable-target="input"]',
			);
			const initial = input.value;
			await userEvent.click(edit);
			expect(root.dataset.state).toBe("editing");
			expect(document.activeElement).toBe(input);
			await userEvent.fill(input, "Draft to cancel");
			await userEvent.keyboard("{Escape}");
			expect(input.value).toBe(initial);
			expect(root.dataset.state).toBe("viewing");
			await userEvent.keyboard("{Enter}");
			await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
			expect(root.dataset.state).toBe("editing");
			if (input instanceof HTMLTextAreaElement) {
				await userEvent.keyboard("{End}{Enter}");
				expect(root.dataset.state).toBe("editing");
				await userEvent.fill(input, initial);
				await userEvent.keyboard("{Control>}{Enter}{/Control}");
				await userEvent.click(edit);
				await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
			} else {
				await userEvent.keyboard("{Enter}");
			}
			expect(root.dataset.state).toBe("viewing");
			await userEvent.keyboard(" "); // Space
			await userEvent.keyboard("{Tab}");
			expect(document.activeElement).toBe(save);
			await userEvent.keyboard("{Tab}{Shift>}{Tab}{/Shift}");
			expect(document.activeElement).toBe(save);
			await userEvent.click(cancel);
			expect(root.dataset.state).toBe("viewing");
		}
	},
	skips: [],
};
