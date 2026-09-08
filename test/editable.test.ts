import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import EditableController, { type EditableChangeDetail } from "../src/editable_controller";

let application: Application;
let warnings: string[];
let originalWarn: typeof console.warn;
let nextId = 0;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
};
const createEditable = (multiline = false) => {
	const id = `editable-fixture-${++nextId}`;
	const root = document.createElement("div");
	root.setAttribute("data-controller", "editable");
	const preview = document.createElement("div");
	preview.setAttribute("data-editable-target", "preview");
	const text = document.createElement("p");
	text.textContent = "Alice";
	const editor = document.createElement("div");
	editor.id = id;
	editor.hidden = true;
	editor.setAttribute("data-editable-target", "editor");
	const input = document.createElement(multiline ? "textarea" : "input");
	input.id = `${id}-input`;
	input.name = "display-name";
	input.defaultValue = "Alice";
	input.setAttribute("data-editable-target", "input");
	const label = document.createElement("label");
	label.htmlFor = input.id;
	label.textContent = "表示名";
	const buttons = ["edit", "save", "cancel"].map((target) => {
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = target;
		button.setAttribute("data-editable-target", target);
		return button;
	});
	const [edit, save, cancel] = buttons;
	if (!edit || !save || !cancel) throw new Error("button がありません");
	edit.setAttribute("aria-controls", id);
	preview.append(text, edit);
	editor.append(label, input, save, cancel);
	root.append(preview, editor);
	return { root, preview, text, editor, input, label, edit, save, cancel };
};
const mount = async (fixture = createEditable()) => {
	if (!fixture.root.isConnected) document.body.append(fixture.root);
	await settle();
	const controller = application.getControllerForElementAndIdentifier(fixture.root, "editable");
	if (!(controller instanceof EditableController)) throw new Error("controller がありません");
	return { ...fixture, controller };
};
const listen = ({ root, controller }: Awaited<ReturnType<typeof mount>>) => {
	const events: {
		type: string;
		detail: EditableChangeDetail;
		editing: boolean;
		value: string;
		bubbles: boolean;
		cancelable: boolean;
	}[] = [];
	for (const action of ["edit", "commit", "cancel"]) {
		for (const type of [`editable:before${action}`, `editable:${action}`]) {
			root.addEventListener(type, (event) =>
				events.push({
					type,
					detail: (event as CustomEvent<EditableChangeDetail>).detail,
					editing: controller.editing,
					value: controller.value,
					bubbles: event.bubbles,
					cancelable: event.cancelable,
				}),
			);
		}
	}
	return events;
};

beforeEach(() => {
	document.body.replaceChildren();
	warnings = [];
	originalWarn = console.warn;
	console.warn = (message?: unknown) => warnings.push(String(message));
	application = Application.start();
	application.register("editable", EditableController);
});
afterEach(async () => {
	document.body.replaceChildren();
	await settle();
	application.stop();
	console.warn = originalWarn;
	vi.restoreAllMocks();
});

test("[editable-state][editable-state-negative] Synchronizes initial values, hidden, ARIA, and root state while preserving preview content", async () => {
	const page = await mount();
	expect(page.controller.value).toBe("Alice");
	expect(page.controller.editing).toBe(false);
	expect(page.root.dataset.state).toBe("viewing");
	expect(page.preview.hidden).toBe(false);
	expect(page.editor.hidden).toBe(true);
	expect(page.edit.getAttribute("aria-expanded")).toBe("false");
	expect(page.edit.getAttribute("aria-controls")).toBe(page.editor.id);
	expect(page.root.style.length).toBe(0);
	expect(page.root.hasAttribute("aria-live")).toBe(false);
	expect(page.input.name).toBe("display-name");
	expect(warnings).toEqual([]);
	page.controller.value = "Bob";
	expect(page.input.value).toBe("Bob");
	expect(page.text.textContent).toBe("Alice");
});

