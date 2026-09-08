import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";
import CheckboxGroupController, {
	type CheckboxGroupChangeDetail,
} from "../src/checkbox_group_controller";

type CheckboxGroupPublicController = Controller & {
	selected: string[];
};

type ItemDefinition = {
	value: string;
	checked?: boolean;
	disabled?: boolean;
	attributes?: string;
};

type MountedGroup = {
	prefix: string;
	wrapper: HTMLElement;
	root: HTMLElement;
	form: HTMLFormElement | null;
	master: HTMLInputElement;
	items: HTMLInputElement[];
};

type RecordedEvent = {
	type: string;
	detail: CheckboxGroupChangeDetail;
	bubbles: boolean;
	cancelable: boolean;
	target: EventTarget | null;
};

let application: Application;
let mountCount = 0;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const defaultItems = (): ItemDefinition[] => [
	{ value: "one" },
	{ value: "two" },
	{ value: "three" },
];

const mount = async ({
	prefix = `checkbox-group-${mountCount++}`,
	rootAttributes = "",
	items = defaultItems(),
	masterAttributes = "",
	withForm = false,
}: {
	prefix?: string;
	rootAttributes?: string;
	items?: ItemDefinition[];
	masterAttributes?: string;
	withForm?: boolean;
} = {}): Promise<MountedGroup> => {
	const itemMarkup = items
		.map((item) => {
			const checked = item.checked ? " checked" : "";
			const disabled = item.disabled ? " disabled" : "";
			return (
				"<li>" +
				`<label data-testid="${prefix}-label-${item.value}" for="${prefix}-${item.value}">${item.value}</label>` +
				`<input id="${prefix}-${item.value}" type="checkbox" data-testid="${prefix}-item-${item.value}" data-checkbox-group-target="item" data-checkbox-group-value="${item.value}" aria-label="${item.value}"${checked}${disabled} ${item.attributes ?? ""}>` +
				"</li>"
			);
		})
		.join("");
	const group =
		`<div data-controller="checkbox-group" role="group" aria-label="選択肢" ${rootAttributes}>` +
		`<label data-testid="${prefix}-master-label" for="${prefix}-master">全選択</label>` +
		`<input id="${prefix}-master" type="checkbox" data-testid="${prefix}-master" data-checkbox-group-target="all" aria-label="全選択" ${masterAttributes}>` +
		`<ul>${itemMarkup}</ul></div>`;
	const content = withForm ? `<form data-testid="${prefix}-form">${group}</form>` : group;
	document.body.insertAdjacentHTML(
		"beforeend",
		`<section data-testid="${prefix}-wrapper">${content}</section>`,
	);
	await settle();

	const wrapper = document.body.lastElementChild;
	if (!(wrapper instanceof HTMLElement)) throw new Error("checkbox-group の wrapper がありません");
	const root = wrapper.querySelector<HTMLElement>('[data-controller~="checkbox-group"]');
	if (root === null) throw new Error("checkbox-group の root がありません");
	const form = wrapper.querySelector<HTMLFormElement>("form");
	const master = root.querySelector<HTMLInputElement>('[data-checkbox-group-target="all"]');
	if (master === null) {
		throw new Error("checkbox-group の markup がありません");
	}
	return {
		prefix,
		wrapper,
		root,
		form,
		master,
		items: Array.from(
			root.querySelectorAll<HTMLInputElement>('[data-checkbox-group-target="item"]'),
		),
	};
};

const mountRaw = async (markup: string) => {
	document.body.insertAdjacentHTML("beforeend", markup);
	await settle();
	return document.body.lastElementChild;
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"checkbox-group",
	) as CheckboxGroupPublicController | null;
	if (controller === null) throw new Error("checkbox-group controller が接続されていません");
	return controller;
};

const eventsFrom = (root: HTMLElement) => {
	const events: RecordedEvent[] = [];
	for (const type of ["checkbox-group:beforechange", "checkbox-group:change"]) {
		root.addEventListener(type, (event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<CheckboxGroupChangeDetail>).detail,
				bubbles: event.bubbles,
				cancelable: event.cancelable,
				target: event.target,
			});
		});
	}
	return events;
};

