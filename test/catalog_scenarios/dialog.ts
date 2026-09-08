import { page } from "vite-plus/test/browser/context";
import { press, required, requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	run: async ({ main, settle, userEvent }) => {
		const root = required<HTMLElement>(main, '[data-controller="dialog"]');
		const trigger = required<HTMLButtonElement>(root, '[data-dialog-target="trigger"]');
		// A partial name match also finds triggers whose generated state text is "closed".
		const close = page.getByRole("button", { name: "Close", exact: true });

		await userEvent.click(trigger);
		await userEvent.click(close);
		trigger.focus();
		await userEvent.keyboard("{Enter}");
		await userEvent.keyboard("{Tab}");
		await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
		await userEvent.keyboard("{Escape}");
		trigger.focus();
		await userEvent.keyboard("{Space}");
		await userEvent.keyboard("{Escape}");
		for (const panel of requiredAll<HTMLElement>(main, ".catalog-dialog-panel")) {
			const panelTrigger = required<HTMLButtonElement>(panel, '[data-dialog-target="trigger"]');
			const move = required<HTMLButtonElement>(panel, '[data-dialog-target="move"]');
			const resize = required<HTMLButtonElement>(panel, '[data-dialog-target="resize"]');
			const apply = required<HTMLButtonElement>(panel, '[data-dialog-target="apply"]');
			await userEvent.click(panelTrigger);
			for (const handle of [move, resize]) {
				handle.focus();
				await press(userEvent, ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]);
				await userEvent.keyboard(
					"{Shift>}{ArrowDown}{/Shift}{Control>}{ArrowRight}{/Control}{Alt>}{ArrowRight}{/Alt}{Meta>}{ArrowRight}{/Meta}",
				);
			}
			await userEvent.fill(
				required<HTMLInputElement>(panel, '[data-dialog-target="xControl"]'),
				"5",
			);
			await userEvent.fill(
				required<HTMLInputElement>(panel, '[data-dialog-target="yControl"]'),
				"5",
			);
			await userEvent.click(apply);
			await userEvent.fill(
				required<HTMLInputElement>(panel, '[data-dialog-target="widthControl"]'),
				"75",
			);
			apply.focus();
			await userEvent.keyboard("{Enter}");
			await userEvent.fill(
				required<HTMLInputElement>(panel, '[data-dialog-target="heightControl"]'),
				"75",
			);
			apply.focus();
			await userEvent.keyboard("{Space}");
			await userEvent.dragAndDrop(move, resize);
			await userEvent.dragAndDrop(resize, move);
			await userEvent.tab();
			await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
			move.focus();
			await userEvent.keyboard("{Escape}");
		}
		await settle();
	},
	skips: [],
};
