import { press, required, requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const roots = requiredAll<HTMLElement>(main, '[data-controller="image-cropper"]');
		for (const root of roots) {
			const selection = required<HTMLButtonElement>(
				root,
				'[data-image-cropper-target="selection"]',
			);
			const resize = required<HTMLButtonElement>(root, '[data-image-cropper-target="resize"]');
			const controls = requiredAll<HTMLInputElement>(
				root,
				'input[type="range"][data-image-cropper-target]',
			);
			const details = root.querySelector<HTMLDetailsElement>("details");

			if (details !== null && !details.open) {
				selection.focus();
				await userEvent.keyboard("{Enter}");
			}

			selection.focus();
			await press(userEvent, ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]);
			await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}{Shift>}{ArrowDown}{/Shift}");
			await userEvent.keyboard("+");
			await userEvent.keyboard("-");
			await userEvent.keyboard("{Control>}{ArrowRight}{/Control}");
			await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
			await userEvent.keyboard("{Meta>}{ArrowRight}{/Meta}");

			resize.focus();
			await press(userEvent, ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]);
			await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");

			for (const control of controls) {
				control.focus();
				await press(userEvent, [
					"ArrowLeft",
					"ArrowRight",
					"ArrowUp",
					"ArrowDown",
					"Home",
					"End",
					"PageUp",
					"PageDown",
				]);
				await userEvent.click(control);
			}

			selection.focus();
			await userEvent.keyboard("{Escape}");
			await userEvent.keyboard("{Enter}");
			await userEvent.keyboard("{Space}");
			await userEvent.tab();
			await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
			await userEvent.dragAndDrop(selection, resize);
			await userEvent.dragAndDrop(resize, selection);
			if (details !== null) {
				const summary = required<HTMLElement>(root, "summary");
				await userEvent.click(summary);
				if (details.open) throw new Error("Could not close details");
				selection.focus();
				await userEvent.keyboard("{Enter}");
				if (!details.open) throw new Error("Button activation did not open details");
			}
			await settle();
		}
	},
	skips: [],
};