test("[editable-commit][editable-commit-negative] Edits and commits trusted interaction and reports before/after state and values", async () => {
	const page = await mount();
	const events = listen(page);
	await userEvent.click(page.edit);
	expect(page.controller.editing).toBe(true);
	expect(document.activeElement).toBe(page.input);
	await userEvent.fill(page.input, "Bob");
	expect(page.controller.value).toBe("Alice");
	await userEvent.keyboard("{Enter}");
	expect(page.controller.value).toBe("Bob");
	expect(page.controller.editing).toBe(false);
	expect(document.activeElement).toBe(page.edit);
	expect(page.text.textContent).toBe("Alice");
	expect(events.map((event) => event.type)).toEqual([
		"editable:beforeedit",
		"editable:edit",
		"editable:beforecommit",
		"editable:commit",
	]);
	expect(events.map((event) => event.editing)).toEqual([false, true, true, false]);
	expect(events.map((event) => event.cancelable)).toEqual([true, false, true, false]);
	expect(events.every((event) => event.bubbles)).toBe(true);
	expect(events.at(-1)?.detail).toEqual({
		value: "Bob",
		previousValue: "Alice",
		reason: "keyboard",
	});
});

test("[editable-cancel][editable-cancel-negative] Cancels drafts on Escape and preserves editing on blur", async () => {
	const page = await mount();
	const events = listen(page);
	await userEvent.click(page.edit);
	await userEvent.fill(page.input, "draft");
	const outside = document.createElement("button");
	outside.textContent = "外";
	document.body.append(outside);
	await userEvent.click(outside);
	expect(page.controller.editing).toBe(true);
	expect(page.input.value).toBe("draft");
	page.input.focus();
	await userEvent.keyboard("{Escape}");
	expect(page.input.value).toBe("Alice");
	expect(document.activeElement).toBe(page.edit);
	expect(events.at(-1)?.detail).toEqual({
		value: "Alice",
		previousValue: "draft",
		reason: "keyboard",
	});
});

test("[editable-api] APIs and the value setter emit no notifications and do not steal focus moved outside", async () => {
	const page = await mount();
	const events = listen(page);
	expect(page.controller.edit()).toBe(true);
	page.input.value = "draft";
	page.controller.value = "server";
	expect(page.controller.editing).toBe(true);
	page.input.value = "another";
	expect(page.controller.cancel()).toBe(true);
	expect(page.input.value).toBe("server");
	page.controller.edit();
	page.input.value = "saved";
	const outside = document.createElement("button");
	document.body.append(outside);
	outside.focus();
	expect(page.controller.commit()).toBe(true);
	expect(document.activeElement).toBe(outside);
	expect(page.controller.value).toBe("saved");
	expect(events).toEqual([]);
});

test("[editable-before-cancel][editable-before-negative] Canceling every before-event prevents state changes and after notifications", async () => {
	for (const action of ["edit", "commit", "cancel"] as const) {
		const page = await mount();
		if (action !== "edit") page.controller.edit();
		page.input.value = "draft";
		const events = listen(page);
		page.root.addEventListener(`editable:before${action}`, (event) => event.preventDefault(), {
			once: true,
		});
		const button = action === "commit" ? page.save : page[action];
		await userEvent.click(button);
		expect(page.controller.editing).toBe(action !== "edit");
		expect(page.input.value).toBe("draft");
		expect(events.map((event) => event.type)).toEqual([`editable:before${action}`]);
		page.root.remove();
		await settle();
	}
});

test("[editable-validation][editable-validity-negative] Does not save invalid drafts and rechecks custom validity set by before listeners", async () => {
	const page = await mount();
	page.input.required = true;
	page.controller.edit();
	const events = listen(page);
	await userEvent.fill(page.input, "");
	await userEvent.click(page.save);
	expect(page.controller.editing).toBe(true);
	expect(page.controller.value).toBe("Alice");
	expect(events).toEqual([]);
	await userEvent.fill(page.input, "valid");
	page.root.addEventListener(
		"editable:beforecommit",
		() => page.input.setCustomValidity("保存できません"),
		{ once: true },
	);
	await userEvent.click(page.save);
	expect(page.controller.editing).toBe(true);
	expect(events.map((event) => event.type)).toEqual(["editable:beforecommit"]);
	page.input.setCustomValidity("");
	expect(page.controller.commit()).toBe(true);
	expect(page.controller.value).toBe("valid");
});

