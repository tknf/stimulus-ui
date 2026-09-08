import { Application, type Controller } from "@hotwired/stimulus";
import { userEvent } from "vite-plus/test/browser/context";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import CarouselController from "../src/carousel_controller";

type PublicCarouselController = Controller & {
	index: number;
	playing: boolean;
	next: () => void;
	previous: () => void;
	play: () => void;
	pause: () => void;
};

type ChangeDetail = {
	index: number;
	previousIndex: number;
	reason: "pointer" | "keyboard" | "timer";
};

let application: Application;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const wait = (milliseconds: number) =>
	new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

const mount = async (rootAttributes = "", slideAttributes = "") => {
	document.body.insertAdjacentHTML(
		"beforeend",
		'<section data-controller="carousel" aria-label="おすすめ" ' +
			rootAttributes +
			">" +
			'<article data-carousel-target="slide" aria-label="1枚目" ' +
			slideAttributes +
			">A</article>" +
			'<article data-carousel-target="slide" aria-label="2枚目">B</article>' +
			'<article data-carousel-target="slide" aria-label="3枚目">C</article>' +
			'<button type="button" data-carousel-target="previous">前へ</button>' +
			'<button type="button" data-carousel-target="next">次へ</button>' +
			'<button type="button" data-carousel-target="play">再生</button>' +
			"</section>",
	);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("carousel root を作成できませんでした");
	const slides = Array.from(root.querySelectorAll<HTMLElement>("[data-carousel-target=slide]"));
	const previous = root.querySelector<HTMLButtonElement>("[data-carousel-target=previous]");
	const next = root.querySelector<HTMLButtonElement>("[data-carousel-target=next]");
	const play = root.querySelector<HTMLButtonElement>("[data-carousel-target=play]");
	if (!previous || !next || !play) throw new Error("carousel button を作成できませんでした");
	return { root, slides, previous, next, play };
};

const controllerFor = (root: HTMLElement) => {
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"carousel",
	) as PublicCarouselController | null;
	if (!controller) throw new Error("carousel controller が接続されていません");
	return controller;
};

beforeEach(() => {
	document.body.innerHTML = "";
	application = Application.start();
	application.register("carousel", CarouselController);
});

