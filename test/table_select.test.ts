import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";
import TableSelectController, {
	type TableSelectChangeDetail,
} from "../src/table_select_controller";
import TableSortController from "../src/table_sort_controller";

type TableSelectPublicController = Controller & {
	selected: string[];
};

type ItemDefinition = {
	value: string;
	checked?: boolean;
	disabled?: boolean;
	attributes?: string;
};

type MountedTable = {
	prefix: string;
	root: HTMLTableElement;
	form: HTMLFormElement | null;
	master: HTMLInputElement | null;
	items: HTMLInputElement[];
};

type RecordedEvent = {
	type: string;
	detail: TableSelectChangeDetail;
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
	{ value: "four" },
];

const mount = async ({
	prefix = `table-select-${mountCount++}`,
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
} = {}): Promise<MountedTable> => {
	const rows = items
		.map((item) => {
			const checked = item.checked ? " checked" : "";
			const disabled = item.disabled ? " disabled" : "";
			return (
				`<tr><th scope="row">${item.value}</th><td>` +
				`<label data-testid="${prefix}-label-${item.value}" for="${prefix}-${item.value}">${item.value}</label>` +
				`<input id="${prefix}-${item.value}" type="checkbox" data-testid="${prefix}-item-${item.value}" data-table-select-target="item" data-table-select-value="${item.value}" aria-label="${item.value}"${checked}${disabled} ${item.attributes ?? ""}>` +
				"</td></tr>"
			);
		})
		.join("");
	const table =
		`<table data-controller="table-select" aria-label="利用者一覧" ${rootAttributes}>` +
		`<thead><tr><th scope="col"><label for="${prefix}-master">全選択</label><input id="${prefix}-master" type="checkbox" data-testid="${prefix}-master" data-table-select-target="all" aria-label="全選択" ${masterAttributes}></th></tr></thead>` +
		`<tbody>${rows}</tbody></table>`;
	const markup = withForm ? `<form data-testid="${prefix}-form">${table}</form>` : table;
	document.body.insertAdjacentHTML("beforeend", markup);
	await settle();

	const wrapper = document.body.lastElementChild;
	const root = wrapper instanceof HTMLTableElement ? wrapper : wrapper?.querySelector("table");
	const form = wrapper instanceof HTMLFormElement ? wrapper : null;
	if (!(root instanceof HTMLTableElement)) throw new Error("table-select root がありません");
	return {
		prefix,
		root,
		form,
		master: root.querySelector<HTMLInputElement>('[data-table-select-target="all"]'),
		items: Array.from(root.querySelectorAll<HTMLInputElement>('[data-table-select-target="item"]')),
	};
};

const mountRaw = async (markup: string) => {
	document.body.insertAdjacentHTML("beforeend", markup);
	await settle();
	return document.body.lastElementChild;
};

const controllerFor = (root: HTMLTableElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"table-select",
	) as TableSelectPublicController | null;
	if (controller === null) throw new Error("table-select controller が接続されていません");
	return controller;
};

const eventsFrom = (root: HTMLTableElement) => {
	const events: RecordedEvent[] = [];
	for (const type of ["table-select:beforechange", "table-select:change"]) {
		root.addEventListener(type, (event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<TableSelectChangeDetail>).detail,
				bubbles: event.bubbles,
				cancelable: event.cancelable,
				target: event.target,
			});
		});
	}
	return events;
};

const clickInput = async (prefix: string, value: string) => {
	await page.getByTestId(`${prefix}-item-${value}`).click();
	await settle();
};

const shiftClickInput = async (prefix: string, value: string) => {
	await page.getByTestId(`${prefix}-item-${value}`).click({ modifiers: ["Shift"] });
	await settle();
};

const shiftClickLabel = async (_root: HTMLTableElement, prefix: string, value: string) => {
	await page.getByTestId(`${prefix}-label-${value}`).click({ modifiers: ["Shift"] });
	await settle();
};

const clickMaster = async (prefix: string) => {
	await page.getByTestId(`${prefix}-master`).click();
	await settle();
};

const valuesOf = (items: HTMLInputElement[]) =>
	items.filter((item) => item.checked).map((item) => item.dataset.tableSelectValue);

beforeEach(() => {
	document.body.innerHTML = "";
	mountCount = 0;
	application = Application.start();
	application.register("table-select", TableSelectController);
});

afterEach(() => {
	vi.restoreAllMocks();
	application.stop();
	document.body.innerHTML = "";
});

