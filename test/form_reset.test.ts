/// <reference types="vite-plus/client" />

import { Application } from "@hotwired/stimulus";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import DateFieldController from "../src/date_field_controller";
import TimeFieldController from "../src/time_field_controller";
import NumberFieldController from "../src/number_field_controller";
import SliderController from "../src/slider_controller";
import CharacterCountController from "../src/character_count_controller";
import CheckboxGroupController from "../src/checkbox_group_controller";
import TableSelectController from "../src/table_select_controller";
import EditableController from "../src/editable_controller";
import PasswordFieldController from "../src/password_field_controller";
import ImageCropperController from "../src/image_cropper_controller";

const controllers = {
	"date-field": DateFieldController,
	"time-field": TimeFieldController,
	"number-field": NumberFieldController,
	slider: SliderController,
	"character-count": CharacterCountController,
	"checkbox-group": CheckboxGroupController,
	"table-select": TableSelectController,
	editable: EditableController,
	"password-field": PasswordFieldController,
	"image-cropper": ImageCropperController,
};
const catalogs = import.meta.glob<string>("../catalog/*.html", {
	query: "?raw",
	import: "default",
	eager: true,
});
let application: Application | undefined;

const mount = async (
	identifier: keyof typeof controllers,
	prepare: (root: HTMLElement) => void = () => {},
) => {
	vi.spyOn(console, "warn");
	const form = document.createElement("form");
	const parsed = new DOMParser().parseFromString(
		catalogs[`../catalog/${identifier}.html`] ?? "",
		"text/html",
	);
	const root = parsed.querySelector<HTMLElement>(`[data-controller="${identifier}"]`);
	if (!root) throw new Error("catalog の root がありません");
	prepare(root);
	const reset = document.createElement("button");
	reset.type = "reset";
	reset.textContent = "初期値に戻す";
	form.append(root, reset);
	document.body.append(form);
	application = Application.start();
	application.register(identifier, controllers[identifier]);
	await expect
		.poll(() => application?.getControllerForElementAndIdentifier(root, identifier))
		.toBeTruthy();
	return { root, form, reset };
};
const inputFor = (root: HTMLElement, selector = "input") => {
	const input = root.matches(selector) ? root : root.querySelector(selector);
	if (!(input instanceof HTMLInputElement)) throw new Error("input がありません");
	return input;
};
afterEach(() => {
	application?.unload(...Object.keys(controllers));
	application?.stop();
	application = undefined;
	document.body.innerHTML = "";
	expect(console.warn).not.toHaveBeenCalled();
	vi.restoreAllMocks();
});

for (const [identifier, initial, min, max] of [
	["date-field", "2026-09-05", "2026-09-01", "2026-09-10"],
	["time-field", "10:00", "09:00", "12:00"],
	["number-field", "5", "0", "10"],
	["slider", "5", "0", "10"],
] as const) {
	test(`[form-reset-native-state] ${identifier} は reset ボタンで戻った native value の状態を出す`, async () => {
		const { root, reset } = await mount(identifier, (element) => {
			const input = inputFor(element);
			input.min = min;
			input.max = max;
			input.defaultValue = initial;
		});
		const input = inputFor(root);
		input.value = min;
		input.dispatchEvent(new Event("input", { bubbles: true }));
		expect(input.dataset.state).toBe("min");
		await userEvent.click(reset);
		expect(input.value).toBe(initial);
		await expect.poll(() => input.dataset.state).toBe("between");
	});
}

test("[form-reset-counter] character-count exposes the length restored by a reset button", async () => {
	const { root, reset } = await mount("character-count");
	const field = root.querySelector("textarea");
	if (!field) throw new Error("textarea がありません");
	field.value = "入力済み";
	field.dispatchEvent(new Event("input", { bubbles: true }));
	expect(root.style.getPropertyValue("--character-count-value")).toBe("4");
	await userEvent.click(reset);
	await expect.poll(() => root.style.getPropertyValue("--character-count-value")).toBe("0");
});

for (const identifier of ["checkbox-group", "table-select"] as const) {
	test(`[form-reset-master] ${identifier} は reset 後の選択から master を同期する`, async () => {
		const { root, reset } = await mount(identifier, (element) => {
			inputFor(element, `[data-${identifier}-target="item"]`).defaultChecked = true;
		});
		const master = inputFor(root, `[data-${identifier}-target="all"]`);
		const items = root.querySelectorAll<HTMLInputElement>(`[data-${identifier}-target="item"]`);
		for (const item of items) {
			item.checked = true;
			item.dispatchEvent(new Event("change", { bubbles: true }));
		}
		expect(master.checked).toBe(true);
		expect(master.indeterminate).toBe(false);
		await userEvent.click(reset);
		await expect.poll(() => master.indeterminate).toBe(true);
		expect(master.checked).toBe(false);
	});
}

for (const identifier of ["editable", "password-field"] as const) {
	test(`[form-reset-cancel] ${identifier} は後続 listener が取り消した reset で表示状態を変えない`, async () => {
		const { root, form, reset } = await mount(identifier);
		const controller = application?.getControllerForElementAndIdentifier(root, identifier);
		if (controller instanceof EditableController) controller.edit();
		else if (controller instanceof PasswordFieldController) controller.show();
		else throw new Error("controller がありません");
		const state = root.dataset.state;
		form.addEventListener("reset", (event) => event.preventDefault(), { once: true });
		await userEvent.click(reset);
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(root.dataset.state).toBe(state);
	});
}

test("[form-reset-editable-value] editable commits the value after native reset", async () => {
	const { root, reset } = await mount("editable");
	const controller = application?.getControllerForElementAndIdentifier(root, "editable");
	if (!(controller instanceof EditableController)) throw new Error("controller がありません");
	controller.edit();
	const input = inputFor(root);
	input.value = "変更中";
	await userEvent.click(reset);
	await expect.poll(() => root.dataset.state).toBe("viewing");
	expect(controller.value).toBe(input.defaultValue);
});

test("[form-reset-cropper-controls] image-cropper restores its initial snapshot to controls after native reset", async () => {
	const { root, reset } = await mount("image-cropper", (element) => {
		const viewport = element.querySelector<HTMLElement>('[data-image-cropper-target="viewport"]');
		if (!viewport) throw new Error("viewport がありません");
		viewport.style.width = "320px";
		viewport.style.height = "240px";
		inputFor(element, '[data-image-cropper-target="xControl"]').defaultValue = "10";
	});
	const input = inputFor(root, '[data-image-cropper-target="xControl"]');
	await expect.poll(() => input.value).toBe("25");
	await userEvent.click(reset);
	await expect.poll(() => input.value).toBe("25");
});
