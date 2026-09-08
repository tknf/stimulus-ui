/// <reference types="vite-plus/client" />

import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import ComboboxController from "../src/combobox_controller";
import DialogController from "../src/dialog_controller";
import markup from "./compositions/command_palette.html?raw";
import PaletteDemoController from "./compositions/command_palette_controller";

let application: Application;

const mount = async () => {
	document.body.innerHTML = markup;
	application = Application.start();
	application.register("combobox", ComboboxController);
	application.register("dialog", DialogController);
	application.register("palette-demo", PaletteDemoController);
	const dialog = document.querySelector("dialog");
	const trigger = document.querySelector("button");
	const input = document.querySelector("input");
	const result = document.querySelector("output");
	const empty = document.querySelector('[data-palette-demo-target="empty"]');
	const options = Array.from(document.querySelectorAll<HTMLLIElement>('[role="option"]'));
	if (!dialog || !trigger || !input || !result || !(empty instanceof HTMLElement)) {
		throw new Error("command palette の検証用 markup がありません");
	}
	await expect.poll(() => trigger.dataset.state).toBe("closed");
	return { dialog, trigger, input, result, empty, options };
};

beforeEach(() => {
	vi.spyOn(console, "warn");
});

afterEach(() => {
	application.stop();
	document.body.innerHTML = "";
	expect(console.warn).not.toHaveBeenCalled();
	vi.restoreAllMocks();
});

describe("Command palette composition", () => {
	test("Skips headings and disabled items during keyboard execution and can execute the same command again", async () => {
		const { dialog, trigger, input, result, options } = await mount();
		for (let count = 0; count < 2; count += 1) {
			trigger.focus();
			await userEvent.keyboard("{Enter}");
			expect(dialog.open).toBe(true);
			expect(document.activeElement).toBe(input);
			expect(input.value).toBe("");
			await userEvent.keyboard("{Home}{ArrowDown}{ArrowDown}");
			expect(input.getAttribute("aria-activedescendant")).toBe(options[3]?.id);
			await userEvent.keyboard("{Enter}");
			expect(result.value).toBe("create-project");
			expect(dialog.open).toBe(false);
			expect(document.activeElement).toBe(trigger);
		}
	});

	test("Composes search, recovery from empty results, and pointer execution in consumer code", async () => {
		const { dialog, trigger, input, empty, result, options } = await mount();
		await userEvent.click(trigger);
		await userEvent.fill(input, "見つからない");
		expect(empty.hidden).toBe(false);
		expect(options.every((option) => option.hidden)).toBe(true);
		await userEvent.keyboard("{ArrowDown}{Enter}");
		expect(result.value).toBe("");
		expect(dialog.open).toBe(true);
		await userEvent.fill(input, "設定");
		expect(empty.hidden).toBe(true);
		expect(
			options.filter((option) => !option.hidden).map((option) => option.dataset.comboboxValue),
		).toEqual(["open-settings"]);
		const settings = options[1];
		if (!settings) throw new Error("設定コマンドがありません");
		await userEvent.click(settings);
		expect(result.value).toBe("open-settings");
		expect(dialog.open).toBe(false);
		expect(document.activeElement).toBe(trigger);
	});

	test("Closes suggestions on the first Escape and the dialog on the next", async () => {
		const { dialog, trigger, input } = await mount();
		await userEvent.click(trigger);
		await userEvent.keyboard("{Escape}");
		expect(input.getAttribute("aria-expanded")).toBe("false");
		expect(dialog.open).toBe(true);
		expect(document.activeElement).toBe(input);
		await userEvent.keyboard("{Escape}");
		await expect.poll(() => dialog.open).toBe(false);
		await expect.poll(() => document.activeElement).toBe(trigger);
	});
});