test("[editable-form][editable-invalid-reveal-negative] Shows editing for hidden-input native validation and prevents Enter form submission", async () => {
	const fixture = createEditable();
	fixture.input.defaultValue = "";
	fixture.input.required = true;
	const form = document.createElement("form");
	form.append(fixture.root);
	document.body.append(form);
	const page = await mount(fixture);
	const events = listen(page);
	const focused = document.activeElement;
	expect(page.input.checkValidity()).toBe(false);
	expect(page.controller.editing).toBe(true);
	expect(page.editor.hidden).toBe(false);
	expect(document.activeElement).toBe(focused);
	expect(events).toEqual([]);
	const submits: Event[] = [];
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		submits.push(event);
	});
	await userEvent.fill(page.input, "Ada");
	await userEvent.keyboard("{Enter}");
	expect(submits).toEqual([]);
	expect(new FormData(form).get("display-name")).toBe("Ada");
});

test("[editable-form-reset][editable-reset-negative] Honors native form reset cancellation and restores defaultValue without notifications or focus changes", async () => {
	const fixture = createEditable();
	const form = document.createElement("form");
	form.append(fixture.root);
	document.body.append(form);
	const page = await mount(fixture);
	const events = listen(page);
	page.controller.edit();
	page.input.value = "draft";
	form.addEventListener("reset", (event) => event.preventDefault(), { once: true });
	form.reset();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	expect(page.input.value).toBe("draft");
	expect(page.controller.editing).toBe(true);
	form.reset();
	await expect.poll(() => page.controller.editing).toBe(false);
	expect(page.controller.value).toBe("Alice");
	expect(page.controller.editing).toBe(false);
	expect(events).toEqual([]);
});

test("[editable-disabled][editable-disabled-negative] Respects disabled and readonly while allowing editing cancellation regardless of input state", async () => {
	const page = await mount();
	page.input.readOnly = true;
	expect(page.controller.edit()).toBe(false);
	page.input.readOnly = false;
	page.input.disabled = true;
	expect(page.controller.edit()).toBe(false);
	page.input.disabled = false;
	page.edit.addEventListener(
		"click",
		() => {
			page.edit.disabled = true;
		},
		{ capture: true, once: true },
	);
	await userEvent.click(page.edit);
	expect(page.controller.editing).toBe(false);
	page.edit.disabled = false;
	page.controller.edit();
	page.input.value = "draft";
	page.save.disabled = true;
	await userEvent.keyboard("{Enter}");
	expect(page.controller.editing).toBe(true);
	page.input.readOnly = true;
	expect(page.controller.commit()).toBe(false);
	expect(page.controller.cancel()).toBe(true);
	expect(page.input.value).toBe("Alice");
});

test("[editable-synthetic][editable-synthetic-negative] Synthetic clicks and keydown do not change state", async () => {
	const page = await mount();
	const events = listen(page);
	page.edit.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
	expect(page.controller.editing).toBe(false);
	page.controller.edit();
	page.input.value = "draft";
	page.input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
	);
	expect(page.controller.editing).toBe(true);
	expect(events).toEqual([]);
});

test("[editable-ime] Does not handle IME Enter or Escape", async () => {
	const page = await mount();
	page.controller.edit();
	page.input.value = "draft";
	for (const attribute of ["isComposing", "keyCode"]) {
		for (const key of ["Enter", "Escape"]) {
			page.input.addEventListener(
				"keydown",
				(event) =>
					Object.defineProperty(event, attribute, {
						value: attribute === "isComposing" ? true : 229,
					}),
				{ capture: true, once: true },
			);
			await userEvent.keyboard(`{${key}}`);
			expect(page.controller.editing).toBe(true);
			expect(page.input.value).toBe("draft");
		}
	}
});

test("[editable-multiline][editable-keyboard-negative] Preserves textarea Enter as a newline and saves with Control or Meta", async () => {
	const page = await mount(createEditable(true));
	page.controller.edit();
	await userEvent.fill(page.input, "first");
	await userEvent.keyboard("{End}{Enter}second");
	expect(page.controller.editing).toBe(true);
	expect(page.input.value).toBe("first\nsecond");
	await userEvent.keyboard("{Control>}{Enter}{/Control}");
	expect(page.controller.value).toBe("first\nsecond");
	expect(page.controller.editing).toBe(false);
	page.controller.edit();
	await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
	expect(page.controller.editing).toBe(false);
});

