import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import LandmarkNavigationController from "../src/landmark_navigation_controller";

type PublicLandmarkNavigationController = Controller & {
	focusNext: () => void;
	focusPrevious: () => void;
	landmarkTargetConnected: () => void;
	landmarkTargetDisconnected: (target: Element) => void;
};

type F6Options = {
	shiftKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	metaKey?: boolean;
	repeat?: boolean;
};

let application: Application;
let originalWarn: typeof console.warn;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const defaultMarkup = `
	<header data-landmark-navigation-target="landmark" aria-label="ヘッダー">
		<button type="button" data-landmark-child="header">ヘッダー</button>
	</header>
	<main data-landmark-navigation-target="landmark" aria-label="メイン">
		<button type="button" data-landmark-child="main">メイン</button>
	</main>
	<nav data-landmark-navigation-target="landmark" aria-label="ナビゲーション">
		<button type="button" data-landmark-child="navigation">ナビゲーション</button>
	</nav>
`;

const mountBody = async (markup = defaultMarkup) => {
	document.body.setAttribute("data-controller", "landmark-navigation");
	document.body.insertAdjacentHTML("beforeend", markup);
	await settle();
	return document.body;
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"landmark-navigation",
	) as PublicLandmarkNavigationController | null;
	if (controller === null) throw new Error("landmark-navigation controller が接続されていません");
	return controller;
};

const landmarkTargets = () =>
	Array.from(
		document.body.querySelectorAll<HTMLElement>('[data-landmark-navigation-target="landmark"]'),
	);

const childOf = (target: HTMLElement) => {
	const child = target.querySelector<HTMLElement>("button, a, input, [tabindex]");
	if (child === null) throw new Error("landmark の focusable child がありません");
	return child;
};

const dispatchF6 = (target: HTMLElement, options: F6Options = {}) => {
	const event = new KeyboardEvent("keydown", {
		altKey: options.altKey ?? false,
		bubbles: true,
		cancelable: true,
		ctrlKey: options.ctrlKey ?? false,
		key: "F6",
		metaKey: options.metaKey ?? false,
		repeat: options.repeat ?? false,
		shiftKey: options.shiftKey ?? false,
	});
	target.dispatchEvent(event);
	return event;
};

const outsideButton = () => {
	document.body.insertAdjacentHTML("beforeend", '<button type="button" id="outside">外部</button>');
	const button = document.body.querySelector<HTMLButtonElement>("#outside");
	if (button === null) throw new Error("外部 button がありません");
	return button;
};

const attributesOf = (element: Element) =>
	Array.from(element.attributes).map(({ name, value }) => [name, value]);

beforeEach(() => {
	document.body.removeAttribute("data-controller");
	document.body.removeAttribute("class");
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("landmark-navigation", LandmarkNavigationController);
});

afterEach(async () => {
	console.warn = originalWarn;
	document.body.removeAttribute("data-controller");
	await settle();
	application.stop();
	document.body.removeAttribute("class");
	document.body.innerHTML = "";
});

