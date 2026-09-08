import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import { horizontalArrowDelta, wrapNavigationIndex } from "../src/internal/roving_navigation";
import TabsController from "../src/tabs_controller";

type TabsPublicController = Controller & {
	value: string;
	select: (value: string) => void;
};

type ChangeDetail = {
	value: string;
	previousValue: string;
	reason: "pointer" | "keyboard";
};

let application: Application;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const mount = async (rootAttributes = "", firstTabAttributes = "") => {
	document.body.insertAdjacentHTML(
		"beforeend",
		'<div data-controller="tabs" ' +
			rootAttributes +
			'><div data-tabs-target="tablist" aria-label="設定">' +
			`<button type="button" data-tabs-target="tab" data-tabs-value="account" ${firstTabAttributes}>アカウント</button>` +
			'<button type="button" data-tabs-target="tab" data-tabs-value="security">セキュリティ</button>' +
			'<button type="button" data-tabs-target="tab" data-tabs-value="notifications">通知</button>' +
			'<button type="button" data-tabs-target="tab" data-tabs-value="billing" disabled>請求</button>' +
			"</div>" +
			'<section data-tabs-target="tabpanel" data-tabs-value="account">アカウント内容</section>' +
			'<section data-tabs-target="tabpanel" data-tabs-value="security">セキュリティ内容</section>' +
			'<section data-tabs-target="tabpanel" data-tabs-value="notifications">通知内容</section>' +
			'<section data-tabs-target="tabpanel" data-tabs-value="billing">請求内容</section>' +
			"</div>",
	);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) {
		throw new Error("tabs root を作成できませんでした");
	}
	const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tabs-target="tab"]'));
	const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-tabs-target="tabpanel"]'));
	const tablist = root.querySelector<HTMLElement>('[data-tabs-target="tablist"]');
	if (!tablist) {
		throw new Error("tablist を作成できませんでした");
	}
	return { root, tablist, tabs, panels };
};

const mountRaw = async (html: string) => {
	document.body.insertAdjacentHTML("beforeend", html);
	await settle();
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"tabs",
	) as TabsPublicController | null;
	if (!controller) {
		throw new Error("tabs controller が接続されていません");
	}
	return controller;
};

const keydown = async (element: HTMLElement, key: string) => {
	element.focus();
	await userEvent.keyboard(key === " " ? " " : `{${key}}`);
};

beforeEach(() => {
	document.body.innerHTML = "";
	application = Application.start();
	application.register("tabs", TabsController);
});

afterEach(() => {
	application.stop();
	document.body.innerHTML = "";
});

