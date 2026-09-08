import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";
import TableSortController from "../src/table_sort_controller";

type TableSortPublicController = Controller & {
	column: string;
	direction: string;
};

type SortDetail = {
	column: string;
	direction: "ascending" | "descending" | "none";
	previousColumn: string;
	previousDirection: "ascending" | "descending" | "none";
	reason: "pointer" | "keyboard";
};

let application: Application;
let originalWarn: typeof console.warn;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const mount = async (rootAttributes = "") => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<table data-controller="table-sort" aria-label="利用者一覧" ${rootAttributes}>` +
			"<caption>利用者一覧</caption>" +
			"<thead><tr>" +
			'<th id="authored-name" data-table-sort-target="sortable" data-table-sort-column="name" scope="row"><button type="button" data-testid="table-sort-name">名前</button></th>' +
			'<th data-table-sort-target="sortable" data-table-sort-column="price"><button type="button" data-testid="table-sort-price">価格</button></th>' +
			'<th data-table-sort-target="sortable" data-table-sort-column="status" scope="col"><button type="button" data-testid="table-sort-status">状態</button></th>' +
			"</tr></thead>" +
			"<tbody>" +
			'<tr><th scope="row">A</th><td>10</td><td>有効</td></tr>' +
			'<tr><th scope="row">B</th><td>20</td><td>停止</td></tr>' +
			'<tr><th scope="row">C</th><td>30</td><td>有効</td></tr>' +
			"</tbody>" +
			"</table>",
	);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLTableElement)) throw new Error("table-sort root がありません");
	return {
		root,
		headers: Array.from(root.tHead?.rows[0]?.cells ?? []).filter(
			(cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement,
		),
	};
};

const controllerFor = (root: HTMLTableElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"table-sort",
	) as TableSortPublicController | null;
	if (controller === null) throw new Error("table-sort controller が接続されていません");
	return controller;
};

const buttonAt = (cell: HTMLTableCellElement) => {
	const button = cell.getElementsByTagName("button")[0];
	if (!(button instanceof HTMLButtonElement)) throw new Error("sortable button がありません");
	return button;
};

const clickTrusted = async (cell: HTMLTableCellElement) => {
	const testId = buttonAt(cell).getAttribute("data-testid");
	if (testId === null) throw new Error("sortable button に data-testid がありません");
	await page.getByTestId(testId).click();
	await settle();
};

const eventDetails = (root: HTMLTableElement) => {
	const events: Array<{ type: string; detail: SortDetail; target: EventTarget | null }> = [];
	root.addEventListener("table-sort:beforesort", (event) => {
		events.push({
			type: event.type,
			detail: (event as CustomEvent<SortDetail>).detail,
			target: event.target,
		});
	});
	root.addEventListener("table-sort:sort", (event) => {
		events.push({
			type: event.type,
			detail: (event as CustomEvent<SortDetail>).detail,
			target: event.target,
		});
	});
	return events;
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("table-sort", TableSortController);
});

afterEach(() => {
	vi.restoreAllMocks();
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("table-sort", () => {
	test("[table-sort-state-sync] Checks aria-sort, data-state, scope completion, authored values, and absence of added roles", async () => {
		const { root, headers } = await mount(
			'data-table-sort-column-value="price" data-table-sort-direction-value="descending"',
		);

		expect(root.getAttribute("role")).toBeNull();
		expect(root.getAttribute("aria-label")).toBe("利用者一覧");
		expect(root.querySelector("caption")?.textContent).toBe("利用者一覧");
		expect(headers[0]?.id).toBe("authored-name");
		expect(headers.map((header) => header.getAttribute("scope"))).toEqual(["row", "col", "col"]);
		expect(headers.map((header) => header.getAttribute("aria-sort"))).toEqual([
			"none",
			"descending",
			"none",
		]);
		expect(headers.map((header) => header.dataset.state)).toEqual(["none", "descending", "none"]);
		expect(root.dataset.state).toBeUndefined();
		expect(headers.every((header) => header.getAttribute("role") === null)).toBe(true);

		const preserved = await mount('role="table" data-preserved="yes"');
		expect(preserved.root.getAttribute("role")).toBe("table");
		expect(preserved.root.getAttribute("data-preserved")).toBe("yes");
	});

	test("[table-sort-request][table-sort-single-column-negative] Synchronizes three-state sortable activation, detail, and single-column aria-sort", async () => {
		const { root, headers } = await mount();
		const events = eventDetails(root);

		headers[1]!.style.padding = "0 0 0 48px";
		await userEvent.click(headers[1]!, { position: { x: 4, y: 4 } });
		await settle();
		expect(events).toHaveLength(0);
		expect(headers[1]?.getAttribute("aria-sort")).toBe("none");

		await clickTrusted(headers[1]!);
		expect(headers[1]?.getAttribute("aria-sort")).toBe("ascending");
		expect(events[0]).toEqual({
			type: "table-sort:beforesort",
			detail: {
				column: "price",
				direction: "ascending",
				previousColumn: "",
				previousDirection: "none",
				reason: "pointer",
			},
			target: root,
		});
		expect(events[1]?.type).toBe("table-sort:sort");

		await clickTrusted(headers[0]!);
		expect(headers.map((header) => header.getAttribute("aria-sort"))).toEqual([
			"ascending",
			"none",
			"none",
		]);

		buttonAt(headers[0]!).focus();
		await userEvent.keyboard("{Enter}");
		await settle();
		expect(headers[0]?.getAttribute("aria-sort")).toBe("descending");
		expect(events.at(-1)?.detail.reason).toBe("keyboard");

		await clickTrusted(headers[0]!);
		expect(headers[0]?.getAttribute("aria-sort")).toBe("none");
		expect(headers[0]?.dataset.state).toBe("none");
		expect(headers.filter((header) => header.getAttribute("aria-sort") !== "none")).toHaveLength(0);
	});

	test("[table-sort-cancel][table-sort-cancel-negative] Cancelable beforesort prevents sort-state changes", async () => {
		const { root, headers } = await mount();
		const events = eventDetails(root);
		const cancel = (event: Event) => event.preventDefault();
		root.addEventListener("table-sort:beforesort", cancel);

		await clickTrusted(headers[0]!);
		expect(events).toHaveLength(1);
		expect(root.getAttribute("data-table-sort-column-value")).toBeNull();
		expect(headers[0]?.getAttribute("aria-sort")).toBe("none");
		expect(headers[0]?.dataset.state).toBe("none");

		root.removeEventListener("table-sort:beforesort", cancel);
		await clickTrusted(headers[0]!);
		expect(events.map(({ type }) => type)).toEqual([
			"table-sort:beforesort",
			"table-sort:beforesort",
			"table-sort:sort",
		]);
	});

	test("[table-sort-no-reorder][table-sort-no-reorder-negative] Sort requests do not reorder rows", async () => {
		const { root, headers } = await mount();
		const before = Array.from(root.rows, (row) => row.textContent);

		await clickTrusted(headers[0]!);
		expect(Array.from(root.rows, (row) => row.textContent)).toEqual(before);
	});

	test("[table-sort-programmatic-silence][table-sort-programmatic-silence-negative] Public APIs synchronize only state without events and ignore synthetic clicks", async () => {
		const { root, headers } = await mount();
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("table-sort:beforesort", (event) => events.push(event));
		root.addEventListener("table-sort:sort", (event) => events.push(event));

		controller.column = "price";
		controller.direction = "descending";
		await settle();
		expect(events).toEqual([]);
		expect(controller.column).toBe("price");
		expect(controller.direction).toBe("descending");
		expect(headers[1]?.getAttribute("aria-sort")).toBe("descending");

		buttonAt(headers[0]!).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		await settle();
		expect(events).toEqual([]);
		expect(controller.column).toBe("price");
		expect(controller.direction).toBe("descending");
	});

	test("[table-sort-dynamic-targets] Tracks added and removed sortable targets", async () => {
		const { headers } = await mount();
		const sortable = headers[2]!;

		sortable.removeAttribute("data-table-sort-target");
		await settle();
		expect(sortable.hasAttribute("aria-sort")).toBe(false);
		expect(sortable.hasAttribute("data-state")).toBe(false);
		expect(sortable.getAttribute("scope")).toBe("col");

		sortable.setAttribute("data-table-sort-target", "sortable");
		await settle();
		expect(sortable.getAttribute("aria-sort")).toBe("none");
		expect(sortable.dataset.state).toBe("none");
	});

	test("[table-sort-disconnect-cleanup][table-sort-disconnect-cleanup-negative] Removes and reattaches listeners without duplicate events across reconnection", async () => {
		const { root, headers } = await mount();
		const controller = controllerFor(root);
		const events = eventDetails(root);
		const removeEventListener = vi.spyOn(root, "removeEventListener");

		await clickTrusted(headers[0]!);
		expect(events).toHaveLength(2);

		controller.disconnect();
		expect(removeEventListener).toHaveBeenCalledWith("click", expect.any(Function));
		await clickTrusted(headers[0]!);
		expect(events).toHaveLength(2);

		controller.connect();
		await settle();
		await clickTrusted(headers[0]!);
		expect(events).toHaveLength(4);
	});

	test("[table-sort-completion-warning][table-sort-completion-warning-negative] Warns once per connection when completing scope and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("table-sort controller");
			expect(warnings[0]).toContain('scope="col"');

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<table data-controller="table-sort"><thead><tr><th data-table-sort-target="sortable" data-table-sort-column="name" scope="col"><button type="button">名前</button></th><th data-table-sort-target="sortable" data-table-sort-column="price" scope="col"><button type="button">価格</button></th></tr></thead></table>',
			);
			await settle();
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div data-controller="table-sort" aria-label="非 table"></div>',
			);
			await settle();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(warnings[0]).not.toContain("Added ");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[table-sort-semantic-validation][table-sort-semantic-validation-negative] Disables invalid markup with exactly one warning", async () => {
		const warnings: unknown[][] = [];
		console.warn = (...args: unknown[]) => warnings.push(args);
		const cases = [
			'<div data-controller="table-sort" aria-label="非 table"></div>',
			'<table data-controller="table-sort" aria-label="非 th"><tbody><tr><td data-table-sort-target="sortable" data-table-sort-column="x"><button type="button">x</button></td></tr></tbody></table>',
			'<table data-controller="table-sort" aria-label="button なし"><thead><tr><th data-table-sort-target="sortable" data-table-sort-column="x"></th></tr></thead></table>',
			'<table data-controller="table-sort" aria-label="button 過剰"><thead><tr><th data-table-sort-target="sortable" data-table-sort-column="x"><button type="button">x</button><button type="button">y</button></th></tr></thead></table>',
			'<table data-controller="table-sort" aria-label="空 column"><thead><tr><th data-table-sort-target="sortable" data-table-sort-column=""><button type="button">x</button></th></tr></thead></table>',
			'<table data-controller="table-sort" aria-label="重複 column"><thead><tr><th data-table-sort-target="sortable" data-table-sort-column="x"><button type="button">x</button></th><th data-table-sort-target="sortable" data-table-sort-column="x"><button type="button">y</button></th></tr></thead></table>',
			'<table data-controller="table-sort" aria-label="colspan"><thead><tr><th colspan="2" data-table-sort-target="sortable" data-table-sort-column="x"><button type="button">x</button></th></tr></thead></table>',
		];

		for (const [index, markup] of cases.entries()) {
			document.body.insertAdjacentHTML("beforeend", markup);
			await settle();
			const root = document.body.lastElementChild;
			if (!(root instanceof HTMLElement)) throw new Error(`invalid root ${index} がありません`);
			expect(root.hasAttribute("role")).toBe(false);
			expect(root.querySelectorAll("[scope]").length).toBe(0);
			expect(root.querySelectorAll("[aria-sort]").length).toBe(0);
			expect(root.querySelectorAll("[data-state]").length).toBe(0);
		}

		expect(warnings).toHaveLength(cases.length);
		expect(String(warnings[0]?.[0])).toContain("table-sort controller");
		expect(String(warnings[0]?.[0])).toContain("<table>");
	});
});
