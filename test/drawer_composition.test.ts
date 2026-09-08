/// <reference types="vite-plus/client" />

import { Application } from "@hotwired/stimulus";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import DialogController from "../src/dialog_controller";
import SliderController from "../src/slider_controller";
import markup from "./compositions/drawer.html?raw";

let application: Application | undefined;

const mount = async () => {
	vi.spyOn(console, "warn");
	document.body.innerHTML = markup;
	const root = document.getElementById("drawer-demo");
	const sizing = document.getElementById("drawer-size");
	const dialog = document.getElementById("drawer-panel");
	const input = document.getElementById("drawer-height");
	const trigger = root?.querySelector("button");
	const close = dialog?.querySelector("button");
	if (
		!root ||
		!sizing ||
		!(dialog instanceof HTMLDialogElement) ||
		!(input instanceof HTMLInputElement) ||
		!trigger ||
		!close
	) {
		throw new Error("drawer の検証用 markup がありません");
	}
	application = Application.start();
	application.register("dialog", DialogController);
	application.register("slider", SliderController);
	await expect.poll(() => root.dataset.state).toBe("closed");
	await expect.poll(() => sizing.style.getPropertyValue("--slider-value")).toBe("0.5");
	return { root, sizing, dialog, input, trigger, close };
};

const expectHeight = (dialog: HTMLDialogElement, percentage: number) => {
	expect(dialog.getBoundingClientRect().height).toBeCloseTo(
		(window.innerHeight * percentage) / 100,
		0,
	);
	expect(dialog.getBoundingClientRect().bottom).toBeCloseTo(window.innerHeight, 0);
};

afterEach(() => {
	application?.unload("dialog", "slider");
	application?.stop();
	application = undefined;
	document.body.innerHTML = "";
	expect(console.warn).not.toHaveBeenCalled();
	vi.restoreAllMocks();
});

describe("Drawer composition", () => {
	test("Uses the keyboard to open, close, and select three heights while preserving state and focus independently", async () => {
		const { root, sizing, dialog, input, trigger, close } = await mount();
		trigger.focus();
		await userEvent.keyboard("{Enter}");
		expect(dialog.matches(":modal")).toBe(true);
		expect(document.activeElement).toBe(close);
		expectHeight(dialog, 60);
		input.focus();
		for (const [key, value, state] of [
			["Home", 30, "min"],
			["ArrowUp", 60, "between"],
			["End", 90, "max"],
		] as const) {
			await userEvent.keyboard(`{${key}}`);
			expect(input.valueAsNumber).toBe(value);
			expectHeight(dialog, value);
			expect(sizing.dataset.state).toBe(state);
			expect(root.dataset.state).toBe("open");
			expect(document.activeElement).toBe(input);
		}
		await userEvent.keyboard("{Escape}");
		expect(dialog.open).toBe(false);
		expect(root.dataset.state).toBe("closed");
		expect(document.activeElement).toBe(trigger);
	});

	test("Selects every height with non-drag track clicks and closes with the close button", async () => {
		const { dialog, input, trigger, close } = await mount();
		await userEvent.click(trigger);
		for (const [fraction, value] of [
			[0.05, 30],
			[0.5, 60],
			[0.95, 90],
		] as const) {
			const rect = input.getBoundingClientRect();
			await userEvent.click(input, {
				position: { x: rect.width * fraction, y: rect.height / 2 },
			});
			expect(input.valueAsNumber).toBe(value);
			expectHeight(dialog, value);
		}
		await userEvent.click(close);
		expect(dialog.open).toBe(false);
		expect(document.activeElement).toBe(trigger);
	});
});
