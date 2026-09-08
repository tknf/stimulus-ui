import { expect } from "vite-plus/test";
import { server } from "vite-plus/test/browser/context";
import { requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	run: async ({ main, userEvent, settle }) => {
		const [first, second, last] = requiredAll<HTMLAnchorElement>(
			main,
			'[data-table-of-contents-target="link"]',
		);
		if (!first || !second || !last) throw new Error("Missing table-of-contents links");
		window.scrollTo(0, 0);
		await settle();
		await expect.element(first).toHaveAccessibleName("Overview");
		first.focus();
		await userEvent.keyboard(server.browser === "webkit" ? "{Alt>}{Tab}{/Alt}" : "{Tab}");
		expect(document.activeElement).toBe(second);
		await userEvent.keyboard(
			server.browser === "webkit" ? "{Alt>}{Shift>}{Tab}{/Shift}{/Alt}" : "{Shift>}{Tab}{/Shift}",
		);
		expect(document.activeElement).toBe(first);
		await userEvent.keyboard("{Enter}");
		await settle();
		expect(location.hash).toBe("#toc-overview");
		await userEvent.click(second);
		await settle();
		await expect.poll(() => second.dataset.state).toBe("current");
		expect(first.dataset.state).toBe("inactive");
		const focused = document.activeElement;
		window.scrollTo(0, document.documentElement.scrollHeight);
		await expect.poll(() => last.dataset.state).toBe("current");
		expect(last.getAttribute("aria-current")).toBe("location");
		expect(document.activeElement).toBe(focused);
		window.scrollTo(0, 0);
		await settle();
	},
	skips: [],
};
