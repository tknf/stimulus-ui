import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { commands, userEvent } from "vite-plus/test/browser/context";
import ListReorderController, {
	type ListReorderChangeDetail,
} from "../src/list_reorder_controller";

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};
let application: Application;
let counter = 0;
const required = <T extends Element>(root: ParentNode, selector: string) => {
	const element = root.querySelector<T>(selector);
	if (element === null) throw new Error(`list-reorder testに${selector}がありません`);
	return element;
};
const createItem = (prefix: string, key: string) => {
	const item = document.createElement("li");
	item.id = `${prefix}-${key}`;
	item.setAttribute("data-list-reorder-target", "item");
	item.style.cssText = "width:260px;min-height:70px;flex-shrink:0";
	item.innerHTML = `<span>${key.toUpperCase()}</span> <button type="button" data-list-reorder-target="handle">${key}を並べ替え</button> <button type="button" data-list-reorder-target="previous">${key}を前へ</button> <button type="button" data-list-reorder-target="next">${key}を後ろへ</button>`;
	return item;
};
const mount = async ({
	count = 3,
	horizontal = false,
	rtl = false,
	complete = true,
}: { count?: number; horizontal?: boolean; rtl?: boolean; complete?: boolean } = {}) => {
	const root = document.createElement("div");
	root.id = `reorder-${counter++}`;
	root.setAttribute("data-controller", "list-reorder");
	root.setAttribute("aria-label", "項目の並べ替え");
	if (complete) root.setAttribute("role", "group");
	if (horizontal) root.setAttribute("data-list-reorder-orientation-value", "horizontal");
	if (rtl) root.dir = "rtl";
	root.innerHTML = `<p id="${root.id}-instructions" data-list-reorder-target="instructions">Enter・Spaceで移動元を選び、矢印・Home・Endで移動先へ移ります。Enter・Spaceで現在の項目の位置に確定します。Escapeで取消、Tabで取消して通常移動。前へ・後ろへbuttonでも移動できます。</p><ol id="${root.id}-list" data-list-reorder-target="list" ${complete ? 'role="list" aria-live="polite" aria-atomic="false" aria-relevant="additions"' : ""} style="margin:0;padding:0;${horizontal ? "display:flex;width:780px" : "width:280px"}"></ol>`;
	const list = required<HTMLOListElement>(root, "ol");
	for (const key of ["a", "b", "c", "d"].slice(0, count)) list.append(createItem(root.id, key));
	document.body.append(root);
	await settle();
	const controller = application.getControllerForElementAndIdentifier(root, "list-reorder");
	if (!(controller instanceof ListReorderController))
		throw new Error("list-reorderが接続されていません");
	const item = (key: string) => required<HTMLLIElement>(root, `#${root.id}-${key}`);
	const button = (key: string, kind: "handle" | "previous" | "next" = "handle") =>
		required<HTMLButtonElement>(item(key), `[data-list-reorder-target="${kind}"]`);
	const order = () => controller.order.map((id) => id.replace(`${root.id}-`, ""));
	const events: Array<{ type: string; detail: ListReorderChangeDetail; cancelable: boolean }> = [];
	for (const type of ["list-reorder:beforechange", "list-reorder:change"])
		root.addEventListener(type, (event) => {
			if (event instanceof CustomEvent && event.target === root)
				events.push({
					type,
					detail: event.detail as ListReorderChangeDetail,
					cancelable: event.cancelable,
				});
		});
	return { root, list, controller, item, button, order, events };
};
type Mounted = Awaited<ReturnType<typeof mount>>;
const pointerCommands = commands as typeof commands & {
	reorderPointer: (
		selector: string,
		action: "down" | "move" | "up" | "release",
		x: number,
		y: number,
	) => Promise<void>;
};
const pointer = (
	mounted: Mounted,
	action: "down" | "move" | "up",
	target: "a" | "b" | "c" | "list",
	x = 0.5,
	y = 0.5,
) => {
	const element = target === "list" ? mounted.list : mounted.button(target);
	if (element.id === "") element.id = `${mounted.root.id}-${target}-handle`;
	return pointerCommands.reorderPointer(`#${element.id}`, action, x, y);
};
const start = async (mounted: Mounted, key = "a") => {
	mounted.button(key).focus();
	await userEvent.keyboard("{Enter}");
	expect(mounted.controller.pickedItem).toBe(mounted.item(key).id);
};