test("[editable-reentrancy][editable-reentrancy-negative] Does not overwrite API, draft, target, or connection changes in before listeners", async () => {
	for (const change of ["api", "draft", "cancel", "target", "disabled", "disconnect", "form"]) {
		const page = await mount();
		page.controller.edit();
		page.input.value = "draft";
		const events = listen(page);
		page.root.addEventListener(
			"editable:beforecommit",
			() => {
				if (change === "api") page.controller.value = "server";
				if (change === "draft") page.input.value = "newer";
				if (change === "cancel") page.controller.cancel();
				if (change === "target") page.input.remove();
				if (change === "disabled") page.input.disabled = true;
				if (change === "disconnect") page.root.removeAttribute("data-controller");
				if (change === "form") {
					const form = document.createElement("form");
					form.id = `${page.input.id}-form`;
					document.body.append(form);
					page.input.setAttribute("form", form.id);
				}
			},
			{ once: true },
		);
		await userEvent.click(page.save);
		expect(
			events.map((event) => event.type),
			change,
		).toEqual(["editable:beforecommit"]);
		if (change === "api") expect(page.input.value).toBe("server");
		if (change === "draft") expect(page.input.value).toBe("newer");
		page.root.remove();
		await settle();
	}
});

test("[editable-focus-reentrancy][editable-focus-negative] Does not emit after-edit when a focus listener cancels editing", async () => {
	for (const change of ["cancel", "remove"]) {
		const page = await mount();
		const events = listen(page);
		page.input.addEventListener(
			"focus",
			() => {
				if (change === "cancel") page.controller.cancel();
				else page.input.remove();
			},
			{ once: true },
		);
		await userEvent.click(page.edit);
		expect(page.controller.editing).toBe(false);
		expect(events.map((event) => event.type)).toEqual(["editable:beforeedit"]);
		page.root.remove();
		await settle();
	}
});

test("[editable-names][editable-markup-negative][editable-label-negative] Disables invalid names or target configurations and returns to viewing after repair", async () => {
	const page = await mount();
	page.controller.edit();
	page.input.value = "draft";
	page.label.htmlFor = "別の入力";
	await expect.poll(() => page.root.hasAttribute("data-state")).toBe(false);
	expect(page.input.value).toBe("Alice");
	page.label.htmlFor = page.input.id;
	await expect.poll(() => page.root.dataset.state).toBe("viewing");
	page.controller.edit();
	page.input.value = "draft";
	page.label.remove();
	await settle();
	expect(page.root.hasAttribute("data-state")).toBe(false);
	expect(page.input.value).toBe("Alice");
	page.input.setAttribute("aria-label", "表示名");
	await settle();
	expect(page.root.dataset.state).toBe("viewing");
	page.edit.innerHTML = '<span aria-hidden="true">編集</span>';
	await settle();
	expect(page.root.hasAttribute("data-state")).toBe(false);
	page.edit.setAttribute("aria-label", "編集");
	await settle();
	expect(page.root.dataset.state).toBe("viewing");
	page.save.type = "submit";
	await settle();
	expect(page.root.hasAttribute("data-state")).toBe(false);
	expect(warnings).toHaveLength(1);
});

test("[editable-dynamic] Discards the old draft on simultaneous target replacement and starts from the new input value", async () => {
	const page = await mount();
	page.controller.edit();
	page.input.value = "draft";
	const replacement = document.createElement("input");
	replacement.id = page.input.id;
	replacement.value = "new";
	replacement.setAttribute("data-editable-target", "input");
	page.input.replaceWith(replacement);
	await settle();
	expect(page.input.value).toBe("Alice");
	expect(page.controller.value).toBe("new");
	expect(page.controller.editing).toBe(false);
	expect(warnings).toEqual([]);
});

