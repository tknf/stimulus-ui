import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import PasswordFieldController from "../src/password_field_controller";

type PasswordFieldPublicController = Controller & {
	visible: boolean;
	show: () => void;
	hide: () => void;
	toggle: () => void;
};

type ToggleDetail = {
	visible: boolean;
	previousVisible: boolean;
	reason: "pointer" | "keyboard";
};

let application: Application;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
};

const mount = async (rootAttributes = "", inputAttributes = "", toggleAttributes = "") => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<form><div data-controller="password-field" ${rootAttributes}>` +
			`<label>Password<input type="password" value="secret" data-password-field-target="input" ${inputAttributes}></label>` +
			`<button type="button" data-password-field-target="toggle" ${toggleAttributes}></button>` +
			"</div></form>",
	);
	await settle();

	const form = document.body.lastElementChild;
	const root = form?.firstElementChild;
	const input = root?.querySelector('[data-password-field-target="input"]');
	const toggle = root?.querySelector('[data-password-field-target="toggle"]');
	if (
		!(form instanceof HTMLFormElement) ||
		!(root instanceof HTMLElement) ||
		!(input instanceof HTMLInputElement) ||
		!(toggle instanceof HTMLButtonElement)
	) {
		throw new Error("password-field を作成できませんでした");
	}
	// Firefox submits forms even for dispatchEvent(submit), navigating the test page.
	// Navigation loses the runner context, so prevent the submission itself.
	// This listener runs after controller registration, but default cancellation
	// is checked after propagation completes and is therefore independent of that order.
	form.addEventListener("submit", (event) => event.preventDefault());
	return { form, root, input, toggle };
};

/** Mount replacement toggle markup to check aria-label, aria-labelledby, and text names. */
const mountToggle = async (toggleMarkup: string) => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<form><div data-controller="password-field">` +
			`<input type="password" value="secret" data-password-field-target="input">${toggleMarkup}</div></form>`,
	);
	await settle();

	const form = document.body.lastElementChild;
	const root = form?.firstElementChild;
	const input = root?.querySelector('[data-password-field-target="input"]');
	const toggle = root?.querySelector('[data-password-field-target="toggle"]');
	if (
		!(form instanceof HTMLFormElement) ||
		!(root instanceof HTMLElement) ||
		!(input instanceof HTMLInputElement) ||
		!(toggle instanceof HTMLButtonElement)
	) {
		throw new Error("password-field を作成できませんでした");
	}
	form.addEventListener("submit", (event) => event.preventDefault());
	return { form, root, input, toggle };
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"password-field",
	) as PasswordFieldPublicController | null;
	if (controller === null) throw new Error("password-field controller が接続されていません");
	return controller;
};

beforeEach(() => {
	document.body.innerHTML = "";
	application = Application.start();
	application.register("password-field", PasswordFieldController);
});

afterEach(() => {
	application.stop();
	document.body.innerHTML = "";
});