describe("landmark-navigation", () => {
	test("[landmark-navigation-forward-backward][landmark-navigation-wrap-negative][landmark-navigation-direction-negative] Handles F6 and Shift+F6 in DOM order with wrapping", async () => {
		await mountBody();
		const targets = landmarkTargets();
		const first = targets[0];
		const second = targets[1];
		const third = targets[2];
		if (first === undefined || second === undefined || third === undefined) {
			throw new Error("landmark target が3つありません");
		}

		const firstChild = childOf(first);
		const secondChild = childOf(second);
		const thirdChild = childOf(third);
		secondChild.focus();
		thirdChild.focus();
		firstChild.focus();
		const next = dispatchF6(firstChild);
		expect(next.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(secondChild);
		dispatchF6(secondChild);
		expect(document.activeElement).toBe(thirdChild);
		dispatchF6(thirdChild);
		expect(document.activeElement).toBe(firstChild);
		const previous = dispatchF6(firstChild, { shiftKey: true });
		expect(previous.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(thirdChild);
	});

	test("[landmark-navigation-outside-start] Moves to the first or last landmark from outside on F6 or Shift+F6", async () => {
		await mountBody();
		const targets = landmarkTargets();
		const first = targets[0];
		const last = targets.at(-1);
		if (first === undefined || last === undefined) throw new Error("landmark target がありません");
		const outside = outsideButton();

		outside.focus();
		const next = dispatchF6(outside);
		expect(next.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(first);
		outside.focus();
		const previous = dispatchF6(outside, { shiftKey: true });
		expect(previous.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(last);
	});

	test("[landmark-navigation-focus-restore][landmark-navigation-focus-restore-negative] Restores the last focused child and falls back to the target when the record is invalid", async () => {
		await mountBody();
		const targets = landmarkTargets();
		const first = targets[0];
		const second = targets[1];
		if (first === undefined || second === undefined)
			throw new Error("landmark target がありません");
		const firstChild = childOf(first);
		const secondChild = childOf(second);

		secondChild.focus();
		firstChild.focus();
		dispatchF6(firstChild);
		expect(document.activeElement).toBe(secondChild);

		(secondChild as HTMLButtonElement).disabled = true;
		firstChild.focus();
		dispatchF6(firstChild);
		expect(document.activeElement).toBe(second);
		expect(second.getAttribute("tabindex")).toBe("-1");
		outsideButton().focus();
		expect(second.hasAttribute("tabindex")).toBe(false);
	});

	test("[landmark-navigation-nested] Uses the innermost landmark as the current position for nested targets", async () => {
		await mountBody(`
			<section data-landmark-navigation-target="landmark" aria-label="外側">
				<button type="button" data-landmark-child="outer">外側</button>
				<section data-landmark-navigation-target="landmark" aria-label="内側">
					<button type="button" data-landmark-child="inner">内側</button>
				</section>
			</section>
			<footer data-landmark-navigation-target="landmark" aria-label="フッター">
				<button type="button" data-landmark-child="footer">フッター</button>
			</footer>
		`);
		const targets = landmarkTargets();
		const outer = targets[0];
		const inner = targets[1];
		const footer = targets[2];
		if (outer === undefined || inner === undefined || footer === undefined) {
			throw new Error("nested landmark target がありません");
		}
		const innerChild = childOf(inner);

		innerChild.focus();
		dispatchF6(innerChild);
		expect(document.activeElement).toBe(footer);
		dispatchF6(footer, { shiftKey: true });
		expect(document.activeElement).toBe(innerChild);
		dispatchF6(innerChild, { shiftKey: true });
		expect(document.activeElement).toBe(outer);
	});

	test("[landmark-navigation-unavailable-skip][landmark-navigation-unavailable-current][landmark-navigation-unavailable-skip-negative][landmark-navigation-current-anchor-negative] Skips hidden, inert, aria-hidden, or unfocusable targets and preserves default behavior for no-ops", async () => {
		await mountBody(`
			<section data-landmark-navigation-target="landmark" aria-label="開始">
				<button type="button">開始</button>
			</section>
			<section data-landmark-navigation-target="landmark" aria-label="hidden" hidden>
				<button type="button">hidden</button>
			</section>
			<section data-landmark-navigation-target="landmark" aria-label="inert" inert>
				<button type="button">inert</button>
			</section>
			<section data-landmark-navigation-target="landmark" aria-label="aria-hidden" aria-hidden="true">
				<button type="button">aria-hidden</button>
			</section>
			<button data-landmark-navigation-target="landmark" aria-label="disabled" disabled>disabled</button>
			<footer data-landmark-navigation-target="landmark" aria-label="終了">
				<button type="button">終了</button>
			</footer>
		`);
		const targets = landmarkTargets();
		const first = targets[0];
		const unavailableCurrent = targets[3];
		const disabled = targets[4];
		const last = targets.at(-1);
		if (
			first === undefined ||
			unavailableCurrent === undefined ||
			disabled === undefined ||
			last === undefined
		) {
			throw new Error("availability test の target がありません");
		}
		const firstChild = childOf(first);
		const unavailableCurrentChild = childOf(unavailableCurrent);

		firstChild.focus();
		const skipped = dispatchF6(firstChild);
		expect(skipped.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(last);
		expect(disabled.hasAttribute("tabindex")).toBe(false);

		unavailableCurrentChild.focus();
		const nextFromUnavailable = dispatchF6(unavailableCurrentChild);
		expect(nextFromUnavailable.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(last);
		unavailableCurrentChild.focus();
		const previousFromUnavailable = dispatchF6(unavailableCurrentChild, { shiftKey: true });
		expect(previousFromUnavailable.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(firstChild);

		last?.setAttribute("hidden", "true");
		firstChild.focus();
		const noDestination = dispatchF6(firstChild);
		expect(noDestination.defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(firstChild);
	});

	test("[landmark-navigation-unavailable-ancestor][landmark-navigation-unavailable-ancestor-negative] Skips targets under hidden, inert, or aria-hidden ancestors", async () => {
		const ancestors = [
			{ attribute: "hidden", markup: "hidden" },
			{ attribute: "inert", markup: "inert" },
			{ attribute: "aria-hidden", markup: 'aria-hidden="true"' },
		] as const;

		for (const ancestor of ancestors) {
			document.body.innerHTML = "";
			await mountBody(`
				<section data-landmark-navigation-target="landmark" aria-label="開始">
					<button type="button">開始</button>
				</section>
				<div ${ancestor.markup}>
					<section data-landmark-navigation-target="landmark" aria-label="${ancestor.attribute}">
						<button type="button">${ancestor.attribute}</button>
					</section>
				</div>
				<footer data-landmark-navigation-target="landmark" aria-label="終了">
					<button type="button">終了</button>
				</footer>
			`);
			const targets = landmarkTargets();
			const first = targets[0];
			const blocked = targets[1];
			const last = targets[2];
			if (first === undefined || blocked === undefined || last === undefined) {
				throw new Error(`${ancestor.attribute} ancestor test の target がありません`);
			}

			const firstChild = childOf(first);
			firstChild.focus();
			const moved = dispatchF6(firstChild);
			expect(moved.defaultPrevented).toBe(true);
			expect(document.activeElement).toBe(last);
			expect(blocked.hasAttribute("tabindex")).toBe(false);
		}
	});

	test("[landmark-navigation-keyboard-guard][landmark-navigation-keyboard-prevent-default-negative][landmark-navigation-modifier-guard-negative] Ignores modifiers and canceled events while preserving propagation", async () => {
		await mountBody();
		const targets = landmarkTargets();
		const first = targets[0];
		const second = targets[1];
		if (first === undefined || second === undefined)
			throw new Error("landmark target がありません");
		const firstChild = childOf(first);
		let bubbled = 0;
		const onKeydown = () => {
			bubbled += 1;
		};
		document.body.addEventListener("keydown", onKeydown);

		firstChild.focus();
		const handled = dispatchF6(firstChild);
		expect(handled.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(second);
		expect(bubbled).toBe(1);

		firstChild.focus();
		for (const options of [
			{ ctrlKey: true },
			{ altKey: true },
			{ metaKey: true },
			{ ctrlKey: true, shiftKey: true },
			{ altKey: true, shiftKey: true },
			{ metaKey: true, shiftKey: true },
		]) {
			const ignored = dispatchF6(firstChild, options);
			expect(ignored.defaultPrevented).toBe(false);
			expect(document.activeElement).toBe(firstChild);
		}

		const canceled = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "F6",
		});
		canceled.preventDefault();
		firstChild.dispatchEvent(canceled);
		expect(document.activeElement).toBe(firstChild);
		document.body.removeEventListener("keydown", onKeydown);
	});

	test("[landmark-navigation-keyboard-repeat][landmark-navigation-keyboard-repeat-negative] Moves on every F6 press including repeats", async () => {
		await mountBody();
		const targets = landmarkTargets();
		const first = targets[0];
		const second = targets[1];
		const third = targets[2];
		if (first === undefined || second === undefined || third === undefined) {
			throw new Error("repeat test の target が3つありません");
		}
		const firstChild = childOf(first);

		firstChild.focus();
		const firstRepeat = dispatchF6(firstChild, { repeat: true });
		expect(firstRepeat.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(second);
		const secondRepeat = dispatchF6(second, { repeat: true });
		expect(secondRepeat.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(third);
		const previousRepeat = dispatchF6(third, { repeat: true, shiftKey: true });
		expect(previousRepeat.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(second);
	});

	test("[landmark-navigation-tabindex][landmark-navigation-tabindex-preservation-negative][landmark-navigation-tabindex-cleanup-negative] Preserves authored tabindex and cleans up temporary tabindex", async () => {
		await mountBody(`
			<header data-landmark-navigation-target="landmark" aria-label="ヘッダー" tabindex="7">
				<button type="button">ヘッダー</button>
			</header>
			<main data-landmark-navigation-target="landmark" aria-label="メイン">
				<button type="button">メイン</button>
			</main>
		`);
		const controller = controllerFor(document.body);
		const targets = landmarkTargets();
		const authored = targets[0];
		const temporary = targets[1];
		if (authored === undefined || temporary === undefined) {
			throw new Error("tabindex test の target がありません");
		}
		const outside = outsideButton();

		controller.focusNext();
		expect(document.activeElement).toBe(authored);
		expect(authored.getAttribute("tabindex")).toBe("7");
		controller.focusNext();
		expect(document.activeElement).toBe(temporary);
		expect(temporary.getAttribute("tabindex")).toBe("-1");
		outside.focus();
		expect(temporary.hasAttribute("tabindex")).toBe(false);
		expect(authored.getAttribute("tabindex")).toBe("7");

		controller.focusNext();
		expect(document.activeElement).toBe(authored);
		controller.focusNext();
		expect(document.activeElement).toBe(temporary);
		controller.disconnect();
		expect(temporary.hasAttribute("tabindex")).toBe(false);
	});

	test("[landmark-navigation-focus-api] focusNext and focusPrevious match keyboard behavior without custom events", async () => {
		await mountBody();
		const controller = controllerFor(document.body);
		const targets = landmarkTargets();
		const first = targets[0];
		const second = targets[1];
		if (first === undefined || second === undefined)
			throw new Error("landmark target がありません");
		const firstChild = childOf(first);
		const events: Event[] = [];
		document.body.addEventListener("landmark-navigation:focus", (event) => events.push(event));
		document.body.addEventListener("landmark-navigation:change", (event) => events.push(event));

		firstChild.focus();
		controller.focusNext();
		expect(document.activeElement).toBe(second);
		controller.focusPrevious();
		expect(document.activeElement).toBe(firstChild);
		expect(events).toEqual([]);
	});

	test("[landmark-navigation-dynamic-targets] Tracks target additions/removals, same-microtask replacement, and recovery from invalid markup", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		await mountBody(`
			<header data-landmark-navigation-target="landmark" aria-label="一">
				<button type="button">一</button>
			</header>
			<main data-landmark-navigation-target="landmark" aria-label="二">
				<button type="button">二</button>
			</main>
		`);
		const targetsBefore = landmarkTargets();
		const first = targetsBefore[0];
		const second = targetsBefore[1];
		if (first === undefined || second === undefined) throw new Error("dynamic target がありません");
		const firstChild = childOf(first);

		document.body.insertAdjacentHTML(
			"beforeend",
			'<footer data-landmark-navigation-target="landmark" aria-label="三"><button type="button">三</button></footer>',
		);
		await settle();
		const added = landmarkTargets().at(-1);
		if (added === undefined) throw new Error("追加 target がありません");
		firstChild.focus();
		dispatchF6(firstChild);
		expect(document.activeElement).toBe(second);

		second.remove();
		await settle();
		expect(second.hasAttribute("tabindex")).toBe(false);
		const replacementMarkup =
			'<aside data-landmark-navigation-target="landmark" aria-label="交換"><button type="button">交換</button></aside>';
		document.body.insertAdjacentHTML("beforeend", replacementMarkup);
		await settle();
		expect(warnings).toEqual([]);
		expect(landmarkTargets()).toHaveLength(3);

		added.remove();
		await settle();
		expect(warnings).toHaveLength(0);
		const remaining = landmarkTargets();
		const remainingFirst = remaining[0];
		const remainingLast = remaining.at(-1);
		if (remainingFirst === undefined || remainingLast === undefined) {
			throw new Error("remaining target がありません");
		}
		const remainingFirstChild = childOf(remainingFirst);
		remainingFirstChild.focus();
		const invalidDestination = dispatchF6(remainingFirstChild);
		expect(invalidDestination.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(remainingLast);
		expect(remainingLast.getAttribute("tabindex")).toBe("-1");
		remainingFirst.remove();
		await settle();
		expect(warnings).toHaveLength(1);
		expect(remainingLast.hasAttribute("tabindex")).toBe(false);
		document.body.insertAdjacentHTML(
			"beforeend",
			'<section data-landmark-navigation-target="landmark" aria-label="復帰"><button type="button">復帰</button></section>',
		);
		await settle();
		expect(warnings).toHaveLength(1);
		const restored = landmarkTargets().at(-1);
		if (restored === undefined) throw new Error("復帰 target がありません");
		const start = landmarkTargets()[0];
		if (start === undefined) throw new Error("開始 target がありません");
		childOf(start).focus();
		const moved = dispatchF6(childOf(start));
		expect(moved.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(restored);
	});

	test("[landmark-navigation-target-cleanup][landmark-navigation-target-cleanup-negative][landmark-navigation-invalid-cleanup][landmark-navigation-invalid-cleanup-negative][landmark-navigation-invalid-last-focused-negative] Cleans temporary tabindex and lastFocused when targets disconnect or become invalid", async () => {
		await mountBody();
		const controller = controllerFor(document.body);
		const targets = landmarkTargets();
		const first = targets[0];
		const second = targets[1];
		const third = targets[2];
		if (first === undefined || second === undefined || third === undefined) {
			throw new Error("target cleanup test の target が3つありません");
		}
		const firstChild = childOf(first);
		const secondChild = childOf(second);
		const thirdChild = childOf(third);

		secondChild.focus();
		firstChild.focus();
		(secondChild as HTMLButtonElement).disabled = true;
		controller.focusNext();
		expect(document.activeElement).toBe(second);
		expect(second.getAttribute("tabindex")).toBe("-1");

		second.remove();
		await settle();
		expect(second.hasAttribute("tabindex")).toBe(false);
		(secondChild as HTMLButtonElement).disabled = false;
		document.body.append(second);
		await settle();

		thirdChild.focus();
		controller.focusNext();
		expect(document.activeElement).toBe(second);
		thirdChild.focus();
		controller.focusNext();
		expect(document.activeElement).toBe(second);
		expect(second.getAttribute("tabindex")).toBe("-1");

		secondChild.focus();
		first.remove();
		third.remove();
		await settle();
		expect(second.hasAttribute("tabindex")).toBe(false);

		document.body.insertAdjacentHTML(
			"beforeend",
			'<footer data-landmark-navigation-target="landmark" aria-label="復帰"><button type="button">復帰</button></footer>',
		);
		await settle();
		const restored = landmarkTargets().at(-1);
		if (restored === undefined) throw new Error("復帰 target がありません");
		const restoredChild = childOf(restored);
		restoredChild.focus();
		controller.focusNext();
		expect(document.activeElement).toBe(second);
		expect(document.activeElement).not.toBe(secondChild);
	});

	test("[landmark-navigation-dynamic-reconcile-negative][landmark-navigation-disconnect-reconcile-negative] Handles target replacement and pending reconciliation according to connection state", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		await mountBody(`
			<header data-landmark-navigation-target="landmark" aria-label="一">
				<button type="button">一</button>
			</header>
			<main data-landmark-navigation-target="landmark" aria-label="二">
				<button type="button">二</button>
			</main>
		`);
		const controller = controllerFor(document.body);
		const targets = landmarkTargets();
		const first = targets[0];
		const second = targets[1];
		if (first === undefined || second === undefined)
			throw new Error("交換前の target がありません");
		const firstChild = childOf(first);

		second.remove();
		controller.landmarkTargetDisconnected(second);
		document.body.insertAdjacentHTML(
			"beforeend",
			'<nav data-landmark-navigation-target="landmark" aria-label="交換"><button type="button">交換</button></nav>',
		);
		await settle();
		expect(warnings).toEqual([]);
		const exchangedTargets = landmarkTargets();
		expect(exchangedTargets).toHaveLength(2);
		const replacement = exchangedTargets[1];
		if (replacement === undefined) throw new Error("交換後の target がありません");
		firstChild.focus();
		const exchanged = dispatchF6(firstChild);
		expect(exchanged.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(replacement);

		controller.landmarkTargetConnected();
		controller.disconnect();
		await settle();
		firstChild.focus();
		const disconnected = dispatchF6(firstChild);
		expect(disconnected.defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(firstChild);

		controller.connect();
		await settle();
		firstChild.focus();
		const reconnected = dispatchF6(firstChild);
		expect(reconnected.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(replacement);
	});

	test("[landmark-navigation-disconnect-cleanup][landmark-navigation-disconnect-listener-negative][landmark-navigation-disconnect-root-listener-negative][landmark-navigation-disconnect-last-focused-negative] Cleans listeners, temporary tabindex, lastFocused, and pending reconciliation without duplicates after reconnect", async () => {
		await mountBody();
		const controller = controllerFor(document.body);
		const targets = landmarkTargets();
		const first = targets[0];
		const second = targets[1];
		if (first === undefined || second === undefined)
			throw new Error("landmark target がありません");
		const firstChild = childOf(first);
		const secondChild = childOf(second);
		const outside = outsideButton();
		const removeEventListener = vi.spyOn(document.body, "removeEventListener");

		firstChild.focus();
		controller.focusNext();
		expect(document.activeElement).toBe(second);
		expect(second.getAttribute("tabindex")).toBe("-1");
		secondChild.focus();
		firstChild.focus();
		(secondChild as HTMLButtonElement).disabled = true;
		controller.focusNext();
		expect(document.activeElement).toBe(second);
		expect(second.getAttribute("tabindex")).toBe("-1");
		controller.disconnect();
		expect(second.hasAttribute("tabindex")).toBe(false);
		expect(removeEventListener).toHaveBeenCalledWith("focusin", expect.any(Function));
		expect(removeEventListener).toHaveBeenCalledWith("focusout", expect.any(Function));
		(secondChild as HTMLButtonElement).disabled = false;
		secondChild.focus();
		firstChild.focus();
		const disconnected = dispatchF6(firstChild);
		expect(disconnected.defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(firstChild);

		controller.connect();
		await settle();
		firstChild.focus();
		controller.focusNext();
		expect(document.activeElement).toBe(second);
		controller.disconnect();
		await settle();
		outside.focus();
		const pending = dispatchF6(outside);
		expect(pending.defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(outside);

		controller.connect();
		await settle();
		firstChild.focus();
		const reconnected = dispatchF6(firstChild);
		expect(reconnected.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(second);
	});

	test("[landmark-navigation-semantic-validation][landmark-navigation-semantic-validation-negative] Disables non-body roots, insufficient targets, or non-HTMLElement targets with one warning", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-controller="landmark-navigation"><section data-landmark-navigation-target="landmark"></section><nav data-landmark-navigation-target="landmark"></nav></div>',
		);
		await settle();
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("owner document body");

		document.body.setAttribute("data-controller", "landmark-navigation");
		await settle();
		expect(warnings).toHaveLength(2);
		document.body.insertAdjacentHTML(
			"beforeend",
			'<header data-landmark-navigation-target="landmark"><button type="button">一つ</button></header>',
		);
		await settle();
		expect(warnings).toHaveLength(2);
		document.body.insertAdjacentHTML(
			"beforeend",
			'<svg data-landmark-navigation-target="landmark"><circle /></svg>',
		);
		await settle();
		expect(warnings).toHaveLength(2);
		document.body.querySelector("svg")?.remove();
		document.body.insertAdjacentHTML(
			"beforeend",
			'<main data-landmark-navigation-target="landmark"><button type="button">二つ</button></main>',
		);
		await settle();
		expect(warnings).toHaveLength(2);
		const targets = landmarkTargets();
		const first = targets.at(-2);
		const second = targets.at(-1);
		if (first === undefined || second === undefined) throw new Error("valid target がありません");
		const firstChild = childOf(first);
		firstChild.focus();
		const restored = dispatchF6(firstChild);
		expect(restored.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(second);
	});

	test("[landmark-navigation-semantic-elements-negative] Disables keyboard and public methods for markup containing SVG targets", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		await mountBody(`
			<header data-landmark-navigation-target="landmark" aria-label="一">
				<button type="button">一</button>
			</header>
			<main data-landmark-navigation-target="landmark" aria-label="二">
				<button type="button">二</button>
			</main>
			<svg data-landmark-navigation-target="landmark" aria-label="SVG"><circle /></svg>
		`);
		const controller = controllerFor(document.body);
		const targets = landmarkTargets();
		const first = targets[0];
		if (first === undefined) throw new Error("SVG validation test の target がありません");
		const firstChild = childOf(first);

		expect(warnings).toHaveLength(1);
		firstChild.focus();
		controller.focusNext();
		expect(document.activeElement).toBe(firstChild);
		const ignored = dispatchF6(firstChild);
		expect(ignored.defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(firstChild);
	});

	test("[landmark-navigation-state-event-silence][landmark-navigation-state-event-silence-negative] Adds no state, classes, ARIA, custom properties, or custom events", async () => {
		await mountBody(`
			<header
				data-landmark-navigation-target="landmark"
				aria-label="ヘッダー"
				role="banner"
				class="authored"
				data-state="authored"
				style="--authored-value: 1"
				tabindex="2"
			>
				<button type="button">ヘッダー</button>
			</header>
			<main data-landmark-navigation-target="landmark" aria-label="メイン" role="main">
				<button type="button">メイン</button>
			</main>
		`);
		const controller = controllerFor(document.body);
		const targets = landmarkTargets();
		const first = targets[0];
		const second = targets[1];
		if (first === undefined || second === undefined)
			throw new Error("silence test の target がありません");
		const beforeBody = attributesOf(document.body);
		const beforeFirst = attributesOf(first);
		const beforeSecond = attributesOf(second);
		const events: Event[] = [];
		document.body.addEventListener("landmark-navigation:focus", (event) => events.push(event));

		controller.focusNext();
		controller.focusNext();
		expect(document.activeElement).toBe(second);
		expect(attributesOf(document.body)).toEqual(beforeBody);
		expect(attributesOf(first)).toEqual(beforeFirst);
		expect(attributesOf(second)).toEqual([...beforeSecond, ["tabindex", "-1"]]);
		expect(document.body.className).toBe("");
		expect(document.body.hasAttribute("data-state")).toBe(false);
		expect(events).toEqual([]);
	});
});