beforeEach(() => {
	document.body.innerHTML = "";
	application = Application.start();
	application.register("list-reorder", ListReorderController);
});
afterEach(async () => {
	await pointerCommands.reorderPointer("", "release", 0, 0);
	for (const root of document.querySelectorAll('[data-controller="list-reorder"]'))
		root.removeAttribute("data-controller");
	await settle();
	application.stop();
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

test("[list-reorder-markup][list-reorder-state-negative] Connects complete native lists without warnings and exposes state and position only on items", async () => {
	const warn = vi.spyOn(console, "warn");
	const mounted = await mount();
	expect(warn).not.toHaveBeenCalled();
	expect(mounted.order()).toEqual(["a", "b", "c"]);
	expect(mounted.root.hasAttribute("data-state")).toBe(false);
	for (const [index, key] of ["a", "b", "c"].entries()) {
		expect(mounted.item(key).dataset.state).toBe("idle");
		expect(mounted.item(key).dataset.dropPosition).toBe("none");
		expect(mounted.item(key).getAttribute("aria-posinset")).toBe(String(index + 1));
		expect(mounted.item(key).getAttribute("aria-setsize")).toBe("3");
		expect(mounted.button(key).getAttribute("aria-pressed")).toBe("false");
		expect(mounted.item(key).getAttribute("aria-describedby")).toBe(
			`${mounted.root.id}-instructions`,
		);
	}
});

test("[list-reorder-api][list-reorder-node-negative][list-reorder-api-negative] APIs move existing nodes and content without copies or synthetic events", async () => {
	const mounted = await mount();
	const original = mounted.item("a");
	const child = document.createElement("input");
	child.value = "編集済み";
	original.append(child);
	const listener = vi.fn();
	original.addEventListener("probe", listener);
	mounted.controller.move(original.id, 2);
	await settle();
	expect(mounted.order()).toEqual(["b", "c", "a"]);
	expect(mounted.list.lastElementChild).toBe(original);
	expect(child.value).toBe("編集済み");
	original.dispatchEvent(new Event("probe"));
	expect(listener).toHaveBeenCalledTimes(1);
	expect(mounted.events).toEqual([]);
	const copy = mounted.controller.order as string[];
	copy.reverse();
	expect(mounted.order()).toEqual(["b", "c", "a"]);
	for (const index of [-1, 3, 0.5, NaN, Infinity]) mounted.controller.move(original.id, index);
	mounted.controller.move("unknown", 0);
	mounted.controller.move(original.id, 2);
	expect(mounted.order()).toEqual(["b", "c", "a"]);
	expect(mounted.events).toEqual([]);
});

test("[list-reorder-keyboard][list-reorder-preview-negative] Leaves DOM order unchanged while grabbed, focuses candidates, and commits once on drop", async () => {
	const mounted = await mount();
	await start(mounted);
	expect(document.activeElement).toBe(mounted.item("a"));
	expect(mounted.button("a").getAttribute("aria-pressed")).toBe("true");
	await userEvent.keyboard("{ArrowDown}{ArrowDown}");
	expect(mounted.order()).toEqual(["a", "b", "c"]);
	expect(mounted.controller.targetIndex).toBe(2);
	expect(document.activeElement).toBe(mounted.item("c"));
	expect(mounted.item("c").dataset.dropPosition).toBe("after");
	expect(mounted.events).toEqual([]);
	await userEvent.keyboard(" ");
	await settle();
	expect(mounted.order()).toEqual(["b", "c", "a"]);
	expect(document.activeElement).toBe(mounted.button("a"));
	expect(mounted.controller.pickedItem).toBeNull();
	expect(mounted.events.map((event) => [event.type, event.cancelable])).toEqual([
		["list-reorder:beforechange", true],
		["list-reorder:change", false],
	]);
	expect(mounted.events[1]?.detail).toMatchObject({
		item: mounted.item("a").id,
		from: 0,
		to: 2,
		reason: "keyboard",
	});
});

test("[list-reorder-keyboard][list-reorder-rtl-negative] Handles horizontal RTL, boundaries, modifiers, and IME", async () => {
	const mounted = await mount({ horizontal: true, rtl: true });
	await start(mounted, "b");
	await userEvent.keyboard("{ArrowLeft}");
	expect(mounted.controller.targetIndex).toBe(2);
	await userEvent.keyboard("{ArrowRight}{Home}");
	expect(mounted.controller.targetIndex).toBe(0);
	expect(mounted.item("a").dataset.dropPosition).toBe("before");
	for (const flag of ["ctrlKey", "altKey", "metaKey", "isComposing", "keyCode"] as const) {
		mounted
			.item("a")
			.addEventListener(
				"keydown",
				(event) => Object.defineProperty(event, flag, { value: flag === "keyCode" ? 229 : true }),
				{ once: true, capture: true },
			);
		await userEvent.keyboard("{ArrowLeft}");
	}
	expect(mounted.controller.targetIndex).toBe(0);
	await userEvent.keyboard("{End}{ArrowLeft}{Enter}");
	expect(mounted.order()).toEqual(["a", "c", "b"]);
});

test("[list-reorder-keyboard][list-reorder-cancel-negative] Prevents Escape only during interaction and preserves normal Tab focus movement", async () => {
	const mounted = await mount();
	const prevented: boolean[] = [];
	mounted.root.addEventListener("keydown", (event) => {
		if (event.key === "Escape" || event.key === "Tab") prevented.push(event.defaultPrevented);
	});
	mounted.button("a").focus();
	await userEvent.keyboard("{Escape}");
	await start(mounted);
	await userEvent.keyboard("{End}{Escape}");
	expect(document.activeElement).toBe(mounted.button("a"));
	expect(mounted.controller.pickedItem).toBeNull();
	await start(mounted);
	await userEvent.keyboard("{ArrowDown}{Tab}");
	expect(mounted.controller.pickedItem).toBeNull();
	expect(prevented).toEqual([false, true, false]);
	expect(mounted.order()).toEqual(["a", "b", "c"]);
	expect(mounted.events).toEqual([]);
});

test("[list-reorder-step][list-reorder-step-negative] Supports click and keyboard on native previous/next buttons and treats boundaries as unchanged values", async () => {
	const mounted = await mount();
	await userEvent.click(mounted.button("a", "next"));
	expect(mounted.order()).toEqual(["b", "a", "c"]);
	expect(mounted.events.at(-1)?.detail.reason).toBe("pointer");
	mounted.button("a", "next").focus();
	await userEvent.keyboard("{Enter}");
	expect(mounted.order()).toEqual(["b", "c", "a"]);
	expect(mounted.events.at(-1)?.detail.reason).toBe("keyboard");
	mounted.events.length = 0;
	await userEvent.click(mounted.button("a", "next"));
	expect(mounted.events).toEqual([]);
	await userEvent.click(mounted.button("a", "previous"));
	expect(mounted.order()).toEqual(["b", "a", "c"]);
});

test("[list-reorder-pointer][list-reorder-pointer-negative] Shows only insertion candidates during capture and moves actual nodes on pointerup", async () => {
	const mounted = await mount();
	await pointer(mounted, "down", "a");
	await pointer(mounted, "move", "list", 0.5, 0.9);
	expect(mounted.order()).toEqual(["a", "b", "c"]);
	expect(mounted.controller.targetIndex).toBe(2);
	expect(mounted.item("c").dataset.dropPosition).toBe("after");
	expect(mounted.events).toEqual([]);
	await pointer(mounted, "up", "list", 0.5, 0.9);
	expect(mounted.order()).toEqual(["b", "c", "a"]);
	expect(mounted.events).toHaveLength(2);
	expect(mounted.events[1]?.detail.reason).toBe("pointer");
	expect(mounted.controller.pickedItem).toBeNull();
});

test("[list-reorder-pointer][list-reorder-geometry-negative][list-reorder-capture-negative] Cancels candidates on outside release, lost capture, or geometry changes", async () => {
	const mounted = await mount();
	let pointerId = 0;
	mounted.button("a").addEventListener("pointerdown", (event) => {
		pointerId = event.pointerId;
	});
	for (const kind of ["outside", "capture", "geometry"] as const) {
		await pointer(mounted, "down", "a");
		await pointer(mounted, "move", "list", 0.5, 0.9);
		if (kind === "capture") mounted.button("a").releasePointerCapture(pointerId);
		if (kind === "geometry") mounted.list.style.width = "290px";
		await pointer(mounted, "up", "list", kind === "outside" ? 1.5 : 0.5, 0.9);
		expect(mounted.order()).toEqual(["a", "b", "c"]);
		expect(mounted.controller.pickedItem).toBeNull();
	}
	expect(mounted.events).toEqual([]);
});

test("[list-reorder-reentrant][list-reorder-before-negative] Canceling before leaves DOM order unchanged and restores keyboard focus", async () => {
	const mounted = await mount();
	mounted.root.addEventListener("list-reorder:beforechange", (event) => event.preventDefault());
	await start(mounted);
	await userEvent.keyboard("{End}{Enter}");
	expect(mounted.order()).toEqual(["a", "b", "c"]);
	expect(document.activeElement).toBe(mounted.button("a"));
	await userEvent.click(mounted.button("a", "next"));
	expect(mounted.events.every(({ type }) => type === "list-reorder:beforechange")).toBe(true);
	expect(mounted.events).toHaveLength(2);
});

test("[list-reorder-reentrant][list-reorder-reentrant-negative] Prioritizes API and DOM-order changes in before listeners and copies detail arrays", async () => {
	const mounted = await mount();
	mounted.root.addEventListener(
		"list-reorder:beforechange",
		(event) => {
			if (event instanceof CustomEvent) (event.detail as { order: string[] }).order.reverse();
			mounted.controller.move(mounted.item("c").id, 1);
		},
		{ once: true },
	);
	await userEvent.click(mounted.button("a", "next"));
	expect(mounted.order()).toEqual(["a", "c", "b"]);
	expect(mounted.events.map(({ type }) => type)).toEqual(["list-reorder:beforechange"]);
	mounted.events.length = 0;
	mounted.root.addEventListener(
		"list-reorder:beforechange",
		() => mounted.list.append(mounted.item("c")),
		{ once: true },
	);
	await userEvent.click(mounted.button("a", "next"));
	await settle();
	expect(mounted.order()).toEqual(["a", "b", "c"]);
	expect(mounted.events.map(({ type }) => type)).toEqual(["list-reorder:beforechange"]);
});

test("[list-reorder-reentrant][list-reorder-id-negative] Cancels stale movement and change events when IDs change during before", async () => {
	const mounted = await mount();
	const item = mounted.item("a");
	mounted.root.addEventListener(
		"list-reorder:beforechange",
		() => {
			item.id = `${mounted.root.id}-renamed`;
		},
		{ once: true },
	);
	await userEvent.click(mounted.button("a", "next"));
	expect(mounted.list.firstElementChild).toBe(item);
	expect(mounted.events.map(({ type }) => type)).toEqual(["list-reorder:beforechange"]);
	mounted.controller.move(item.id, 2);
	expect(mounted.order()).toEqual(["b", "c", "renamed"]);
});

test("[list-reorder-reentrant] Does not move when the controller token is removed during before", async () => {
	const mounted = await mount();
	mounted.root.setAttribute("data-controller", "list-reorder unrelated");
	mounted.root.addEventListener(
		"list-reorder:beforechange",
		() => {
			mounted.root.setAttribute("data-controller", "unrelated");
		},
		{ once: true },
	);
	await userEvent.click(mounted.button("a", "next"));
	expect(mounted.list.firstElementChild).toBe(mounted.item("a"));
	expect(mounted.events.map(({ type }) => type)).toEqual(["list-reorder:beforechange"]);
});

test("[list-reorder-dynamic][list-reorder-membership-negative] Tracks target additions, removals, replacements, and external order changes", async () => {
	const mounted = await mount();
	await start(mounted);
	mounted.list.append(createItem(mounted.root.id, "d"));
	await settle();
	expect(mounted.controller.pickedItem).toBeNull();
	expect(mounted.order()).toEqual(["a", "b", "c", "d"]);
	mounted.item("b").remove();
	mounted.list.prepend(mounted.item("d"));
	await settle();
	expect(mounted.order()).toEqual(["d", "a", "c"]);
	const old = mounted.button("a", "next");
	const replacement = old.cloneNode(true);
	old.replaceWith(replacement);
	await settle();
	await userEvent.click(mounted.button("a", "next"));
	expect(mounted.order()).toEqual(["d", "c", "a"]);
	expect(mounted.item("a").getAttribute("aria-posinset")).toBe("3");
});

test("[list-reorder-lifecycle][list-reorder-cleanup-negative] Direct disconnect releases old listeners and capture without duplicates on reconnect", async () => {
	const mounted = await mount();
	await pointer(mounted, "down", "a");
	await pointer(mounted, "move", "list", 0.5, 0.9);
	mounted.controller.disconnect();
	await pointer(mounted, "up", "list", 0.5, 0.9);
	await userEvent.click(mounted.button("a", "next"));
	expect(mounted.order()).toEqual(["a", "b", "c"]);
	expect(mounted.events).toEqual([]);
	expect(mounted.controller.pickedItem).toBeNull();
	mounted.controller.connect();
	await userEvent.click(mounted.button("a", "next"));
	expect(mounted.order()).toEqual(["b", "a", "c"]);
	expect(mounted.events).toHaveLength(2);
});

test("[list-reorder-focus][list-reorder-focus-negative][list-reorder-native-move-negative] Preserves the same input value and focus with insertBefore while updating native numbering", async () => {
	const mounted = await mount();
	const insert = vi.spyOn(mounted.list, "insertBefore");
	const input = document.createElement("input");
	input.value = "保持する入力";
	mounted.item("a").append(input);
	input.focus();
	mounted.controller.move(mounted.item("a").id, 2);
	await settle();
	expect(insert).toHaveBeenCalledWith(mounted.item("a"), null);
	expect(mounted.order()).toEqual(["b", "c", "a"]);
	expect(document.activeElement).toBe(input);
	expect(input.value).toBe("保持する入力");
	expect(mounted.events).toEqual([]);
});

test("[list-reorder-markup][list-reorder-validation-negative][list-reorder-preservation-negative] Completes only static attributes without partially completing unnamed or invalid targets", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const mounted = await mount({ complete: false });
	expect(warn).toHaveBeenCalledTimes(1);
	expect(warn.mock.calls[0]?.[0]).toContain("Added ");
	expect(mounted.list.getAttribute("aria-live")).toBe("polite");
	mounted.controller.disconnect();
	mounted.list.setAttribute("aria-live", "assertive");
	mounted.list.setAttribute("aria-atomic", "true");
	mounted.item("a").tabIndex = 0;
	mounted.item("a").setAttribute("aria-describedby", "authored");
	mounted.controller.connect();
	expect(mounted.list.getAttribute("aria-live")).toBe("assertive");
	expect(mounted.list.getAttribute("aria-atomic")).toBe("true");
	expect(mounted.item("a").tabIndex).toBe(0);
	expect(mounted.item("a").getAttribute("aria-describedby")).toBe(
		`authored ${mounted.root.id}-instructions`,
	);
	mounted.controller.disconnect();
	mounted.root.removeAttribute("role");
	mounted.root.removeAttribute("aria-label");
	mounted.controller.connect();
	expect(mounted.root.hasAttribute("role")).toBe(false);
	expect(warn.mock.calls.at(-1)?.[0]).toContain("Enhancement has been disabled");
});

test("[list-reorder-trusted][list-reorder-trusted-negative][list-reorder-disabled-negative] Rejects synthetic and disabled interaction while allowing APIs when disabled", async () => {
	const mounted = await mount();
	mounted.button("a", "next").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
	mounted.button("a").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
	expect(mounted.controller.pickedItem).toBeNull();
	await start(mounted);
	mounted.item("a").dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
	expect(mounted.controller.targetIndex).toBe(0);
	mounted.controller.cancel();
	mounted.button("a", "next").addEventListener(
		"click",
		() => {
			for (const kind of ["handle", "previous", "next"] as const)
				mounted.button("a", kind).disabled = true;
		},
		{ once: true, capture: true },
	);
	await userEvent.click(mounted.button("a", "next"));
	expect(mounted.order()).toEqual(["a", "b", "c"]);
	expect(mounted.events).toEqual([]);
	mounted.controller.move(mounted.item("a").id, 2);
	expect(mounted.order()).toEqual(["b", "c", "a"]);
});

test("[list-reorder-dynamic] Isolates same-type nesting, multiple roots, and empty lists", async () => {
	const outer = await mount();
	const inner = await mount();
	outer.item("c").append(inner.root);
	await settle();
	await userEvent.click(inner.button("a", "next"));
	expect(inner.order()).toEqual(["b", "a", "c"]);
	expect(outer.order()).toEqual(["a", "b", "c"]);
	expect(outer.events).toEqual([]);
	const empty = await mount({ count: 0 });
	expect(empty.order()).toEqual([]);
	empty.controller.move("unknown", 0);
	expect(empty.events).toEqual([]);
});

test("[list-reorder-reentrant][list-reorder-detail-negative] Does not share before/change detail with internal order or each other", async () => {
	const mounted = await mount();
	mounted.root.addEventListener(
		"list-reorder:beforechange",
		(event) => {
			if (!(event instanceof CustomEvent)) return;
			const detail = event.detail as { item: string; order: string[]; previousOrder: string[] };
			detail.item = "書き換え";
			detail.order.reverse();
			detail.previousOrder.length = 0;
		},
		{ once: true },
	);
	await userEvent.click(mounted.button("a", "next"));
	expect(mounted.order()).toEqual(["b", "a", "c"]);
	expect(mounted.events[1]?.detail).toMatchObject({
		item: mounted.item("a").id,
		order: [mounted.item("b").id, mounted.item("a").id, mounted.item("c").id],
		previousOrder: [mounted.item("a").id, mounted.item("b").id, mounted.item("c").id],
	});
});

test("[list-reorder-keyboard][list-reorder-repeat-negative] Does not repeatedly start or immediately drop on repeated Enter", async () => {
	const mounted = await mount();
	const repeat = (event: Event) => Object.defineProperty(event, "repeat", { value: true });
	mounted.button("a").addEventListener("keydown", repeat, { once: true, capture: true });
	mounted.button("a").focus();
	await userEvent.keyboard("{Enter}");
	expect(mounted.controller.pickedItem).toBeNull();
	await start(mounted);
	await userEvent.keyboard("{End}");
	mounted.item("c").addEventListener("keydown", repeat, { once: true, capture: true });
	await userEvent.keyboard("{Enter}");
	expect(mounted.controller.pickedItem).toBe(mounted.item("a").id);
	expect(mounted.order()).toEqual(["a", "b", "c"]);
	mounted.controller.cancel();
});

test("[list-reorder-dynamic][list-reorder-binding-negative] Does not commit stale candidates after target, orientation, or disabled changes during before", async () => {
	for (const kind of ["target", "orientation", "disabled"] as const) {
		const mounted = await mount();
		mounted.root.addEventListener(
			"list-reorder:beforechange",
			() => {
				if (kind === "target") {
					const old = mounted.button("a");
					old.replaceWith(old.cloneNode(true));
				} else if (kind === "orientation")
					mounted.root.setAttribute("data-list-reorder-orientation-value", "horizontal");
				else
					for (const target of ["handle", "previous", "next"] as const)
						mounted.button("a", target).disabled = true;
			},
			{ once: true },
		);
		await userEvent.click(mounted.button("a", "next"));
		await settle();
		expect(mounted.order()).toEqual(["a", "b", "c"]);
		expect(mounted.events.map(({ type }) => type)).toEqual(["list-reorder:beforechange"]);
	}
});

test("[list-reorder-keyboard] Allows focusing disabled candidates and moving other items to their positions", async () => {
	const mounted = await mount();
	for (const kind of ["handle", "previous", "next"] as const)
		mounted.button("b", kind).disabled = true;
	await settle();
	await start(mounted);
	await userEvent.keyboard("{ArrowDown}");
	expect(document.activeElement).toBe(mounted.item("b"));
	await userEvent.keyboard("{Enter}");
	expect(mounted.order()).toEqual(["b", "a", "c"]);
});

test("[list-reorder-markup][list-reorder-ancestor-negative] Rejects button ancestors, invalid items, missing controls, and disabled mismatches without completion", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	for (const kind of ["ancestor", "item", "missing", "disabled"] as const) {
		const mounted = await mount();
		mounted.controller.disconnect();
		mounted.root.removeAttribute("role");
		if (kind === "ancestor") {
			const button = document.createElement("button");
			button.type = "button";
			mounted.root.before(button);
			button.append(mounted.root);
		} else if (kind === "item") mounted.list.append(document.createElement("div"));
		else if (kind === "missing") mounted.button("a", "next").remove();
		else mounted.button("a", "next").disabled = true;
		mounted.controller.connect();
		expect(mounted.root.hasAttribute("role")).toBe(false);
	}
	expect(warn.mock.calls.length).toBeGreaterThanOrEqual(4);
	expect(
		warn.mock.calls.every(
			([message]) =>
				typeof message === "string" && message.includes("Enhancement has been disabled"),
		),
	).toBe(true);
});

