import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import TreegridController from "../src/treegrid_controller";
import type { TreegridChangeDetail, TreegridToggleDetail } from "../src/treegrid_controller";

type TreegridPublicController = Controller & {
	expanded: string[];
	expandedValue: string[];
	pageSizeValue: number;
	selectionValue: string;
	expand: (value: string) => void;
	collapse: (value: string) => void;
	toggle: (value: string) => void;
	selected: string[];
	selectedValue: string[];
};

let application: Application;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const fixture = (rootAttributes: string) =>
	`<table data-controller="treegrid" aria-label="ファイル一覧" ${rootAttributes}>` +
	"<thead><tr><th>名前</th><th>種類</th><th>状態</th></tr></thead>" +
	"<tbody>" +
	'<tr data-treegrid-target="row" data-treegrid-level="1" data-treegrid-value="root">' +
	'<th scope="row"><button type="button" data-treegrid-target="toggle" aria-label="root を開閉">root</button></th>' +
	"<td>folder</td><td>open</td>" +
	"</tr>" +
	'<tr data-treegrid-target="row" data-treegrid-level="2" data-treegrid-value="child">' +
	'<th scope="row"><button type="button" data-treegrid-target="toggle" aria-label="child を開閉">child</button></th>' +
	"<td>folder</td><td>open</td>" +
	"</tr>" +
	'<tr data-treegrid-target="row" data-treegrid-level="3" data-treegrid-value="grand">' +
	'<th scope="row">grand</th><td>file</td><td>ready</td>' +
	"</tr>" +
	'<tr data-treegrid-target="row" data-treegrid-level="1" data-treegrid-value="other">' +
	'<th scope="row">other</th><td>file</td><td>ready</td>' +
	"</tr>" +
	"</tbody></table>";

const mount = async (rootAttributes = "") => {
	document.body.insertAdjacentHTML("beforeend", fixture(rootAttributes));
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLTableElement)) throw new Error("treegrid root がありません");
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"treegrid",
	) as TreegridPublicController | null;
	if (controller === null) throw new Error("treegrid controller が接続されていません");
	return { root, controller };
};

const rowFor = (root: HTMLTableElement, value: string) => {
	const row = root.querySelector(`[data-treegrid-value="${value}"]`);
	if (!(row instanceof HTMLTableRowElement)) throw new Error(`row ${value} がありません`);
	return row;
};

const cellAt = (root: HTMLTableElement, value: string, column: number) => {
	const cell = rowFor(root, value).cells[column];
	if (!(cell instanceof HTMLTableCellElement)) {
		throw new Error(`cell(${value}, ${column}) がありません`);
	}
	return cell;
};

const toggleFor = (root: HTMLTableElement, value = "root") => {
	const toggle = rowFor(root, value).querySelector('[data-treegrid-target~="toggle"]');
	if (!(toggle instanceof HTMLButtonElement)) throw new Error(`toggle ${value} がありません`);
	return toggle;
};

const focusAndPress = async (cell: HTMLTableCellElement, key: string) => {
	cell.focus();
	await userEvent.keyboard(key);
	await settle();
};

beforeEach(() => {
	document.body.innerHTML = "";
	application = Application.start();
	application.register("treegrid", TreegridController);
});

afterEach(() => {
	vi.restoreAllMocks();
	application.stop();
	document.body.innerHTML = "";
});