afterEach(() => {
	application.stop();
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

describe("carousel", () => {
	test("[carousel-state-sync][carousel-preservation-negative] Synchronizes role, aria-roledescription, hidden, data-state, and authored attributes", async () => {
		const { root, slides } = await mount(
			'role="region" aria-roledescription="展示"',
			'id="authored-slide" role="figure" aria-roledescription="作品"',
		);

		expect(root.getAttribute("role")).toBe("region");
		expect(root.getAttribute("aria-roledescription")).toBe("展示");
		expect(root.dataset.state).toBe("paused");
		expect(slides[0]?.id).toBe("authored-slide");
		expect(slides[0]?.getAttribute("role")).toBe("figure");
		expect(slides[0]?.getAttribute("aria-roledescription")).toBe("作品");
		expect(slides[0]?.hidden).toBe(false);
		expect(slides[0]?.dataset.state).toBe("active");
		expect(slides[1]?.hidden).toBe(true);
		expect(slides[1]?.dataset.state).toBe("inactive");

		const generated = await mount();
		expect(generated.root.getAttribute("role")).toBe("group");
		expect(generated.root.getAttribute("aria-roledescription")).toBe("carousel");
		expect(generated.slides[0]?.getAttribute("role")).toBe("group");
		expect(generated.slides[0]?.getAttribute("aria-roledescription")).toBe("slide");
		expect(generated.play.dataset.state).toBe("paused");
	});

	test("[carousel-navigation] Wraps previous and next at boundaries and records pointer reason", async () => {
		const { root, previous, next } = await mount();
		const details: ChangeDetail[] = [];
		root.addEventListener("carousel:change", (event) => {
			details.push((event as CustomEvent<ChangeDetail>).detail);
		});

		await userEvent.click(next);
		expect(controllerFor(root).index).toBe(1);
		expect(details[0]).toEqual({ index: 1, previousIndex: 0, reason: "pointer" });
		await userEvent.click(previous);
		await userEvent.click(previous);
		expect(controllerFor(root).index).toBe(2);
		expect(details.at(-1)).toEqual({ index: 2, previousIndex: 0, reason: "pointer" });
	});

	test("[carousel-beforechange-cancel][carousel-beforechange-cancel-negative] Checks cancelable event order, detail, and bubbling", async () => {
		const { root, next } = await mount();
		const events: Array<{ type: string; detail: ChangeDetail; target: EventTarget | null }> = [];
		let cancel = true;
		root.addEventListener("carousel:beforechange", (event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<ChangeDetail>).detail,
				target: event.target,
			});
			if (cancel) event.preventDefault();
		});
		root.addEventListener("carousel:change", (event) => {
			events.push({
				type: event.type,
				detail: (event as CustomEvent<ChangeDetail>).detail,
				target: event.target,
			});
		});

		await userEvent.click(next);
		expect(controllerFor(root).index).toBe(0);
		expect(events.map(({ type }) => type)).toEqual(["carousel:beforechange"]);
		cancel = false;
		next.focus();
		await userEvent.keyboard("{Enter}");
		expect(controllerFor(root).index).toBe(1);
		expect(events.map(({ type }) => type)).toEqual([
			"carousel:beforechange",
			"carousel:beforechange",
			"carousel:change",
		]);
		expect(events.at(-1)?.detail.reason).toBe("keyboard");
		expect(events.at(-1)?.target).toBe(root);
	});

	test("[carousel-autoplay] Checks timed slide advancement, timer reason, and play toggling", async () => {
		const { root, play } = await mount('data-carousel-interval-value="15"');
		const reasons: string[] = [];
		root.addEventListener("carousel:change", (event) => {
			reasons.push((event as CustomEvent<ChangeDetail>).detail.reason);
		});
		const controller = controllerFor(root);

		await userEvent.click(play);
		expect(controller.playing).toBe(true);
		await wait(25);
		expect(reasons).toContain("timer");
		await userEvent.click(play);
		expect(controller.playing).toBe(false);
		const count = reasons.length;
		await wait(25);
		expect(reasons).toHaveLength(count);
		await userEvent.click(play);
		expect(controller.playing).toBe(true);
		await userEvent.click(play);
	});

	test("[carousel-focus-pause][carousel-focus-pause-negative] Stops automatic rotation when focus enters the root", async () => {
		const { root, next, play } = await mount('data-carousel-interval-value="15"');
		const controller = controllerFor(root);
		await userEvent.click(play);
		expect(controller.playing).toBe(true);
		next.focus();
		expect(controller.playing).toBe(false);
		const index = controller.index;
		await wait(30);
		expect(controller.index).toBe(index);
	});

	test("[carousel-programmatic-silence][carousel-programmatic-silence-negative] Changes visibility through public APIs and setters without emitting events", async () => {
		const { root } = await mount('data-carousel-interval-value="10"');
		const controller = controllerFor(root);
		const events: Event[] = [];
		root.addEventListener("carousel:beforechange", (event) => events.push(event));
		root.addEventListener("carousel:change", (event) => events.push(event));

		controller.index = 1;
		controller.next();
		controller.previous();
		controller.play();
		controller.pause();
		expect(controller.index).toBe(1);
		expect(events).toEqual([]);
	});

	test("[carousel-index-fallback-negative][carousel-dynamic-targets] Clamps the index and tracks added and removed slides", async () => {
		const { root, slides } = await mount('data-carousel-index-value="99"');
		const controller = controllerFor(root);
		expect(controller.index).toBe(0);
		expect(root.getAttribute("data-carousel-index-value")).toBe("0");
		controller.index = 2;
		slides[2]?.remove();
		await settle();
		expect(controller.index).toBe(1);
		expect(root.getAttribute("data-carousel-index-value")).toBe("1");
		root.insertAdjacentHTML(
			"afterbegin",
			'<article data-carousel-target="slide" aria-label="追加">追加</article>',
		);
		await settle();
		expect(controller.index).toBe(1);
		expect(root.querySelectorAll("[data-carousel-target=slide][data-state=active]")).toHaveLength(
			1,
		);
	});

	test("[carousel-disconnect-cleanup][carousel-timer-cleanup-negative] Removes timers and listeners on disconnect and reconnect", async () => {
		const { root, next } = await mount('data-carousel-interval-value="15"');
		const controller = controllerFor(root);
		const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
		controller.play();
		root.remove();
		await settle();
		expect(clearTimeoutSpy).toHaveBeenCalled();
		const index = controller.index;
		await wait(35);
		expect(controller.index).toBe(index);
		document.body.append(root);
		await settle();
		expect(controller.playing).toBe(false);
		const changes: ChangeDetail[] = [];
		root.addEventListener("carousel:change", (event) => {
			changes.push((event as CustomEvent<ChangeDetail>).detail);
		});
		await userEvent.click(next);
		expect(changes).toHaveLength(1);
	});

	test("[carousel-completion-warning][carousel-completion-warning-negative] Warns once per connection when completing role and aria-roledescription and never for complete markup", async () => {
		const warnings: string[] = [];
		const previousWarn = console.warn;
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			await mount();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("carousel controller");
			expect(warnings[0]).toContain('role="group"');
			expect(warnings[0]).toContain('aria-roledescription="carousel"');

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<section data-controller="carousel" aria-label="おすすめ" role="group" aria-roledescription="carousel">' +
					'<article data-carousel-target="slide" aria-label="1枚目" role="group" aria-roledescription="slide">A</article>' +
					'<article data-carousel-target="slide" aria-label="2枚目" role="group" aria-roledescription="slide">B</article>' +
					"</section>",
			);
			await settle();
			expect(warnings).toHaveLength(0);

			warnings.length = 0;
			document.body.insertAdjacentHTML(
				"beforeend",
				'<section data-controller="carousel" aria-label="不正"><article data-carousel-target="slide" aria-label="1枚目">A</article></section>',
			);
			await settle();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Enhancement has been disabled");
			expect(warnings[0]).not.toContain("Added ");
		} finally {
			console.warn = previousWarn;
		}
	});

	test("[carousel-semantic-validation][carousel-semantic-validation-negative] Warns once and disables enhancement for invalid markup", async () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		document.body.insertAdjacentHTML(
			"beforeend",
			'<section data-controller="carousel" data-carousel-interval-value="-1">' +
				'<article data-carousel-target="slide">名前なし</article>' +
				'<div data-carousel-target="slide" aria-label="2枚目">非button</div>' +
				'<div data-carousel-target="previous">前へ</div>' +
				"</section>",
		);
		await settle();
		const root = document.body.lastElementChild as HTMLElement;
		expect(warning).toHaveBeenCalledTimes(1);
		expect(warning.mock.calls[0]?.[0]).toContain("carousel controller");
		expect(warning.mock.calls[0]?.[0]).toContain("interval");
		expect(root.dataset.state).toBeUndefined();
		expect(root.querySelector("[data-carousel-target=slide]")?.getAttribute("role")).toBeNull();
		(root.querySelector("[data-carousel-target=slide]") as HTMLElement).click();
		expect(root.dataset.state).toBeUndefined();

		document.body.insertAdjacentHTML(
			"beforeend",
			'<section data-controller="carousel" aria-label="有効">' +
				'<article data-carousel-target="slide" aria-label="1枚目">A</article>' +
				'<article data-carousel-target="slide" aria-label="2枚目">B</article>' +
				'<button data-carousel-target="play">再生</button>' +
				"</section>",
		);
		await settle();
		expect(warning).toHaveBeenCalledTimes(2);
	});
});
