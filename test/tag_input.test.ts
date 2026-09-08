import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import TagInputController, {
	type TagInputAddDetail,
	type TagInputRemoveDetail,
} from "../src/tag_input_controller";

type TagInputPublicController = Controller & {
	values: string[];
	connect: () => void;
	disconnect: () => void;
};

type MountedTagInput = {
	root: HTMLElement;
	list: HTMLUListElement;
	input: HTMLInputElement;
	chips: HTMLLIElement[];
	removes: HTMLButtonElement[];
};

let application: Application;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const chipMarkup = (value: string, removeAttributes = "") =>
	`<li data-tag-input-target="chip" data-tag-input-value="${value}"><span>${value}</span><button type="button" data-tag-input-target="remove" aria-label="${value}を削除" ${removeAttributes}>削除</button></li>`;

const rootMarkup = (
	rootAttributes = "",
	values: string[] = ["alpha", "beta", "gamma"],
	inputAttributes = "",
) =>
	`<div data-controller="tag-input" ${rootAttributes}><ul aria-label="タグ">${values.map((value) => chipMarkup(value)).join("")}</ul><input type="text" data-tag-input-target="input" ${inputAttributes}></div>`;

const elementsFor = (root: HTMLElement): MountedTagInput => {
	const list = root.querySelector<HTMLUListElement>("ul");
	const input = root.querySelector<HTMLInputElement>('[data-tag-input-target="input"]');
	if (!list || !input) throw new Error("tag-input の list/input がありません");

	return {
		chips: Array.from(root.querySelectorAll<HTMLLIElement>('[data-tag-input-target="chip"]')),
		input,
		list,
		removes: Array.from(
			root.querySelectorAll<HTMLButtonElement>('[data-tag-input-target="remove"]'),
		),
		root,
	};
};

const mount = async (
	rootAttributes = "",
	values: string[] = ["alpha", "beta", "gamma"],
	inputAttributes = "",
) => {
	document.body.insertAdjacentHTML(
		"beforeend",
		rootMarkup(rootAttributes, values, inputAttributes),
	);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("tag-input root がありません");
	return elementsFor(root);
};

