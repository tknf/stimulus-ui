import { expect } from "vite-plus/test";
import { required, requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	run: async ({ main, settle, userEvent }) => {
		for (const root of requiredAll<HTMLElement>(main, '[data-controller="hover-card"]')) {
			const trigger = required<HTMLElement>(root, '[data-hover-card-target="trigger"]');
			const content = required<HTMLElement>(root, '[data-hover-card-target="content"]');
			const close = required<HTMLButtonElement>(root, '[data-hover-card-target="close"]');
			trigger.focus();
			expect(root.dataset.state).toBe("open");
			// Tab / Shift+Tab use the native focus order.
			await userEvent.tab();
			await userEvent.tab({ shift: true });
			expect(document.activeElement).toBe(trigger);
			await userEvent.keyboard("{Escape}");
			expect(root.dataset.state).toBe("closed");
			const opener =
				root.querySelector<HTMLButtonElement>('[data-hover-card-target="preview"]') ?? trigger;
			opener.focus();
			// Native buttons translate Enter / Space into clicks.
			await userEvent.keyboard("{Enter}");
			expect(content.matches(":popover-open")).toBe(true);
			close.focus();
			await userEvent.keyboard(" ");
			expect(root.dataset.state).toBe("closed");
			expect(document.activeElement).toBe(trigger);
			await settle();
		}
	},
	skips: [],
};
