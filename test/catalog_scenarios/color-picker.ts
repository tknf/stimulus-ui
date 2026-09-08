import { commands } from "vite-plus/test/browser/context";
import { press, requiredAll, type CatalogScenario } from "./types";

const pointerCommands = commands as typeof commands & {
	colorPointer: (
		selector: string,
		action: "down" | "move" | "up" | "release",
		x: number,
		y: number,
	) => Promise<void>;
};

export const scenario: CatalogScenario = {
	run: async ({ main, userEvent, settle }) => {
		for (const handle of requiredAll<HTMLButtonElement>(
			main,
			".catalog-color-area, .catalog-color-wheel",
		)) {
			await pointerCommands.colorPointer(`#${handle.id}`, "down", 0.25, 0.25);
			await settle();
			await pointerCommands.colorPointer(`#${handle.id}`, "move", 0.75, 0.6);
			await pointerCommands.colorPointer(`#${handle.id}`, "up", 0.75, 0.6);
			await pointerCommands.colorPointer(`#${handle.id}`, "down", 0.6, 0.3);
			await pointerCommands.colorPointer(`#${handle.id}`, "up", 0.6, 0.3);
			handle.focus();
			await press(userEvent, ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);
			await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
			// Check Control / Alt / Meta / IME on trusted keys without invoking browser shortcuts.
			for (const flag of ["ctrlKey", "altKey", "metaKey", "isComposing", "keyCode"] as const) {
				handle.addEventListener(
					"keydown",
					(event) => Object.defineProperty(event, flag, { value: flag === "keyCode" ? 229 : true }),
					{ once: true, capture: true },
				);
				await press(userEvent, ["ArrowLeft"]);
			}
			await pointerCommands.colorPointer(`#${handle.id}`, "down", 0.2, 0.2);
			await press(userEvent, ["Escape"]);
			await pointerCommands.colorPointer(`#${handle.id}`, "up", 0.2, 0.2);
			handle.focus();
			await press(userEvent, ["Enter"]);
			handle.focus();
			// Space
			await userEvent.keyboard(" ");
		}
		for (const range of requiredAll<HTMLInputElement>(main, ".catalog-color-controls input")) {
			await pointerCommands.colorPointer(`#${range.id}`, "down", 0.7, 0.5);
			await pointerCommands.colorPointer(`#${range.id}`, "up", 0.7, 0.5);
			range.focus();
			await press(userEvent, [
				"Home",
				"End",
				"ArrowLeft",
				"ArrowRight",
				"ArrowUp",
				"ArrowDown",
				"PageUp",
				"PageDown",
				"Tab",
			]);
			// Shift+Tab
			await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
		}
		await settle();
	},
	skips: [],
};