describe("password-field", () => {
	test("[password-field-state-sync] Synchronizes initial state, public APIs, ARIA, IDs, and state outputs", async () => {
		const { root, input, toggle } = await mount(
			'data-password-field-show-label-value="表示" data-password-field-hide-label-value="非表示"',
		);
		const controller = controllerFor(root);

		expect(controller.visible).toBe(false);
		expect(input.type).toBe("password");
		expect(root.dataset.state).toBe("hidden");
		expect(toggle.dataset.state).toBe("hidden");
		expect(toggle.getAttribute("aria-controls")).toBe(input.id);
		expect(toggle.getAttribute("aria-label")).toBe("表示");

		controller.show();
		expect(controller.visible).toBe(true);
		expect(input.type).toBe("text");
		expect(root.dataset.state).toBe("visible");
		expect(toggle.dataset.state).toBe("visible");
		expect(toggle.getAttribute("aria-label")).toBe("非表示");
		controller.hide();
		controller.toggle();
		expect(controller.visible).toBe(true);

		const authored = await mount(
			"",
			'id="authored-input"',
			'aria-label="切替" aria-controls="authored"',
		);
		expect(authored.input.id).toBe("authored-input");
		expect(authored.toggle.getAttribute("aria-label")).toBe("切替");
		expect(authored.toggle.getAttribute("aria-controls")).toBe("authored");
		expect(input.id).not.toBe(authored.input.id);
	});

	test("Preserves input values through every visibility-change path", async () => {
		const { root, input } = await mount();
		const controller = controllerFor(root);

		expect(input.value).toBe("secret");
		controller.show();
		expect(input.value).toBe("secret");
		controller.hide();
		expect(input.value).toBe("secret");
		controller.toggle();
		expect(input.value).toBe("secret");
		controller.visible = false;
		expect(input.value).toBe("secret");
	});

	test("Does not complete aria-label when the toggle has text content or aria-labelledby", async () => {
		const withText = await mountToggle(
			'<button type="button" data-password-field-target="toggle">切替</button>',
		);
		expect(withText.toggle.hasAttribute("aria-label")).toBe(false);
		controllerFor(withText.root).show();
		expect(withText.toggle.hasAttribute("aria-label")).toBe(false);

		const withLabelledby = await mountToggle(
			'<span id="password-toggle-label">切替</span>' +
				'<button type="button" data-password-field-target="toggle" aria-labelledby="password-toggle-label"></button>',
		);
		expect(withLabelledby.toggle.hasAttribute("aria-label")).toBe(false);
		controllerFor(withLabelledby.root).show();
		expect(withLabelledby.toggle.hasAttribute("aria-label")).toBe(false);
	});

	test("[password-field-beforetoggle-cancel] Allows cancellation of trusted-pointer beforetoggle", async () => {
		const { root, input, toggle } = await mount();
		const events: Array<{ type: string; detail: ToggleDetail }> = [];
		let cancel = true;
		root.addEventListener("password-field:beforetoggle", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ToggleDetail>).detail });
			if (cancel) event.preventDefault();
		});
		root.addEventListener("password-field:toggle", (event) => {
			events.push({ type: event.type, detail: (event as CustomEvent<ToggleDetail>).detail });
		});

		await userEvent.click(toggle);
		expect(input.type).toBe("password");
		expect(events.map(({ type }) => type)).toEqual(["password-field:beforetoggle"]);

		cancel = false;
		events.length = 0;
		await userEvent.click(toggle);
		expect(input.type).toBe("text");
		expect(events.map(({ type }) => type)).toEqual([
			"password-field:beforetoggle",
			"password-field:toggle",
		]);
		expect(events[1]?.detail).toEqual({
			visible: true,
			previousVisible: false,
			reason: "pointer",
		});
	});

	test("Canceling beforetoggle changes neither focus nor selection", async () => {
		const { root, input, toggle } = await mount();
		const controller = controllerFor(root);
		controller.show();
		root.addEventListener("password-field:beforetoggle", (event) => event.preventDefault());

		input.focus();
		input.setSelectionRange(2, 4, "backward");
		await userEvent.click(toggle);

		expect(input.type).toBe("text");
		// Focus after a click differs by engine; WebKit does not focus clicked buttons.
		// Assert only that the controller did not return focus to the input rather than
		// asserting a particular native destination. restoreFocusAndSelection would
		// move focus to the input if called.
		expect(document.activeElement).not.toBe(input);
		expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([
			2,
			4,
			"backward",
		]);
	});

	test("[password-field-completion-warning][password-field-completion-warning-negative] Warns once per connection when completing aria-controls and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			const incomplete = await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("password-field controller");
			expect(warnings[0]).toContain("aria-controls");

			warnings.length = 0;
			const nextToggle = document.createElement("button");
			nextToggle.type = "button";
			nextToggle.dataset.passwordFieldTarget = "toggle";
			incomplete.toggle.replaceWith(nextToggle);
			await settle();
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			incomplete.root.remove();
			await settle();
			incomplete.form.append(incomplete.root);
			await settle();
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			await mount("", 'id="complete-password"', 'aria-controls="complete-password"');
			expect(warnings).toHaveLength(0);
		} finally {
			console.warn = previousWarn;
		}
	});

	test("Restores focus and selection for trusted pointers and preserves toggle focus for keyboard interaction", async () => {
		const { root, input, toggle } = await mount();
		const reasons: ToggleDetail["reason"][] = [];
		root.addEventListener("password-field:toggle", (event) => {
			reasons.push((event as CustomEvent<ToggleDetail>).detail.reason);
		});

		input.focus();
		input.setSelectionRange(1, 4, "backward");
		await userEvent.click(toggle);
		expect(document.activeElement).toBe(input);
		expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([
			1,
			4,
			"backward",
		]);

		toggle.focus();
		await userEvent.keyboard("{Enter}");
		expect(document.activeElement).toBe(toggle);
		await userEvent.keyboard(" ");
		expect(document.activeElement).toBe(toggle);
		expect(reasons).toEqual(["pointer", "keyboard", "keyboard"]);
	});

	test("Public show/hide/toggle APIs and the visible setter do not move focus", async () => {
		const { root } = await mount();
		const controller = controllerFor(root);
		const elsewhere = document.createElement("button");
		document.body.appendChild(elsewhere);
		elsewhere.focus();
		expect(document.activeElement).toBe(elsewhere);

		controller.show();
		expect(document.activeElement).toBe(elsewhere);
		controller.hide();
		expect(document.activeElement).toBe(elsewhere);
		controller.toggle();
		expect(document.activeElement).toBe(elsewhere);
		controller.visible = false;
		expect(document.activeElement).toBe(elsewhere);
	});

	test("Synthetic clicks emit no events, disabled controls do nothing, and readonly permits toggling", async () => {
		const { root, input, toggle } = await mount();
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("password-field:beforetoggle", (event) => events.push(event));
		root.addEventListener("password-field:toggle", (event) => events.push(event));

		toggle.click();
		expect(input.type).toBe("text");
		expect(events).toEqual([]);

		controller.hide();
		controller.show();
		controller.toggle();
		controller.show();
		expect(input.type).toBe("text");
		expect(events).toEqual([]);

		input.disabled = true;
		await userEvent.click(toggle);
		expect(input.type).toBe("text");
		expect(events).toEqual([]);

		input.disabled = false;
		toggle.disabled = true;
		toggle.click();
		expect(input.type).toBe("text");
		expect(events).toEqual([]);

		toggle.disabled = false;
		input.readOnly = true;
		await userEvent.click(toggle);
		expect(input.type).toBe("password");
		expect(events).toHaveLength(2);
	});

	test("Hides on submit and uncanceled reset", async () => {
		const { form, root, input } = await mount();
		const controller = controllerFor(root);
		controller.show();

		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		expect(input.type).toBe("password");

		controller.show();
		form.addEventListener("reset", (event) => event.preventDefault(), { once: true });
		form.dispatchEvent(new Event("reset", { bubbles: true, cancelable: true }));
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(input.type).toBe("text");

		form.dispatchEvent(new Event("reset", { bubbles: true, cancelable: true }));
		await expect.poll(() => input.type).toBe("password");
	});

	test("Does not defer hiding after reset when removing the root disconnects the controller", async () => {
		const { form, root, input } = await mount();
		controllerFor(root).show();

		// MutationObserver disconnection runs before the post-reset task.
		root.remove();
		form.dispatchEvent(new Event("reset", { bubbles: true, cancelable: true }));
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(input.type).toBe("text");
	});

	test("[password-field-disconnect-cleanup] Old toggle and form events have no effect while disconnected", async () => {
		const { form, root, input, toggle } = await mount();
		controllerFor(root).show();
		root.remove();
		await settle();

		toggle.click();
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		expect(input.type).toBe("text");

		form.append(root);
		await settle();
		toggle.click();
		expect(input.type).toBe("password");
	});

	test("Synchronizes state, ARIA, and listeners after dynamic target replacement", async () => {
		const { root, input, toggle } = await mount();
		controllerFor(root).show();
		const nextInput = document.createElement("input");
		nextInput.type = "password";
		nextInput.setAttribute("data-password-field-target", "input");
		const nextToggle = document.createElement("button");
		nextToggle.type = "button";
		nextToggle.setAttribute("data-password-field-target", "toggle");

		input.replaceWith(nextInput);
		toggle.replaceWith(nextToggle);
		await settle();
		expect(nextInput.type).toBe("text");
		expect(nextToggle.dataset.state).toBe("visible");
		expect(nextToggle.getAttribute("aria-controls")).toBe(nextInput.id);
		expect(nextToggle.getAttribute("aria-label")).toBe("Hide password");

		toggle.click();
		expect(nextInput.type).toBe("text");
		nextToggle.click();
		expect(nextInput.type).toBe("password");
		expect(root.dataset.state).toBe("hidden");
	});

	test("[password-field-semantic-validation] Disables zero or two input/toggle targets with one warning", async () => {
		const errors: unknown[] = [];
		const warnings: string[] = [];
		const onError = (event: ErrorEvent) => errors.push(event.error ?? event.message);
		const previousWarn = console.warn;
		window.addEventListener("error", onError);
		console.warn = (message?: unknown) => warnings.push(String(message));

		try {
			document.body.insertAdjacentHTML(
				"beforeend",
				`<form><div data-controller="password-field" id="no-input">` +
					`<button type="button" data-password-field-target="toggle"></button>` +
					`</div></form>` +
					`<form><div data-controller="password-field" id="no-toggle">` +
					`<input type="text" value="secret" data-password-field-target="input">` +
					`</div></form>` +
					`<form><div data-controller="password-field" id="duplicated">` +
					`<input type="text" value="a" data-password-field-target="input">` +
					`<input type="password" value="b" data-password-field-target="input">` +
					`<button type="button" data-password-field-target="toggle"></button>` +
					`<button type="button" data-password-field-target="toggle"></button>` +
					`</div></form>`,
			);
			for (const form of document.querySelectorAll("form")) {
				form.addEventListener("submit", (event) => event.preventDefault());
			}
			await settle();

			const noInputRoot = document.getElementById("no-input");
			const noToggleRoot = document.getElementById("no-toggle");
			const duplicatedRoot = document.getElementById("duplicated");
			if (
				!(noInputRoot instanceof HTMLElement) ||
				!(noToggleRoot instanceof HTMLElement) ||
				!(duplicatedRoot instanceof HTMLElement)
			) {
				throw new Error("password-field を作成できませんでした");
			}

			const noInputToggle = noInputRoot.querySelector('[data-password-field-target="toggle"]');
			const noToggleInput = noToggleRoot.querySelector('[data-password-field-target="input"]');
			const duplicatedInput = duplicatedRoot.querySelector<HTMLInputElement>(
				'[data-password-field-target="input"]',
			);
			if (
				!(noInputToggle instanceof HTMLButtonElement) ||
				!(noToggleInput instanceof HTMLInputElement) ||
				!(duplicatedInput instanceof HTMLInputElement)
			) {
				throw new Error("password-field を作成できませんでした");
			}

			expect(warnings).toHaveLength(3);
			expect(warnings.every((warning) => warning.includes("Enhancement has been disabled"))).toBe(
				true,
			);
			expect(
				noInputRoot.querySelectorAll("[data-state], [aria-controls], [aria-label]"),
			).toHaveLength(0);
			expect(
				noToggleRoot.querySelectorAll("[data-state], [aria-controls], [aria-label]"),
			).toHaveLength(0);
			expect(
				duplicatedRoot.querySelectorAll("[data-state], [aria-controls], [aria-label]"),
			).toHaveLength(0);

			controllerFor(noInputRoot).show();
			noInputToggle.click();
			controllerFor(noToggleRoot).toggle();
			controllerFor(duplicatedRoot).hide();
			noToggleInput.form?.dispatchEvent(new Event("reset", { bubbles: true, cancelable: true }));
			expect(noToggleInput.type).toBe("text");
			expect(duplicatedInput.type).toBe("text");
		} finally {
			window.removeEventListener("error", onError);
			console.warn = previousWarn;
		}

		expect(errors).toEqual([]);
	});

	test("[password-field-semantic-validation][password-field-semantic-validation-negative] Disables invalid markup with one warning and reapplies enhancement when valid", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			const cases = [
				'<div data-controller="password-field"><div data-password-field-target="input"></div><button type="button" data-password-field-target="toggle"></button></div>',
				'<div data-controller="password-field"><input type="checkbox" data-password-field-target="input"><button type="button" data-password-field-target="toggle"></button></div>',
				'<div data-controller="password-field"><input type="password" data-password-field-target="input"><div data-password-field-target="toggle"></div></div>',
				'<div data-controller="password-field"><input type="password" data-password-field-target="input"><button data-password-field-target="toggle"></button></div>',
				'<div data-controller="password-field"><input type="password" data-password-field-target="input"></div>',
				'<div data-controller="password-field"><input type="password" data-password-field-target="input"><button type="button" data-password-field-target="toggle"></button><button type="button" data-password-field-target="toggle"></button></div>',
				'<div data-controller="password-field"><button type="button" data-password-field-target="toggle"></button></div>',
				'<div data-controller="password-field"><input type="password" data-password-field-target="input"><input type="password" data-password-field-target="input"><button type="button" data-password-field-target="toggle"></button></div>',
			];

			for (const [index, markup] of cases.entries()) {
				document.body.insertAdjacentHTML("beforeend", `<form>${markup}</form>`);
				await settle();
				const form = document.body.lastElementChild;
				const root = form?.firstElementChild;
				if (!(root instanceof HTMLElement)) throw new Error(`invalid root ${index} がありません`);
				const controller = controllerFor(root);

				expect(warnings).toHaveLength(index + 1);
				expect(warnings[index]).toContain("password-field controller");
				expect(warnings[index]).toContain("Enhancement has been disabled");
				expect(warnings[index]).not.toContain("Added ");
				expect(root.dataset.state).toBeUndefined();
				expect(
					root.querySelectorAll("[data-state], [id], [aria-controls], [aria-label]"),
				).toHaveLength(0);
				controller.show();
				controller.hide();
				controller.toggle();
				controller.visible = true;
				expect(controller.visible).toBe(false);
				expect(root.dataset.state).toBeUndefined();
			}

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<form><div data-controller="password-field">' +
					'<input id="valid-password-input" type="text" data-password-field-target="input">' +
					'<button type="button" aria-controls="valid-password-input" data-password-field-target="toggle"></button>' +
					"</div></form>",
			);
			await settle();
			const validForm = document.body.lastElementChild;
			const validRoot = validForm?.firstElementChild;
			const validInput = validRoot?.querySelector('[data-password-field-target="input"]');
			const validToggle = validRoot?.querySelector('[data-password-field-target="toggle"]');
			if (
				!(validForm instanceof HTMLFormElement) ||
				!(validRoot instanceof HTMLElement) ||
				!(validInput instanceof HTMLInputElement) ||
				!(validToggle instanceof HTMLButtonElement)
			) {
				throw new Error("valid password-field を作成できませんでした");
			}
			const validController = controllerFor(validRoot);
			expect(warnings).toHaveLength(0);
			validController.show();
			expect(validInput.type).toBe("text");
			validRoot.remove();
			await settle();
			validForm.append(validRoot);
			await settle();
			expect(warnings).toHaveLength(0);
			expect(validInput.type).toBe("text");
			expect(validRoot.dataset.state).toBe("visible");

			validToggle.remove();
			await settle();
			expect(warnings).toHaveLength(1);
			expect(validRoot.dataset.state).toBe("visible");
			const nextToggle = document.createElement("button");
			nextToggle.type = "button";
			nextToggle.dataset.passwordFieldTarget = "toggle";
			nextToggle.setAttribute("aria-controls", validInput.id);
			validRoot.append(nextToggle);
			await settle();
			expect(warnings).toHaveLength(1);
			expect(validRoot.dataset.state).toBe("visible");
			expect(nextToggle.dataset.state).toBe("visible");
			nextToggle.click();
			expect(validInput.type).toBe("password");
		} finally {
			console.warn = previousWarn;
		}
	});
});