test("[list-reorder-markup][list-reorder-name-negative] Rejects hidden-only names and instructions but accepts directly referenced hidden labels", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	for (const kind of ["button", "root", "instructions"] as const) {
		const mounted = await mount();
		mounted.controller.disconnect();
		mounted.root.removeAttribute("role");
		const hidden =
			'<span hidden>非表示</span><script type="application/json">"データ"</script><style></style><template>テンプレート</template>';
		if (kind === "button") mounted.button("a").innerHTML = hidden;
		else if (kind === "instructions") required<HTMLElement>(mounted.root, "p").innerHTML = hidden;
		else {
			const label = document.createElement("span");
			label.id = `${mounted.root.id}-name`;
			label.innerHTML = hidden;
			mounted.root.append(label);
			mounted.root.removeAttribute("aria-label");
			mounted.root.setAttribute("aria-labelledby", label.id);
		}
		mounted.controller.connect();
		expect(mounted.root.hasAttribute("role")).toBe(false);
	}
	expect(warn).toHaveBeenCalledTimes(3);
	const valid = await mount();
	valid.controller.disconnect();
	const label = document.createElement("span");
	label.id = `${valid.root.id}-hidden-label`;
	label.hidden = true;
	label.textContent = "項目の並べ替え";
	valid.root.append(label);
	valid.root.removeAttribute("aria-label");
	valid.root.setAttribute("aria-labelledby", label.id);
	valid.controller.connect();
	await userEvent.click(valid.button("a", "next"));
	expect(valid.order()).toEqual(["b", "a", "c"]);
	expect(warn).toHaveBeenCalledTimes(3);
});

