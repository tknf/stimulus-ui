import { expect } from "vite-plus/test";
import { requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	run: async ({ main, userEvent, settle }) => {
		for (const root of requiredAll<HTMLElement>(main, '[data-controller="toggle-group"]')) {
			const [first, second, last] = requiredAll<HTMLButtonElement>(root, "button:not(:disabled)");
			if (!first || !second || !last) throw new Error("Missing toggle-group items");
			await expect.element(first).toHaveAccessibleName("Bold");
			await userEvent.click(second);
			await expect.element(first).toHaveAccessibleName("Bold");
			expect(second.dataset.state).toBe("on");
			if (root.dataset.toggleGroupMultipleValue === "true") expect(first.dataset.state).toBe("on");
			else expect(first.dataset.state).toBe("off");
			await userEvent.click(second);
			expect(second.dataset.state).toBe("off");
			first.focus();
			for (const key of Object.values({ Enter: "{Enter}", Space: " " })) {
				await userEvent.keyboard(key);
			}
			const vertical = root.dataset.toggleGroupOrientationValue === "vertical";
			const rtl = getComputedStyle(root).direction === "rtl";
			const forward = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
			const backward = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
			await userEvent.keyboard(`{${forward}}`);
			expect(document.activeElement).toBe(second);
			await userEvent.keyboard(`{${backward}}`);
			expect(document.activeElement).toBe(first);
			await userEvent.keyboard("{End}");
			expect(document.activeElement).toBe(last);
			await userEvent.keyboard(`{${forward}}`);
			expect(document.activeElement).toBe(first);
			await userEvent.keyboard("{Home}{Tab}");
			await settle();
		}
	},
	skips: [],
};