const mountForm = async (
	rootAttributes = "",
	values: string[] = ["alpha"],
	inputAttributes = "",
) => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<form>${rootMarkup(rootAttributes, values, inputAttributes)}</form>`,
	);
	await settle();
	const form = document.body.lastElementChild;
	if (!(form instanceof HTMLFormElement)) throw new Error("tag-input form がありません");
	const root = form.firstElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("tag-input root がありません");
	return { ...elementsFor(root), form };
};

const mountRaw = async (html: string) => {
	document.body.insertAdjacentHTML("beforeend", html);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("tag-input root がありません");
	return root;
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"tag-input",
	) as TagInputPublicController | null;
	if (!controller) throw new Error("tag-input controller が接続されていません");
	return controller;
};

const mountWithoutInput = async (values = ["alpha", "beta", "gamma"], rootAttributes = "") => {
	const root = await mountRaw(
		`<div data-controller="tag-input" ${rootAttributes}><ul aria-label="タグ">${values.map((value) => chipMarkup(value)).join("")}</ul><button type="button" data-tag-input-target="fallback">タグを選ぶ</button></div>`,
	);
	const list = root.querySelector("ul");
	const fallback = root.querySelector('[data-tag-input-target="fallback"]');
	if (!list || !(fallback instanceof HTMLButtonElement))
		throw new Error("list/fallback がありません");
	const removes = Array.from(
		root.querySelectorAll<HTMLButtonElement>('[data-tag-input-target="remove"]'),
	);
	return { root, list, fallback, removes };
};

const requiredRemove = (removes: HTMLButtonElement[], index: number) => {
	const remove = removes[index];
	if (!remove) throw new Error("remove button がありません");
	return remove;
};

const removedChip = (event: Event) => {
	if (!(event instanceof CustomEvent)) throw new Error("remove event ではありません");
	const detail: unknown = event.detail;
	if (
		typeof detail !== "object" ||
		detail === null ||
		!("chip" in detail) ||
		!(detail.chip instanceof HTMLLIElement)
	)
		throw new Error("remove detail に chip がありません");
	return detail.chip;
};

const keydown = (element: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
	const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init });
	element.dispatchEvent(event);
	return event;
};

const press = async (element: HTMLElement, key: string) => {
	element.focus();
	const specialKeys = new Set([
		"ArrowDown",
		"ArrowLeft",
		"ArrowRight",
		"ArrowUp",
		"Backspace",
		"Delete",
		"End",
		"Enter",
		"Home",
	]);
	await userEvent.keyboard(specialKeys.has(key) ? `{${key}}` : key);
};

beforeEach(() => {
	document.body.innerHTML = "";
	application = Application.start();
	application.register("tag-input", TagInputController);
});

afterEach(() => {
	application.stop();
	document.body.innerHTML = "";
});

describe("tag-input", () => {
	test("[tag-input-inputless-navigation][tag-input-inputless-end-negative] Checks inputless LTR/RTL, Home/End, disabled skipping, and stopping at the end", async () => {
		for (const direction of ["ltr", "rtl"]) {
			const { root, fallback, removes } = await mountWithoutInput(undefined, `dir="${direction}"`);
			const first = requiredRemove(removes, 0);
			const middle = requiredRemove(removes, 1);
			const last = requiredRemove(removes, 2);
			middle.disabled = true;
			await settle();
			expect(removes.filter((remove) => remove.tabIndex === 0)).toEqual([first]);
			await press(first, direction === "ltr" ? "ArrowRight" : "ArrowLeft");
			expect(document.activeElement).toBe(last);
			await userEvent.keyboard(direction === "ltr" ? "{ArrowRight}" : "{ArrowLeft}");
			expect(document.activeElement).toBe(last);
			await userEvent.keyboard("{Home}");
			expect(document.activeElement).toBe(first);
			await userEvent.keyboard("{End}");
			expect(document.activeElement).toBe(last);
			await userEvent.tab();
			expect(document.activeElement).toBe(fallback);
			expect(fallback.hasAttribute("tabindex")).toBe(false);
			expect(root.hasAttribute("role")).toBe(false);
		}
	});

	test("[tag-input-inputless-removal][tag-input-fallback-focus-negative] Allows canceling inputless removal and restores next, previous, then fallback focus", async () => {
		const { root, fallback, removes } = await mountWithoutInput();
		let cancel = true;
		root.addEventListener("tag-input:beforeremove", (event) => {
			if (cancel) event.preventDefault();
		});
		const events: string[] = [];
		root.addEventListener("tag-input:add", () => events.push("add"));
		root.addEventListener("tag-input:remove", (event) => {
			events.push("remove");
			removedChip(event).remove();
		});
		const first = requiredRemove(removes, 0);
		const middle = requiredRemove(removes, 1);
		const last = requiredRemove(removes, 2);
		await press(middle, "Delete");
		expect(controllerFor(root).values).toEqual(["alpha", "beta", "gamma"]);
		expect(events).toEqual([]);
		cancel = false;
		middle.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		expect(events).toEqual([]);
		await userEvent.click(middle);
		await settle();
		expect(document.activeElement).toBe(last);
		await userEvent.keyboard("{Delete}");
		await settle();
		expect(document.activeElement).toBe(first);
		await userEvent.keyboard("{Backspace}");
		await settle();
		expect(controllerFor(root).values).toEqual([]);
		expect(document.activeElement).toBe(fallback);
		expect(events).toEqual(["remove", "remove", "remove"]);
	});

	test("[tag-input-inputless-empty] Empty or fully disabled chip lists have no tab stop and initialization does not move focus", async () => {
		const empty = await mountWithoutInput([]);
		empty.fallback.focus();
		const disabled = await mountWithoutInput(["fixed"]);
		const remove = requiredRemove(disabled.removes, 0);
		remove.disabled = true;
		await settle();
		expect(remove.tabIndex).toBe(-1);
		expect(document.activeElement).toBe(empty.fallback);
		expect(controllerFor(empty.root).values).toEqual([]);
	});

	test("[tag-input-inputless-async][tag-input-focus-request-negative] Does not steal externally moved focus during asynchronous or programmatic removal", async () => {
		const { root, list, fallback, removes } = await mountWithoutInput(["alpha"]);
		const outside = document.createElement("button");
		outside.textContent = "外部";
		document.body.append(outside);
		let pending: HTMLLIElement | undefined;
		root.addEventListener("tag-input:remove", (event) => {
			pending = removedChip(event);
		});
		await press(requiredRemove(removes, 0), "Delete");
		outside.focus();
		pending?.remove();
		await settle();
		expect(document.activeElement).toBe(outside);
		list.insertAdjacentHTML("beforeend", chipMarkup("programmatic"));
		await settle();
		const button = list.querySelector("button");
		if (!button) throw new Error("remove がありません");
		button.focus();
		list.firstElementChild?.remove();
		await settle();
		expect(document.activeElement).not.toBe(fallback);
	});

	test("[tag-input-inputless-microtask][tag-input-focus-request-negative] Respects external focus moved after target removal is detected but before focus restoration", async () => {
		const { root, list, removes } = await mountWithoutInput(["alpha"]);
		const outside = document.createElement("button");
		outside.textContent = "外部";
		document.body.append(outside);
		// Move focus in the same observer delivery after Stimulus queues removal recovery.
		const observer = new MutationObserver(() => outside.focus());
		observer.observe(list, { childList: true });
		try {
			root.addEventListener("tag-input:remove", (event) => removedChip(event).remove());
			await press(requiredRemove(removes, 0), "Delete");
			await settle();
			expect(document.activeElement).toBe(outside);
		} finally {
			observer.disconnect();
		}
	});

	test("[tag-input-inputless-dynamic][tag-input-fallback-focus-negative] Tracks input/fallback addition, removal, and replacement and prioritizes the input", async () => {
		const { root, list, fallback, removes } = await mountWithoutInput(["alpha"]);
		const first = requiredRemove(removes, 0);
		const input = document.createElement("input");
		input.dataset.tagInputTarget = "input";
		root.append(input);
		await settle();
		await press(first, "End");
		expect(document.activeElement).toBe(input);
		root.addEventListener("tag-input:remove", (event) => removedChip(event).remove());
		await press(first, "Delete");
		await settle();
		expect(document.activeElement).toBe(input);
		input.remove();
		const replacement = document.createElement("button");
		replacement.type = "button";
		replacement.textContent = "復帰先";
		replacement.dataset.tagInputTarget = "fallback";
		fallback.replaceWith(replacement);
		list.insertAdjacentHTML("beforeend", chipMarkup("beta"));
		await settle();
		const next = list.querySelector("button");
		if (!next) throw new Error("remove がありません");
		await press(next, "Delete");
		await settle();
		expect(document.activeElement).toBe(replacement);
	});

	test("[tag-input-fallback-validation][tag-input-input-count-negative][tag-input-fallback-validation-negative] Disables duplicate inputs and invalid fallbacks", async () => {
		const originalWarn = console.warn;
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			const invalid = [
				'<input data-tag-input-target="input"><input data-tag-input-target="input">',
				'<button type="submit" data-tag-input-target="fallback">復帰</button>',
				'<button type="button" disabled data-tag-input-target="fallback">復帰</button>',
				'<button type="button" hidden data-tag-input-target="fallback">復帰</button>',
				'<button type="button" tabindex="-1" data-tag-input-target="fallback">復帰</button>',
				'<button type="button" data-tag-input-target="fallback"></button>',
				'<a data-tag-input-target="fallback">復帰</a>',
				'<button type="button" data-tag-input-target="fallback">復帰</button><button type="button" data-tag-input-target="fallback">復帰</button>',
			];
			for (const targets of invalid) {
				const root = await mountRaw(
					`<div data-controller="tag-input"><ul>${chipMarkup("alpha")}</ul>${targets}</div>`,
				);
				const remove = root.querySelector('[data-tag-input-target="remove"]');
				expect(remove?.hasAttribute("tabindex")).toBe(false);
			}
			expect(warnings).toHaveLength(invalid.length);
			const nested = await mountRaw(
				`<div data-controller="tag-input"><ul>${chipMarkup("alpha").replace('data-tag-input-target="remove"', 'data-tag-input-target="remove fallback"')}</ul></div>`,
			);
			expect(nested.querySelector("button")?.hasAttribute("tabindex")).toBe(false);
			expect(warnings).toHaveLength(invalid.length + 1);
		} finally {
			console.warn = originalWarn;
		}
	});

	test("[tag-input-inputless-reconnect] Disables enhancement when fallback disappears and resumes when a destination reconnects", async () => {
		const { root, fallback, removes } = await mountWithoutInput(["alpha", "beta"]);
		const first = requiredRemove(removes, 0);
		const last = requiredRemove(removes, 1);
		const originalWarn = console.warn;
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			fallback.remove();
			await settle();
			await press(first, "End");
			expect(document.activeElement).toBe(first);
			expect(warnings).toHaveLength(1);
			root.append(fallback);
			await settle();
			await press(first, "End");
			expect(document.activeElement).toBe(last);
			expect(warnings).toHaveLength(1);
		} finally {
			console.warn = originalWarn;
		}
	});

	test("[tag-input-fallback-validation][tag-input-fallback-tabindex-negative] Warns and disables removal when fallback leaves the tab order", async () => {
		const { root, fallback, removes } = await mountWithoutInput(["alpha"]);
		const originalWarn = console.warn;
		const warnings: string[] = [];
		const events: Event[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			root.addEventListener("tag-input:remove", (event) => events.push(event));
			fallback.tabIndex = -1;
			await settle();
			await press(requiredRemove(removes, 0), "Delete");
			expect(events).toEqual([]);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(controllerFor(root).values).toEqual(["alpha"]);
		} finally {
			console.warn = originalWarn;
		}
	});

	test("[tag-input-add][tag-input-beforeadd-cancel-negative][tag-input-prevent-default-negative] Checks Enter, delimiters, cancellation, input clearing, and form submission", async () => {
		const { form, input, root } = await mountForm('data-tag-input-delimiter-value=","');
		let submissions = 0;
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			submissions += 1;
		});

		const events: Array<{
			name: string;
			detail: TagInputAddDetail;
			event: Event;
		}> = [];
		let cancel = true;
		root.addEventListener("tag-input:beforeadd", (event) => {
			const customEvent = event as CustomEvent<TagInputAddDetail>;
			events.push({ detail: customEvent.detail, event, name: event.type });
			if (cancel) event.preventDefault();
		});
		root.addEventListener("tag-input:add", (event) => {
			const customEvent = event as CustomEvent<TagInputAddDetail>;
			events.push({ detail: customEvent.detail, event, name: event.type });
		});

		input.value = "cancelled";
		await press(input, "Enter");
		expect(input.value).toBe("cancelled");
		expect(events.map(({ name }) => name)).toEqual(["tag-input:beforeadd"]);
		expect(submissions).toBe(0);

		cancel = false;
		events.length = 0;
		input.value = "alpha";
		await press(input, "Enter");
		expect(input.value).toBe("");
		expect(submissions).toBe(0);
		expect(events.map(({ name }) => name)).toEqual(["tag-input:beforeadd", "tag-input:add"]);
		expect(events[0]?.detail).toEqual({ reason: "keyboard", value: "alpha" });
		expect(events[1]?.detail).toEqual({ reason: "keyboard", value: "alpha" });
		expect(events[0]?.event.cancelable).toBe(true);
		expect(events[1]?.event.cancelable).toBe(false);
		expect(events[1]?.event.target).toBe(root);

		events.length = 0;
		input.value = "beta";
		await press(input, ",");
		expect(input.value).toBe("");
		expect(events.map(({ name }) => name)).toEqual(["tag-input:beforeadd", "tag-input:add"]);

		await press(input, "Enter");
		expect(submissions).toBe(1);
	});

	test("[tag-input-ime-guard][tag-input-ime-guard-negative] Suppresses tag addition and focus movement during IME composition", async () => {
		const { input, root } = await mount('data-tag-input-delimiter-value=","', ["alpha"]);
		const events: Event[] = [];
		root.addEventListener("tag-input:beforeadd", (event) => events.push(event));
		root.addEventListener("tag-input:add", (event) => events.push(event));

		input.focus();
		const composingBackspace = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			isComposing: true,
			key: "Backspace",
		});
		input.dispatchEvent(composingBackspace);
		expect(document.activeElement).toBe(input);

		input.value = "変換中";
		keydown(input, "Enter", { isComposing: true });
		keydown(input, ",", { isComposing: true });
		expect(input.value).toBe("変換中");
		expect(events).toEqual([]);
	});

	test("[tag-input-remove][tag-input-beforeremove-cancel-negative] Checks trusted click/Delete/Backspace removal, cancellation, and reasons", async () => {
		const { root } = await mount();
		const events: Array<{ name: string; detail: TagInputRemoveDetail; event: Event }> = [];
		let cancel = true;
		root.addEventListener("tag-input:beforeremove", (event) => {
			const customEvent = event as CustomEvent<TagInputRemoveDetail>;
			events.push({ detail: customEvent.detail, event, name: event.type });
			if (cancel) event.preventDefault();
		});
		root.addEventListener("tag-input:remove", (event) => {
			const customEvent = event as CustomEvent<TagInputRemoveDetail>;
			events.push({ detail: customEvent.detail, event, name: event.type });
			customEvent.detail.chip.remove();
		});

		let current = elementsFor(root);
		await userEvent.click(current.removes[0]!);
		expect(current.chips[0]?.isConnected).toBe(true);
		expect(events.map(({ name }) => name)).toEqual(["tag-input:beforeremove"]);
		expect(events[0]?.event.cancelable).toBe(true);

		cancel = false;
		events.length = 0;
		await userEvent.click(current.removes[0]!);
		await settle();
		expect(events.map(({ name }) => name)).toEqual(["tag-input:beforeremove", "tag-input:remove"]);
		expect(events[1]?.detail.reason).toBe("pointer");
		expect(events[1]?.event.cancelable).toBe(false);

		current = elementsFor(root);
		current.removes[0]?.focus();
		await userEvent.keyboard("{Delete}");
		await settle();
		expect(events.at(-1)?.name).toBe("tag-input:remove");
		expect(events.at(-1)?.detail.reason).toBe("keyboard");

		current = elementsFor(root);
		current.removes[0]?.focus();
		await userEvent.keyboard("{Backspace}");
		await settle();
		expect(events.at(-1)?.detail.reason).toBe("keyboard");

		current.list.insertAdjacentHTML("beforeend", chipMarkup("enter"));
		await settle();
		current = elementsFor(root);
		current.removes[0]?.focus();
		await userEvent.keyboard("{Enter}");
		await settle();
		expect(events.at(-1)?.name).toBe("tag-input:remove");
		expect(events.at(-1)?.detail.reason).toBe("keyboard");
	});

	test("[tag-input-events-guard][tag-input-trusted-guard-negative] Emits no events for synthetic clicks or programmatic DOM changes", async () => {
		const { chips, removes, root } = await mount("", ["alpha"]);
		const events: Event[] = [];
		root.addEventListener("tag-input:beforeremove", (event) => events.push(event));
		root.addEventListener("tag-input:remove", (event) => events.push(event));

		removes[0]?.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
		);
		expect(events).toEqual([]);
		expect(chips[0]?.isConnected).toBe(true);

		chips[0]?.remove();
		await settle();
		expect(events).toEqual([]);
		expect(controllerFor(root).values).toEqual([]);
	});

	test("[tag-input-navigation] Checks arrows between chips/input, Home/End, caret boundaries, and no wrapping", async () => {
		const { input, root } = await mount();
		let current = elementsFor(root);

		current.removes[1]?.focus();
		let event = keydown(current.removes[1]!, "ArrowLeft");
		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(current.removes[0]);

		event = keydown(current.removes[0]!, "ArrowLeft");
		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(current.removes[0]);
		keydown(current.removes[0]!, "ArrowUp");
		expect(document.activeElement).toBe(current.removes[0]);

		keydown(current.removes[0]!, "ArrowRight");
		expect(document.activeElement).toBe(current.removes[1]);
		keydown(current.removes[1]!, "Home");
		expect(document.activeElement).toBe(current.removes[0]);
		keydown(current.removes[0]!, "End");
		expect(document.activeElement).toBe(input);

		input.value = "abc";
		input.setSelectionRange(0, 0);
		input.focus();
		keydown(input, "ArrowLeft");
		current = elementsFor(root);
		expect(document.activeElement).toBe(current.removes[2]);

		input.value = "";
		input.focus();
		keydown(input, "Backspace");
		expect(document.activeElement).toBe(current.removes[2]);
		keydown(current.removes[2]!, "ArrowRight");
		expect(document.activeElement).toBe(input);
	});

	test("[tag-input-direction] Checks RTL arrow mapping and logical input caret boundaries", async () => {
		const { input, root } = await mount('dir="rtl"', ["alpha", "beta"]);
		let current = elementsFor(root);

		current.removes[0]?.focus();
		keydown(current.removes[0]!, "ArrowLeft");
		expect(document.activeElement).toBe(current.removes[1]);

		input.value = "abc";
		input.setSelectionRange(0, 0);
		input.focus();
		keydown(input, "ArrowRight");
		current = elementsFor(root);
		expect(document.activeElement).toBe(current.removes[1]);

		input.focus();
		input.setSelectionRange(input.value.length, input.value.length);
		keydown(input, "ArrowLeft");
		expect(document.activeElement).toBe(input);
	});

	test("[tag-input-focus-after-removal][tag-input-focus-request-negative] Checks conditions for focus restoration to next chip, previous chip, or input and programmatic removal", async () => {
		const { input, root } = await mount();
		let deferRemoval = false;
		let deferredChip: HTMLLIElement | undefined;
		root.addEventListener("tag-input:remove", (event) => {
			const detail = (event as CustomEvent<TagInputRemoveDetail>).detail;
			if (deferRemoval) {
				deferredChip = detail.chip as HTMLLIElement;
				return;
			}
			detail.chip.remove();
		});
		const removeDeferredChip = () => {
			deferredChip?.remove();
			deferredChip = undefined;
		};

		let current = elementsFor(root);
		current.removes[1]?.focus();
		await userEvent.keyboard("{Delete}");
		await settle();
		current = elementsFor(root);
		expect(current.chips.map((chip) => chip.dataset.tagInputValue)).toEqual(["alpha", "gamma"]);
		expect(document.activeElement).toBe(current.removes[1]);

		current.removes[1]?.focus();
		await userEvent.keyboard("{Backspace}");
		await settle();
		current = elementsFor(root);
		expect(current.chips.map((chip) => chip.dataset.tagInputValue)).toEqual(["alpha"]);
		expect(document.activeElement).toBe(current.removes[0]);

		current.removes[0]?.focus();
		await userEvent.keyboard("{Delete}");
		await settle();
		current = elementsFor(root);
		expect(current.chips).toHaveLength(0);
		expect(document.activeElement).toBe(input);

		current.list.insertAdjacentHTML("beforeend", chipMarkup("programmatic"));
		await settle();
		current = elementsFor(root);
		current.removes[0]?.focus();
		current.chips[0]?.remove();
		await settle();
		expect(document.activeElement).not.toBe(input);

		current.list.insertAdjacentHTML("beforeend", chipMarkup("outside"));
		await settle();
		const outside = document.createElement("button");
		outside.type = "button";
		outside.textContent = "outside";
		document.body.append(outside);
		current = elementsFor(root);
		deferRemoval = true;
		current.removes[0]?.focus();
		await userEvent.keyboard("{Delete}");
		outside.focus();
		removeDeferredChip();
		deferRemoval = false;
		await settle();
		expect(document.activeElement).toBe(outside);

		current.list.insertAdjacentHTML("beforeend", chipMarkup("input-focus"));
		current.list.insertAdjacentHTML("beforeend", chipMarkup("input-next"));
		await settle();
		current = elementsFor(root);
		deferRemoval = true;
		current.removes[0]?.focus();
		await userEvent.keyboard("{Delete}");
		input.focus();
		removeDeferredChip();
		deferRemoval = false;
		await settle();
		expect(document.activeElement).toBe(input);
	});

	test("[tag-input-dynamic-targets][tag-input-tabstop-negative] Maintains one tab stop through target and disabled changes", async () => {
		const { list, root } = await mount("", ["alpha"]);
		let current = elementsFor(root);
		expect(
			current.removes.filter((remove) => remove.getAttribute("tabindex") === "0"),
		).toHaveLength(1);

		list.insertAdjacentHTML("beforeend", chipMarkup("disabled", "disabled"));
		await settle();
		current = elementsFor(root);
		expect(
			current.removes.filter((remove) => remove.getAttribute("tabindex") === "0"),
		).toHaveLength(1);
		expect(current.removes[1]?.getAttribute("tabindex")).toBe("-1");

		list.insertAdjacentHTML("beforeend", chipMarkup("gamma"));
		await settle();
		current = elementsFor(root);
		expect(
			current.removes.filter((remove) => remove.getAttribute("tabindex") === "0"),
		).toHaveLength(1);

		current.removes[1]?.removeAttribute("disabled");
		await settle();
		current = elementsFor(root);
		expect(
			current.removes.filter((remove) => remove.getAttribute("tabindex") === "0"),
		).toHaveLength(1);

		current.chips[0]?.remove();
		await settle();
		current = elementsFor(root);
		expect(
			current.removes.filter((remove) => remove.getAttribute("tabindex") === "0"),
		).toHaveLength(1);
	});

	test("[tag-input-values-api] The values getter returns chip targets in DOM order", async () => {
		const { list, root } = await mount("", ["alpha", "beta"]);
		const controller = controllerFor(root);
		expect(controller.values).toEqual(["alpha", "beta"]);

		list.insertAdjacentHTML("afterbegin", chipMarkup("zero"));
		await settle();
		expect(controller.values).toEqual(["zero", "alpha", "beta"]);

		elementsFor(root).chips[1]?.remove();
		await settle();
		expect(controller.values).toEqual(["zero", "beta"]);
	});

	test("[tag-input-semantic-validation][tag-input-semantic-validation-negative] Disables invalid markup with one warning", async () => {
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			const missingInput = await mountRaw(
				`<div data-controller="tag-input"><ul><li data-tag-input-target="chip" data-tag-input-value="a"><button type="button" data-tag-input-target="remove">削除</button></li></ul></div>`,
			);
			const notLi = await mountRaw(
				`<div data-controller="tag-input"><ul><div data-tag-input-target="chip" data-tag-input-value="a"><button type="button" data-tag-input-target="remove">削除</button></div></ul><input data-tag-input-target="input"></div>`,
			);
			const missingValue = await mountRaw(
				`<div data-controller="tag-input"><ul><li data-tag-input-target="chip"><button type="button" data-tag-input-target="remove">削除</button></li></ul><input data-tag-input-target="input"></div>`,
			);
			const notButton = await mountRaw(
				`<div data-controller="tag-input"><ul><li data-tag-input-target="chip" data-tag-input-value="a"><a data-tag-input-target="remove" aria-label="削除">削除</a></li></ul><input data-tag-input-target="input"></div>`,
			);
			const missingName = await mountRaw(
				`<div data-controller="tag-input"><ul><li data-tag-input-target="chip" data-tag-input-value="a"><button type="button" data-tag-input-target="remove"></button></li></ul><input data-tag-input-target="input"></div>`,
			);

			expect(warnings).toHaveLength(5);
			expect(warnings.every((warning) => warning.includes("Enhancement has been disabled"))).toBe(
				true,
			);
			expect(missingInput.hasAttribute("role")).toBe(false);
			expect(
				notLi.querySelector("[data-tag-input-target='remove']")?.hasAttribute("tabindex"),
			).toBe(false);
			expect(
				missingValue.querySelector("[data-tag-input-target='remove']")?.hasAttribute("tabindex"),
			).toBe(false);
			expect(
				notButton.querySelector("[data-tag-input-target='remove']")?.hasAttribute("tabindex"),
			).toBe(false);
			expect(
				missingName.querySelector("[data-tag-input-target='remove']")?.hasAttribute("tabindex"),
			).toBe(false);

			missingValue.insertAdjacentHTML("beforeend", '<input data-tag-input-target="input">');
			await settle();
			expect(warnings).toHaveLength(5);
		} finally {
			console.warn = originalWarn;
		}
	});

	test("[tag-input-disconnect-cleanup][tag-input-disconnect-cleanup-negative] Removes listeners and discards pending work across disconnect and reconnect", async () => {
		const { root } = await mount("", ["alpha", "beta"]);
		const controller = controllerFor(root);
		let current = elementsFor(root);
		current.removes[0]?.focus();

		controller.disconnect();
		const disconnectedKeydown = keydown(current.removes[0]!, "ArrowRight");
		expect(disconnectedKeydown.defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(current.removes[0]);

		controller.connect();
		await settle();
		current = elementsFor(root);
		current.removes[0]?.focus();
		await userEvent.keyboard("{Delete}");
		await settle();

		controller.disconnect();
		controller.connect();
		await settle();
		current = elementsFor(root);
		current.chips[0]?.remove();
		await settle();
		expect(document.activeElement).not.toBe(current.input);
	});
});
