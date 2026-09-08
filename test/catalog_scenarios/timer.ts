import { expect } from "vite-plus/test";
import { requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	run: async ({ main, userEvent, settle }) => {
		for (const root of requiredAll<HTMLElement>(main, '[data-controller="timer"]')) {
			const [start, pause, reset] = requiredAll<HTMLButtonElement>(root, "button");
			if (!start || !pause || !reset) throw new Error("Missing timer controls");
			expect(root.dataset.state).toBe("idle");
			await userEvent.click(start);
			expect(root.dataset.state).toBe("running");
			await userEvent.keyboard("{Tab}{Enter}");
			expect(document.activeElement).toBe(pause);
			expect(root.dataset.state).toBe("paused");
			await userEvent.keyboard("{Tab}");
			await userEvent.keyboard(" "); // Space
			expect(root.dataset.state).toBe("idle");
			await userEvent.keyboard("{Shift>}{Tab}{/Shift}{Shift>}{Tab}{/Shift}{Enter}");
			expect(document.activeElement).toBe(start);
			if (root.hasAttribute("data-timer-duration-value")) {
				await expect.poll(() => root.dataset.state, { timeout: 3000 }).toBe("finished");
			} else {
				await expect
					.poll(() => Number(root.style.getPropertyValue("--timer-value")) >= 500)
					.toBe(true);
				await userEvent.click(pause);
				expect(root.style.getPropertyValue("--timer-duration")).toBe("");
			}
			await userEvent.click(reset);
			await settle();
		}
	},
	skips: [],
};