describe("treegrid", () => {
	test("[treegrid-structure-projection][treegrid-structure-projection-negative] Synchronizes hierarchy attributes, expansion, and roles while preserving authored roles", async () => {
		const { root } = await mount(`data-treegrid-expanded-value='["root"]'`);
		const rootRow = rowFor(root, "root");
		const childRow = rowFor(root, "child");
		const grandRow = rowFor(root, "grand");
		const otherRow = rowFor(root, "other");

		expect(root.getAttribute("role")).toBe("treegrid");
		expect(rootRow.getAttribute("aria-level")).toBe("1");
		expect(rootRow.getAttribute("aria-posinset")).toBe("1");
		expect(rootRow.getAttribute("aria-setsize")).toBe("2");
		expect(rootRow.getAttribute("aria-expanded")).toBe("true");
		expect(rootRow.dataset.state).toBe("expanded");
		expect(childRow.getAttribute("aria-level")).toBe("2");
		expect(childRow.getAttribute("aria-posinset")).toBe("1");
		expect(childRow.getAttribute("aria-setsize")).toBe("1");
		expect(childRow.getAttribute("aria-expanded")).toBe("false");
		expect(childRow.dataset.state).toBe("collapsed");
		expect(grandRow.getAttribute("aria-level")).toBe("3");
		expect(grandRow.getAttribute("aria-posinset")).toBe("1");
		expect(grandRow.getAttribute("aria-setsize")).toBe("1");
		expect(grandRow.hasAttribute("aria-expanded")).toBe(false);
		expect(grandRow.dataset.state).toBeUndefined();
		expect(otherRow.getAttribute("aria-level")).toBe("1");
		expect(otherRow.getAttribute("aria-posinset")).toBe("2");
		expect(otherRow.getAttribute("aria-setsize")).toBe("2");
		expect(otherRow.hasAttribute("aria-expanded")).toBe(false);
		expect(otherRow.dataset.state).toBeUndefined();
		expect(root.dataset.state).toBeUndefined();
		expect(
			Array.from(root.querySelectorAll('[data-treegrid-target="row"]')).every(
				(row) => row.getAttribute("role") === null,
			),
		).toBe(true);
		expect(root.querySelectorAll('[data-treegrid-target="row"] [role]').length).toBe(0);

		const authored = await mount('role="grid" data-preserved="yes"');
		expect(authored.root.getAttribute("role")).toBe("grid");
		expect(authored.root.getAttribute("data-preserved")).toBe("yes");
	});

	test("[treegrid-completion-warning][treegrid-completion-warning-negative] Warns once per connection only for missing attributes, separately from invalid-markup warnings", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('role="treegrid"');

			warnings.length = 0;
			await mount('role="treegrid"');
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div data-controller="treegrid" aria-label="非 table"></div>',
			);
			await settle();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("treegrid controller");
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(warnings[0]).not.toContain("Added ");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[treegrid-keyboard-navigation] Checks two-dimensional navigation, jumps, boundaries, and RTL among visible rows", async () => {
		const { root } = await mount(
			`data-treegrid-expanded-value='["root","child"]' data-treegrid-page-size-value="2"`,
		);

		await focusAndPress(cellAt(root, "child", 1), "{ArrowRight}");
		expect(document.activeElement).toBe(cellAt(root, "child", 2));
		await focusAndPress(cellAt(root, "child", 2), "{ArrowDown}");
		expect(document.activeElement).toBe(cellAt(root, "grand", 2));
		await focusAndPress(cellAt(root, "grand", 2), "{ArrowUp}");
		expect(document.activeElement).toBe(cellAt(root, "child", 2));
		await focusAndPress(cellAt(root, "root", 0), "{ArrowLeft}");
		expect(document.activeElement).toBe(cellAt(root, "root", 0));
		await focusAndPress(cellAt(root, "other", 2), "{ArrowRight}");
		expect(document.activeElement).toBe(cellAt(root, "other", 2));
		await focusAndPress(cellAt(root, "root", 0), "{ArrowUp}");
		expect(document.activeElement).toBe(cellAt(root, "root", 0));
		await focusAndPress(cellAt(root, "other", 2), "{ArrowDown}");
		expect(document.activeElement).toBe(cellAt(root, "other", 2));

		await focusAndPress(cellAt(root, "child", 2), "{Home}");
		expect(document.activeElement).toBe(cellAt(root, "child", 0));
		await focusAndPress(cellAt(root, "child", 0), "{End}");
		expect(document.activeElement).toBe(cellAt(root, "child", 2));
		await focusAndPress(cellAt(root, "grand", 1), "{Control>}{Home}{/Control}");
		expect(document.activeElement).toBe(cellAt(root, "root", 0));
		await focusAndPress(cellAt(root, "root", 0), "{Control>}{End}{/Control}");
		expect(document.activeElement).toBe(cellAt(root, "other", 2));
		await focusAndPress(cellAt(root, "root", 1), "{PageDown}");
		expect(document.activeElement).toBe(cellAt(root, "grand", 1));
		await focusAndPress(cellAt(root, "grand", 1), "{PageUp}");
		expect(document.activeElement).toBe(cellAt(root, "root", 1));

		const hidden = await mount(`data-treegrid-expanded-value='["root"]'`);
		expect(rowFor(hidden.root, "grand").hidden).toBe(true);
		await focusAndPress(cellAt(hidden.root, "child", 1), "{ArrowDown}");
		expect(document.activeElement).toBe(cellAt(hidden.root, "other", 1));

		const rtl = await mount(`dir="rtl" data-treegrid-expanded-value='["root","child"]'`);
		await focusAndPress(cellAt(rtl.root, "root", 1), "{ArrowLeft}");
		expect(document.activeElement).toBe(cellAt(rtl.root, "root", 2));
		await focusAndPress(cellAt(rtl.root, "root", 2), "{ArrowRight}");
		expect(document.activeElement).toBe(cellAt(rtl.root, "root", 1));
	});

	test("[treegrid-enter-toggle][treegrid-enter-toggle-negative] Only the first cell of an expandable row toggles with Enter", async () => {
		const { root } = await mount();
		const rootRow = rowFor(root, "root");

		await focusAndPress(cellAt(root, "root", 0), "{Enter}");
		expect(rootRow.getAttribute("aria-expanded")).toBe("true");
		expect(rowFor(root, "child").hidden).toBe(false);
		await focusAndPress(cellAt(root, "root", 0), "{Enter}");
		expect(rootRow.getAttribute("aria-expanded")).toBe("false");

		await focusAndPress(cellAt(root, "root", 1), "{Enter}");
		expect(rootRow.getAttribute("aria-expanded")).toBe("false");
		await focusAndPress(cellAt(root, "other", 0), "{Enter}");
		expect(rootRow.getAttribute("aria-expanded")).toBe("false");
	});

	test("[treegrid-toggle-events][treegrid-toggle-events-negative] Checks trusted cancellation, detail, event order, bubbling, and absence of synthetic notifications", async () => {
		const { root } = await mount();
		const toggle = toggleFor(root);
		const events: Array<{
			type: string;
			detail: TreegridToggleDetail;
			bubbles: boolean;
			cancelable: boolean;
		}> = [];
		let cancelBefore = true;
		root.addEventListener("treegrid:beforetoggle", (event) => {
			const custom = event as CustomEvent<TreegridToggleDetail>;
			events.push({
				type: event.type,
				detail: custom.detail,
				bubbles: event.bubbles,
				cancelable: event.cancelable,
			});
			if (cancelBefore) event.preventDefault();
		});
		root.addEventListener("treegrid:toggle", (event) => {
			const custom = event as CustomEvent<TreegridToggleDetail>;
			events.push({
				type: event.type,
				detail: custom.detail,
				bubbles: event.bubbles,
				cancelable: event.cancelable,
			});
		});

		await userEvent.click(toggle);
		await settle();
		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("treegrid:beforetoggle");
		expect(events[0]?.detail).toEqual({ value: "root", expanded: true, reason: "pointer" });
		expect(events[0]?.bubbles).toBe(true);
		expect(events[0]?.cancelable).toBe(true);
		expect(rowFor(root, "root").getAttribute("aria-expanded")).toBe("false");

		cancelBefore = false;
		await userEvent.click(toggle);
		await settle();
		expect(events).toHaveLength(3);
		expect(events[1]?.type).toBe("treegrid:beforetoggle");
		expect(events[2]?.type).toBe("treegrid:toggle");
		expect(events[2]?.detail).toEqual({ value: "root", expanded: true, reason: "pointer" });
		expect(events[2]?.bubbles).toBe(true);
		expect(events[2]?.cancelable).toBe(false);

		toggle.focus();
		await userEvent.keyboard("{Enter}");
		await settle();
		expect(events).toHaveLength(5);
		expect(events[3]?.detail).toEqual({ value: "root", expanded: false, reason: "keyboard" });
		expect(events[4]?.detail).toEqual({ value: "root", expanded: false, reason: "keyboard" });

		const beforeSynthetic = events.length;
		toggle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
		cellAt(root, "root", 0).dispatchEvent(
			new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
		);
		await settle();
		expect(events).toHaveLength(beforeSynthetic);
		expect(rowFor(root, "root").getAttribute("aria-expanded")).toBe("false");
	});

	test("[treegrid-hidden-sync][treegrid-hidden-sync-negative] Synchronizes descendant hidden/state on collapse and visibility on re-expansion", async () => {
		const { root, controller } = await mount(`data-treegrid-expanded-value='["root","child"]'`);
		const grandCell = cellAt(root, "grand", 1);
		grandCell.focus();
		controller.collapse("child");
		expect(rowFor(root, "child").hidden).toBe(false);
		expect(rowFor(root, "grand").hidden).toBe(true);
		expect(rowFor(root, "child").dataset.state).toBe("collapsed");
		expect(rowFor(root, "root").dataset.state).toBe("expanded");
		controller.collapse("root");
		expect(rowFor(root, "child").hidden).toBe(true);
		expect(rowFor(root, "grand").hidden).toBe(true);
		expect(cellAt(root, "root", 0).getAttribute("tabindex")).toBe("0");

		controller.expand("root");
		expect(rowFor(root, "child").hidden).toBe(false);
		expect(rowFor(root, "grand").hidden).toBe(true);
		controller.expand("child");
		expect(rowFor(root, "grand").hidden).toBe(false);
		expect(rowFor(root, "grand").dataset.state).toBeUndefined();
	});

	test("[treegrid-programmatic-silence][treegrid-programmatic-silence-negative] Setters and expand/collapse/toggle normalize expanded without emitting events", async () => {
		const { root, controller } = await mount();
		const events: Event[] = [];
		root.addEventListener("treegrid:beforetoggle", (event) => events.push(event));
		root.addEventListener("treegrid:toggle", (event) => events.push(event));

		controller.expanded = ["root", "child", "other", "missing", "root"];
		expect(controller.expanded).toEqual(["root", "child"]);
		expect(controller.expandedValue).toEqual(["root", "child"]);
		expect(rowFor(root, "root").dataset.state).toBe("expanded");
		expect(rowFor(root, "child").dataset.state).toBe("expanded");

		controller.collapse("root");
		expect(controller.expanded).toEqual(["child"]);
		controller.expand("root");
		expect(controller.expanded).toEqual(["child", "root"]);
		controller.toggle("child");
		expect(controller.expanded).toEqual(["root"]);
		controller.collapse("root");
		expect(controller.expanded).toEqual([]);
		controller.expand("other");
		controller.collapse("missing");
		controller.toggle("other");
		expect(controller.expanded).toEqual([]);
		expect(controller.expandedValue).toEqual([]);
		expect(events).toHaveLength(0);
	});

	test("[treegrid-semantic-validation][treegrid-semantic-validation-negative] Disables invalid markup with one warning", async () => {
		const warnings: unknown[][] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args);
		const table = (rows: string, rootAttributes = "") =>
			`<table data-controller="treegrid" aria-label="invalid" ${rootAttributes}><tbody>${rows}</tbody></table>`;
		const row = (level: string, value: string, cells = "<td>x</td>") =>
			`<tr data-treegrid-target="row" data-treegrid-level="${level}" data-treegrid-value="${value}">${cells}</tr>`;
		const cases = [
			'<div data-controller="treegrid" aria-label="非 table"></div>',
			table(row("1", "root") + row("3", "grand")),
			table(row("1.5", "root")),
			table(row("1", "same") + row("1", "same")),
			table(row("1", " ")),
			table(row("1", "root", '<td><div data-treegrid-target="toggle">toggle</div></td>')),
			table(row("1", "root", '<td colspan="2">x</td>')),
			table(row("1", "root", "<td>x</td><td>y</td>") + row("1", "other")),
			table(row("1", "root"), 'data-treegrid-page-size-value="0"'),
			table(row("1", "root"), 'data-treegrid-page-size-value="1.5"'),
		];

		try {
			for (const [index, markup] of cases.entries()) {
				document.body.insertAdjacentHTML("beforeend", markup);
				await settle();
				const root = document.body.lastElementChild;
				if (!(root instanceof HTMLElement)) throw new Error(`invalid root ${index} がありません`);
				expect(root.hasAttribute("role")).toBe(false);
				expect(root.querySelectorAll("[aria-level], [aria-posinset], [aria-setsize]")).toHaveLength(
					0,
				);
				expect(
					root.querySelectorAll("[aria-expanded], [tabindex], [data-state], [hidden]"),
				).toHaveLength(0);
			}
			expect(warnings).toHaveLength(cases.length);
			expect(String(warnings[0]?.[0])).toContain("treegrid controller");
			expect(String(warnings[0]?.[0])).toContain("<table>");
			expect(String(warnings[0]?.[0])).toContain('<button type="button">');
			expect(String(warnings[0]?.[0])).toContain("Enhancement has been disabled");
		} finally {
			console.warn = originalWarn;
		}
	});

	test("[treegrid-disconnect-cleanup][treegrid-disconnect-cleanup-negative] Avoids duplicate listeners and observers across disconnect and reconnect", async () => {
		const { root } = await mount('role="treegrid"');
		const toggle = toggleFor(root);
		const events: Event[] = [];
		root.addEventListener("treegrid:toggle", (event) => events.push(event));
		const removeEventListener = vi.spyOn(root, "removeEventListener");
		const observerDisconnect = vi.spyOn(MutationObserver.prototype, "disconnect");

		root.removeAttribute("data-controller");
		await settle();
		expect(removeEventListener).toHaveBeenCalledWith("click", expect.any(Function));
		expect(removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
		expect(removeEventListener).toHaveBeenCalledWith("focusin", expect.any(Function));
		expect(observerDisconnect).toHaveBeenCalled();
		await userEvent.click(toggle);
		await settle();
		expect(events).toHaveLength(0);

		root.setAttribute("data-controller", "treegrid");
		await settle();
		await userEvent.click(toggle);
		await settle();
		expect(events).toHaveLength(1);

		root.removeAttribute("data-controller");
		await settle();
		await userEvent.click(toggle);
		await settle();
		expect(events).toHaveLength(1);
		root.setAttribute("data-controller", "treegrid");
		await settle();
		await userEvent.click(toggle);
		await settle();
		expect(events).toHaveLength(2);
	});

	test("[treegrid-selection-state][treegrid-selection-state-negative] Synchronizes ARIA and data-selected for each selection mode", async () => {
		const none = await mount('role="treegrid"');
		expect(none.root.hasAttribute("aria-multiselectable")).toBe(false);
		expect(none.root.querySelectorAll("[aria-selected], [data-selected]")).toHaveLength(0);
		expect(none.controller.selected).toEqual([]);

		const single = await mount(
			'role="treegrid" data-treegrid-selection-value="single" data-treegrid-selected-value=\'["other","root"]\'',
		);
		expect(single.controller.selected).toEqual(["root"]);
		expect(rowFor(single.root, "root").getAttribute("aria-selected")).toBe("true");
		expect(rowFor(single.root, "root").dataset.selected).toBe("true");
		for (const value of ["child", "grand", "other"]) {
			const row = rowFor(single.root, value);
			expect(row.hasAttribute("aria-selected")).toBe(false);
			expect(row.hasAttribute("data-selected")).toBe(false);
		}
		expect(single.root.hasAttribute("aria-multiselectable")).toBe(false);

		const multiple = await mount(
			'role="treegrid" data-treegrid-selection-value="multiple" data-treegrid-selected-value=\'["other","missing","root","other"]\'',
		);
		expect(multiple.root.getAttribute("aria-multiselectable")).toBe("true");
		expect(multiple.controller.selected).toEqual(["root", "other"]);
		expect(rowFor(multiple.root, "root").getAttribute("aria-selected")).toBe("true");
		expect(rowFor(multiple.root, "other").getAttribute("aria-selected")).toBe("true");
		expect(rowFor(multiple.root, "child").getAttribute("aria-selected")).toBe("false");
		expect(rowFor(multiple.root, "grand").getAttribute("aria-selected")).toBe("false");
		expect(rowFor(multiple.root, "root").dataset.selected).toBe("true");
		expect(rowFor(multiple.root, "other").dataset.selected).toBe("true");
		expect(rowFor(multiple.root, "child").hasAttribute("data-selected")).toBe(false);
		expect(rowFor(multiple.root, "grand").hasAttribute("data-selected")).toBe(false);
	});

	test("[treegrid-selection-keyboard][treegrid-selection-keyboard-negative] Checks single/multiple Shift+Space toggling and unchanged selection in none mode", async () => {
		const multiple = await mount('role="treegrid" data-treegrid-selection-value="multiple"');
		await focusAndPress(cellAt(multiple.root, "root", 1), "{Shift>}{Space}{/Shift}");
		expect(multiple.controller.selected).toEqual(["root"]);
		await focusAndPress(cellAt(multiple.root, "other", 1), " ");
		expect(multiple.controller.selected).toEqual(["root"]);
		await focusAndPress(cellAt(multiple.root, "other", 1), "{Shift>}{Space}{/Shift}");
		expect(multiple.controller.selected).toEqual(["root", "other"]);
		await focusAndPress(cellAt(multiple.root, "other", 1), "{Shift>}{Space}{/Shift}");
		expect(multiple.controller.selected).toEqual(["root"]);

		const single = await mount(
			'role="treegrid" data-treegrid-selection-value="single" data-treegrid-selected-value=\'["root"]\'',
		);
		const singleEvents: Event[] = [];
		single.root.addEventListener("treegrid:beforechange", (event) => singleEvents.push(event));
		single.root.addEventListener("treegrid:change", (event) => singleEvents.push(event));
		await focusAndPress(cellAt(single.root, "root", 1), "{Shift>}{Space}{/Shift}");
		expect(single.controller.selected).toEqual(["root"]);
		expect(singleEvents).toEqual([]);
		await focusAndPress(cellAt(single.root, "other", 1), "{Shift>}{Space}{/Shift}");
		expect(single.controller.selected).toEqual(["other"]);

		const none = await mount('role="treegrid"');
		await focusAndPress(cellAt(none.root, "root", 1), "{Shift>}{Space}{/Shift}");
		expect(none.controller.selected).toEqual([]);
		expect(rowFor(none.root, "root").hasAttribute("data-selected")).toBe(false);
	});

	test("[treegrid-selection-pointer][treegrid-selection-pointer-negative] Selects only from cell clicks and excludes interactive elements and synthetic clicks", async () => {
		const { root, controller } = await mount(
			'role="treegrid" data-treegrid-selection-value="multiple"',
		);
		const rootRow = rowFor(root, "root");
		await userEvent.click(toggleFor(root));
		await settle();
		expect(rootRow.getAttribute("aria-expanded")).toBe("true");
		expect(controller.selected).toEqual([]);

		const otherCell = cellAt(root, "other", 1);
		await userEvent.click(otherCell);
		expect(controller.selected).toEqual(["other"]);
		expect(rowFor(root, "other").dataset.selected).toBe("true");
		otherCell.insertAdjacentHTML(
			"beforeend",
			'<button type="button" data-selection-button>button</button><a href="#treegrid-selection" data-selection-link>link</a>',
		);
		await settle();

		const button = otherCell.querySelector("[data-selection-button]");
		const link = otherCell.querySelector("[data-selection-link]");
		if (!(button instanceof HTMLButtonElement) || !(link instanceof HTMLAnchorElement)) {
			throw new Error("interactive element がありません");
		}
		link.addEventListener("click", (event) => event.preventDefault());
		await userEvent.click(button);
		await userEvent.click(link);
		expect(controller.selected).toEqual(["other"]);

		otherCell.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		await settle();
		expect(controller.selected).toEqual(["other"]);
		expect(rowFor(root, "other").dataset.selected).toBe("true");
	});

	test("[treegrid-selection-api][treegrid-selection-api-negative] Synchronizes selected values and getters/setters, none mode, and hidden rows", async () => {
		const multiple = await mount(
			'role="treegrid" data-treegrid-selection-value="multiple" data-treegrid-selected-value=\'["other","missing","root","other"]\'',
		);
		const events: Event[] = [];
		for (const name of ["treegrid:beforechange", "treegrid:change"])
			multiple.root.addEventListener(name, (event) => events.push(event));
		expect(multiple.controller.selected).toEqual(["root", "other"]);
		expect(multiple.controller.selectedValue).toEqual(["root", "other"]);

		multiple.controller.selected = ["grand", "missing", "root", "grand"];
		expect(multiple.controller.selected).toEqual(["root", "grand"]);
		expect(multiple.controller.selectedValue).toEqual(["root", "grand"]);
		expect(events).toEqual([]);

		multiple.controller.expand("root");
		multiple.controller.expand("child");
		multiple.controller.selected = ["grand", "other"];
		multiple.controller.collapse("root");
		expect(rowFor(multiple.root, "grand").hidden).toBe(true);
		expect(multiple.controller.selected).toEqual(["grand", "other"]);
		expect(rowFor(multiple.root, "grand").getAttribute("aria-selected")).toBe("true");
		expect(rowFor(multiple.root, "grand").dataset.selected).toBe("true");
		multiple.controller.expand("root");
		expect(rowFor(multiple.root, "grand").hidden).toBe(false);
		expect(rowFor(multiple.root, "grand").getAttribute("aria-selected")).toBe("true");

		const none = await mount(
			'role="treegrid" data-treegrid-selection-value="none" data-treegrid-selected-value=\'["root"]\'',
		);
		expect(none.root.getAttribute("data-treegrid-selected-value")).toBe('["root"]');
		none.controller.selected = ["other"];
		expect(none.controller.selected).toEqual([]);
		expect(none.controller.selectedValue).toEqual(["root"]);
		none.controller.selectionValue = "multiple";
		await settle();
		expect(none.controller.selected).toEqual(["root"]);
		expect(none.controller.selectedValue).toEqual(["root"]);
		expect(rowFor(none.root, "root").getAttribute("aria-selected")).toBe("true");
	});

	test("[treegrid-selection-events][treegrid-selection-events-negative] Checks beforechange/change detail, cancellation, reason, and event-free changes", async () => {
		const { root, controller } = await mount(
			'role="treegrid" data-treegrid-selection-value="multiple"',
		);
		const events: Array<{
			type: string;
			detail: TreegridChangeDetail;
			bubbles: boolean;
			cancelable: boolean;
		}> = [];
		let cancel = false;
		root.addEventListener("treegrid:beforechange", (event) => {
			const custom = event as CustomEvent<TreegridChangeDetail>;
			events.push({
				type: event.type,
				detail: custom.detail,
				bubbles: event.bubbles,
				cancelable: event.cancelable,
			});
			if (cancel) event.preventDefault();
		});
		root.addEventListener("treegrid:change", (event) => {
			const custom = event as CustomEvent<TreegridChangeDetail>;
			events.push({
				type: event.type,
				detail: custom.detail,
				bubbles: event.bubbles,
				cancelable: event.cancelable,
			});
		});

		await userEvent.click(cellAt(root, "other", 1));
		expect(events.map(({ type }) => type)).toEqual(["treegrid:beforechange", "treegrid:change"]);
		expect(events[0]).toMatchObject({ bubbles: true, cancelable: true });
		expect(events[1]).toMatchObject({ bubbles: true, cancelable: false });
		expect(events[1]?.detail).toEqual({
			selected: ["other"],
			previousSelected: [],
			reason: "pointer",
		});

		cancel = true;
		const beforeCancel = events.length;
		const selectedBeforeCancel = controller.selected;
		const valueBeforeCancel = [...controller.selectedValue];
		await userEvent.click(cellAt(root, "other", 1));
		expect(events).toHaveLength(beforeCancel + 1);
		expect(controller.selected).toEqual(selectedBeforeCancel);
		expect(controller.selectedValue).toEqual(valueBeforeCancel);
		expect(rowFor(root, "other").getAttribute("aria-selected")).toBe("true");

		cancel = false;
		await focusAndPress(cellAt(root, "root", 1), "{Shift>}{Space}{/Shift}");
		expect(events.at(-1)?.type).toBe("treegrid:change");
		expect(events.at(-1)?.detail).toEqual({
			selected: ["root", "other"],
			previousSelected: ["other"],
			reason: "keyboard",
		});

		controller.selected = ["grand"];
		root.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
		root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
		expect(events.at(-1)?.type).toBe("treegrid:change");
		expect(controller.selected).toEqual(["grand"]);
	});
});
