/// <reference types="vite-plus/client" />

import { Application } from "@hotwired/stimulus";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import DateFieldController from "../src/date_field_controller";
import TimeFieldController from "../src/time_field_controller";
import markup from "./compositions/period_fields.html?raw";
import PeriodValidationController from "./compositions/period_validation_controller";

let application: Application | undefined;

const mount = async (type: "date" | "time") => {
	vi.spyOn(console, "warn");
	document.body.innerHTML = markup;
	const form = document.getElementById(`${type}-period`);
	const start = document.getElementById(`period-start-${type}`);
	const end = document.getElementById(`period-end-${type}`);
	const submit = form?.querySelector('button[type="submit"]');
	const reset = form?.querySelector('button[type="reset"]');
	if (
		!(form instanceof HTMLFormElement) ||
		!(start instanceof HTMLInputElement) ||
		!(end instanceof HTMLInputElement) ||
		!submit ||
		!reset
	)
		throw new Error("期間の検証用 markup がありません");
	application = Application.start();
	application.register("date-field", DateFieldController);
	application.register("time-field", TimeFieldController);
	application.register("period-validation", PeriodValidationController);
	await expect.poll(() => start.dataset.state).toBe("between");
	const submissions = vi.fn((event: Event) => event.preventDefault());
	form.addEventListener("submit", submissions);
	return { form, start, end, submit, reset, submissions };
};

afterEach(() => {
	application?.unload("period-validation", "date-field", "time-field");
	application?.stop();
	application = undefined;
	document.body.innerHTML = "";
	expect(console.warn).not.toHaveBeenCalled();
	vi.restoreAllMocks();
});

for (const [type, before, after] of [
	["date", "2026-08-31", "2026-09-03"],
	["time", "09:00", "12:00"],
] as const) {
	describe(`${type} の期間の複合`, () => {
		test("Blocks reversed-period submission and preserves the end value after correcting the start", async () => {
			const { form, start, end, submit, submissions } = await mount(type);
			const endValue = end.value;
			await userEvent.fill(start, after);
			expect(end.validity.customError).toBe(true);
			expect(start.value).toBe(after);
			expect(end.value).toBe(endValue);
			await userEvent.click(submit);
			expect(submissions).not.toHaveBeenCalled();
			await userEvent.fill(start, before);
			expect(end.validity.customError).toBe(false);
			await userEvent.click(submit);
			expect(submissions).toHaveBeenCalledOnce();
			expect(new FormData(form).get("start")).toBe(before);
			expect(new FormData(form).get("end")).toBe(endValue);
		});

		test("Validates end corrections and missing values and permits equal endpoints", async () => {
			const { start, end } = await mount(type);
			await userEvent.fill(end, before);
			expect(end.validity.customError).toBe(true);
			await userEvent.fill(end, "");
			expect(end.validity.customError).toBe(false);
			expect(end.validity.valueMissing).toBe(true);
			await userEvent.fill(end, start.value);
			expect(end.validity.valid).toBe(true);
		});

		test("Honors reset cancellation and clears period errors after native reset", async () => {
			const { form, start, end, reset } = await mount(type);
			await userEvent.fill(start, after);
			form.addEventListener("reset", (event) => event.preventDefault(), { once: true });
			await userEvent.click(reset);
			expect(start.value).toBe(after);
			expect(end.validity.customError).toBe(true);
			await userEvent.click(reset);
			await expect.poll(() => end.validity.customError).toBe(false);
			expect(start.value).toBe(start.defaultValue);
			expect(end.value).toBe(end.defaultValue);
		});
	});
}

test("Treats equal time values identically with or without seconds", async () => {
	const { start, end } = await mount("time");
	start.value = "10:00:00";
	end.value = "10:00";
	end.dispatchEvent(new Event("input", { bubbles: true }));
	expect(start.valueAsNumber).toBe(end.valueAsNumber);
	expect(end.validity.customError).toBe(false);
});
