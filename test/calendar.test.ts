import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import CalendarController, { type CalendarChangeDetail } from "../src/calendar_controller";

type CalendarPublicController = Controller & {
	value: string;
	start: string;
	end: string;
};

type CalendarEventRecord = {
	type: string;
	detail: CalendarChangeDetail;
	bubbles: boolean;
	cancelable: boolean;
};

const CALENDAR_DAYS = [
	"2026-07-26",
	"2026-07-27",
	"2026-07-28",
	"2026-07-29",
	"2026-07-30",
	"2026-07-31",
	"2026-08-01",
	"2026-08-02",
	"2026-08-03",
	"2026-08-04",
	"2026-08-05",
	"2026-08-06",
	"2026-08-07",
	"2026-08-08",
	"2026-08-09",
	"2026-08-10",
	"2026-08-11",
	"2026-08-12",
	"2026-08-13",
	"2026-08-14",
	"2026-08-15",
	"2026-08-16",
	"2026-08-17",
	"2026-08-18",
	"2026-08-19",
	"2026-08-20",
	"2026-08-21",
	"2026-08-22",
];

let application: Application;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const daysMarkup = (values: string[] = CALENDAR_DAYS, disabledIndexes: number[] = []) =>
	values
		.map(
			(value, index) =>
				`<button type="button" data-calendar-target="day" data-calendar-value="${value}" ${disabledIndexes.includes(index) ? "disabled" : ""}>${value.slice(-2)}</button>`,
		)
		.join("");

const fixture = (
	rootAttributes = "",
	values: string[] = CALENDAR_DAYS,
	disabledIndexes: number[] = [],
) =>
	`<div data-controller="calendar" aria-label="2026年8月" ${rootAttributes}>${daysMarkup(values, disabledIndexes)}</div>`;

const mount = async (
	rootAttributes = "",
	values: string[] = CALENDAR_DAYS,
	disabledIndexes: number[] = [],
) => {
	document.body.insertAdjacentHTML("beforeend", fixture(rootAttributes, values, disabledIndexes));
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLDivElement)) throw new Error("calendar root がありません");
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"calendar",
	) as CalendarPublicController | null;
	if (controller === null) throw new Error("calendar controller が接続されていません");
	return { root, controller, days: dayButtons(root) };
};

const mountRaw = async (markup: string) => {
	document.body.insertAdjacentHTML("beforeend", markup);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("calendar root がありません");
	return root;
};

const dayButtons = (root: HTMLElement) =>
	Array.from(root.querySelectorAll('[data-calendar-target="day"]')).filter(
		(day): day is HTMLButtonElement => day instanceof HTMLButtonElement,
	);

const dayFor = (root: HTMLElement, value: string) => {
	const day = root.querySelector(`[data-calendar-value="${value}"]`);
	if (!(day instanceof HTMLButtonElement)) throw new Error(`day ${value} がありません`);
	return day;
};

const recordEvents = (root: HTMLElement, events: CalendarEventRecord[]) => {
	for (const name of ["calendar:beforechange", "calendar:change"]) {
		root.addEventListener(name, (event) => {
			const customEvent = event as CustomEvent<CalendarChangeDetail>;
			events.push({
				type: event.type,
				detail: customEvent.detail,
				bubbles: event.bubbles,
				cancelable: event.cancelable,
			});
		});
	}
};

const focusAndPress = async (day: HTMLButtonElement, key: string) => {
	day.focus();
	await userEvent.keyboard(key);
	await settle();
};

beforeEach(() => {
	document.body.innerHTML = "";
	application = Application.start();
	application.register("calendar", CalendarController);
});

afterEach(() => {
	vi.restoreAllMocks();
	application.stop();
	document.body.innerHTML = "";
});

