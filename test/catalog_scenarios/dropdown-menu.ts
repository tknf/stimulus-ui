import { expect } from "vite-plus/test";
import { press, required, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	run: async ({ main, settle, userEvent }) => {
		const root = required<HTMLElement>(main, '[data-controller="dropdown-menu"]');
		const trigger = required<HTMLButtonElement>(root, '[data-dropdown-menu-target="trigger"]');
		const item = required<HTMLButtonElement>(root, '[data-dropdown-menu-value="edit"]');

		await userEvent.click(trigger);
		await press(userEvent, ["ArrowDown", "ArrowUp", "Home", "End", "ArrowLeft", "ArrowRight"]);
		await userEvent.click(item);
		await userEvent.click(trigger);
		await userEvent.keyboard("{Enter}");
		await userEvent.keyboard("{Space}");
		await userEvent.keyboard("{Escape}");
		trigger.focus();
		await userEvent.keyboard("{Tab}");
		await settle();
		const contextRoot = required<HTMLElement>(main, ".catalog-context-menu");
		const source = required<HTMLButtonElement>(contextRoot, ".catalog-context-source");
		await userEvent.click(source, { button: "right" });
		expect(contextRoot.dataset.state).toBe("open");
		expect(contextRoot.style.getPropertyValue("--dropdown-menu-x")).toMatch(/px$/);
		expect(contextRoot.style.getPropertyValue("--dropdown-menu-y")).toMatch(/px$/);
		await userEvent.keyboard("{Escape}");
		for (const key of ["{Shift>}{F10}{/Shift}", "{ContextMenu}"]) {
			source.focus();
			await userEvent.keyboard(key);
			expect(contextRoot.dataset.state).toBe("open");
			await userEvent.keyboard("{Escape}");
			expect(document.activeElement).toBe(source);
		}
		// Check IME guards with trusted keydown and block native contextmenu as a separate path.
		source.addEventListener(
			"keydown",
			(event) => Object.defineProperty(event, "isComposing", { value: true }),
			{ capture: true, once: true },
		);
		source.addEventListener("contextmenu", (event) => event.preventDefault(), {
			capture: true,
			once: true,
		});
		await userEvent.keyboard("{ContextMenu}");
		expect(contextRoot.dataset.state).toBe("closed");
		source.addEventListener(
			"pointerdown",
			(event) => Object.defineProperty(event, "pointerType", { value: "touch" }),
			{ capture: true, once: true },
		);
		await userEvent.click(source, { delay: 650 });
		expect(contextRoot.dataset.state).toBe("open");
		await userEvent.keyboard("{Escape}");
	},
	skips: [],
};
