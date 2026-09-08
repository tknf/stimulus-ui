import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import GridController from "../src/grid_controller";

type GridPublicController = Controller & {
	activeCell: HTMLTableCellElement | undefined;
	focusCell: (row: number, column: number) => void;
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
		`<table data-controller="grid" aria-label="利用者一覧" ${rootAttributes}>` +
			"<caption>利用者一覧</caption>" +
			"<thead><tr>" +
			'<th id="authored-name" data-testid="grid-name">名前</th>' +
			'<th data-testid="grid-price">価格</th>' +
			'<th data-testid="grid-status">状態</th>' +
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
	if (!(root instanceof HTMLTableElement)) throw new Error("grid root がありません");
	return {
		root,
		headers: Array.from(root.tHead?.rows[0]?.cells ?? []).filter(
			(cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement,
		),
		cells: Array.from(root.rows).flatMap((row) => Array.from(row.cells)),
	};
};

const controllerFor = (root: HTMLTableElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"grid",
	) as GridPublicController | null;
	if (controller === null) throw new Error("grid controller が接続されていません");
	return controller;
};

const cellAt = (root: HTMLTableElement, row: number, column: number) => {
	const cell = root.rows[row]?.cells[column];
	if (!(cell instanceof HTMLTableCellElement)) {
		throw new Error(`cell(${row}, ${column}) がありません`);
	}
	return cell;
};

const focusAndPress = async (cell: HTMLTableCellElement, key: string) => {
	cell.focus();
	await userEvent.keyboard(key);
	await settle();
};

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("grid", GridController);
});