describe("calendar", () => {
	test("[calendar-state-sync][calendar-state-sync-negative] Synchronizes single and range state, aria-pressed, clearing, and authored attributes", async () => {
		const single = await mount(
			'data-calendar-value-value="2026-08-05" data-preserved="yes" id="authored-calendar"',
		);
		const selected = dayFor(single.root, "2026-08-05");
		expect(single.root.dataset.state).toBeUndefined();
		expect(single.root.dataset.preserved).toBe("yes");
		expect(single.root.id).toBe("authored-calendar");
		expect(selected.dataset.state).toBe("selected");
		expect(selected.getAttribute("aria-pressed")).toBe("true");
		expect(dayFor(single.root, "2026-08-04").dataset.state).toBeUndefined();
		expect(dayFor(single.root, "2026-08-04").getAttribute("aria-pressed")).toBe("false");

		single.controller.value = "";
		expect(single.controller.value).toBe("");
		expect(selected.dataset.state).toBeUndefined();
		expect(selected.getAttribute("aria-pressed")).toBe("false");

		const range = await mount(
			'data-calendar-mode-value="range" data-calendar-start-value="2026-08-03" data-calendar-end-value="2026-08-06"',
		);
		expect(dayFor(range.root, "2026-08-03").dataset.state).toBe("range-start");
		expect(dayFor(range.root, "2026-08-03").getAttribute("aria-pressed")).toBe("true");
		expect(dayFor(range.root, "2026-08-04").dataset.state).toBe("in-range");
		expect(dayFor(range.root, "2026-08-04").getAttribute("aria-pressed")).toBe("false");
		expect(dayFor(range.root, "2026-08-06").dataset.state).toBe("range-end");
		expect(dayFor(range.root, "2026-08-06").getAttribute("aria-pressed")).toBe("true");

		range.controller.start = "2026-08-09";
		range.controller.end = "2026-08-09";
		expect(dayFor(range.root, "2026-08-09").dataset.state).toBe("range-start");
		expect(dayFor(range.root, "2026-08-09").getAttribute("aria-pressed")).toBe("true");
		expect(dayFor(range.root, "2026-08-09").dataset.state).not.toBe("range-end");
		expect(dayFor(range.root, "2026-08-08").dataset.state).toBeUndefined();
	});

	test("[calendar-range-selection][calendar-range-selection-negative] Checks range starts, backward reselection, reselection, and one-day ranges", async () => {
		const { root, controller } = await mount('data-calendar-mode-value="range"');

		await userEvent.click(dayFor(root, "2026-08-05"));
		expect(controller.start).toBe("2026-08-05");
		expect(controller.end).toBe("");

		await userEvent.click(dayFor(root, "2026-08-03"));
		expect(controller.start).toBe("2026-08-03");
		expect(controller.end).toBe("");

		await userEvent.click(dayFor(root, "2026-08-08"));
		expect(controller.start).toBe("2026-08-03");
		expect(controller.end).toBe("2026-08-08");

		await userEvent.click(dayFor(root, "2026-08-02"));
		expect(controller.start).toBe("2026-08-02");
		expect(controller.end).toBe("");
		await userEvent.click(dayFor(root, "2026-08-02"));
		expect(controller.start).toBe("2026-08-02");
		expect(controller.end).toBe("2026-08-02");
	});

	test("[calendar-keyboard-navigation][calendar-keyboard-navigation-negative] Checks DOM-order horizontal and week navigation, disabled items, boundaries, RTL, and ignored keys", async () => {
		const disabled = await mount("", CALENDAR_DAYS, [9, 15]);
		await focusAndPress(dayFor(disabled.root, "2026-08-03"), "{ArrowRight}");
		expect(document.activeElement).toBe(dayFor(disabled.root, "2026-08-05"));
		expect(dayFor(disabled.root, "2026-08-05").getAttribute("tabindex")).toBe("0");
		await focusAndPress(dayFor(disabled.root, "2026-08-05"), "{ArrowLeft}");
		expect(document.activeElement).toBe(dayFor(disabled.root, "2026-08-03"));
		await focusAndPress(dayFor(disabled.root, "2026-08-03"), "{ArrowDown}");
		expect(document.activeElement).toBe(dayFor(disabled.root, "2026-08-03"));
		await focusAndPress(dayFor(disabled.root, "2026-07-26"), "{ArrowLeft}");
		expect(document.activeElement).toBe(dayFor(disabled.root, "2026-07-26"));

		const weekly = await mount();
		await focusAndPress(dayFor(weekly.root, "2026-08-03"), "{ArrowDown}");
		expect(document.activeElement).toBe(dayFor(weekly.root, "2026-08-10"));
		await focusAndPress(dayFor(weekly.root, "2026-08-10"), "{ArrowUp}");
		expect(document.activeElement).toBe(dayFor(weekly.root, "2026-08-03"));
		await focusAndPress(dayFor(weekly.root, "2026-08-18"), "{ArrowDown}");
		expect(document.activeElement).toBe(dayFor(weekly.root, "2026-08-18"));
		expect(dayFor(weekly.root, "2026-08-03").getAttribute("tabindex")).toBe("-1");

		const rtl = await mount('dir="rtl"');
		await focusAndPress(dayFor(rtl.root, "2026-08-05"), "{ArrowLeft}");
		expect(document.activeElement).toBe(dayFor(rtl.root, "2026-08-06"));
		await focusAndPress(dayFor(rtl.root, "2026-08-06"), "{ArrowRight}");
		expect(document.activeElement).toBe(dayFor(rtl.root, "2026-08-05"));

		const unchanged = dayFor(weekly.root, "2026-08-05");
		unchanged.focus();
		await userEvent.keyboard("{Home}");
		await userEvent.keyboard("{PageUp}");
		await settle();
		expect(document.activeElement).toBe(unchanged);
	});

	test("[calendar-change-events][calendar-change-events-negative] Checks trusted change order, detail, cancellation, reason, unchanged values, and synthetic clicks", async () => {
		const single = await mount('data-calendar-value-value="2026-08-01"');
		const events: CalendarEventRecord[] = [];
		recordEvents(single.root, events);
		let cancel = true;
		single.root.addEventListener("calendar:beforechange", (event) => {
			if (cancel) event.preventDefault();
		});

		await userEvent.click(dayFor(single.root, "2026-08-02"));
		expect(single.controller.value).toBe("2026-08-01");
		expect(events.map(({ type }) => type)).toEqual(["calendar:beforechange"]);
		expect(events[0]?.detail).toEqual({
			value: "2026-08-02",
			previousValue: "2026-08-01",
			reason: "pointer",
		});
		expect(events[0]?.bubbles).toBe(true);
		expect(events[0]?.cancelable).toBe(true);
		expect(events[0]?.detail).not.toHaveProperty("start");

		cancel = false;
		events.length = 0;
		await userEvent.click(dayFor(single.root, "2026-08-02"));
		expect(events.map(({ type }) => type)).toEqual(["calendar:beforechange", "calendar:change"]);
		expect(events[1]?.cancelable).toBe(false);
		expect(single.controller.value).toBe("2026-08-02");

		events.length = 0;
		await userEvent.click(dayFor(single.root, "2026-08-02"));
		expect(events).toEqual([]);

		events.length = 0;
		await focusAndPress(dayFor(single.root, "2026-08-03"), "{Enter}");
		expect(events[1]?.detail).toEqual({
			value: "2026-08-03",
			previousValue: "2026-08-02",
			reason: "keyboard",
		});

		events.length = 0;
		dayFor(single.root, "2026-08-04").dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
		);
		expect(single.controller.value).toBe("2026-08-03");
		expect(events).toEqual([]);

		const range = await mount('data-calendar-mode-value="range"');
		const rangeEvents: CalendarEventRecord[] = [];
		recordEvents(range.root, rangeEvents);
		await userEvent.click(dayFor(range.root, "2026-08-05"));
		expect(rangeEvents[1]?.detail).toEqual({
			start: "2026-08-05",
			end: "",
			previousStart: "",
			previousEnd: "",
			reason: "pointer",
		});
		expect(rangeEvents[1]?.detail).not.toHaveProperty("value");
		await focusAndPress(dayFor(range.root, "2026-08-07"), "{Enter}");
		expect(rangeEvents[3]?.detail).toEqual({
			start: "2026-08-05",
			end: "2026-08-07",
			previousStart: "2026-08-05",
			previousEnd: "",
			reason: "keyboard",
		});
	});

	test("[calendar-programmatic-silence][calendar-programmatic-silence-negative] Checks event-free setters, mismatched modes, and normalized date ranges", async () => {
		const single = await mount('data-calendar-value-value="2026-08-01"');
		const singleEvents: CalendarEventRecord[] = [];
		recordEvents(single.root, singleEvents);
		single.controller.value = "2026-08-05";
		expect(single.controller.value).toBe("2026-08-05");
		expect(single.root.getAttribute("data-calendar-value-value")).toBe("2026-08-05");
		expect(singleEvents).toEqual([]);
		single.controller.value = "2026-8-5";
		expect(single.controller.value).toBe("");
		expect(singleEvents).toEqual([]);
		single.controller.start = "2026-08-06";
		single.controller.end = "2026-08-07";
		expect(single.controller.start).toBe("");
		expect(single.controller.end).toBe("");

		const range = await mount(
			'data-calendar-mode-value="range" data-calendar-start-value="2026-08-03" data-calendar-end-value="2026-08-06"',
		);
		const rangeEvents: CalendarEventRecord[] = [];
		recordEvents(range.root, rangeEvents);
		range.controller.start = "2026-08-05";
		expect(range.controller.start).toBe("2026-08-05");
		expect(range.controller.end).toBe("2026-08-06");
		range.controller.start = "2026-08-08";
		expect(range.controller.start).toBe("2026-08-08");
		expect(range.controller.end).toBe("");
		range.controller.end = "2026-08-02";
		expect(range.controller.end).toBe("");
		range.controller.end = "2026-08-09";
		expect(range.controller.end).toBe("2026-08-09");
		range.controller.value = "2026-08-10";
		expect(range.controller.value).toBe("");
		expect(rangeEvents).toEqual([]);
	});

	test("[calendar-month-swap][calendar-month-swap-negative] Restores selection and roving state without moving focus after replacing every day target", async () => {
		const { root, controller } = await mount('data-calendar-value-value="2026-08-04"');
		const oldDay = dayFor(root, "2026-08-04");
		oldDay.focus();
		const outside = document.createElement("button");
		outside.type = "button";
		outside.textContent = "outside";
		document.body.append(outside);
		outside.focus();

		const events: CalendarEventRecord[] = [];
		recordEvents(root, events);
		root.setAttribute("data-calendar-value-value", "2026-08-05");
		root.innerHTML = daysMarkup(["2026-08-03", "2026-08-04", "2026-08-05"]);
		await settle();

		const restored = dayFor(root, "2026-08-05");
		expect(controller.value).toBe("2026-08-05");
		expect(restored.dataset.state).toBe("selected");
		expect(restored.getAttribute("aria-pressed")).toBe("true");
		expect(restored.getAttribute("tabindex")).toBe("0");
		expect(dayFor(root, "2026-08-03").getAttribute("tabindex")).toBe("-1");
		expect(document.activeElement).toBe(outside);
		expect(events).toEqual([]);
	});

	test("[calendar-semantic-validation][calendar-semantic-validation-negative] Disables invalid markup with one warning and restores enhancement for valid markup", async () => {
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			const invalidMarkups = [
				'<div data-controller="calendar"><div data-calendar-target="day" data-calendar-value="2026-08-01">1</div></div>',
				'<div data-controller="calendar"><button type="button" data-calendar-target="day" data-calendar-value="2026-8-1">1</button></div>',
				'<div data-controller="calendar"><button type="button" data-calendar-target="day" data-calendar-value="2026-08-01">1</button><button type="button" data-calendar-target="day" data-calendar-value="2026-08-01">1</button></div>',
				'<div data-controller="calendar"><button type="button" data-calendar-target="day" data-calendar-value="2026-08-02">2</button><button type="button" data-calendar-target="day" data-calendar-value="2026-08-01">1</button></div>',
				'<div data-controller="calendar" data-calendar-mode-value="multi"><button type="button" data-calendar-target="day" data-calendar-value="2026-08-01">1</button></div>',
			];

			for (const markup of invalidMarkups) {
				warnings.length = 0;
				const root = await mountRaw(markup);
				expect(warnings).toHaveLength(1);
				expect(warnings[0]).toContain("calendar controller");
				expect(warnings[0]).toContain('native <button type="button">');
				expect(warnings[0]).toContain("YYYY-MM-DD");
				expect(warnings[0]).toContain("single or range");
				expect(warnings[0]).toContain("Enhancement has been disabled");
				await settle();
				expect(warnings).toHaveLength(1);
				const day = root.querySelector('[data-calendar-target="day"]');
				expect(day?.hasAttribute("aria-pressed")).toBe(false);
				expect(day?.hasAttribute("tabindex")).toBe(false);
			}

			warnings.length = 0;
			const recovering = await mountRaw(
				'<div data-controller="calendar"><div data-calendar-target="day" data-calendar-value="2026-08-01">1</div></div>',
			);
			recovering.innerHTML = daysMarkup(["2026-08-01"]);
			await settle();
			expect(warnings).toHaveLength(1);
			expect(
				recovering.querySelector('[data-calendar-target="day"]')?.getAttribute("aria-pressed"),
			).toBe("false");

			warnings.length = 0;
			const impossible = await mountRaw(
				'<div data-controller="calendar"><button type="button" data-calendar-target="day" data-calendar-value="2026-02-31">31</button></div>',
			);
			expect(warnings).toEqual([]);
			expect(impossible.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
		} finally {
			console.warn = originalWarn;
		}
	});

	test("[calendar-disconnect-cleanup][calendar-disconnect-cleanup-negative] Prevents duplicate or lingering listeners after disconnect and reconnect", async () => {
		const { root } = await mount('data-calendar-value-value="2026-08-01"');
		const events: string[] = [];
		root.addEventListener("calendar:beforechange", (event) => events.push(event.type));
		root.addEventListener("calendar:change", (event) => events.push(event.type));

		root.removeAttribute("data-controller");
		await settle();
		await userEvent.click(dayFor(root, "2026-08-02"));
		expect(events).toEqual([]);
		expect(dayFor(root, "2026-08-01").getAttribute("aria-pressed")).toBe("true");

		root.setAttribute("data-controller", "calendar");
		await settle();
		await userEvent.click(dayFor(root, "2026-08-02"));
		expect(events).toEqual(["calendar:beforechange", "calendar:change"]);

		const reconnectedController = application.getControllerForElementAndIdentifier(
			root,
			"calendar",
		) as CalendarPublicController;
		const eventCount = events.length;
		reconnectedController.disconnect();
		await userEvent.click(dayFor(root, "2026-08-01"));
		expect(events).toHaveLength(eventCount);
	});
});
