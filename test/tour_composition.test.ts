/// <reference types="vite-plus/client" />

import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import DialogController from "../src/dialog_controller";
import markup from "./compositions/tour.html?raw";
import TourDemoController from "./compositions/tour_controller";
import "./compositions/tour.css";

let application: Application;

const mount = async () => {
	document.body.innerHTML = markup;
	application = Application.start();
	application.register("dialog", DialogController);
	application.register("tour-demo", TourDemoController);
	const root = document.querySelector('[data-controller="dialog tour-demo"]');
	const dialog = document.querySelector("dialog");
	const trigger = document.querySelector('[data-dialog-target="trigger"]');
	const next = document.querySelector('[data-tour-demo-target="next"]');
	const previous = document.querySelector('[data-tour-demo-target="previous"]');
	const close = document.querySelector('[data-dialog-target="close"]');
	const steps = Array.from(
		document.querySelectorAll<HTMLElement>('[data-tour-demo-target="step"]'),
	);
	const headings = Array.from(
		document.querySelectorAll<HTMLElement>('[data-tour-demo-target="heading"]'),
	);
	const search = document.querySelector("#tour-demo-search");
	const settings = document.querySelector("#tour-demo-settings");
	if (
		!(root instanceof HTMLElement) ||
		!dialog ||
		!(trigger instanceof HTMLButtonElement) ||
		!(next instanceof HTMLButtonElement) ||
		!(previous instanceof HTMLButtonElement) ||
		!(close instanceof HTMLButtonElement) ||
		!(search instanceof HTMLButtonElement) ||
		!(settings instanceof HTMLButtonElement)
	)
		throw new Error("tour の検証用 markup がありません");
	await expect.poll(() => trigger.dataset.state).toBe("closed");
	return { root, dialog, trigger, next, previous, close, steps, headings, search, settings };
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

describe("Tour composition", () => {
	test("Moves next/previous by pointer, focuses visible instructions, and restores the origin on finish", async () => {
		const { root, dialog, trigger, next, previous, close, steps, headings } = await mount();
		await userEvent.click(trigger);
		expect(document.activeElement).toBe(headings[0]);
		expect(previous.disabled).toBe(true);
		await userEvent.click(next);
		expect(root.dataset.step).toBe("1");
		expect(steps.map((step) => step.hidden)).toEqual([true, false]);
		expect(document.activeElement).toBe(headings[1]);
		expect(next.disabled).toBe(true);
		await userEvent.click(previous);
		expect(root.dataset.step).toBe("0");
		expect(document.activeElement).toBe(headings[0]);
		await userEvent.click(close);
		await expect.poll(() => dialog.open).toBe(false);
		await expect.poll(() => document.activeElement).toBe(trigger);
	});

	test("Advances, finishes, and restarts using only the keyboard, restarting at the first step", async () => {
		const { root, dialog, trigger, next, headings } = await mount();
		trigger.focus();
		await userEvent.keyboard("{Enter}");
		await userEvent.tab();
		expect(document.activeElement).toBe(next);
		await userEvent.keyboard("{Enter}");
		expect(root.dataset.step).toBe("1");
		expect(document.activeElement).toBe(headings[1]);
		await userEvent.keyboard("{Escape}");
		await expect.poll(() => dialog.open).toBe(false);
		await expect.poll(() => document.activeElement).toBe(trigger);
		await userEvent.keyboard("{Enter}");
		expect(root.dataset.step).toBe("0");
		expect(document.activeElement).toBe(headings[0]);
	});

	test("CSS anchors place dialogs below targets and follow movement without changing focus", async () => {
		const { dialog, trigger, next, search, settings, headings } = await mount();
		await userEvent.click(trigger);
		await expect
			.poll(() =>
				Math.abs(dialog.getBoundingClientRect().top - search.getBoundingClientRect().bottom),
			)
			.toBeLessThan(1);
		expect(
			Math.abs(dialog.getBoundingClientRect().left - search.getBoundingClientRect().left),
		).toBeLessThan(1);
		await userEvent.click(next);
		await expect
			.poll(() =>
				Math.abs(dialog.getBoundingClientRect().top - settings.getBoundingClientRect().bottom),
			)
			.toBeLessThan(1);
		expect(
			Math.abs(dialog.getBoundingClientRect().left - settings.getBoundingClientRect().left),
		).toBeLessThan(1);
		settings.style.left = "320px";
		await expect
			.poll(() =>
				Math.abs(dialog.getBoundingClientRect().left - settings.getBoundingClientRect().left),
			)
			.toBeLessThan(1);
		expect(document.activeElement).toBe(headings[1]);
	});

	test("Does not focus background tour targets during modal display and preserves close cancellation", async () => {
		const { root, dialog, trigger, search, headings } = await mount();
		await userEvent.click(trigger);
		search.focus();
		expect(document.activeElement).toBe(headings[0]);
		root.addEventListener("dialog:beforeclose", (event) => event.preventDefault(), { once: true });
		await userEvent.keyboard("{Escape}");
		expect(dialog.open).toBe(true);
		expect(document.activeElement).toBe(headings[0]);
		await userEvent.keyboard("{Escape}");
		await expect.poll(() => dialog.open).toBe(false);
	});
});