describe("table-select", () => {
	test("[table-select-master-sync][table-select-master-sync-negative] Synchronizes three master states, dynamic targets, and form reset without events", async () => {
		const { prefix, root, master, items, form } = await mount({
			items: [{ value: "one", checked: true }, { value: "two" }, { value: "three" }],
			withForm: true,
		});
		if (!master || !form) throw new Error("master または form がありません");
		const events = eventsFrom(root);

		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
		await clickInput(prefix, "two");
		await clickInput(prefix, "three");
		expect(master.checked).toBe(true);
		expect(master.indeterminate).toBe(false);

		await clickInput(prefix, "one");
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
		await clickInput(prefix, "two");
		await clickInput(prefix, "three");
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(false);

		events.length = 0;
		root.tBodies[0]?.insertAdjacentHTML(
			"beforeend",
			`<tr><td><input id="${prefix}-item-four" type="checkbox" data-testid="${prefix}-item-four" data-table-select-target="item" data-table-select-value="four" aria-label="four"></td></tr>`,
		);
		await settle();
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(false);

		root.querySelector<HTMLInputElement>(`#${prefix}-item-four`)!.checked = true;
		root
			.querySelector<HTMLInputElement>(`#${prefix}-item-four`)!
			.dispatchEvent(new Event("change", { bubbles: true }));
		await settle();
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);

		root.querySelector<HTMLInputElement>(`#${prefix}-item-four`)!.remove();
		await settle();
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(false);

		items[0]!.checked = true;
		items[1]!.checked = true;
		form.reset();
		await settle();
		expect(items.map((item) => item.checked)).toEqual([true, false, false]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
		expect(events).toEqual([]);
	});

	test("[table-select-range][table-select-range-negative] Checks anchored Shift-click, Shift+Space, labels, both directions, disabled items, and missing anchors", async () => {
		const noAnchor = await mount({
			prefix: "no-anchor",
		});
		await shiftClickInput(noAnchor.prefix, "three");
		expect(valuesOf(noAnchor.items)).toEqual(["three"]);

		const downward = await mount({ prefix: "downward" });
		await clickInput(downward.prefix, "two");
		await shiftClickInput(downward.prefix, "four");
		expect(valuesOf(downward.items)).toEqual(["two", "three", "four"]);

		const upward = await mount({
			prefix: "upward",
			items: [
				{ value: "one" },
				{ value: "two" },
				{ value: "three", disabled: true },
				{ value: "four" },
			],
		});
		await clickInput(upward.prefix, "four");
		await shiftClickInput(upward.prefix, "two");
		expect(valuesOf(upward.items)).toEqual(["two", "four"]);
		expect(upward.items[2]?.checked).toBe(false);

		const keyboard = await mount({ prefix: "keyboard" });
		const keyboardEvents = eventsFrom(keyboard.root);
		await clickInput(keyboard.prefix, "one");
		keyboard.items[2]!.focus();
		await userEvent.keyboard("{Shift>}{Space}{/Shift}");
		await settle();
		expect(valuesOf(keyboard.items)).toEqual(["one", "two", "three"]);
		expect(keyboardEvents.at(-1)?.detail.reason).toBe("keyboard");

		const stale = await mount({ prefix: "stale-shift" });
		await clickInput(stale.prefix, "one");
		stale.items[0]!.focus();
		await userEvent.keyboard("{Shift>}");
		const outside = document.createElement("button");
		outside.type = "button";
		document.body.append(outside);
		outside.focus();
		await userEvent.keyboard("{/Shift}");
		stale.items[2]!.focus();
		await userEvent.keyboard("{Space}");
		await settle();
		expect(valuesOf(stale.items)).toEqual(["one", "three"]);

		const label = await mount({ prefix: "label" });
		await clickInput(label.prefix, "one");
		await shiftClickLabel(label.root, label.prefix, "three");
		expect(valuesOf(label.items)).toEqual(["one", "two", "three"]);
		expect(document.activeElement).toBe(label.items[2]);
	});

	test("table-select and table-sort on the same table do not change each other's selection or sorting", async () => {
		application.register("table-sort", TableSortController);
		const prefix = "table-select-table-sort";
		document.body.insertAdjacentHTML(
			"beforeend",
			`<table data-controller="table-select table-sort" aria-label="利用者一覧">
				<thead><tr>
					<th data-table-sort-target="sortable" data-table-sort-column="name" scope="col"><button type="button" data-testid="${prefix}-sort">名前</button></th>
					<th scope="col"><input type="checkbox" data-testid="${prefix}-master" data-table-select-target="all" aria-label="全選択"></th>
				</tr></thead>
				<tbody>
					<tr><td><input type="checkbox" data-testid="${prefix}-item-a" data-table-select-target="item" data-table-select-value="a" aria-label="A"></td><td>A</td></tr>
					<tr><td><input type="checkbox" data-testid="${prefix}-item-b" data-table-select-target="item" data-table-select-value="b" aria-label="B"></td><td>B</td></tr>
					<tr><td><input type="checkbox" data-testid="${prefix}-item-c" data-table-select-target="item" data-table-select-value="c" aria-label="C"></td><td>C</td></tr>
				</tbody>
			</table>`,
		);
		await settle();

		const root = document.body.lastElementChild;
		if (!(root instanceof HTMLTableElement)) throw new Error("coexistence table がありません");
		const body = root.tBodies[0];
		const sortable = root.querySelector<HTMLTableCellElement>(
			'[data-table-sort-target="sortable"]',
		);
		const master = root.querySelector<HTMLInputElement>('[data-table-select-target="all"]');
		if (body === undefined || sortable === null || master === null) {
			throw new Error("coexistence table の target がありません");
		}
		const sortEvents: Event[] = [];
		root.addEventListener("table-sort:sort", (event) => sortEvents.push(event));

		await page.getByTestId(`${prefix}-item-a`).click();
		await settle();
		expect(sortEvents).toEqual([]);
		expect(sortable.getAttribute("aria-sort")).toBe("none");
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);

		await page.getByTestId(`${prefix}-sort`).click();
		await settle();
		expect(sortEvents).toHaveLength(1);
		expect(sortable.getAttribute("aria-sort")).toBe("ascending");
		expect(
			valuesOf(
				Array.from(root.querySelectorAll<HTMLInputElement>('[data-table-select-target="item"]')),
			),
		).toEqual(["a"]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);

		const rows = Array.from(body.rows);
		body.insertBefore(rows[2]!, rows[0]!);
		await settle();
		expect(Array.from(body.rows, (row) => row.textContent?.trim())).toEqual(["C", "A", "B"]);
		expect(
			Array.from(
				body.rows,
				(row) => row.querySelector<HTMLInputElement>('[data-table-select-target="item"]')?.checked,
			),
		).toEqual([false, true, false]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
	});

	test("[table-select-beforechange-cancel][table-select-beforechange-cancel-negative] Checks cancellation restoration and committed detail for individual, range, and master changes", async () => {
		const { prefix, root, master, items } = await mount({ prefix: "cancel" });
		if (!master) throw new Error("master がありません");
		const events = eventsFrom(root);
		const cancel = (event: Event) => event.preventDefault();
		root.addEventListener("table-select:beforechange", cancel);

		await clickInput(prefix, "one");
		expect(valuesOf(items)).toEqual([]);
		expect(events.map(({ type }) => type)).toEqual(["table-select:beforechange"]);

		root.removeEventListener("table-select:beforechange", cancel);
		await clickInput(prefix, "one");
		expect(events.map(({ type }) => type)).toEqual([
			"table-select:beforechange",
			"table-select:beforechange",
			"table-select:change",
		]);
		expect(events[1]?.detail).toEqual({
			selected: ["one"],
			previousSelected: [],
			reason: "pointer",
		});
		expect(events[2]?.detail).toEqual(events[1]?.detail);
		expect(events[1]?.bubbles).toBe(true);
		expect(events[1]?.cancelable).toBe(true);
		expect(events[2]?.bubbles).toBe(true);
		expect(events[2]?.cancelable).toBe(false);
		expect(events[1]?.target).toBe(root);

		root.addEventListener("table-select:beforechange", cancel);
		await shiftClickInput(prefix, "three");
		expect(valuesOf(items)).toEqual(["one"]);
		expect(master.indeterminate).toBe(true);

		await clickMaster(prefix);
		expect(valuesOf(items)).toEqual(["one"]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);

		root.removeEventListener("table-select:beforechange", cancel);
		await clickMaster(prefix);
		expect(valuesOf(items)).toEqual(["one", "two", "three", "four"]);
		expect(events.at(-2)?.detail).toEqual({
			selected: ["one", "two", "three", "four"],
			previousSelected: ["one"],
			reason: "pointer",
		});
		expect(events.at(-1)?.type).toBe("table-select:change");
	});

	test("[table-select-programmatic-silence][table-select-programmatic-silence-negative] Synchronizes only the master without events for selected setters and synthetic click/change", async () => {
		const { root, master, items } = await mount({ prefix: "programmatic" });
		if (!master) throw new Error("master がありません");
		const controller = controllerFor(root);
		const events = eventsFrom(root);

		controller.selected = ["two"];
		expect(valuesOf(items)).toEqual(["two"]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);
		expect(events).toEqual([]);

		items[0]!.click();
		await settle();
		expect(valuesOf(items)).toEqual(["one", "two"]);
		expect(master.indeterminate).toBe(true);
		expect(events).toEqual([]);

		items[1]!.checked = false;
		items[1]!.dispatchEvent(new Event("change", { bubbles: true }));
		await settle();
		expect(valuesOf(items)).toEqual(["one"]);
		expect(master.indeterminate).toBe(true);
		expect(events).toEqual([]);

		controller.selected = ["unknown"];
		expect(valuesOf(items)).toEqual([]);
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(false);
		expect(events).toEqual([]);
	});

	test("[table-select-semantic-validation][table-select-semantic-validation-negative] Disables invalid markup with one warning without overwriting ARIA or state", async () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		const cases = [
			`<div data-controller="table-select" data-state="authored"><table><tbody><tr><td><input type="checkbox" data-table-select-target="item" data-table-select-value="x"></td></tr></tbody></table></div>`,
			`<table data-controller="table-select" data-state="authored"><caption><input type="checkbox" data-table-select-target="item" data-table-select-value="x"></caption></table>`,
			`<table data-controller="table-select" data-state="authored"><tbody><tr><td><input type="checkbox" data-table-select-target="item" data-table-select-value="x"><input type="checkbox" data-table-select-target="item" data-table-select-value="y"></td></tr></tbody></table>`,
			`<table data-controller="table-select" data-state="authored"><tbody><tr><td><input type="checkbox" data-table-select-target="item" data-table-select-value="x"></td></tr><tr><td><input type="checkbox" data-table-select-target="item" data-table-select-value="x"></td></tr></tbody></table>`,
			`<table data-controller="table-select" data-state="authored"><tbody><tr><td><input type="checkbox" data-table-select-target="item" data-table-select-value=""></td></tr></tbody></table>`,
			`<table data-controller="table-select" data-state="authored"><thead><tr><th><input type="checkbox" data-table-select-target="all" data-table-select-value="master"></th></tr></thead><tbody><tr><td><input type="checkbox" data-table-select-target="item" data-table-select-value="x"><input type="checkbox" data-table-select-target="all"></td></tr></tbody></table>`,
			`<table data-controller="table-select" data-state="authored"><thead><tr><th><input type="checkbox" data-table-select-target="all"></th><th><input type="checkbox" data-table-select-target="all"></th></tr></thead><tbody><tr><td><input type="checkbox" data-table-select-target="item" data-table-select-value="x"></td></tr></tbody></table>`,
			`<table data-controller="table-select" data-state="authored"><thead><tr><th><input type="checkbox" data-table-select-target="item all" data-table-select-value="x"></th></tr></thead><tbody><tr><td><input type="checkbox" data-table-select-target="item" data-table-select-value="y"></td></tr></tbody></table>`,
		];

		for (const markup of cases) {
			const root = await mountRaw(markup);
			if (!(root instanceof HTMLElement)) throw new Error("invalid root がありません");
			const eventTypes: string[] = [];
			root.addEventListener("table-select:beforechange", (event) => eventTypes.push(event.type));
			const item = root.querySelector<HTMLInputElement>('[data-table-select-target~="item"]');
			if (item !== null) await userEvent.click(item);
			await settle();
			expect(root.dataset.state).toBe("authored");
			expect(root.querySelectorAll("[aria-selected], [aria-expanded], [data-state]")).toHaveLength(
				0,
			);
			expect(eventTypes).toEqual([]);
		}

		expect(warning).toHaveBeenCalledTimes(cases.length);
		expect(String(warning.mock.calls[0]?.[0])).toContain("table-select controller");
		expect(String(warning.mock.calls[0]?.[0])).toContain("<table>");
		expect(String(warning.mock.calls[0]?.[0])).toContain("Enhancement has been disabled");
	});

	test("[table-select-disconnect-cleanup][table-select-disconnect-cleanup-negative] Removes listeners and clears anchors across disconnect and reconnect", async () => {
		const { prefix, root, master, items } = await mount({ prefix: "lifecycle" });
		if (!master) throw new Error("master がありません");
		const controller = controllerFor(root);
		const events = eventsFrom(root);
		const removeEventListener = vi.spyOn(root, "removeEventListener");

		await clickInput(prefix, "two");
		expect(events).toHaveLength(2);

		controller.disconnect();
		expect(removeEventListener).toHaveBeenCalledWith("click", expect.any(Function));
		await clickInput(prefix, "one");
		expect(events).toHaveLength(2);

		controller.connect();
		await settle();
		expect(master.checked).toBe(false);
		expect(master.indeterminate).toBe(true);

		await shiftClickInput(prefix, "four");
		expect(valuesOf(items)).toEqual(["one", "two", "four"]);
		expect(items[2]?.checked).toBe(false);
		expect(events).toHaveLength(4);
	});
});
