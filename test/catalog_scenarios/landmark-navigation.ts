import { requiredAll, type CatalogScenario } from "./types";
import { expect } from "vite-plus/test";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const landmarks = requiredAll<HTMLElement>(
			main,
			'[data-landmark-navigation-target="landmark"]',
		);
		const first = landmarks[0];
		const second = landmarks[1];
		if (first === undefined || second === undefined)
			throw new Error("Expected two landmark targets");
		const child = first.querySelector<HTMLElement>("button");
		if (child === null) throw new Error("Missing landmark child");

		child.focus();
		await userEvent.keyboard("{F6}");
		await settle();
		expect(document.activeElement).toBe(second);
		await userEvent.keyboard("{Shift>}{F6}{/Shift}");
		await settle();
		expect(document.activeElement).toBe(child);
		for (const modifier of ["Control", "Alt", "Meta"]) {
			child.focus();
			const event = new KeyboardEvent("keydown", {
				altKey: modifier === "Alt",
				bubbles: true,
				cancelable: true,
				ctrlKey: modifier === "Control",
				key: "F6",
				metaKey: modifier === "Meta",
			});
			child.dispatchEvent(event);
			await settle();
			expect(document.activeElement).toBe(child);
		}
	},
	skips: [],
};