test("[list-reorder-markup][list-reorder-container-negative] Rejects link roots and controls inside link or label ancestors", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	for (const kind of ["root", "ancestor", "button", "label"] as const) {
		const mounted = await mount();
		mounted.root.removeAttribute("data-controller");
		await settle();
		const link = document.createElement(kind === "label" ? "label" : "a");
		if (link instanceof HTMLAnchorElement) link.href = "#invalid-reorder";
		if (kind === "root") {
			link.setAttribute("aria-label", "並べ替え");
			link.setAttribute("data-controller", "list-reorder");
			link.append(...mounted.root.childNodes);
			mounted.root.replaceWith(link);
		} else {
			const target = kind === "ancestor" || kind === "label" ? mounted.root : mounted.button("a");
			target.before(link);
			link.append(target);
			mounted.root.removeAttribute("role");
			mounted.root.setAttribute("data-controller", "list-reorder");
		}
		await settle();
		expect((kind === "root" ? link : mounted.root).hasAttribute("role")).toBe(false);
	}
	expect(warn.mock.calls.length).toBeGreaterThanOrEqual(4);
	expect(
		warn.mock.calls.every(
			([message]) =>
				typeof message === "string" && message.includes("Enhancement has been disabled"),
		),
	).toBe(true);
});

test("[list-reorder-markup][list-reorder-element-negative] Rejects SVG roots and SVG instructions", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	for (const kind of ["root", "instructions"] as const) {
		const mounted = await mount();
		mounted.root.removeAttribute("data-controller");
		await settle();
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		if (kind === "root") {
			svg.setAttribute("data-controller", "list-reorder");
			svg.setAttribute("aria-label", "並べ替え");
			const content = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
			content.append(...mounted.root.childNodes);
			svg.append(content);
			mounted.root.replaceWith(svg);
		} else {
			svg.setAttribute("data-list-reorder-target", "instructions");
			svg.textContent = "操作説明";
			required<HTMLElement>(mounted.root, "p").replaceWith(svg);
			mounted.root.removeAttribute("role");
			mounted.root.setAttribute("data-controller", "list-reorder");
		}
		await settle();
		expect((kind === "root" ? svg : mounted.root).hasAttribute("role")).toBe(false);
	}
	expect(warn).toHaveBeenCalledTimes(2);
});

test("[list-reorder-focus][list-reorder-focus-reentry-negative] Does not overwrite API changes in post-drop focus listeners with stale change notifications", async () => {
	const mounted = await mount();
	await start(mounted);
	await userEvent.keyboard("{End}");
	mounted
		.button("a")
		.addEventListener("focus", () => mounted.controller.move(mounted.item("c").id, 0), {
			once: true,
		});
	await userEvent.keyboard("{Enter}");
	expect(mounted.order()).toEqual(["c", "b", "a"]);
	expect(mounted.events.map(({ type }) => type)).toEqual(["list-reorder:beforechange"]);
});

test("[list-reorder-focus][list-reorder-external-focus-negative] External focus and window blur cancel only candidates without stealing focus", async () => {
	const mounted = await mount();
	const external = document.createElement("button");
	external.textContent = "外側";
	document.body.append(external);
	await start(mounted);
	await userEvent.keyboard("{End}");
	external.focus();
	expect(mounted.controller.pickedItem).toBeNull();
	expect(document.activeElement).toBe(external);
	await start(mounted);
	mounted.root.ownerDocument.defaultView?.dispatchEvent(new Event("blur"));
	expect(mounted.controller.pickedItem).toBeNull();
	expect(mounted.events).toEqual([]);
});