test("[editable-ids][editable-controls-negative] Allocates collision-free editor IDs and preserves authored IDs and aria-controls", async () => {
	const fixture = createEditable();
	fixture.editor.removeAttribute("id");
	fixture.edit.removeAttribute("aria-controls");
	const first = await mount(fixture);
	expect(first.editor.id).not.toBe("");
	expect(first.edit.getAttribute("aria-controls")).toBe(first.editor.id);
	const next = Number(first.editor.id.split("-").at(-1)) + 1;
	const collision = document.createElement("div");
	collision.id = `editable-editor-${next}`;
	document.body.append(collision);
	const secondFixture = createEditable();
	secondFixture.editor.removeAttribute("id");
	secondFixture.edit.removeAttribute("aria-controls");
	const second = await mount(secondFixture);
	expect(second.editor.id).not.toBe(first.editor.id);
	expect(second.editor.id).not.toBe(collision.id);
	const authoredFixture = createEditable();
	const id = authoredFixture.editor.id;
	authoredFixture.edit.removeAttribute("aria-controls");
	const authored = await mount(authoredFixture);
	expect(authored.editor.id).toBe(id);
	authored.edit.setAttribute("aria-controls", "external-editor");
	authored.controller.edit();
	expect(authored.editor.id).toBe(id);
	expect(authored.edit.getAttribute("aria-controls")).toBe("external-editor");
	expect(warnings).toHaveLength(3);
});

test("[editable-cleanup][editable-cleanup-negative] Cleans up drafts, attributes, and listeners on direct disconnect and reconnect", async () => {
	const fixture = createEditable();
	fixture.edit.setAttribute("aria-expanded", "true");
	const page = await mount(fixture);
	page.controller.edit();
	page.input.value = "draft";
	const observer = vi.spyOn(MutationObserver.prototype, "disconnect");
	const rootListener = vi.spyOn(page.root, "removeEventListener");
	const fieldListener = vi.spyOn(page.input, "removeEventListener");
	const documentListener = vi.spyOn(document, "removeEventListener");
	page.controller.disconnect();
	expect(page.input.value).toBe("Alice");
	expect(page.preview.hidden).toBe(false);
	expect(page.editor.hidden).toBe(true);
	expect(page.edit.getAttribute("aria-expanded")).toBe("true");
	expect(page.root.hasAttribute("data-state")).toBe(false);
	expect(observer).toHaveBeenCalledOnce();
	expect(rootListener).toHaveBeenCalledWith("click", expect.any(Function));
	expect(rootListener).toHaveBeenCalledWith("keydown", expect.any(Function));
	expect(fieldListener).toHaveBeenCalledWith("invalid", expect.any(Function));
	expect(documentListener).toHaveBeenCalledWith("reset", expect.any(Function), true);
	await userEvent.click(page.edit);
	expect(page.controller.edit()).toBe(false);
	page.controller.connect();
	expect(page.controller.edit()).toBe(true);
	expect(page.controller.value).toBe("Alice");
});

test("[editable-external-reset][editable-external-reset-negative] Handles only the current form owner's resets after external form replacement", async () => {
	const fixture = createEditable();
	const form = document.createElement("form");
	form.id = `${fixture.input.id}-form`;
	fixture.input.setAttribute("form", form.id);
	document.body.append(form);
	const page = await mount(fixture);
	const events = listen(page);
	page.controller.edit();
	page.controller.value = "committed";
	page.input.value = "draft";
	const replacement = document.createElement("form");
	replacement.id = form.id;
	form.replaceWith(replacement);
	expect(page.input.form).toBe(replacement);
	replacement.addEventListener("reset", (event) => event.stopPropagation());
	replacement.reset();
	await expect.poll(() => page.controller.editing).toBe(false);
	expect(page.input.value).toBe("Alice");
	expect(page.controller.value).toBe("Alice");
	expect(page.controller.editing).toBe(false);
	page.controller.edit();
	page.input.value = "次の下書き";
	form.id = `${form.id}-unrelated`;
	document.body.append(form);
	form.reset();
	await settle();
	expect(page.input.value).toBe("次の下書き");
	expect(page.controller.editing).toBe(true);
	expect(events).toEqual([]);
});

test("[editable-before-focus][editable-before-focus-negative] Preserves focus moved outside by a beforeedit listener", async () => {
	const page = await mount();
	const outside = document.createElement("button");
	outside.textContent = "外の操作";
	document.body.append(outside);
	const events = listen(page);
	page.root.addEventListener("editable:beforeedit", () => outside.focus());
	await userEvent.click(page.edit);
	expect(page.controller.editing).toBe(true);
	expect(document.activeElement).toBe(outside);
	expect(events.map((event) => event.type)).toEqual(["editable:beforeedit", "editable:edit"]);
});
