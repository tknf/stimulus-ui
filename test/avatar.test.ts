import { Application, type Controller } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import AvatarController, { type AvatarStatus } from "../src/avatar_controller";

type PublicController = Controller & {
	readonly status: AvatarStatus | null;
};

const VALID_IMAGE =
	"data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22%3E%3C/svg%3E";
const BROKEN_IMAGE = "data:image/png;base64,broken";

let application: Application;
let originalWarn: typeof console.warn;
let warnings: string[];

const flushMicrotasks = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
};

const settle = async () => {
	await flushMicrotasks();
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const waitForImageEvent = (image: HTMLImageElement, type: "load" | "error") =>
	new Promise<void>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(`${type} event が発火しません`)), 3000);
		image.addEventListener(
			type,
			() => {
				window.clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});

const mount = async (
	imageAttributes = `alt="プロフィール画像"`,
	fallbackMarkup = "プロフィール画像",
) => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<div data-controller="avatar"><img data-avatar-target="image" ${imageAttributes}><span data-avatar-target="fallback">${fallbackMarkup}</span></div>`,
	);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLDivElement)) throw new Error("avatar root がありません");
	const image = root.querySelector('[data-avatar-target="image"]');
	const fallback = root.querySelector('[data-avatar-target="fallback"]');
	if (!(image instanceof HTMLImageElement) || !(fallback instanceof HTMLElement))
		throw new Error("avatar target がありません");
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"avatar",
	) as PublicController | null;
	if (controller === null) throw new Error("avatar controller が接続されていません");
	return { root, image, fallback, controller };
};

const mountRaw = async (markup: string) => {
	document.body.insertAdjacentHTML("beforeend", markup);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("avatar root がありません");
	return root;
};

const createCompletedAvatar = async (src: string, eventType: "load" | "error", alt: string) => {
	const root = document.createElement("div");
	const image = document.createElement("img");
	image.alt = alt;
	image.setAttribute("data-avatar-target", "image");
	const fallback = document.createElement("span");
	fallback.textContent = alt;
	fallback.setAttribute("data-avatar-target", "fallback");
	root.append(image, fallback);
	document.body.append(root);

	const imageEvent = waitForImageEvent(image, eventType);
	image.src = src;
	await imageEvent;
	return { root, image, fallback };
};

const connectExistingAvatar = async (root: HTMLDivElement) => {
	root.setAttribute("data-controller", "avatar");
	await settle();
	const controller = application.getControllerForElementAndIdentifier(
		root,
		"avatar",
	) as PublicController | null;
	if (controller === null) throw new Error("avatar controller が接続されていません");
	return controller;
};

const defineImageState = (image: HTMLImageElement, complete: boolean, naturalWidth: number) => {
	Object.defineProperty(image, "complete", {
		configurable: true,
		get: () => complete,
	});
	Object.defineProperty(image, "naturalWidth", {
		configurable: true,
		get: () => naturalWidth,
	});
};

const restoreImageState = (image: HTMLImageElement) => {
	delete (image as { complete?: unknown }).complete;
	delete (image as { naturalWidth?: unknown }).naturalWidth;
};

const appendRootTargets = (root: Element, image: HTMLImageElement, fallback: HTMLElement) => {
	image.setAttribute("data-avatar-target", "image");
	fallback.setAttribute("data-avatar-target", "fallback");
	root.append(image, fallback);
};

beforeEach(() => {
	document.body.innerHTML = "";
	warnings = [];
	originalWarn = console.warn;
	console.warn = (message?: unknown) => warnings.push(String(message));
	application = Application.start();
	application.register("avatar", AvatarController);
});

afterEach(() => {
	console.warn = originalWarn;
	application.stop();
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("avatar", () => {
	test("[avatar-initial-status][avatar-complete-guard-negative] Classifies incomplete loading and missing image sources as initial states", async () => {
		const root = document.createElement("div");
		const pendingImage = document.createElement("img");
		pendingImage.alt = "読み込み中";
		const pendingFallback = document.createElement("span");
		pendingFallback.textContent = "読み込み中";
		defineImageState(pendingImage, false, 0);
		appendRootTargets(root, pendingImage, pendingFallback);
		document.body.append(root);
		root.setAttribute("data-controller", "avatar");
		await settle();
		const pendingController = application.getControllerForElementAndIdentifier(
			root,
			"avatar",
		) as PublicController | null;
		if (pendingController === null) throw new Error("pending avatar controller がありません");
		expect(pendingController.status).toBe("loading");
		expect(root.dataset.state).toBe("loading");
		expect(pendingImage.getAttribute("aria-hidden")).toBe("true");
		expect(pendingFallback.hidden).toBe(false);

		const noSource = await mount('alt="画像"');
		expect(noSource.image.complete).toBe(true);
		expect(noSource.image.naturalWidth).toBe(0);
		expect(noSource.controller.status).toBe("error");
		expect(noSource.root.dataset.state).toBe("error");
	});

	test("[avatar-cache-status][avatar-natural-width-guard-negative] Classifies loads and failures completed before connection", async () => {
		const success = await createCompletedAvatar(VALID_IMAGE, "load", "成功");
		expect(success.root.hasAttribute("data-controller")).toBe(false);
		expect(success.image.complete).toBe(true);
		expect(success.image.naturalWidth).toBeGreaterThan(0);
		const successController = await connectExistingAvatar(success.root);
		expect(successController.status).toBe("loaded");
		expect(success.root.dataset.state).toBe("loaded");

		const failure = await createCompletedAvatar(BROKEN_IMAGE, "error", "失敗");
		expect(failure.root.hasAttribute("data-controller")).toBe(false);
		expect(failure.image.complete).toBe(true);
		expect(failure.image.naturalWidth).toBe(0);
		const failureController = await connectExistingAvatar(failure.root);
		expect(failureController.status).toBe("error");
		expect(failure.root.dataset.state).toBe("error");
	});

	test("[avatar-native-transitions][avatar-native-error-negative][avatar-native-load-negative] Commits trusted load and error outcomes directly", async () => {
		const loaded = await mount('alt="成功"');
		defineImageState(loaded.image, false, 0);
		const loadEvent = waitForImageEvent(loaded.image, "load");
		loaded.image.src = VALID_IMAGE;
		await loadEvent;
		restoreImageState(loaded.image);
		await settle();
		expect(loaded.controller.status).toBe("loaded");
		expect(loaded.root.dataset.state).toBe("loaded");

		const failed = await mount(`alt="失敗" src="${VALID_IMAGE}"`);
		defineImageState(failed.image, true, 1);
		const errorEvent = waitForImageEvent(failed.image, "error");
		failed.image.src = BROKEN_IMAGE;
		await errorEvent;
		restoreImageState(failed.image);
		await settle();
		expect(failed.controller.status).toBe("error");
		expect(failed.root.dataset.state).toBe("error");
	});

	test("[avatar-visibility][avatar-image-aria-hidden-negative][avatar-fallback-hidden-negative] Synchronizes state-dependent visibility while preserving authored image hidden", async () => {
		const loading = await mount('alt="読み込み中" hidden');
		expect(loading.controller.status).toBe("error");
		expect(loading.image.hidden).toBe(true);
		expect(loading.image.getAttribute("aria-hidden")).toBe("true");
		expect(loading.fallback.hidden).toBe(false);

		const loaded = await mount(`alt="成功" src="${VALID_IMAGE}"`);
		expect(loaded.controller.status).toBe("loaded");
		expect(loaded.image.hidden).toBe(false);
		expect(loaded.image.hasAttribute("aria-hidden")).toBe(false);
		expect(loaded.fallback.hidden).toBe(true);
		expect(loaded.root.dataset.state).toBe("loaded");
		expect(loaded.image.hasAttribute("data-state")).toBe(false);
		expect(loaded.fallback.hasAttribute("data-state")).toBe(false);
	});

	test("[avatar-lazy-loading][avatar-lazy-loading-negative] Keeps lazy images visible to loading without setting hidden", async () => {
		const root = document.createElement("div");
		root.style.position = "absolute";
		root.style.top = "100000px";
		root.style.width = "1px";
		root.style.height = "1px";
		const image = document.createElement("img");
		image.alt = "遠い画像";
		image.loading = "lazy";
		image.src = "/test/avatar.svg";
		const fallback = document.createElement("span");
		fallback.textContent = "遠い画像";
		appendRootTargets(root, image, fallback);
		document.body.append(root);
		root.setAttribute("data-controller", "avatar");
		await settle();
		const controller = application.getControllerForElementAndIdentifier(
			root,
			"avatar",
		) as PublicController | null;
		if (controller === null) throw new Error("lazy avatar controller がありません");
		expect(controller.status).toBe("loading");
		expect(image.complete).toBe(false);
		expect(image.hidden).toBe(false);
		expect(image.loading).toBe("lazy");

		const loadEvent = waitForImageEvent(image, "load");
		root.style.top = "0";
		image.scrollIntoView({ block: "center" });
		await loadEvent;
		await settle();
		expect(controller.status).toBe("loaded");
	});

	test("[avatar-source-change][avatar-source-observer-negative] Reevaluates individual src, srcset, and sizes changes while connected", async () => {
		const sourceChanges = [
			["src", VALID_IMAGE],
			["srcset", `${VALID_IMAGE} 1x`],
			["sizes", "100px"],
		] as const;

		for (const [attribute, value] of sourceChanges) {
			const avatar = await mount('alt="画像"');
			defineImageState(avatar.image, false, 0);
			avatar.image.setAttribute(attribute, value);
			await flushMicrotasks();
			expect(avatar.controller.status, `${attribute} の変更後に loading へ遷移する`).toBe(
				"loading",
			);
			restoreImageState(avatar.image);
		}
	});

	test("[avatar-event-silence][avatar-synthetic-event-negative] Ignores synthetic events without emitting custom events", async () => {
		const avatar = await mount('alt="画像"');
		const events: string[] = [];
		avatar.root.addEventListener("avatar:change", (event) => events.push(event.type));
		avatar.image.dispatchEvent(new Event("load"));
		expect(avatar.controller.status).toBe("error");
		expect(avatar.root.dataset.state).toBe("error");
		avatar.image.dispatchEvent(new Event("error"));
		await settle();
		expect(avatar.controller.status).toBe("error");
		expect(avatar.root.dataset.state).toBe("error");
		expect(events).toEqual([]);
	});

	test("[avatar-semantic-validation][avatar-semantic-validation-negative] Disables invalid markup with one warning and permits an empty alt", async () => {
		const invalid = await mountRaw(
			'<div data-controller="avatar"><img data-avatar-target="image"><span data-avatar-target="fallback">fallback</span></div>',
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("avatar controller");
		expect(warnings[0]).toContain("HTMLElement");
		expect(warnings[0]).toContain("alt");
		expect(warnings[0]).toContain("native <img>");
		expect(warnings[0]).toContain("fallback");
		expect(warnings[0]).toContain("Enhancement has been disabled");
		expect(invalid.dataset.state).toBeUndefined();

		warnings.length = 0;
		const valid = await mount('alt=""');
		expect(warnings).toHaveLength(0);
		expect(valid.controller.status).toBe("error");
	});

	test("[avatar-root-type-negative] Requires an HTMLElement root", async () => {
		const root = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		const image = document.createElement("img");
		image.alt = "画像";
		const fallback = document.createElement("span");
		fallback.textContent = "fallback";
		appendRootTargets(root, image, fallback);
		document.body.append(root);
		root.setAttribute("data-controller", "avatar");
		await settle();
		expect(warnings).toHaveLength(1);
		expect(root.getAttribute("data-state")).toBeNull();
	});

	test("[avatar-image-count-negative] Requires exactly one image target", async () => {
		const root = await mountRaw(
			'<div data-controller="avatar"><img alt="一" data-avatar-target="image"><img alt="二" data-avatar-target="image"><span data-avatar-target="fallback">fallback</span></div>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.dataset.state).toBeUndefined();
	});

	test("[avatar-semantic-validation] Disables enhancement with one warning when no image target exists", async () => {
		const root = await mountRaw(
			'<div data-controller="avatar"><span data-avatar-target="fallback">fallback</span></div>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.dataset.state).toBeUndefined();
	});

	test("[avatar-image-type-negative] Requires a native img image target", async () => {
		const root = await mountRaw(
			'<div data-controller="avatar"><span alt="画像" data-avatar-target="image">image</span><span data-avatar-target="fallback">fallback</span></div>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.dataset.state).toBeUndefined();
	});

	test("[avatar-image-focusable-negative] Requires a nonfocusable image target", async () => {
		const root = await mountRaw(
			'<div data-controller="avatar"><img alt="画像" tabindex="0" data-avatar-target="image"><span data-avatar-target="fallback">fallback</span></div>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.dataset.state).toBeUndefined();
	});

	test("[avatar-fallback-count-negative] Requires exactly one fallback target", async () => {
		const root = await mountRaw(
			'<div data-controller="avatar"><img alt="画像" data-avatar-target="image"><span data-avatar-target="fallback">一</span><span data-avatar-target="fallback">二</span></div>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.dataset.state).toBeUndefined();
	});

	test("[avatar-semantic-validation] Disables enhancement with one warning when no fallback target exists", async () => {
		const root = await mountRaw(
			'<div data-controller="avatar"><img alt="画像" data-avatar-target="image"></div>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.dataset.state).toBeUndefined();
	});

	test("[avatar-fallback-type-negative] Requires an HTMLElement fallback target", async () => {
		const root = await mountRaw(
			'<div data-controller="avatar"><img alt="画像" data-avatar-target="image"><svg data-avatar-target="fallback"></svg></div>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.dataset.state).toBeUndefined();
	});

	test("[avatar-target-distinct-negative] Requires distinct image and fallback elements", async () => {
		const root = await mountRaw(
			'<div data-controller="avatar"><img alt="画像" data-avatar-target="image fallback"></div>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.dataset.state).toBeUndefined();
	});

	test("[avatar-alt-required-negative] Requires an alt attribute on the image target", async () => {
		const root = await mountRaw(
			'<div data-controller="avatar"><img data-avatar-target="image"><span data-avatar-target="fallback">fallback</span></div>',
		);
		expect(warnings).toHaveLength(1);
		expect(root.dataset.state).toBeUndefined();
	});

	test("[avatar-status-property-negative] Returns committed state from the status getter", async () => {
		const avatar = await mount(`alt="画像" src="${VALID_IMAGE}"`);
		expect(avatar.controller.status).toBe("loaded");
	});

	test("[avatar-root-state-negative] Synchronizes root data-state with status", async () => {
		const avatar = await mount(`alt="画像" src="${VALID_IMAGE}"`);
		expect(avatar.root.dataset.state).toBe("loaded");
	});

	test("[avatar-disconnect-cleanup][avatar-disconnect-cleanup-negative] Removes listeners and observers on disconnect while retaining outputs", async () => {
		const avatar = await mount(`alt="画像" src="${VALID_IMAGE}"`);
		const removeEventListener = vi.spyOn(avatar.image, "removeEventListener");
		const observerDisconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
		const previousState = avatar.root.dataset.state;
		const previousAriaHidden = avatar.image.getAttribute("aria-hidden");
		const previousFallbackHidden = avatar.fallback.hidden;

		avatar.controller.disconnect();
		const errorEvent = waitForImageEvent(avatar.image, "error");
		avatar.image.src = BROKEN_IMAGE;
		await errorEvent;
		await settle();
		expect(removeEventListener).toHaveBeenCalledTimes(2);
		expect(observerDisconnect).toHaveBeenCalled();
		expect(avatar.root.dataset.state).toBe(previousState);
		expect(avatar.image.getAttribute("aria-hidden")).toBe(previousAriaHidden);
		expect(avatar.fallback.hidden).toBe(previousFallbackHidden);
		expect(avatar.controller.status).toBe("loaded");

		avatar.controller.connect();
		await settle();
		expect(avatar.controller.status).toBe("error");
		expect(avatar.root.dataset.state).toBe("error");
		expect(avatar.image.getAttribute("aria-hidden")).toBe("true");
		expect(avatar.fallback.hidden).toBe(false);
		expect(warnings).toHaveLength(0);
	});

	test("[avatar-dynamic-targets][avatar-target-rebind-negative] Synchronizes only the new image after target replacement", async () => {
		const avatar = await mount(`alt="旧画像" src="${VALID_IMAGE}"`);
		const oldImage = avatar.image;
		const removeEventListener = vi.spyOn(oldImage, "removeEventListener");
		const nextImage = document.createElement("img");
		nextImage.alt = "新画像";
		nextImage.src = VALID_IMAGE;
		nextImage.setAttribute("data-avatar-target", "image");
		oldImage.replaceWith(nextImage);
		await settle();
		expect(removeEventListener).toHaveBeenCalledTimes(2);
		expect(avatar.root.dataset.state).toBe("loaded");
		expect(avatar.controller.status).toBe("loaded");

		const oldError = waitForImageEvent(oldImage, "error").catch(() => undefined);
		oldImage.src = BROKEN_IMAGE;
		await oldError;
		await settle();
		expect(avatar.controller.status).toBe("loaded");

		const oldFallback = avatar.fallback;
		const nextFallback = document.createElement("span");
		nextFallback.textContent = "新しい fallback";
		nextFallback.setAttribute("data-avatar-target", "fallback");
		oldFallback.replaceWith(nextFallback);
		await settle();
		expect(nextFallback.hidden).toBe(true);

		const fallbackError = waitForImageEvent(nextImage, "error");
		nextImage.src = BROKEN_IMAGE;
		await fallbackError;
		await settle();
		expect(avatar.controller.status).toBe("error");
		expect(nextFallback.hidden).toBe(false);
		expect(oldFallback.hidden).toBe(true);
	});

	test("[avatar-alt-observer-negative] Disables enhancement when alt is removed and resynchronizes when restored", async () => {
		const avatar = await mount(`alt="画像" src="${VALID_IMAGE}"`);
		avatar.image.removeAttribute("alt");
		await settle();
		expect(warnings).toHaveLength(1);
		expect(avatar.controller.status).toBe("loaded");
		expect(avatar.root.dataset.state).toBe("loaded");

		const errorEvent = waitForImageEvent(avatar.image, "error");
		avatar.image.src = BROKEN_IMAGE;
		await errorEvent;
		await settle();
		expect(avatar.controller.status).toBe("loaded");
		expect(avatar.root.dataset.state).toBe("loaded");

		avatar.image.setAttribute("alt", "復元画像");
		await settle();
		expect(warnings).toHaveLength(1);
		expect(avatar.controller.status).toBe("error");
		expect(avatar.root.dataset.state).toBe("error");
		expect(avatar.image.getAttribute("aria-hidden")).toBe("true");
		expect(avatar.fallback.hidden).toBe(false);
	});
});