const clickItem = async (prefix: string, value: string) => {
	await page.getByTestId(`${prefix}-item-${value}`).click();
	await settle();
};

const clickItemLabel = async (prefix: string, value: string) => {
	await page.getByTestId(`${prefix}-label-${value}`).click();
	await settle();
};

const clickMaster = async (prefix: string) => {
	await page.getByTestId(`${prefix}-master`).click();
	await settle();
};

const clickMasterLabel = async (prefix: string) => {
	await page.getByTestId(`${prefix}-master-label`).click();
	await settle();
};

const valuesOf = (items: HTMLInputElement[]) =>
	items.filter((item) => item.checked).map((item) => item.dataset.checkboxGroupValue ?? "");

beforeEach(() => {
	document.body.innerHTML = "";
	mountCount = 0;
	application = Application.start();
	application.register("checkbox-group", CheckboxGroupController);
});

afterEach(() => {
	vi.restoreAllMocks();
	application.stop();
	document.body.innerHTML = "";
});

describe("checkbox-group", () => {
	test("[checkbox-group-master-sync][checkbox-group-master-sync-negative] Synchronizes three master states, disabled exclusions, dynamic targets, and form reset without events", async () => {
		const { prefix, root, form, master, items } = await mount({
			prefix: "master-sync",
			items: [
				{ value: "one", checked: true },
				{ value: "two" },
				{ value: "disabled", disabled: true },
			],
			withForm: true,
		});
		if (form === null) throw new Error("form がありません");
		const events = eventsFrom(root);

		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
		await clickItem(prefix, "two");
		expect(master.checked).toBe(true);
		expect(master.indeterminate).toBe(false);

		await clickItem(prefix, "one");
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
		await clickItem(prefix, "two");
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(false);

		events.length = 0;
		items[2]!.checked = true;
		items[2]!.dispatchEvent(new Event("change", { bubbles: true }));
		await settle();
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(false);

		root
			.querySelector("ul")
			?.insertAdjacentHTML(
				"beforeend",
				`<li><input id="${prefix}-dynamic" type="checkbox" checked data-testid="${prefix}-item-dynamic" data-checkbox-group-target="item" data-checkbox-group-value="dynamic" aria-label="dynamic"></li>`,
			);
		await settle();
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);

		root.querySelector<HTMLInputElement>(`#${prefix}-dynamic`)!.remove();
		await settle();
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(false);

		root
			.querySelector("ul")
			?.insertAdjacentHTML(
				"beforeend",
				`<li><input id="${prefix}-dynamic-disabled" type="checkbox" checked disabled data-checkbox-group-target="item" data-checkbox-group-value="dynamic-disabled" aria-label="dynamic disabled"></li>`,
			);
		await settle();
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(false);
		root.querySelector<HTMLInputElement>(`#${prefix}-dynamic-disabled`)!.remove();
		await settle();

		items[0]!.checked = false;
		items[1]!.checked = true;
		items[1]!.dispatchEvent(new Event("change", { bubbles: true }));
		await settle();
		events.length = 0;
		form.reset();
		await settle();
		expect(items.map((item) => item.checked)).toEqual([true, false, false]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
		expect(events).toEqual([]);
	});

	test("[checkbox-group-master-toggle][checkbox-group-master-toggle-negative] Preserves disabled items during master select-all/clear-all and label or keyboard interaction", async () => {
		const { prefix, root, master, items } = await mount({
			prefix: "master-toggle",
			items: [
				{ value: "one" },
				{ value: "two" },
				{ value: "blocked", disabled: true },
				{ value: "frozen", checked: true, disabled: true },
			],
		});
		const events = eventsFrom(root);

		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(false);
		await clickMaster(prefix);
		expect(valuesOf(items)).toEqual(["one", "two", "frozen"]);
		expect(master.checked).toBe(true);
		expect(master.indeterminate).toBe(false);
		expect(events[0]?.detail).toEqual({
			selected: ["one", "two", "frozen"],
			previousSelected: ["frozen"],
			reason: "pointer",
		});

		await clickMaster(prefix);
		expect(valuesOf(items)).toEqual(["frozen"]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(false);

		await clickMasterLabel(prefix);
		expect(valuesOf(items)).toEqual(["one", "two", "frozen"]);
		expect(document.activeElement).toBe(master);

		await clickItemLabel(prefix, "one");
		expect(valuesOf(items)).toEqual(["two", "frozen"]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
		expect(document.activeElement).toBe(items[0]);

		master.focus();
		await userEvent.keyboard("{Space}");
		await settle();
		expect(valuesOf(items)).toEqual(["one", "two", "frozen"]);
		expect(events.at(-1)?.detail.reason).toBe("keyboard");

		const eventCount = events.length;
		items[2]!.disabled = false;
		root.addEventListener("click", () => (items[2]!.disabled = true), {
			capture: true,
			once: true,
		});
		await clickItemLabel(prefix, "blocked");
		expect(items[2]?.checked).toBe(false);
		expect(items[3]?.checked).toBe(true);
		expect(events).toHaveLength(eventCount);
	});

	test("[checkbox-group-beforechange-cancel][checkbox-group-beforechange-cancel-negative] Checks individual and master cancellation restoration and committed detail, order, bubbling, and reason", async () => {
		const { prefix, wrapper, root, master, items } = await mount({ prefix: "cancel" });
		const events = eventsFrom(root);
		const bubbledTypes: string[] = [];
		for (const type of ["checkbox-group:beforechange", "checkbox-group:change"]) {
			wrapper.addEventListener(type, (event) => bubbledTypes.push(event.type));
		}
		const cancel = (event: Event) => event.preventDefault();
		root.addEventListener("checkbox-group:beforechange", cancel);

		await clickItem(prefix, "one");
		expect(valuesOf(items)).toEqual([]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(false);
		expect(events.map(({ type }) => type)).toEqual(["checkbox-group:beforechange"]);

		root.removeEventListener("checkbox-group:beforechange", cancel);
		items[0]!.focus();
		await userEvent.keyboard("{Space}");
		await settle();
		expect(valuesOf(items)).toEqual(["one"]);
		expect(events.map(({ type }) => type)).toEqual([
			"checkbox-group:beforechange",
			"checkbox-group:beforechange",
			"checkbox-group:change",
		]);
		expect(events[1]?.detail).toEqual({
			selected: ["one"],
			previousSelected: [],
			reason: "keyboard",
		});
		expect(events[2]?.detail).toEqual(events[1]?.detail);
		expect(events[1]?.bubbles).toBe(true);
		expect(events[1]?.cancelable).toBe(true);
		expect(events[2]?.bubbles).toBe(true);
		expect(events[2]?.cancelable).toBe(false);
		expect(events[1]?.target).toBe(root);

		await clickItem(prefix, "three");
		expect(events.at(-2)?.detail).toEqual({
			selected: ["one", "three"],
			previousSelected: ["one"],
			reason: "pointer",
		});

		root.addEventListener("checkbox-group:beforechange", cancel);
		await clickMaster(prefix);
		expect(valuesOf(items)).toEqual(["one", "three"]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
		expect(events.at(-1)?.type).toBe("checkbox-group:beforechange");
		expect(events.at(-1)?.detail).toEqual({
			selected: ["one", "two", "three"],
			previousSelected: ["one", "three"],
			reason: "pointer",
		});

		root.removeEventListener("checkbox-group:beforechange", cancel);
		await clickMaster(prefix);
		expect(valuesOf(items)).toEqual(["one", "two", "three"]);
		expect(events.at(-1)?.type).toBe("checkbox-group:change");
		expect(bubbledTypes).toEqual(events.map(({ type }) => type));
	});

	test("[checkbox-group-programmatic-silence][checkbox-group-programmatic-silence-negative] Synchronizes only the master without events for selected setters and synthetic click/change", async () => {
		const { root, master, items } = await mount({
			prefix: "programmatic",
			items: [{ value: "one" }, { value: "two" }, { value: "disabled", disabled: true }],
		});
		const controller = controllerFor(root);
		const events = eventsFrom(root);

		controller.selected = ["two", "unknown", "disabled"];
		expect(controller.selected).toEqual(["two", "disabled"]);
		expect(valuesOf(items)).toEqual(["two", "disabled"]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
		expect(events).toEqual([]);

		items[0]!.click();
		await settle();
		expect(valuesOf(items)).toEqual(["one", "two", "disabled"]);
		expect(master.checked).toBe(true);
		expect(master.indeterminate).toBe(false);
		expect(events).toEqual([]);

		items[1]!.checked = false;
		items[1]!.dispatchEvent(new Event("change", { bubbles: true }));
		await settle();
		expect(valuesOf(items)).toEqual(["one", "disabled"]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
		expect(events).toEqual([]);

		master.click();
		await settle();
		expect(valuesOf(items)).toEqual(["one", "disabled"]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
		expect(events).toEqual([]);

		controller.selected = ["unknown"];
		expect(controller.selected).toEqual([]);
		expect(valuesOf(items)).toEqual([]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(false);
		expect(events).toEqual([]);
	});

	test("[checkbox-group-semantic-validation][checkbox-group-semantic-validation-negative] Disables invalid markup with one warning and reapplies enhancement when valid", async () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		const cases = [
			`<div data-controller="checkbox-group" data-state="authored" aria-label="authored"><input type="checkbox" data-checkbox-group-target="all"></div>`,
			`<div data-controller="checkbox-group" data-state="authored" aria-label="authored"><input type="checkbox" data-testid="invalid-no-all" data-checkbox-group-target="item" data-checkbox-group-value="x"></div>`,
			`<div data-controller="checkbox-group" data-state="authored" aria-label="authored"><input type="checkbox" data-checkbox-group-target="all"><input type="checkbox" data-checkbox-group-target="all"><input type="checkbox" data-checkbox-group-target="item" data-checkbox-group-value="x"></div>`,
			`<div data-controller="checkbox-group" data-state="authored" aria-label="authored"><input type="checkbox" data-testid="invalid-shared" data-checkbox-group-target="item all" data-checkbox-group-value="x"></div>`,
			`<div data-controller="checkbox-group" data-state="authored" aria-label="authored"><input type="text" data-checkbox-group-target="item" data-checkbox-group-value="x"><input type="checkbox" data-checkbox-group-target="all"></div>`,
			`<div data-controller="checkbox-group" data-state="authored" aria-label="authored"><input type="checkbox" data-checkbox-group-target="item" data-checkbox-group-value="x"><input type="checkbox" data-checkbox-group-target="item" data-checkbox-group-value="x"><input type="checkbox" data-checkbox-group-target="all"></div>`,
			`<div data-controller="checkbox-group" data-state="authored" aria-label="authored"><input type="checkbox" data-checkbox-group-target="item" data-checkbox-group-value=" "><input type="checkbox" data-checkbox-group-target="all"></div>`,
			`<div data-controller="checkbox-group" data-state="authored" aria-label="authored"><input type="checkbox" data-checkbox-group-target="item" data-checkbox-group-value="x"><button type="button" data-checkbox-group-target="all">all</button></div>`,
		];

		for (const markup of cases) {
			const root = await mountRaw(markup);
			if (!(root instanceof HTMLElement)) throw new Error("invalid root がありません");
			const controller = controllerFor(root);
			const eventTypes: string[] = [];
			root.addEventListener("checkbox-group:beforechange", (event) => eventTypes.push(event.type));
			const checkboxes = Array.from(
				root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
			);
			const checkedBefore = checkboxes.map((checkbox) => checkbox.checked);

			controller.selected = ["x"];
			expect(controller.selected).toEqual([]);
			expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual(checkedBefore);
			const item = root.querySelector<HTMLElement>('[data-checkbox-group-target~="item"]');
			if (item !== null) await userEvent.click(item);
			await settle();
			expect(root.dataset.state).toBe("authored");
			expect(root.getAttribute("aria-label")).toBe("authored");
			expect(root.querySelector("[aria-selected], [aria-expanded], [data-state]")).toBeNull();
			expect(eventTypes).toEqual([]);
		}

		expect(warning).toHaveBeenCalledTimes(cases.length);
		expect(String(warning.mock.calls[0]?.[0])).toContain("checkbox-group controller");
		expect(String(warning.mock.calls[0]?.[0])).toContain("data-checkbox-group-value");
		expect(String(warning.mock.calls[0]?.[0])).toContain('<input type="checkbox">');
		expect(String(warning.mock.calls[0]?.[0])).toContain("Enhancement has been disabled");

		const recovery = await mountRaw(
			`<div data-controller="checkbox-group" data-state="authored" aria-label="authored"><label for="recovery-item">x</label><input id="recovery-item" type="checkbox" checked data-testid="recovery-item" data-checkbox-group-target="item" data-checkbox-group-value="x" aria-describedby="authored-description"></div>`,
		);
		if (!(recovery instanceof HTMLElement)) throw new Error("recovery root がありません");
		const recoveryEvents = eventsFrom(recovery);
		const recoveryController = controllerFor(recovery);
		expect(warning).toHaveBeenCalledTimes(cases.length + 1);

		recovery.insertAdjacentHTML(
			"afterbegin",
			`<label for="recovery-master">all</label><input id="recovery-master" type="checkbox" data-checkbox-group-target="all" aria-label="all">`,
		);
		await settle();
		let recoveryMaster = recovery.querySelector<HTMLInputElement>("#recovery-master");
		const recoveryItem = recovery.querySelector<HTMLInputElement>("#recovery-item");
		if (recoveryMaster === null || recoveryItem === null) {
			throw new Error("recovery target がありません");
		}
		expect(recoveryMaster.checked).toBe(true);
		expect(recoveryMaster.indeterminate).toBe(false);
		expect(recovery.dataset.state).toBe("authored");
		expect(recoveryItem.getAttribute("aria-describedby")).toBe("authored-description");

		recoveryController.selected = [];
		expect(recoveryItem.checked).toBe(false);
		expect(recoveryMaster.checked).toBe(false);
		expect(recoveryEvents).toEqual([]);
		await page.getByTestId("recovery-item").click();
		await settle();
		expect(recoveryEvents).toHaveLength(2);

		recoveryMaster.remove();
		await settle();
		await page.getByTestId("recovery-item").click();
		await settle();
		expect(recoveryEvents).toHaveLength(2);

		recovery.insertAdjacentHTML(
			"afterbegin",
			`<input id="recovery-master-2" type="checkbox" data-checkbox-group-target="all" aria-label="all">`,
		);
		await settle();
		recoveryMaster = recovery.querySelector<HTMLInputElement>("#recovery-master-2");
		if (recoveryMaster === null) throw new Error("再追加した master がありません");
		expect(recoveryMaster.checked).toBe(false);
		await page.getByTestId("recovery-item").click();
		await settle();
		expect(recoveryEvents).toHaveLength(4);
		expect(warning).toHaveBeenCalledTimes(cases.length + 1);
	});

	test("[checkbox-group-disconnect-cleanup][checkbox-group-disconnect-cleanup-negative] Removes listeners across disconnect and reconnect while preserving checkbox state", async () => {
		const { prefix, root, form, master, items } = await mount({
			prefix: "lifecycle",
			items: [{ value: "one" }, { value: "two" }],
			withForm: true,
		});
		if (form === null) throw new Error("form がありません");
		const controller = controllerFor(root);
		const events = eventsFrom(root);
		const removeRootListener = vi.spyOn(root, "removeEventListener");
		const removeFormListener = vi.spyOn(form, "removeEventListener");

		await clickItem(prefix, "one");
		expect(events).toHaveLength(2);
		const itemStates = items.map((item) => item.checked);
		const masterState = { checked: master.checked, indeterminate: master.indeterminate };

		controller.disconnect();
		expect(items.map((item) => item.checked)).toEqual(itemStates);
		expect({ checked: master.checked, indeterminate: master.indeterminate }).toEqual(masterState);
		expect(removeRootListener).toHaveBeenCalledWith("click", expect.any(Function));
		expect(removeRootListener).toHaveBeenCalledWith("change", expect.any(Function));
		expect(removeFormListener).toHaveBeenCalledWith("reset", expect.any(Function));

		await clickItem(prefix, "two");
		expect(valuesOf(items)).toEqual(["one", "two"]);
		expect(events).toHaveLength(2);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);

		controller.connect();
		await settle();
		expect(master.checked).toBe(true);
		expect(master.indeterminate).toBe(false);

		await clickItem(prefix, "one");
		expect(valuesOf(items)).toEqual(["two"]);
		expect(events).toHaveLength(4);
	});
});
