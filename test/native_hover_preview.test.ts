import { afterEach, expect, test } from "vite-plus/test";
import { server, userEvent } from "vite-plus/test/browser/context";

const createPreview = (kind: "button" | "link" | "link-tabindex") => {
	const root = document.createElement("div");
	const trigger = document.createElement(kind === "button" ? "button" : "a");
	if (trigger instanceof HTMLButtonElement) trigger.type = "button";
	if (trigger instanceof HTMLAnchorElement) trigger.href = "#destination";
	if (kind === "link-tabindex") trigger.tabIndex = 0;
	trigger.textContent = "プレビュー";
	const content = document.createElement("div");
	content.popover = "manual";
	const action = document.createElement("button");
	action.type = "button";
	action.textContent = "プレビュー内の操作";
	content.append(action);
	const outside = document.createElement("button");
	outside.type = "button";
	outside.textContent = "プレビューの次の操作";
	root.append(trigger, content, outside);
	document.body.append(root);
	return { trigger, content, action, outside };
};

afterEach(() => document.body.replaceChildren());

for (const kind of ["button", "link", "link-tabindex"] as const) {
	test(`native manual popover の ${kind} からの Tab 移動と表示時の focus を確認する`, async () => {
		const { trigger, content, action, outside } = createPreview(kind);
		trigger.focus();
		content.showPopover();
		expect(content.matches(":popover-open")).toBe(true);
		expect(document.activeElement).toBe(trigger);
		await userEvent.tab();
		expect(document.activeElement).toBe(action);
		await userEvent.tab({ shift: true });
		const skipsLink = kind === "link" && server.browser === "webkit";
		expect(document.activeElement).toBe(skipsLink ? document.body : trigger);
		trigger.focus();
		await userEvent.tab();
		await userEvent.tab();
		expect(document.activeElement).toBe(outside);
		expect(content.matches(":popover-open")).toBe(true);
		content.hidePopover();
		expect(document.activeElement).toBe(outside);
	});
}

test("Native manual popovers do not close from Escape or outside clicks alone", async () => {
	const { trigger, content, outside } = createPreview("button");
	trigger.focus();
	content.showPopover();
	await userEvent.keyboard("{Escape}");
	expect(content.matches(":popover-open")).toBe(true);
	await userEvent.click(outside);
	expect(content.matches(":popover-open")).toBe(true);
});

test("Native manual popover autofocus moves focus on opening", () => {
	const { trigger, content, action } = createPreview("button");
	action.autofocus = true;
	trigger.focus();
	content.showPopover();
	expect(document.activeElement).toBe(action);
});
