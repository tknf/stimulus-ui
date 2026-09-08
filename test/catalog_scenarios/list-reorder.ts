import { commands } from "vite-plus/test/browser/context";
import { press, required, requiredAll, type CatalogScenario } from "./types";

const pointerCommands = commands as typeof commands & {
	reorderPointer: (
		selector: string,
		action: "down" | "move" | "up" | "release",
		x: number,
		y: number,
	) => Promise<void>;
};

export const scenario: CatalogScenario = {
	run: async ({ main, userEvent, settle }) => {
		for (const list of requiredAll<HTMLOListElement | HTMLUListElement>(
			main,
			".catalog-reorder-list",
		)) {
			const first = list.firstElementChild;
			if (!(first instanceof HTMLLIElement)) continue;
			const handle = required<HTMLButtonElement>(first, '[data-list-reorder-target="handle"]');
			const previous = required<HTMLButtonElement>(first, '[data-list-reorder-target="previous"]');
			const next = required<HTMLButtonElement>(first, '[data-list-reorder-target="next"]');
			await userEvent.click(next);
			if (list.children[1] !== first)
				throw new Error("Non-drag next interaction did not update order");
			await userEvent.click(previous);
			if (list.firstElementChild !== first)
				throw new Error("Non-drag previous interaction did not update order");
			const horizontal = list.classList.contains("catalog-reorder-horizontal");
			const rtl = getComputedStyle(list).direction === "rtl";
			list.scrollIntoView({ block: "center" });
			handle.id = `${first.id}-handle`;
			await pointerCommands.reorderPointer(`#${handle.id}`, "down", 0.5, 0.5);
			await settle();
			if (first.getAttribute("data-state") !== "picked")
				throw new Error(`Drag did not start for ${list.id}`);
			await pointerCommands.reorderPointer(
				`#${list.id}`,
				"move",
				horizontal ? (rtl ? 0.05 : 0.95) : 0.5,
				horizontal ? 0.5 : 0.95,
			);
			await pointerCommands.reorderPointer(
				`#${list.id}`,
				"up",
				horizontal ? (rtl ? 0.05 : 0.95) : 0.5,
				horizontal ? 0.5 : 0.95,
			);
			if (list.lastElementChild !== first)
				throw new Error(
					`Could not drag ${list.id} to the end (state=${first.getAttribute("data-state")})`,
				);
			handle.focus();
			await press(userEvent, ["Enter", "End", "Home"]);
			await press(userEvent, horizontal ? ["ArrowLeft", "ArrowRight"] : ["ArrowDown", "ArrowUp"]);
			// Isolate Control / Alt / Meta / IME checks from browser shortcuts.
			for (const flag of ["ctrlKey", "altKey", "metaKey", "isComposing", "keyCode"] as const) {
				const active = list.ownerDocument.activeElement;
				active?.addEventListener(
					"keydown",
					(event) => Object.defineProperty(event, flag, { value: flag === "keyCode" ? 229 : true }),
					{ once: true, capture: true },
				);
				await press(userEvent, ["End"]);
			}
			// repeat
			const active = list.ownerDocument.activeElement;
			active?.addEventListener(
				"keydown",
				(event) => Object.defineProperty(event, "repeat", { value: true }),
				{ once: true, capture: true },
			);
			await press(userEvent, ["Enter", "End"]);
			// Space
			await userEvent.keyboard(" ");
			handle.focus();
			await press(userEvent, ["Enter", "Home", "Escape"]);
			handle.focus();
			await press(userEvent, ["Enter", "Tab"]);
			handle.focus();
			await press(userEvent, ["Enter"]);
			// Shift+Tab
			await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
		}
		await settle();
	},
	skips: [],
};
