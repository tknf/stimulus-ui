import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import ToggleGroupController, {
	type ToggleGroupChangeDetail,
} from "../src/toggle_group_controller";

let application: Application;
let warnings: string[];
let originalWarn: typeof console.warn;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const createItem = (value: string) => {
	const item = document.createElement("button");
	item.type = "button";
	item.textContent = value;
	item.setAttribute("data-toggle-group-target", "item");
	item.setAttribute("data-toggle-group-value", value);
	return item;
};

const createGroup = (attributes: Record<string, string> = {}) => {
	const root = document.createElement("div");
	root.setAttribute("data-controller", "toggle-group");
	root.setAttribute("role", "group");
	root.setAttribute("aria-label", "表示設定");
	for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value);
	root.append(...["a", "b", "c"].map(createItem));
	return root;
};

const mount = async (root = createGroup()) => {
	if (!root.isConnected) document.body.append(root);
	await settle();
	const controller = application.getControllerForElementAndIdentifier(root, "toggle-group");
	if (!(controller instanceof ToggleGroupController)) throw new Error("controller がありません");
	const item = (value: string) => {
		const found = controller.itemTargets.find(
			(candidate) => candidate.getAttribute("data-toggle-group-value") === value,
		);
		if (!(found instanceof HTMLButtonElement)) throw new Error(`${value} がありません`);
		return found;
	};
	return { root, controller, item };
};

const listen = ({ root, controller }: Awaited<ReturnType<typeof mount>>) => {
	const events: {
		type: string;
		detail: ToggleGroupChangeDetail;
		state: string[];
		bubbles: boolean;
		cancelable: boolean;
	}[] = [];
	for (const type of ["toggle-group:beforechange", "toggle-group:change"]) {
		root.addEventListener(type, (event) => {
			const detail = (event as CustomEvent<ToggleGroupChangeDetail>).detail;
			events.push({
				type,
				detail,
				state: controller.selected,
				bubbles: event.bubbles,
				cancelable: event.cancelable,
			});
		});
	}
	return events;
};

beforeEach(() => {
	document.body.replaceChildren();
	warnings = [];
	originalWarn = console.warn;
	console.warn = (message?: unknown) => warnings.push(String(message));
	application = Application.start();
	application.register("toggle-group", ToggleGroupController);
});

afterEach(async () => {
	document.body.replaceChildren();
	await settle();
	application.stop();
	console.warn = originalWarn;
	vi.restoreAllMocks();
});