afterEach(() => {
	vi.restoreAllMocks();
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("grid", () => {
	test("[grid-state-sync] Checks role, roving tabindex, absence of cell roles, and preservation of authored attributes", async () => {
		const { root, headers, cells } = await mount();

		expect(root.getAttribute("role")).toBe("grid");
		expect(root.getAttribute("aria-label")).toBe("利用者一覧");
		expect(root.querySelector("caption")?.textContent).toBe("利用者一覧");
		expect(headers[0]?.id).toBe("authored-name");
		expect(cells.filter((cell) => cell.getAttribute("tabindex") === "0")).toHaveLength(1);
		expect(cells.every((cell) => cell.hasAttribute("tabindex"))).toBe(true);
		expect(cells.every((cell) => cell.getAttribute("role") === null)).toBe(true);
		expect(root.dataset.state).toBeUndefined();
		expect(headers.every((header) => !header.hasAttribute("data-state"))).toBe(true);

		const authoredRole = headers[0];
		authoredRole?.setAttribute("role", "columnheader");
		await settle();
		expect(authoredRole?.getAttribute("role")).toBe("columnheader");

		const preserved = await mount('role="table" data-preserved="yes"');
		expect(preserved.root.getAttribute("role")).toBe("table");
		expect(preserved.root.getAttribute("data-preserved")).toBe("yes");
	});

	test("[grid-navigation][grid-navigation-bounds-negative] Checks two-dimensional arrows, boundary stopping, and RTL reversal", async () => {
		const { root } = await mount();

		await focusAndPress(cellAt(root, 2, 1), "{ArrowRight}");
		expect(document.activeElement).toBe(cellAt(root, 2, 2));
		await focusAndPress(cellAt(root, 2, 2), "{ArrowDown}");
		expect(document.activeElement).toBe(cellAt(root, 3, 2));
		await focusAndPress(cellAt(root, 3, 2), "{ArrowLeft}");
		expect(document.activeElement).toBe(cellAt(root, 3, 1));
		await focusAndPress(cellAt(root, 3, 1), "{ArrowUp}");
		expect(document.activeElement).toBe(cellAt(root, 2, 1));

		await focusAndPress(cellAt(root, 0, 0), "{ArrowLeft}");
		expect(document.activeElement).toBe(cellAt(root, 0, 0));
		await focusAndPress(cellAt(root, 3, 2), "{ArrowRight}");
		expect(document.activeElement).toBe(cellAt(root, 3, 2));
		await focusAndPress(cellAt(root, 0, 1), "{ArrowUp}");
		expect(document.activeElement).toBe(cellAt(root, 0, 1));

		const rtl = await mount('dir="rtl"');
		await focusAndPress(cellAt(rtl.root, 2, 1), "{ArrowLeft}");
		expect(document.activeElement).toBe(cellAt(rtl.root, 2, 2));
		await focusAndPress(cellAt(rtl.root, 2, 2), "{ArrowRight}");
		expect(document.activeElement).toBe(cellAt(rtl.root, 2, 1));
	});

	test("[grid-navigation-jump] Checks Home, End, Ctrl+Home, Ctrl+End, PageUp, PageDown, and boundary stopping", async () => {
		const { root } = await mount('data-grid-page-size-value="2"');

		await focusAndPress(cellAt(root, 2, 2), "{Home}");
		expect(document.activeElement).toBe(cellAt(root, 2, 0));
		await focusAndPress(cellAt(root, 2, 0), "{End}");
		expect(document.activeElement).toBe(cellAt(root, 2, 2));
		await focusAndPress(cellAt(root, 2, 2), "{Control>}{Home}{/Control}");
		expect(document.activeElement).toBe(cellAt(root, 0, 0));
		await focusAndPress(cellAt(root, 0, 0), "{Control>}{End}{/Control}");
		expect(document.activeElement).toBe(cellAt(root, 3, 2));

		await focusAndPress(cellAt(root, 1, 1), "{PageDown}");
		expect(document.activeElement).toBe(cellAt(root, 3, 1));
		await focusAndPress(cellAt(root, 3, 1), "{PageDown}");
		expect(document.activeElement).toBe(cellAt(root, 3, 1));
		await focusAndPress(cellAt(root, 3, 1), "{PageUp}");
		expect(document.activeElement).toBe(cellAt(root, 1, 1));
		await focusAndPress(cellAt(root, 0, 1), "{PageUp}");
		expect(document.activeElement).toBe(cellAt(root, 0, 1));
	});

	test("[grid-roving-tabindex][grid-roving-tabindex-negative] Keeps exactly one cell in the tab sequence", async () => {
		const { root, cells } = await mount();
		const controller = controllerFor(root);

		expect(cells.filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
		expect(cells.filter((cell) => cell.tabIndex === 0)[0]).toBe(cellAt(root, 0, 0));
		expect(cells.every((cell) => cell.hasAttribute("tabindex"))).toBe(true);
		expect(cells.filter((cell) => cell.tabIndex === -1)).toHaveLength(cells.length - 1);
		controller.focusCell(3, 2);
		expect(controller.activeCell).toBe(cellAt(root, 3, 2));
		expect(cells.filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
		expect(root.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
	});

	test("[grid-event-silence][grid-event-silence-negative] Emits no custom events from public APIs, cell movement, initialization, or reconnection", async () => {
		const { root } = await mount();
		const controller = controllerFor(root);
		const dispatchEvent = vi.spyOn(root, "dispatchEvent");

		controller.focusCell(2, 1);
		await focusAndPress(cellAt(root, 2, 1), "{ArrowLeft}");
		root.remove();
		await settle();
		document.body.append(root);
		await settle();
		controller.focusCell(1, 1);
		await settle();

		expect(dispatchEvent).not.toHaveBeenCalled();
	});

	test("[grid-dynamic-rows] Tracks added and removed rows and cells", async () => {
		const { root } = await mount();
		const controller = controllerFor(root);

		const row = document.createElement("tr");
		for (const text of ["D", "40", "有効"]) {
			const cell = document.createElement("td");
			cell.textContent = text;
			row.append(cell);
		}
		root.tBodies[0]?.append(row);
		await settle();
		expect(root.rows).toHaveLength(5);
		expect(
			Array.from(root.rows)
				.flatMap((candidate) => Array.from(candidate.cells))
				.every((cell) => cell.hasAttribute("tabindex")),
		).toBe(true);

		controller.focusCell(2, 1);
		cellAt(root, 2, 1).parentElement?.remove();
		await settle();
		expect(controller.activeCell).toBeDefined();
		expect(root.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
	});

	test("[grid-disconnect-cleanup][grid-disconnect-cleanup-negative] Removes listeners and observers across disconnect/reconnect without duplicates", async () => {
		const { root, cells } = await mount();
		const controller = controllerFor(root);
		const removeEventListener = vi.spyOn(root, "removeEventListener");
		const observerDisconnect = vi.spyOn(MutationObserver.prototype, "disconnect");

		controller.disconnect();
		expect(removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
		expect(removeEventListener).toHaveBeenCalledWith("focusin", expect.any(Function));
		expect(observerDisconnect).toHaveBeenCalled();
		cells[0]?.focus();
		const disconnectedKeydown = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "ArrowRight",
		});
		cells[0]?.dispatchEvent(disconnectedKeydown);
		expect(disconnectedKeydown.defaultPrevented).toBe(false);

		controller.connect();
		await settle();
		cells[0]?.focus();
		await userEvent.keyboard("{ArrowRight}");
		await settle();
		expect(document.activeElement).toBe(cells[1]);
	});

	test("[grid-completion-warning][grid-completion-warning-negative] Warns once per connection when completing role and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("grid controller");
			expect(warnings[0]).toContain('role="grid"');

			warnings.length = 0;
			await mount('role="grid"');
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div data-controller="grid" aria-label="非 table"></div>',
			);
			await settle();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(warnings[0]).not.toContain("Added ");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[grid-semantic-validation][grid-semantic-validation-negative] Warns once and disables enhancement for invalid markup", async () => {
		const warnings: unknown[][] = [];
		console.warn = (...args: unknown[]) => warnings.push(args);
		const cases = [
			'<div data-controller="grid" aria-label="非 table"></div>',
			'<table data-controller="grid" aria-label="行なし"></table>',
			'<table data-controller="grid" aria-label="セルなし"><tbody><tr></tr></tbody></table>',
			'<table data-controller="grid"><tbody><tr><td>x</td></tr></tbody></table>',
			'<table data-controller="grid" aria-label="rowspan"><tbody><tr><td rowspan="2">x</td></tr><tr><td>y</td></tr></tbody></table>',
			'<table data-controller="grid" aria-label="colspan"><tbody><tr><td colspan="2">x</td></tr></tbody></table>',
			'<table data-controller="grid" aria-label="不一致"><tbody><tr><td>x</td><td>y</td></tr><tr><td>z</td></tr></tbody></table>',
			'<table data-controller="grid" aria-label="page" data-grid-page-size-value="bad"><tbody><tr><td>x</td></tr></tbody></table>',
			'<table data-controller="grid" aria-label="page" data-grid-page-size-value="0"><tbody><tr><td>x</td></tr></tbody></table>',
			'<table data-controller="grid" aria-label="page" data-grid-page-size-value="1.5"><tbody><tr><td>x</td></tr></tbody></table>',
		];

		for (const [index, markup] of cases.entries()) {
			document.body.insertAdjacentHTML("beforeend", markup);
			await settle();
			const root = document.body.lastElementChild;
			if (!(root instanceof HTMLElement)) throw new Error(`invalid root ${index} がありません`);
			expect(root.hasAttribute("role")).toBe(false);
			expect(root.querySelectorAll("[tabindex]").length).toBe(0);
			expect(root.querySelectorAll("[data-state]").length).toBe(0);
		}

		expect(warnings).toHaveLength(cases.length);
		expect(String(warnings[0]?.[0])).toContain("grid controller");
		expect(String(warnings[0]?.[0])).toContain("<table>");
	});

	test("[grid-cell-role-negative] Does not set roles on native cells", async () => {
		const { cells } = await mount();
		expect(cells.every((cell) => cell.getAttribute("role") === null)).toBe(true);
	});
});
