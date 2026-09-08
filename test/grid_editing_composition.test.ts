/// <reference types="vite-plus/client" />

import { Application } from "@hotwired/stimulus";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import EditableController from "../src/editable_controller";
import GridController from "../src/grid_controller";
import TreegridController from "../src/treegrid_controller";
import CellEditDemoController from "./compositions/cell_edit_demo_controller";
import markup from "./compositions/grid_editing.html?raw";

let application: Application | undefined;

const mount = async (identifier: "grid" | "treegrid") => {
	vi.spyOn(console, "warn");
	document.body.innerHTML = markup;
	const table = document.querySelector("table");
	const cell = document.getElementById("editable-cell");
	const editor = document.getElementById("cell-editor");
	const input = document.getElementById("cell-name");
	const outside = document.getElementById("editing-outside");
	const text = cell?.querySelector("span");
	const edit = editor?.querySelector("button");
	if (
		!table ||
		!cell ||
		!editor ||
		!(input instanceof HTMLInputElement) ||
		!outside ||
		!text ||
		!edit
	) {
		throw new Error("セル編集の検証用 markup がありません");
	}
	table.setAttribute("data-controller", identifier);
	table.setAttribute("role", identifier);
	application = Application.start();
	application.register("grid", GridController);
	application.register("treegrid", TreegridController);
	application.register("editable", EditableController);
	application.register("cell-edit-demo", CellEditDemoController);
	await expect.poll(() => editor.dataset.state).toBe("viewing");
	await expect.poll(() => cell.getAttribute("tabindex")).toBe("-1");
	return { table, cell, editor, input, outside, text, edit };
};

afterEach(() => {
	application?.unload("grid", "treegrid", "editable", "cell-edit-demo");
	application?.stop();
	application = undefined;
	document.body.innerHTML = "";
	expect(console.warn).not.toHaveBeenCalled();
	vi.restoreAllMocks();
});

for (const identifier of ["grid", "treegrid"] as const) {
	describe(`${identifier} と editable の複合`, () => {
		test("Enters editing with Enter, moves the caret with arrows, and cancels with Escape to resume cell navigation", async () => {
			const { table, cell, editor, input } = await mount(identifier);
			cell.focus();
			await userEvent.keyboard("{Enter}");
			expect(editor.dataset.state).toBe("editing");
			expect(document.activeElement).toBe(input);
			input.setSelectionRange(1, 1);
			await userEvent.keyboard("{ArrowRight}");
			expect(input.selectionStart).toBe(2);
			expect(document.activeElement).toBe(input);
			await userEvent.fill(input, "変更中");
			await userEvent.keyboard("{Escape}");
			expect(input.value).toBe("原稿");
			expect(editor.dataset.state).toBe("viewing");
			expect(document.activeElement).toBe(cell);
			await userEvent.keyboard("{ArrowDown}");
			expect(document.activeElement).toBe(table.rows[1]?.cells[1]);
		});

		test("Commits with the edit button and Enter, updates display, and returns to the cell", async () => {
			const { cell, input, text, edit } = await mount(identifier);
			await userEvent.click(edit);
			await userEvent.fill(input, "確定した名前");
			await userEvent.keyboard("{Enter}");
			expect(text.textContent).toBe("確定した名前");
			expect(document.activeElement).toBe(cell);
		});

		test("Preserves focus moved outside before saving and retains invalid drafts", async () => {
			const { cell, editor, input, outside, text } = await mount(identifier);
			cell.focus();
			await userEvent.keyboard("{Enter}");
			await userEvent.fill(input, "");
			await userEvent.keyboard("{Enter}");
			expect(editor.dataset.state).toBe("editing");
			expect(document.activeElement).toBe(input);
			await userEvent.fill(input, "保存値");
			editor.addEventListener("editable:beforecommit", () => outside.focus(), { once: true });
			await userEvent.keyboard("{Enter}");
			expect(text.textContent).toBe("保存値");
			expect(document.activeElement).toBe(outside);
		});

		test("Does not enter editing for synthetic or IME Enter", async () => {
			const { cell, editor } = await mount(identifier);
			cell.focus();
			cell.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			expect(editor.dataset.state).toBe("viewing");
			cell.addEventListener(
				"keydown",
				(event) => Object.defineProperty(event, "keyCode", { value: 229 }),
				{ capture: true, once: true },
			);
			await userEvent.keyboard("{Enter}");
			expect(editor.dataset.state).toBe("viewing");
		});
	});
}