describe("Toggle-group selection and interaction", () => {
	test("[toggle-group-state][toggle-group-state-negative][toggle-group-role-negative] Exposes initial state only on items and preserves authored attributes", async () => {
		const root = createGroup({
			"data-toggle-group-selected-value": '["b"]',
			role: "group generic",
		});
		root.id = "authored-group";
		const group = await mount(root);
		expect(group.controller.selected).toEqual(["b"]);
		expect(group.item("b").getAttribute("aria-pressed")).toBe("true");
		expect(group.item("b").dataset.state).toBe("on");
		expect(group.item("a").getAttribute("aria-pressed")).toBe("false");
		expect(group.item("a").dataset.state).toBe("off");
		expect(group.item("b").tabIndex).toBe(0);
		expect(group.item("a").tabIndex).toBe(-1);
		expect(group.item("c").tabIndex).toBe(-1);
		expect(root.hasAttribute("data-state")).toBe(false);
		expect(root.hasAttribute("aria-orientation")).toBe(false);
		expect(root.getAttribute("role")).toBe("group generic");
		expect(root.id).toBe("authored-group");
		expect(root.getAttribute("aria-label")).toBe("表示設定");
		expect(warnings).toEqual([]);
	});

	test("[toggle-group-api][toggle-group-single-negative] APIs normalize to DOM order and synchronize attributes without events", async () => {
		const group = await mount(createGroup({ "data-toggle-group-multiple-value": "true" }));
		const events = listen(group);
		group.item("b").focus();
		group.controller.selected = ["c", "a", "c", "unknown"];
		expect(group.controller.selected).toEqual(["a", "c"]);
		expect(group.root.getAttribute("data-toggle-group-selected-value")).toBe('["a","c"]');
		const copy = group.controller.selected;
		copy.push("b");
		expect(group.controller.selected).toEqual(["a", "c"]);
		group.controller.multipleValue = false;
		await settle();
		expect(group.controller.selected).toEqual(["a"]);
		group.controller.selected = ["c", "b"];
		expect(group.controller.selected).toEqual(["b"]);
		group.controller.selected = ["unknown"];
		expect(group.controller.selected).toEqual([]);
		group.root.setAttribute("data-toggle-group-selected-value", '["c"]');
		await settle();
		expect(group.controller.selected).toEqual(["c"]);
		group.root.removeAttribute("data-toggle-group-selected-value");
		await settle();
		expect(group.controller.selected).toEqual([]);
		expect(document.activeElement).toBe(group.item("b"));
		expect(events).toEqual([]);
	});

	test("[toggle-group-activation] Selects and deselects through pointer and Enter/Space and reports before/after state", async () => {
		const group = await mount();
		const events = listen(group);
		await userEvent.click(group.item("a"));
		expect(events).toEqual([
			{
				type: "toggle-group:beforechange",
				detail: { selected: ["a"], previousSelected: [], reason: "pointer" },
				state: [],
				bubbles: true,
				cancelable: true,
			},
			{
				type: "toggle-group:change",
				detail: { selected: ["a"], previousSelected: [], reason: "pointer" },
				state: ["a"],
				bubbles: true,
				cancelable: false,
			},
		]);
		await userEvent.click(group.item("a"));
		expect(group.controller.selected).toEqual([]);
		group.item("b").focus();
		await userEvent.keyboard("{Enter}");
		expect(group.controller.selected).toEqual(["b"]);
		expect(events.at(-1)?.detail.reason).toBe("keyboard");
		await userEvent.keyboard(" ");
		expect(group.controller.selected).toEqual([]);
		expect(events.at(-1)?.detail.reason).toBe("keyboard");
		group.controller.multipleValue = true;
		await settle();
		await userEvent.click(group.item("a"));
		await userEvent.click(group.item("c"));
		expect(group.controller.selected).toEqual(["a", "c"]);
		await userEvent.click(group.item("a"));
		expect(group.controller.selected).toEqual(["c"]);
	});

	test("[toggle-group-navigation] Arrows and Home/End wrap without changing selection and maintain one tab stop", async () => {
		const group = await mount(createGroup({ "data-toggle-group-selected-value": '["b"]' }));
		const events = listen(group);
		const before = document.createElement("button");
		const after = document.createElement("button");
		before.textContent = "前";
		after.textContent = "後";
		group.root.before(before);
		group.root.after(after);
		before.focus();
		await userEvent.tab();
		expect(document.activeElement).toBe(group.item("b"));
		for (const [key, value] of [
			["ArrowRight", "c"],
			["ArrowRight", "a"],
			["ArrowLeft", "c"],
			["Home", "a"],
			["End", "c"],
			["ArrowUp", "c"],
			["ArrowDown", "c"],
		]) {
			await userEvent.keyboard(`{${key}}`);
			expect(document.activeElement).toBe(group.item(value));
		}
		expect(group.controller.itemTargets.filter((item) => item.tabIndex === 0)).toEqual([
			group.item("c"),
		]);
		await userEvent.tab();
		expect(document.activeElement).toBe(after);
		await userEvent.tab({ shift: true });
		expect(document.activeElement).toBe(group.item("c"));
		expect(group.controller.selected).toEqual(["b"]);
		expect(events).toEqual([]);
	});

	test("[toggle-group-navigation][toggle-group-tabstop-negative] Uses selected items as tab stops before focus history exists without moving actual focus", async () => {
		const group = await mount();
		expect(group.item("a").tabIndex).toBe(0);
		group.controller.selected = ["b"];
		expect(group.item("b").tabIndex).toBe(0);
		expect(group.item("a").tabIndex).toBe(-1);
		expect(document.activeElement).not.toBe(group.item("b"));
		group.item("a").focus();
		group.controller.selected = ["c"];
		expect(group.item("a").tabIndex).toBe(0);
		expect(group.item("c").tabIndex).toBe(-1);
		expect(document.activeElement).toBe(group.item("a"));
	});

	test("[toggle-group-navigation] Switches direction for inherited RTL and vertical orientation", async () => {
		const parent = document.createElement("div");
		parent.dir = "rtl";
		const root = createGroup();
		parent.append(root);
		document.body.append(parent);
		const group = await mount(root);
		group.item("b").focus();
		await userEvent.keyboard("{ArrowLeft}");
		expect(document.activeElement).toBe(group.item("c"));
		await userEvent.keyboard("{ArrowRight}");
		expect(document.activeElement).toBe(group.item("b"));
		group.controller.orientationValue = "vertical";
		await settle();
		await userEvent.keyboard("{ArrowDown}");
		expect(document.activeElement).toBe(group.item("c"));
		await userEvent.keyboard("{ArrowUp}");
		expect(document.activeElement).toBe(group.item("b"));
		await userEvent.keyboard("{ArrowLeft}{ArrowRight}");
		expect(document.activeElement).toBe(group.item("b"));
		expect(root.hasAttribute("aria-orientation")).toBe(false);
	});

	test("[toggle-group-ignored-keys][toggle-group-keyboard-negative] Ignores synthetic, modified, and IME navigation", async () => {
		const group = await mount();
		group.item("a").focus();
		group
			.item("a")
			.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
			);
		expect(document.activeElement).toBe(group.item("a"));
		for (const modifier of [
			"altKey",
			"ctrlKey",
			"metaKey",
			"shiftKey",
			"isComposing",
			"keyCode",
		] as const) {
			// Annotate trusted keydown to reach each guard after isTrusted.
			group.root.addEventListener(
				"keydown",
				(event) => {
					Object.defineProperty(event, modifier, { value: modifier === "keyCode" ? 229 : true });
				},
				{ capture: true, once: true },
			);
			await userEvent.keyboard("{ArrowRight}");
			expect(document.activeElement, modifier).toBe(group.item("a"));
		}
	});

	test("[toggle-group-disabled][toggle-group-disabled-negative] Excludes disabled items and ancestor fieldsets while preserving selection", async () => {
		const fieldset = document.createElement("fieldset");
		const root = createGroup({ "data-toggle-group-selected-value": '["b"]' });
		fieldset.append(root);
		document.body.append(fieldset);
		const group = await mount(root);
		group.item("b").disabled = true;
		await settle();
		expect(group.controller.selected).toEqual(["b"]);
		expect(group.item("b").tabIndex).toBe(-1);
		group.item("a").focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(document.activeElement).toBe(group.item("c"));
		fieldset.disabled = true;
		await settle();
		expect(group.controller.itemTargets.every((item) => item.tabIndex === -1)).toBe(true);
		group.controller.selected = ["a"];
		expect(group.controller.selected).toEqual(["a"]);
		fieldset.disabled = false;
		await settle();
		expect(group.item("c").tabIndex).toBe(0);
		const events = listen(group);
		root.addEventListener(
			"click",
			() => {
				fieldset.disabled = true;
			},
			{ capture: true, once: true },
		);
		await userEvent.click(group.item("c"));
		expect(group.controller.selected).toEqual(["a"]);
		expect(events).toEqual([]);
	});

	test("[toggle-group-validation][toggle-group-validation-negative] Does not complete invalid targets, values, or configuration and resumes after repair", async () => {
		const roots = [
			createGroup({ "data-toggle-group-orientation-value": "diagonal" }),
			createGroup({ "data-toggle-group-selected-value": "[1]" }),
			createGroup({ "data-toggle-group-selected-value": '{"a":true}' }),
			createGroup({ "data-toggle-group-selected-value": "invalid-json" }),
		];
		const empty = createGroup();
		empty.replaceChildren();
		roots.push(empty);
		const duplicate = createGroup();
		duplicate.append(createItem("a"));
		roots.push(duplicate);
		const blank = createGroup();
		blank.append(createItem(" "));
		roots.push(blank);
		const nonButton = createGroup();
		const div = document.createElement("div");
		div.setAttribute("data-toggle-group-target", "item");
		div.setAttribute("data-toggle-group-value", "d");
		div.textContent = "d";
		nonButton.append(div);
		roots.push(nonButton);
		const submit = createGroup();
		const submitButton = createItem("d");
		submitButton.type = "submit";
		submit.append(submitButton);
		roots.push(submit);
		for (const root of roots) {
			root.removeAttribute("role");
			const group = await mount(root);
			expect(root.hasAttribute("role")).toBe(false);
			expect(group.controller.itemTargets.every((item) => !item.hasAttribute("data-state"))).toBe(
				true,
			);
			group.controller.selected = ["a"];
			expect(group.controller.selected).toEqual([]);
		}
		expect(warnings).toHaveLength(roots.length);
		const root = roots[0];
		if (root === undefined) throw new Error("検証用 root がありません");
		root.setAttribute("data-toggle-group-orientation-value", "horizontal");
		await settle();
		expect(root.getAttribute("role")).toBe("group");
		const group = await mount(root);
		await userEvent.click(group.item("a"));
		expect(group.controller.selected).toEqual(["a"]);
	});

	test("[toggle-group-names][toggle-group-warning-negative] Does not invent names and separately warns once per connection for completion and invalid markup", async () => {
		const root = createGroup();
		root.removeAttribute("role");
		const group = await mount(root);
		expect(warnings).toEqual([
			'toggle-group controller: Added role="group". Include them in your markup.',
		]);
		root.removeAttribute("role");
		group.controller.selected = ["a"];
		expect(warnings).toHaveLength(1);
		root.removeAttribute("aria-label");
		await settle();
		expect(warnings).toHaveLength(2);
		expect(warnings[1]).toContain("Enhancement has been disabled.");
		expect(root.hasAttribute("aria-label")).toBe(false);
		group.controller.selected = ["b"];
		expect(group.controller.selected).toEqual(["a"]);
		expect(group.item("a").dataset.state).toBe("on");
		expect(warnings).toHaveLength(2);
		root.setAttribute("aria-label", "修復");
		await settle();
		group.item("a").textContent = "";
		await settle();
		expect(warnings).toHaveLength(2);
		group.item("a").setAttribute("aria-label", "名前");
		await settle();
		await userEvent.click(group.item("b"));
		expect(group.controller.selected).toEqual(["b"]);
	});

	test("[toggle-group-names] Validates referenced root/item text and external labels before interaction", async () => {
		const label = document.createElement("span");
		label.id = "toggle-group-label";
		label.textContent = "編集設定";
		document.body.append(label);
		const root = createGroup({ "aria-labelledby": label.id });
		root.removeAttribute("aria-label");
		const named = createItem("d");
		named.textContent = "";
		named.setAttribute("aria-labelledby", label.id);
		root.append(named);
		const group = await mount(root);
		expect(warnings).toEqual([]);
		label.textContent = "";
		group.controller.selected = ["a"];
		expect(group.controller.selected).toEqual([]);
		expect(warnings).toHaveLength(1);
		label.textContent = "再設定";
		group.controller.selected = ["d"];
		expect(group.controller.selected).toEqual(["d"]);
	});

	test("[toggle-group-names][toggle-group-name-negative] Does not accept names consisting only of SVG or hidden-subtree text", async () => {
		for (const markup of [
			'<svg aria-hidden="true"><title>アイコン</title></svg>',
			'<span aria-hidden="true">記号</span>',
			"<span hidden>非表示</span>",
			'<span style="display:none">非表示</span>',
			'<span style="visibility:hidden">非表示</span>',
			'<span style="visibility:collapse">非表示</span>',
			'<span style="display:block;content-visibility:hidden">非表示</span>',
		]) {
			const root = createGroup();
			const icon = createItem("d");
			icon.innerHTML = markup;
			root.append(icon);
			const group = await mount(root);
			expect(icon.hasAttribute("aria-pressed")).toBe(false);
			expect(icon.hasAttribute("data-state")).toBe(false);
			icon.setAttribute("aria-label", "装飾を切り替える");
			await settle();
			await userEvent.click(group.item("a"));
			expect(group.controller.selected).toEqual(["a"]);
		}
		expect(warnings).toHaveLength(7);
	});

	test("[toggle-group-names][toggle-group-reference-name-negative][toggle-group-hidden-reference-negative] Distinguishes hidden text inside visible labels from directly referenced hidden labels", async () => {
		const label = document.createElement("span");
		label.id = "toggle-group-hidden-label";
		label.innerHTML = '<span aria-hidden="true">装飾</span>';
		document.body.append(label);
		const root = createGroup();
		const icon = createItem("d");
		icon.textContent = "";
		icon.setAttribute("aria-labelledby", label.id);
		root.append(icon);
		const group = await mount(root);
		expect(icon.hasAttribute("aria-pressed")).toBe(false);
		label.hidden = true;
		group.controller.selected = ["d"];
		expect(group.controller.selected).toEqual(["d"]);
		expect(icon.getAttribute("aria-pressed")).toBe("true");
		expect(warnings).toHaveLength(1);
	});

	test("[toggle-group-names] Accepts opacity-zero text and explicitly referenced SVG titles as names", async () => {
		const root = createGroup();
		const transparent = createItem("d");
		transparent.innerHTML = '<span style="opacity:0">透明な文字</span>';
		const icon = createItem("e");
		icon.innerHTML = '<svg><title id="toggle-group-icon-title">装飾</title></svg>';
		icon.setAttribute("aria-labelledby", "toggle-group-icon-title");
		root.append(transparent, icon);
		const group = await mount(root);
		group.controller.selected = ["e"];
		expect(group.controller.selected).toEqual(["e"]);
		expect(warnings).toEqual([]);
	});

	test("[toggle-group-dynamic] Synchronizes additions, removals, reordering, and value changes without moving focus", async () => {
		const group = await mount(createGroup({ "data-toggle-group-multiple-value": "true" }));
		const outside = document.createElement("button");
		outside.textContent = "外部";
		document.body.append(outside);
		outside.focus();
		const events = listen(group);
		group.controller.selected = ["a", "b", "d"];
		group.root.append(createItem("d"));
		await settle();
		expect(group.item("d").dataset.state).toBe("off");
		group.root.prepend(group.item("b"));
		await settle();
		expect(group.controller.selected).toEqual(["b", "a"]);
		group.controller.multipleValue = false;
		await settle();
		expect(group.controller.selected).toEqual(["b"]);
		group.item("b").setAttribute("data-toggle-group-value", "renamed");
		await settle();
		expect(group.controller.selected).toEqual([]);
		group.controller.selected = ["c"];
		group.item("c").remove();
		await settle();
		expect(group.controller.selected).toEqual([]);
		expect(document.activeElement).toBe(outside);
		expect(events).toEqual([]);
	});

	test("[toggle-group-cancellation][toggle-group-cancel-negative] Honors before-event and native-click cancellation", async () => {
		const group = await mount();
		const events = listen(group);
		group.root.addEventListener("toggle-group:beforechange", (event) => event.preventDefault(), {
			once: true,
		});
		await userEvent.click(group.item("a"));
		expect(group.controller.selected).toEqual([]);
		expect(events.map((event) => event.type)).toEqual(["toggle-group:beforechange"]);
		group.root.addEventListener("click", (event) => event.preventDefault(), {
			capture: true,
			once: true,
		});
		await userEvent.click(group.item("b"));
		expect(events).toHaveLength(1);
		expect(group.controller.selected).toEqual([]);
	});

	test("[toggle-group-reentrancy][toggle-group-reentrancy-negative] Does not overwrite API, configuration, target, or connection changes in before listeners", async () => {
		type Group = Awaited<ReturnType<typeof mount>>;
		const cases = [
			{
				act: (group: Group) => {
					group.controller.selected = ["c"];
				},
				expected: ["c"],
			},
			{
				act: (group: Group) => {
					group.controller.selected = [];
				},
				expected: [],
			},
			{
				act: (group: Group) => {
					group.controller.selectedValue = ["b"];
				},
				expected: ["b"],
			},
			{
				act: (group: Group) => {
					group.controller.multipleValue = true;
				},
				expected: [],
			},
			{
				act: (group: Group) => {
					group.item("a").remove();
				},
				expected: [],
			},
			{
				act: (group: Group) => {
					group.root.append(createItem("d"));
				},
				expected: [],
			},
			{
				act: (group: Group) => {
					group.controller.disconnect();
				},
				expected: [],
			},
			{
				act: (group: Group) => {
					group.controller.disconnect();
					group.controller.connect();
				},
				expected: [],
			},
			{
				act: (group: Group) => {
					group.controller.selectedValue = ["b"];
					group.controller.selectedValue = [];
				},
				expected: [],
			},
		];
		for (const { act, expected } of cases) {
			const group = await mount();
			const events = listen(group);
			group.root.addEventListener("toggle-group:beforechange", () => act(group), { once: true });
			await userEvent.click(group.item("a"));
			await settle();
			expect(group.controller.selected).toEqual(expected);
			expect(events.map((event) => event.type)).toEqual(["toggle-group:beforechange"]);
		}
	});

	test("[toggle-group-reentrancy][toggle-group-detail-negative] Mutating detail arrays changes neither internal selection nor committed notifications", async () => {
		const group = await mount();
		const events = listen(group);
		group.root.addEventListener(
			"toggle-group:beforechange",
			(event) => {
				const detail = (event as CustomEvent<ToggleGroupChangeDetail>).detail;
				detail.selected.splice(0, 1, "c");
				detail.previousSelected.push("b");
			},
			{ once: true },
		);
		await userEvent.click(group.item("a"));
		expect(group.controller.selected).toEqual(["a"]);
		expect(events.at(-1)?.detail).toEqual({
			selected: ["a"],
			previousSelected: [],
			reason: "pointer",
		});
		group.root.addEventListener(
			"toggle-group:beforechange",
			(event) => {
				group.controller.selected = ["c"];
				event.preventDefault();
			},
			{ once: true },
		);
		await userEvent.click(group.item("b"));
		expect(group.controller.selected).toEqual(["c"]);
		expect(events).toHaveLength(3);
	});

	test("[toggle-group-reentrancy][toggle-group-reentrant-log-negative] Log additions and focus movement alone in before listeners do not cancel selection", async () => {
		const group = await mount();
		const events = listen(group);
		group.root.addEventListener(
			"toggle-group:beforechange",
			() => {
				const log = document.createElement("span");
				log.textContent = "選択の変更を受け取りました";
				group.root.append(log);
				group.item("b").focus();
			},
			{ once: true },
		);
		await userEvent.click(group.item("a"));
		expect(group.controller.selected).toEqual(["a"]);
		expect(events.map((event) => event.type)).toEqual([
			"toggle-group:beforechange",
			"toggle-group:change",
		]);
		expect(document.activeElement).toBe(group.item("b"));
	});

	test("[toggle-group-reentrancy][toggle-group-detached-negative] Does not commit state when a before listener removes the root", async () => {
		const group = await mount();
		const events = listen(group);
		group.root.addEventListener("toggle-group:beforechange", () => group.root.remove(), {
			once: true,
		});
		await userEvent.click(group.item("a"));
		expect(group.controller.selected).toEqual([]);
		expect(events.map((event) => event.type)).toEqual(["toggle-group:beforechange"]);
	});

	test("[toggle-group-reentrancy] Cancels without warning when a before listener removes the controller token", async () => {
		const group = await mount();
		const events = listen(group);
		group.root.addEventListener(
			"toggle-group:beforechange",
			() => group.root.removeAttribute("data-controller"),
			{ once: true },
		);
		await userEvent.click(group.item("a"));
		expect(group.controller.selected).toEqual([]);
		expect(events.map((event) => event.type)).toEqual(["toggle-group:beforechange"]);
		expect(warnings).toEqual([]);
	});

	test("[toggle-group-synthetic][toggle-group-synthetic-negative] Ignores synthetic clicks even with pointer-like detail", async () => {
		const group = await mount();
		const events = listen(group);
		group
			.item("a")
			.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
		group.item("a").click();
		expect(group.controller.selected).toEqual([]);
		expect(events).toEqual([]);
	});

	test("[toggle-group-lifecycle][toggle-group-cleanup-negative][toggle-group-listener-negative][toggle-group-observer-negative] Direct disconnect releases subscriptions without duplicates on reconnect", async () => {
		const group = await mount();
		const events = listen(group);
		const remove = vi.spyOn(group.root, "removeEventListener");
		const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
		group.controller.disconnect();
		expect(remove.mock.calls.map(([name]) => name).sort()).toEqual(["click", "focusin", "keydown"]);
		expect(disconnect).toHaveBeenCalledTimes(1);
		group.controller.selected = ["c"];
		group.root.setAttribute("data-toggle-group-selected-value", '["b"]');
		await settle();
		expect(group.item("b").dataset.state).toBe("off");
		await userEvent.click(group.item("a"));
		group.item("a").focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(document.activeElement).toBe(group.item("a"));
		expect(group.controller.selected).toEqual([]);
		expect(events).toEqual([]);
		group.controller.connect();
		group.controller.connect();
		await settle();
		expect(group.controller.selected).toEqual(["b"]);
		await userEvent.click(group.item("a"));
		expect(group.controller.selected).toEqual(["a"]);
		expect(events).toHaveLength(2);
	});

	test("[toggle-group-lifecycle][toggle-group-pending-negative] Does not run scheduled synchronization after disconnect", async () => {
		const group = await mount();
		group.root.setAttribute("data-toggle-group-selected-value", '["b"]');
		group.controller.itemTargetConnected();
		group.controller.disconnect();
		await settle();
		expect(group.controller.selected).toEqual([]);
		expect(group.item("b").dataset.state).toBe("off");
	});

	test("[toggle-group-nested] Nested interaction does not change outer selection while notifications bubble", async () => {
		const outerRoot = createGroup();
		const innerRoot = createGroup();
		outerRoot.append(innerRoot);
		const outer = await mount(outerRoot);
		const inner = await mount(innerRoot);
		const targets: EventTarget[] = [];
		outerRoot.addEventListener("toggle-group:change", (event) => {
			if (event.target !== null) targets.push(event.target);
		});
		await userEvent.click(inner.item("a"));
		expect(inner.controller.selected).toEqual(["a"]);
		expect(outer.controller.selected).toEqual([]);
		expect(targets).toEqual([innerRoot]);
		await userEvent.click(outer.item("b"));
		expect(outer.controller.selected).toEqual(["b"]);
		expect(inner.controller.selected).toEqual(["a"]);
		expect(targets).toEqual([innerRoot, outerRoot]);
	});
});
