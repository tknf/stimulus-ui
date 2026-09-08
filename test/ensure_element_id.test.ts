import { Application } from "@hotwired/stimulus";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { ensureElementId } from "../src/internal/ensure_element_id";
import PasswordFieldController from "../src/password_field_controller";
import TabsController from "../src/tabs_controller";

let application: Application | undefined;

afterEach(() => {
	application?.stop();
	application = undefined;
	document.body.innerHTML = "";
});

describe("ensureElementId", () => {
	test("Preserves and returns an existing ID", () => {
		const element = document.createElement("div");
		element.id = "authored-id";

		const id = ensureElementId(element, "generated");

		expect(id).toBe("authored-id");
		expect(element.id).toBe("authored-id");
	});

	test("Assigns and returns a prefixed ID for an element without one", () => {
		const element = document.createElement("div");
		document.body.append(element);

		const id = ensureElementId(element, "generated");

		expect(id).toBe("generated-1");
		expect(element.id).toBe(id);
	});

	test("Avoids collisions with existing IDs in the same document", () => {
		const existing = document.createElement("div");
		existing.id = "collision-1";
		const element = document.createElement("div");
		document.body.append(existing, element);

		const id = ensureElementId(element, "collision");

		expect(id).toBe("collision-2");
		expect(document.querySelectorAll("#collision-1")).toHaveLength(1);
		expect(document.querySelectorAll("#collision-2")).toHaveLength(1);
	});

	test("Uses ownerDocument rather than the global document to allocate IDs", () => {
		const globalCollision = document.createElement("div");
		globalCollision.id = "isolated-1";
		const iframe = document.createElement("iframe");
		document.body.append(globalCollision, iframe);

		const iframeDocument = iframe.contentDocument;
		if (!iframeDocument) {
			throw new Error("iframe の ownerDocument を取得できませんでした");
		}
		const element = iframeDocument.createElement("div");
		iframeDocument.body.append(element);

		const id = ensureElementId(element, "isolated");

		expect(id).toBe("isolated-1");
		expect(element.ownerDocument).toBe(iframeDocument);
		expect(iframeDocument.getElementById(id)).toBe(element);
	});

	test("Maintains IDs and ARIA relationships for tabs and password-field in the same document", async () => {
		document.body.innerHTML =
			'<div data-controller="tabs" data-tabs-value-value="account">' +
			'<div data-tabs-target="tablist" aria-label="設定">' +
			'<button id="authored-tab" type="button" data-tabs-target="tab" data-tabs-value="account">アカウント</button>' +
			"</div>" +
			'<section data-tabs-target="tabpanel" data-tabs-value="account">内容</section>' +
			"</div>" +
			'<div data-controller="password-field">' +
			'<input type="password" data-password-field-target="input">' +
			'<button type="button" data-password-field-target="toggle">表示</button>' +
			"</div>";

		application = Application.start();
		application.register("tabs", TabsController);
		application.register("password-field", PasswordFieldController);
		await Promise.resolve();
		await new Promise<void>((resolve) => queueMicrotask(resolve));

		const tab = document.querySelector<HTMLButtonElement>('[data-tabs-target="tab"]');
		const panel = document.querySelector<HTMLElement>('[data-tabs-target="tabpanel"]');
		const input = document.querySelector<HTMLInputElement>('[data-password-field-target="input"]');
		const toggle = document.querySelector<HTMLButtonElement>(
			'[data-password-field-target="toggle"]',
		);
		if (!tab || !panel || !input || !toggle) {
			throw new Error("integration test の要素を取得できませんでした");
		}

		expect(tab.id).toBe("authored-tab");
		expect(panel.id).toMatch(/^tabs-tabpanel-\d+$/);
		expect(input.id).toMatch(/^password-field-input-\d+$/);
		expect(new Set([tab.id, panel.id, input.id]).size).toBe(3);
		expect(tab.getAttribute("aria-controls")).toBe(panel.id);
		expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
		expect(toggle.getAttribute("aria-controls")).toBe(input.id);
	});
});