describe("tabs", () => {
	test("[tabs-state-sync][tabs-id-preservation] Checks initial ARIA, state, relationships, IDs, and Tab movement to panels", async () => {
		const { root, tablist, tabs, panels } = await mount(
			'data-tabs-value-value="unknown"',
			'id="authored-account-tab"',
		);

		expect(root.getAttribute("data-tabs-value-value")).toBe("account");
		expect(tablist.getAttribute("role")).toBe("tablist");
		expect(tabs[0]?.getAttribute("role")).toBe("tab");
		expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
		expect(tabs[0]?.getAttribute("tabindex")).toBe("0");
		expect(tabs[0]?.getAttribute("data-state")).toBe("active");
		expect(tabs[1]?.getAttribute("aria-selected")).toBe("false");
		expect(tabs[1]?.getAttribute("tabindex")).toBe("-1");
		expect(panels[0]?.getAttribute("role")).toBe("tabpanel");
		expect(panels[0]?.hidden).toBe(false);
		expect(panels[0]?.getAttribute("tabindex")).toBe("0");
		expect(panels[1]?.hidden).toBe(true);
		expect(tabs[0]?.getAttribute("aria-controls")).toBe(panels[0]?.id);
		expect(panels[0]?.getAttribute("aria-labelledby")).toBe(tabs[0]?.id);
		expect(tabs[0]?.id).toBe("authored-account-tab");
		expect(new Set([...tabs, ...panels].map((element) => element.id)).size).toBe(8);
		panels[0]?.focus();
		expect(document.activeElement).toBe(panels[0]);
	});

	test("[tabs-pair-validity] Disables duplicate tab/panel pairs with one warning", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			const { root, tablist } = await mount('data-tabs-value-value="account"');
			warnings.length = 0;
			const duplicate = document.createElement("button");
			duplicate.type = "button";
			duplicate.dataset.tabsTarget = "tab";
			duplicate.dataset.tabsValue = "account";
			duplicate.textContent = "アカウント2";

			tablist.append(duplicate);
			await settle();

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(duplicate.getAttribute("aria-selected")).toBeNull();
			expect(duplicate.getAttribute("aria-controls")).toBeNull();
			const controller = controllerFor(root);
			controller.select("security");
			expect(root.getAttribute("data-tabs-value-value")).toBe("account");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[tabs-beforechange-cancel] Checks pointer events, cancellation, and no events for unchanged values", async () => {
		const { root, tabs } = await mount('data-tabs-value-value="account"');
		const events: Array<{ name: string; detail: ChangeDetail; target: EventTarget | null }> = [];
		let cancel = true;
		root.addEventListener("tabs:beforechange", (event) => {
			events.push({
				name: event.type,
				detail: (event as CustomEvent<ChangeDetail>).detail,
				target: event.target,
			});
			if (cancel) event.preventDefault();
		});
		root.addEventListener("tabs:change", (event) => {
			events.push({
				name: event.type,
				detail: (event as CustomEvent<ChangeDetail>).detail,
				target: event.target,
			});
		});

		await userEvent.click(tabs[1]!);
		expect(root.getAttribute("data-tabs-value-value")).toBe("account");
		expect(events.map(({ name }) => name)).toEqual(["tabs:beforechange"]);
		cancel = false;
		events.length = 0;
		await userEvent.click(tabs[1]!);
		expect(events.map(({ name }) => name)).toEqual(["tabs:beforechange", "tabs:change"]);
		expect(events[1]?.detail).toEqual({
			value: "security",
			previousValue: "account",
			reason: "pointer",
		});
		expect(events[1]?.target).toBe(root);
		events.length = 0;
		await userEvent.click(tabs[1]!);
		expect(events).toEqual([]);
	});

	test("[tabs-isTrusted-guard] Synthetic click/keydown do not change state or custom events", async () => {
		const { root, tabs } = await mount('data-tabs-value-value="account"');
		const events: string[] = [];
		root.addEventListener("tabs:beforechange", (event) => events.push(event.type));
		root.addEventListener("tabs:change", (event) => events.push(event.type));

		tabs[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle();
		expect(root.getAttribute("data-tabs-value-value")).toBe("account");
		expect(events).toEqual([]);

		tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
		await settle();
		expect(root.getAttribute("data-tabs-value-value")).toBe("account");
		expect(events).toEqual([]);
	});

	test("[tabs-programmatic-silence] Programmatic changes emit no events and restore invalid values to valid ones", async () => {
		const { root, tabs, panels } = await mount('data-tabs-value-value="account"');
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("tabs:beforechange", (event) => events.push(event));
		root.addEventListener("tabs:change", (event) => events.push(event));

		controller.select("security");
		await settle();
		expect(controller.value).toBe("security");
		expect(root.getAttribute("data-tabs-value-value")).toBe("security");
		expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
		expect(panels[1]?.hidden).toBe(false);
		controller.value = "missing";
		await settle();
		expect(controller.value).toBe("security");
		root.setAttribute("data-tabs-value-value", "missing");
		await settle();
		expect(root.getAttribute("data-tabs-value-value")).toBe("security");
		expect(events).toEqual([]);
	});

	test("[tabs-roving-empty-length-negative][tabs-roving-negative-index-negative][tabs-roving-key-filter-negative][tabs-roving-rtl-left-negative][tabs-roving-rtl-right-negative] Checks shared roving navigation boundaries and direction", () => {
		expect(wrapNavigationIndex(0, 0)).toBeUndefined();
		expect(wrapNavigationIndex(-1, 3)).toBe(2);
		expect(horizontalArrowDelta("Home", "ltr")).toBeUndefined();
		expect(horizontalArrowDelta("ArrowLeft", "rtl")).toBe(1);
		expect(horizontalArrowDelta("ArrowRight", "rtl")).toBe(-1);
	});

	test("[tabs-keyboard-orientation][tabs-keyboard-direction][tabs-keyboard-disabled][tabs-keyboard-wrap][tabs-activation] Checks focus and selection during keyboard interaction", async () => {
		// Three enabled tabs (account, security, notifications) give distinct neighbors,
		// allowing tests to distinguish LTR/RTL and ArrowUp/ArrowDown directions.
		const automatic = await mount('data-tabs-value-value="account"');
		automatic.tabs[0]?.focus();
		await keydown(automatic.tabs[0]!, "ArrowUp");
		await settle();
		// Horizontal mode does not handle ArrowUp or ArrowDown.
		expect(document.activeElement).toBe(automatic.tabs[0]);
		expect(automatic.root.getAttribute("data-tabs-value-value")).toBe("account");
		await keydown(automatic.tabs[0]!, "ArrowDown");
		await settle();
		expect(document.activeElement).toBe(automatic.tabs[0]);
		expect(automatic.root.getAttribute("data-tabs-value-value")).toBe("account");
		await keydown(automatic.tabs[0]!, "ArrowLeft");
		await settle();
		// LTR ArrowLeft moves backward, wrapping from the first to the last enabled tab.
		expect(document.activeElement).toBe(automatic.tabs[2]);
		// Automatic activation selects as focus moves.
		expect(automatic.root.getAttribute("data-tabs-value-value")).toBe("notifications");
		await keydown(automatic.tabs[2]!, "ArrowRight");
		await settle();
		// LTR ArrowRight moves forward, wrapping from the last to the first tab.
		expect(document.activeElement).toBe(automatic.tabs[0]);
		await keydown(automatic.tabs[0]!, "End");
		await settle();
		// Disabled billing is excluded, so the last enabled tab is the boundary.
		expect(document.activeElement).toBe(automatic.tabs[2]);
		await keydown(automatic.tabs[2]!, "Home");
		await settle();
		expect(document.activeElement).toBe(automatic.tabs[0]);

		const manual = await mount(
			'data-tabs-value-value="account" data-tabs-activation-value="manual" dir="rtl"',
		);
		manual.tabs[0]?.focus();
		await keydown(manual.tabs[0]!, "ArrowLeft");
		await settle();
		// RTL ArrowLeft moves forward; LTR would wrap to tabs[2], distinguishing direction.
		expect(document.activeElement).toBe(manual.tabs[1]);
		// Manual activation moves focus without changing selection.
		expect(manual.root.getAttribute("data-tabs-value-value")).toBe("account");
		expect(manual.tabs[0]?.getAttribute("tabindex")).toBe("0");
		expect(manual.tabs[1]?.getAttribute("tabindex")).toBe("-1");
		await keydown(manual.tabs[1]!, "Enter");
		await settle();
		expect(manual.root.getAttribute("data-tabs-value-value")).toBe("security");
		expect(manual.tabs[0]?.getAttribute("tabindex")).toBe("-1");
		expect(manual.tabs[1]?.getAttribute("tabindex")).toBe("0");

		manual.root.setAttribute("data-tabs-orientation-value", "vertical");
		await settle();
		expect(manual.tablist.getAttribute("aria-orientation")).toBe("vertical");
		await keydown(manual.tabs[1]!, "ArrowDown");
		await settle();
		// Vertical ArrowDown moves forward.
		expect(document.activeElement).toBe(manual.tabs[2]);
		expect(manual.root.getAttribute("data-tabs-value-value")).toBe("security");
		expect(manual.tabs[1]?.getAttribute("tabindex")).toBe("0");
		expect(manual.tabs[2]?.getAttribute("tabindex")).toBe("-1");
		await keydown(manual.tabs[2]!, "ArrowUp");
		await settle();
		// Vertical ArrowUp moves backward.
		expect(document.activeElement).toBe(manual.tabs[1]);
		await keydown(manual.tabs[1]!, "ArrowUp");
		await settle();
		expect(document.activeElement).toBe(manual.tabs[0]);
		await keydown(manual.tabs[0]!, " ");
		await settle();
		expect(manual.root.getAttribute("data-tabs-value-value")).toBe("account");
		expect(manual.tabs[0]?.getAttribute("tabindex")).toBe("0");
		expect(manual.tabs[1]?.getAttribute("tabindex")).toBe("-1");

		await keydown(manual.tabs[0]!, "End");
		await settle();
		// Disabled billing is excluded, so End reaches the last enabled tab.
		expect(document.activeElement).toBe(manual.tabs[2]);
		// Home and End move only focus during manual activation.
		expect(manual.root.getAttribute("data-tabs-value-value")).toBe("account");
		await keydown(manual.tabs[2]!, "Enter");
		await settle();
		expect(manual.root.getAttribute("data-tabs-value-value")).toBe("notifications");
		await keydown(manual.tabs[2]!, "Home");
		await settle();
		expect(document.activeElement).toBe(manual.tabs[0]);
		expect(manual.root.getAttribute("data-tabs-value-value")).toBe("notifications");
	});

	test("[tabs-disabled-guard][tabs-dynamic-preservation][tabs-dynamic-fallback][tabs-disconnect-cleanup] Checks dynamic targets, connection, and disconnection", async () => {
		const { root, tablist, tabs, panels } = await mount('data-tabs-value-value="account"');
		tablist.insertAdjacentHTML(
			"beforeend",
			'<button type="button" data-tabs-target="tab" data-tabs-value="activity">履歴</button>',
		);
		root.insertAdjacentHTML(
			"beforeend",
			'<section data-tabs-target="tabpanel" data-tabs-value="activity">履歴内容</section>',
		);
		await settle();
		expect(root.getAttribute("data-tabs-value-value")).toBe("account");
		tabs[0]?.remove();
		panels[0]?.remove();
		await settle();
		expect(root.getAttribute("data-tabs-value-value")).toBe("security");
		tabs[1]!.disabled = true;
		await settle();
		expect(root.getAttribute("data-tabs-value-value")).toBe("notifications");

		const activityTab = root.querySelector<HTMLButtonElement>(
			'[data-tabs-value="activity"][data-tabs-target="tab"]',
		);
		const activityPanel = root.querySelector<HTMLElement>(
			'[data-tabs-value="activity"][data-tabs-target="tabpanel"]',
		);
		tabs[2]!.disabled = true;
		await settle();
		expect(root.getAttribute("data-tabs-value-value")).toBe("activity");
		activityTab!.disabled = true;
		await settle();
		expect(root.getAttribute("data-tabs-value-value")).toBe("");

		tabs[1]!.disabled = false;
		await settle();
		expect(root.getAttribute("data-tabs-value-value")).toBe("security");

		tabs[1]!.setAttribute("data-tabs-value", "renamed");
		const securityPanel = root.querySelector<HTMLElement>(
			'[data-tabs-value="security"][data-tabs-target="tabpanel"]',
		);
		securityPanel!.setAttribute("data-tabs-value", "renamed");
		await settle();
		expect(root.getAttribute("data-tabs-value-value")).toBe("renamed");
		activityTab!.disabled = false;
		activityPanel!.hidden = true;
		await settle();

		let changes = 0;
		root.addEventListener("tabs:change", () => {
			changes += 1;
		});
		const controller = controllerFor(root);
		controller.disconnect();
		// Clicks while disconnected affect neither selection nor events.
		await userEvent.click(activityTab!);
		expect(changes).toBe(0);
		expect(root.getAttribute("data-tabs-value-value")).toBe("renamed");
		controller.connect();
		await settle();
		// After reconnect, each click emits exactly one event.
		await userEvent.click(activityTab!);
		expect(changes).toBe(1);
		expect(root.getAttribute("data-tabs-value-value")).toBe("activity");
	});

	test("[tabs-id-uniqueness] Generated IDs remain unique across instances in the entire document", async () => {
		const first = await mount('data-tabs-value-value="account"');
		const second = await mount('data-tabs-value-value="security"');
		const ids = [...first.tabs, ...first.panels, ...second.tabs, ...second.panels]
			.map((element) => element.id)
			.filter(Boolean);
		expect(ids).toHaveLength(16);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("Preserves authored aria-label as the tablist accessible name", async () => {
		const { tablist } = await mount('data-tabs-value-value="account"');
		expect(tablist.getAttribute("aria-label")).toBe("設定");
	});

	test("tabs:beforechange and tabs:change bubble to the document", async () => {
		const { root, tabs } = await mount('data-tabs-value-value="account"');
		const events: string[] = [];
		const onBeforeChange = (event: Event) => {
			if (event.target === root) events.push(event.type);
		};
		const onChange = (event: Event) => {
			if (event.target === root) events.push(event.type);
		};
		document.addEventListener("tabs:beforechange", onBeforeChange);
		document.addEventListener("tabs:change", onChange);

		await userEvent.click(tabs[1]!);
		await settle();
		expect(events).toEqual(["tabs:beforechange", "tabs:change"]);

		document.removeEventListener("tabs:beforechange", onBeforeChange);
		document.removeEventListener("tabs:change", onChange);
	});

	test("A disabled tab click() changes neither selection nor events because the browser emits no click", async () => {
		// HTMLElement.click() returns without emitting a click on disabled form controls.
		// This checks native browser behavior rather than the controller's disabled guard.
		// The following [tabs-disabled-guard] test checks the controller guard itself.
		const { root, tabs } = await mount('data-tabs-value-value="account"');
		const events: string[] = [];
		root.addEventListener("tabs:beforechange", () => events.push("tabs:beforechange"));
		root.addEventListener("tabs:change", () => events.push("tabs:change"));
		const billingTab = tabs[3];
		expect(billingTab?.disabled).toBe(true);

		billingTab?.click();
		await settle();
		expect(root.getAttribute("data-tabs-value-value")).toBe("account");
		expect(events).toEqual([]);
	});

	test("[tabs-disabled-guard] A tab disabled during trusted-click capture changes neither selection nor events", async () => {
		const { root, tabs } = await mount('data-tabs-value-value="account"');
		const events: string[] = [];
		root.addEventListener("tabs:beforechange", () => events.push("tabs:beforechange"));
		root.addEventListener("tabs:change", () => events.push("tabs:change"));
		const billingTab = tabs[3];
		expect(billingTab?.disabled).toBe(true);

		billingTab!.disabled = false;
		root.addEventListener(
			"click",
			() => {
				billingTab!.disabled = true;
			},
			{ capture: true, once: true },
		);
		await userEvent.click(billingTab!);
		expect(root.getAttribute("data-tabs-value-value")).toBe("account");
		expect(events).toEqual([]);
	});

	test("Selects the first enabled pair when the initial value refers to a disabled pair", async () => {
		const { root, tabs } = await mount('data-tabs-value-value="billing"');
		expect(root.getAttribute("data-tabs-value-value")).toBe("account");
		expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
		expect(tabs[3]?.getAttribute("aria-selected")).toBe("false");
	});

	test("Disables missing pairs and zero or multiple tablists with one warning", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mountRaw(
				'<div data-controller="tabs" id="no-pair-root">' +
					'<div data-tabs-target="tablist" aria-label="pairなし">' +
					'<button type="button" data-tabs-target="tab" data-tabs-value="only">Only</button>' +
					"</div></div>",
			);
			const noPairRoot = document.getElementById("no-pair-root");
			if (!(noPairRoot instanceof HTMLElement))
				throw new Error("no-pair-root を作成できませんでした");
			expect(controllerFor(noPairRoot).value).toBe("");
			expect(noPairRoot.getAttribute("data-tabs-value-value")).toBeNull();
			expect(noPairRoot.querySelectorAll("[data-state]")).toHaveLength(0);
			expect(noPairRoot.querySelectorAll("[aria-controls]")).toHaveLength(0);

			await mountRaw(
				'<div data-controller="tabs" id="no-tablist-root">' +
					'<button type="button" data-tabs-target="tab" data-tabs-value="orphan">Orphan</button>' +
					'<section data-tabs-target="tabpanel" data-tabs-value="orphan">Orphan内容</section>' +
					"</div>",
			);
			const noTablistRoot = document.getElementById("no-tablist-root");
			if (!(noTablistRoot instanceof HTMLElement)) {
				throw new Error("no-tablist-root を作成できませんでした");
			}
			expect(controllerFor(noTablistRoot).value).toBe("");
			expect(noTablistRoot.getAttribute("data-tabs-value-value")).toBeNull();
			expect(noTablistRoot.querySelectorAll("[data-state]")).toHaveLength(0);
			expect(noTablistRoot.querySelectorAll("[role]")).toHaveLength(0);

			await mountRaw(
				'<div data-controller="tabs" id="multi-tablist-root">' +
					'<div data-tabs-target="tablist" aria-label="1つめ">' +
					'<button type="button" data-tabs-target="tab" data-tabs-value="a">A</button>' +
					"</div>" +
					'<div data-tabs-target="tablist" aria-label="2つめ">' +
					'<button type="button" data-tabs-target="tab" data-tabs-value="b">B</button>' +
					"</div>" +
					'<section data-tabs-target="tabpanel" data-tabs-value="a">A内容</section>' +
					'<section data-tabs-target="tabpanel" data-tabs-value="b">B内容</section>' +
					"</div>",
			);
			const multiTablistRoot = document.getElementById("multi-tablist-root");
			if (!(multiTablistRoot instanceof HTMLElement)) {
				throw new Error("multi-tablist-root を作成できませんでした");
			}
			expect(controllerFor(multiTablistRoot).value).toBe("");
			expect(multiTablistRoot.getAttribute("data-tabs-value-value")).toBeNull();
			expect(multiTablistRoot.querySelectorAll("[role]")).toHaveLength(0);
			expect(warnings).toHaveLength(3);
			expect(warnings.every((warning) => warning.includes("Enhancement has been disabled"))).toBe(
				true,
			);
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[tabs-semantic-validation][tabs-semantic-validation-negative] Disables invalid markup with one warning and reapplies enhancement when valid", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			const cases = [
				'<div data-controller="tabs"><button type="button" data-tabs-target="tab" data-tabs-value="a">A</button><section data-tabs-target="tabpanel" data-tabs-value="a">A</section></div>',
				'<div data-controller="tabs"><div data-tabs-target="tablist"><button type="button" data-tabs-target="tab" data-tabs-value="a">A</button></div><div data-tabs-target="tablist"><button type="button" data-tabs-target="tab" data-tabs-value="b">B</button></div><section data-tabs-target="tabpanel" data-tabs-value="a">A</section><section data-tabs-target="tabpanel" data-tabs-value="b">B</section></div>',
				'<div data-controller="tabs"><div data-tabs-target="tablist"><div data-tabs-target="tab" data-tabs-value="a">A</div></div><section data-tabs-target="tabpanel" data-tabs-value="a">A</section></div>',
				'<div data-controller="tabs"><div data-tabs-target="tablist"><button data-tabs-target="tab" data-tabs-value="a">A</button></div><section data-tabs-target="tabpanel" data-tabs-value="a">A</section></div>',
				'<div data-controller="tabs"><div data-tabs-target="tablist"><button type="button" data-tabs-target="tab" data-tabs-value="a">A</button></div><button type="button" data-tabs-target="tab" data-tabs-value="b">B</button><section data-tabs-target="tabpanel" data-tabs-value="a">A</section><section data-tabs-target="tabpanel" data-tabs-value="b">B</section></div>',
				'<div data-controller="tabs"><div data-tabs-target="tablist"></div><section data-tabs-target="tabpanel" data-tabs-value="a">A</section></div>',
				'<div data-controller="tabs"><div data-tabs-target="tablist"><button type="button" data-tabs-target="tab" data-tabs-value="">A</button></div><section data-tabs-target="tabpanel" data-tabs-value="">A</section></div>',
				'<div data-controller="tabs"><div data-tabs-target="tablist"><button type="button" data-tabs-target="tab" data-tabs-value="a">A</button><button type="button" data-tabs-target="tab" data-tabs-value="a">A2</button></div><section data-tabs-target="tabpanel" data-tabs-value="a">A</section></div>',
				'<div data-controller="tabs"><div data-tabs-target="tablist"><button type="button" data-tabs-target="tab" data-tabs-value="a">A</button><button type="button" data-tabs-target="tab" data-tabs-value="b">B</button></div><section data-tabs-target="tabpanel" data-tabs-value="a">A</section><section data-tabs-target="tabpanel" data-tabs-value="a">A2</section></div>',
				'<div data-controller="tabs"><div data-tabs-target="tablist"><button type="button" data-tabs-target="tab" data-tabs-value="a">A</button><button type="button" data-tabs-target="tab" data-tabs-value="b">B</button></div><section data-tabs-target="tabpanel" data-tabs-value="a">A</section></div>',
				'<div data-controller="tabs" data-tabs-orientation-value="diagonal"><div data-tabs-target="tablist"><button type="button" data-tabs-target="tab" data-tabs-value="a">A</button></div><section data-tabs-target="tabpanel" data-tabs-value="a">A</section></div>',
				'<div data-controller="tabs" data-tabs-activation-value="manuel"><div data-tabs-target="tablist"><button type="button" data-tabs-target="tab" data-tabs-value="a">A</button></div><section data-tabs-target="tabpanel" data-tabs-value="a">A</section></div>',
			];

			for (const [index, markup] of cases.entries()) {
				document.body.insertAdjacentHTML("beforeend", markup);
				await settle();
				const root = document.body.lastElementChild;
				if (!(root instanceof HTMLElement)) throw new Error(`invalid root ${index} がありません`);
				const controller = controllerFor(root);

				expect(warnings).toHaveLength(index + 1);
				expect(warnings[index]).toContain("tabs controller");
				expect(warnings[index]).toContain("Enhancement has been disabled");
				expect(warnings[index]).not.toContain("Added ");
				expect(root.dataset.state).toBeUndefined();
				expect(root.querySelectorAll("[role]")).toHaveLength(0);
				expect(root.querySelectorAll("[data-state]")).toHaveLength(0);
				expect(
					root.querySelectorAll("[aria-controls], [aria-labelledby], [tabindex]"),
				).toHaveLength(0);
				controller.select("a");
				controller.value = "a";
				expect(root.getAttribute("data-tabs-value-value")).toBeNull();
			}

			warnings.length = 0;
			await mountRaw(
				'<div data-controller="tabs" data-tabs-value-value="a">' +
					'<div data-tabs-target="tablist" role="tablist" aria-label="設定">' +
					'<button type="button" data-tabs-target="tab" data-tabs-value="a" id="valid-tab-a" role="tab" aria-controls="valid-panel-a">A</button>' +
					'<button type="button" data-tabs-target="tab" data-tabs-value="b" id="valid-tab-b" role="tab" aria-controls="valid-panel-b">B</button>' +
					"</div>" +
					'<section data-tabs-target="tabpanel" data-tabs-value="a" id="valid-panel-a" role="tabpanel" tabindex="0" aria-labelledby="valid-tab-a">A</section>' +
					'<section data-tabs-target="tabpanel" data-tabs-value="b" id="valid-panel-b" role="tabpanel" tabindex="0" aria-labelledby="valid-tab-b">B</section>' +
					"</div>",
			);
			expect(warnings).toHaveLength(0);

			const validRoot = document.body.lastElementChild;
			if (!(validRoot instanceof HTMLElement)) throw new Error("valid root がありません");
			const validController = controllerFor(validRoot);
			const validTablist = validRoot.querySelector<HTMLElement>('[data-tabs-target="tablist"]');
			if (!validTablist) throw new Error("valid tablist がありません");
			const duplicate = document.createElement("button");
			duplicate.type = "button";
			duplicate.dataset.tabsTarget = "tab";
			duplicate.dataset.tabsValue = "a";
			duplicate.textContent = "A2";
			validTablist.append(duplicate);
			await settle();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			validController.select("b");
			expect(validRoot.getAttribute("data-tabs-value-value")).toBe("a");

			duplicate.remove();
			await settle();
			validController.select("b");
			expect(validRoot.getAttribute("data-tabs-value-value")).toBe("b");
			expect(validRoot.querySelector('[data-tabs-value="b"][data-state="active"]')).not.toBeNull();
			expect(warnings).toHaveLength(1);
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[tabs-completion-warning][tabs-completion-warning-negative] Warns once per connection when completing roles and ARIA relationships and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("tabs controller");
			expect(warnings[0]).toContain('role="tablist"');
			expect(warnings[0]).toContain("aria-controls");
			expect(warnings[0]).toContain("aria-labelledby");

			warnings.length = 0;
			await mountRaw(
				'<div data-controller="tabs">' +
					'<div data-tabs-target="tablist" aria-label="設定" role="tablist">' +
					'<button type="button" data-tabs-target="tab" data-tabs-value="a" id="complete-tab-a" role="tab" aria-controls="complete-panel-a">A</button>' +
					'<button type="button" data-tabs-target="tab" data-tabs-value="b" id="complete-tab-b" role="tab" aria-controls="complete-panel-b">B</button>' +
					"</div>" +
					'<section data-tabs-target="tabpanel" data-tabs-value="a" id="complete-panel-a" role="tabpanel" aria-labelledby="complete-tab-a">A内容</section>' +
					'<section data-tabs-target="tabpanel" data-tabs-value="b" id="complete-panel-b" role="tabpanel" aria-labelledby="complete-tab-b">B内容</section>' +
					"</div>",
			);
			expect(warnings).toHaveLength(0);
		} finally {
			console.warn = previousWarn;
		}
	});

	test("Preserves authored roles, aria-controls, aria-labelledby, aria-orientation, and panel tabindex", async () => {
		await mountRaw(
			'<div data-controller="tabs" id="preserved-root" data-tabs-orientation-value="vertical" data-tabs-value-value="alpha">' +
				'<div data-tabs-target="tablist" aria-label="保持" role="tablist" aria-orientation="vertical">' +
				'<button type="button" data-tabs-target="tab" data-tabs-value="alpha" id="preserved-tab-alpha" role="tab" aria-controls="preserved-panel-alpha">Alpha</button>' +
				'<button type="button" data-tabs-target="tab" data-tabs-value="beta" id="preserved-tab-beta" role="tab" aria-controls="preserved-panel-beta">Beta</button>' +
				"</div>" +
				'<section data-tabs-target="tabpanel" data-tabs-value="alpha" id="preserved-panel-alpha" role="tabpanel" aria-labelledby="preserved-tab-alpha" tabindex="-1">Alpha内容</section>' +
				'<section data-tabs-target="tabpanel" data-tabs-value="beta" id="preserved-panel-beta" role="tabpanel" aria-labelledby="preserved-tab-beta" tabindex="-1">Beta内容</section>' +
				"</div>",
		);
		const root = document.getElementById("preserved-root");
		if (!root) throw new Error("preserved-root を作成できませんでした");
		const tablist = root.querySelector<HTMLElement>('[data-tabs-target="tablist"]');
		const alphaTab = document.getElementById("preserved-tab-alpha");
		const alphaPanel = document.getElementById("preserved-panel-alpha");
		const betaPanel = document.getElementById("preserved-panel-beta");

		expect(tablist?.getAttribute("role")).toBe("tablist");
		expect(tablist?.getAttribute("aria-orientation")).toBe("vertical");
		expect(alphaTab?.getAttribute("role")).toBe("tab");
		expect(alphaTab?.getAttribute("aria-controls")).toBe("preserved-panel-alpha");
		expect(alphaPanel?.getAttribute("role")).toBe("tabpanel");
		expect(alphaPanel?.getAttribute("aria-labelledby")).toBe("preserved-tab-alpha");
		expect(alphaPanel?.getAttribute("tabindex")).toBe("-1");
		expect(betaPanel?.getAttribute("tabindex")).toBe("-1");
		// Normalize controller-managed state outputs to match selection.
		expect(alphaTab?.getAttribute("aria-selected")).toBe("true");
		expect(alphaTab?.getAttribute("data-state")).toBe("active");
	});

	test("Distinguishes nested tab events using event.target and event.currentTarget", async () => {
		await mountRaw(
			'<div data-controller="tabs" id="nested-outer">' +
				'<div data-tabs-target="tablist" aria-label="外側">' +
				'<button type="button" data-tabs-target="tab" data-tabs-value="a">A</button>' +
				'<button type="button" data-tabs-target="tab" data-tabs-value="b">B</button>' +
				"</div>" +
				'<section data-tabs-target="tabpanel" data-tabs-value="a">' +
				'<div data-controller="tabs" id="nested-inner">' +
				'<div data-tabs-target="tablist" aria-label="内側">' +
				'<button type="button" data-tabs-target="tab" data-tabs-value="x">X</button>' +
				'<button type="button" data-tabs-target="tab" data-tabs-value="y">Y</button>' +
				"</div>" +
				'<section data-tabs-target="tabpanel" data-tabs-value="x">X内容</section>' +
				'<section data-tabs-target="tabpanel" data-tabs-value="y">Y内容</section>' +
				"</div>" +
				"</section>" +
				'<section data-tabs-target="tabpanel" data-tabs-value="b">B内容</section>' +
				"</div>",
		);
		const outer = document.getElementById("nested-outer");
		const inner = document.getElementById("nested-inner");
		if (!outer || !inner) throw new Error("nested tabs を作成できませんでした");

		const received: Array<{ own: boolean; target: EventTarget | null }> = [];
		outer.addEventListener("tabs:change", (event) => {
			received.push({ own: event.target === event.currentTarget, target: event.target });
		});

		const innerTabY = inner.querySelector<HTMLButtonElement>(
			'[data-tabs-target="tab"][data-tabs-value="y"]',
		);
		await userEvent.click(innerTabY!);
		await settle();
		expect(received).toEqual([{ own: false, target: inner }]);

		const outerTabB = outer.querySelector<HTMLButtonElement>(
			'[data-tabs-target="tab"][data-tabs-value="b"]',
		);
		await userEvent.click(outerTabB!);
		await settle();
		expect(received).toEqual([
			{ own: false, target: inner },
			{ own: true, target: outer },
		]);
		expect(received.filter((entry) => entry.own)).toHaveLength(1);
	});
});
