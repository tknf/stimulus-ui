import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { server, userEvent } from "vite-plus/test/browser/context";
import TableOfContentsController from "../src/table_of_contents_controller";

let application: Application;
let warnings: string[];
let originalWarn: typeof console.warn;
const settle = async () => {
	await new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);
};
const createSection = (id: string) => {
	const section = document.createElement("section");
	section.style.minHeight = "110vh";
	const heading = document.createElement("h2");
	heading.id = id;
	heading.textContent = id;
	heading.setAttribute("data-table-of-contents-target", "heading");
	section.append(heading);
	const link = document.createElement("a");
	link.href = `#${encodeURIComponent(id)}`;
	link.textContent = id;
	link.setAttribute("data-table-of-contents-target", "link");
	return { section, heading, link };
};
const createPage = () => {
	const root = document.createElement("div");
	root.setAttribute("data-controller", "table-of-contents");
	const nav = document.createElement("nav");
	nav.setAttribute("aria-label", "このページの目次");
	nav.setAttribute("data-table-of-contents-target", "nav");
	const sections = ["概要", "usage", "最後"].map(createSection);
	nav.append(...sections.map(({ link }) => link));
	root.append(nav, ...sections.map(({ section }) => section));
	return { root, nav, sections };
};
const mount = async (page = createPage()) => {
	document.body.append(page.root);
	await settle();
	const controller = application.getControllerForElementAndIdentifier(
		page.root,
		"table-of-contents",
	);
	if (!(controller instanceof TableOfContentsController))
		throw new Error("controller がありません");
	const [first, second, last] = page.sections;
	if (!first || !second || !last) throw new Error("見出しが足りません");
	return { ...page, controller, first, second, last };
};
const scrollToHeading = async (heading: HTMLElement, distance = 0) => {
	window.scrollTo(0, window.scrollY + heading.getBoundingClientRect().top + distance);
	await settle();
};

beforeEach(() => {
	document.body.replaceChildren();
	window.scrollTo(0, 0);
	warnings = [];
	originalWarn = console.warn;
	console.warn = (message?: unknown) => warnings.push(String(message));
	application = Application.start();
	application.register("table-of-contents", TableOfContentsController);
});
afterEach(async () => {
	document.body.replaceChildren();
	await settle();
	application.stop();
	window.scrollTo(0, 0);
	console.warn = originalWarn;
	vi.restoreAllMocks();
});

test("[toc-position][toc-position-negative][toc-state-negative] Tracks the last heading above the threshold in DOM order, including scrolling through gaps", async () => {
	const page = await mount();
	expect(page.controller.currentId).toBe(page.first.heading.id);
	expect(page.first.link.getAttribute("aria-current")).toBe("location");
	expect(page.first.link.dataset.state).toBe("current");
	expect(page.second.link.getAttribute("aria-current")).toBe("false");
	expect(page.second.link.dataset.state).toBe("inactive");
	await scrollToHeading(page.second.heading, -10);
	expect(page.controller.currentId).toBe(page.first.heading.id);
	await scrollToHeading(page.second.heading, 150);
	expect(page.controller.currentId).toBe(page.second.heading.id);
	await scrollToHeading(page.first.heading, 160);
	expect(page.controller.currentId).toBe(page.first.heading.id);
	expect(warnings).toEqual([]);
});

test("[toc-bottom][toc-bottom-negative] Marks a short final section current at the document end", async () => {
	const page = await mount();
	page.last.section.style.minHeight = "0";
	window.scrollTo(0, document.documentElement.scrollHeight);
	await settle();
	expect(page.last.heading.getBoundingClientRect().top).toBeGreaterThan(0);
	expect(page.controller.currentId).toBe(page.last.heading.id);
});

test("[toc-short-document][toc-range-negative] Marks the first section current in a non-scrolling document", async () => {
	const fixture = createPage();
	for (const { section } of fixture.sections) section.style.minHeight = "0";
	const page = await mount(fixture);
	expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(
		document.documentElement.clientHeight + 1,
	);
	expect(page.controller.currentId).toBe(page.first.heading.id);
});

test("[toc-offset][toc-offset-negative] Applies offset changes and clamps the threshold to the viewport", async () => {
	const page = await mount();
	await scrollToHeading(page.second.heading, -50);
	page.controller.offsetValue = 60;
	await settle();
	expect(page.controller.currentId).toBe(page.second.heading.id);
	page.controller.offsetValue = 100000;
	window.scrollTo(0, 0);
	await settle();
	expect(page.controller.currentId).toBe(page.first.heading.id);
});

test("[toc-availability][toc-availability-negative] Excludes hidden, inert, or aria-hidden headings and ancestors and represents no eligible candidates", async () => {
	const page = await mount();
	await scrollToHeading(page.second.heading, 160);
	page.second.section.setAttribute("aria-hidden", "true");
	await settle();
	expect(page.controller.currentId).toBe(page.first.heading.id);
	page.first.heading.hidden = true;
	page.last.section.inert = true;
	await settle();
	expect(page.controller.currentId).toBeNull();
	for (const { link } of page.sections) expect(link.dataset.state).toBe("inactive");
	page.last.section.inert = false;
	page.last.section.style.visibility = "hidden";
	await settle();
	expect(page.controller.currentId).toBeNull();
	page.last.section.style.visibility = "visible";
	await settle();
	expect(page.controller.currentId).toBe(page.last.heading.id);
});

test("[toc-validation][toc-validation-negative] Disables invalid native structure, pairing, or offset and resumes after repair", async () => {
	const page = await mount();
	const invalid = [
		() => {
			page.second.link.href = "#unknown";
		},
		() => {
			page.second.link.href = page.first.link.href;
		},
		() => {
			page.controller.offsetValue = -1;
		},
		() => {
			page.controller.offsetValue = Number.NaN;
		},
		() => {
			page.second.heading.id = page.first.heading.id;
		},
		() => {
			page.nav.removeAttribute("data-table-of-contents-target");
		},
	];
	for (const change of invalid) {
		change();
		await settle();
		expect(page.controller.currentId).toBeNull();
		expect(page.first.link.hasAttribute("aria-current")).toBe(false);
		page.second.heading.id = "usage";
		page.second.link.href = "#usage";
		page.controller.offsetValue = 0;
		page.nav.setAttribute("data-table-of-contents-target", "nav");
		await settle();
		expect(page.controller.currentId).toBe(page.first.heading.id);
	}
	expect(warnings).toHaveLength(1);
});

test("[toc-url][toc-url-negative] Accepts only same-document fragments and decodes percent encoding", async () => {
	const page = await mount();
	const href = page.first.link.href;
	for (const invalid of [
		"https://example.net/#概要",
		"?other-query#概要",
		"/other-page#概要",
		"#%ZZ",
		"#",
	]) {
		page.first.link.setAttribute("href", invalid);
		page.controller.refresh();
		expect(page.controller.currentId).toBeNull();
	}
	page.first.link.href = href;
	page.controller.refresh();
	expect(page.controller.currentId).toBe("概要");
});

test("[toc-names] Disables unnamed nav elements and links with only hidden text", async () => {
	const page = await mount();
	page.nav.removeAttribute("aria-label");
	page.controller.refresh();
	expect(page.controller.currentId).toBeNull();
	page.nav.setAttribute("aria-label", "目次");
	page.first.link.innerHTML = '<span aria-hidden="true">概要</span>';
	page.controller.refresh();
	expect(page.controller.currentId).toBeNull();
	page.first.link.setAttribute("aria-label", "概要");
	page.controller.refresh();
	expect(page.controller.currentId).toBe("概要");
});

test("[toc-dynamic][toc-dynamic-negative] Reobserves target additions, replacements, removals, and layout changes", async () => {
	const page = await mount();
	const added = createSection("追加");
	page.root.append(added.section);
	page.nav.append(added.link);
	await settle();
	await scrollToHeading(added.heading, 60);
	expect(page.controller.currentId).toBe("追加");
	added.section.remove();
	added.link.remove();
	await settle();
	expect(added.link.hasAttribute("aria-current")).toBe(false);
	expect(page.controller.currentId).toBe(page.last.heading.id);
	window.scrollTo(0, 0);
	await settle();
	page.first.section.style.minHeight = "0";
	await scrollToHeading(page.second.heading, 20);
	expect(page.controller.currentId).toBe(page.second.heading.id);
});

test("[toc-native] Preserves native link Tab, Enter, clicks, and history without moving focus during passive updates", async () => {
	const page = await mount();
	page.first.link.focus();
	await userEvent.keyboard(server.browser === "webkit" ? "{Alt>}{Tab}{/Alt}" : "{Tab}");
	expect(document.activeElement).toBe(page.second.link);
	await userEvent.keyboard(
		server.browser === "webkit" ? "{Alt>}{Shift>}{Tab}{/Shift}{/Alt}" : "{Shift>}{Tab}{/Shift}",
	);
	expect(document.activeElement).toBe(page.first.link);
	const click = vi.fn((event: Event) => expect(event.defaultPrevented).toBe(false));
	page.root.addEventListener("click", click);
	await userEvent.keyboard("{Enter}");
	expect(decodeURIComponent(location.hash)).toBe("#概要");
	await userEvent.click(page.second.link);
	expect(location.hash).toBe("#usage");
	expect(click).toHaveBeenCalledTimes(2);
	const focused = document.activeElement;
	await scrollToHeading(page.last.heading, 60);
	expect(document.activeElement).toBe(focused);
	expect(page.root.hasAttribute("data-state")).toBe(false);
	for (const { heading, link } of page.sections) {
		expect(heading.hasAttribute("data-state")).toBe(false);
		expect(link.hasAttribute("tabindex")).toBe(false);
		expect(link.hasAttribute("style")).toBe(false);
	}
});

test("[toc-cleanup][toc-cleanup-negative] Direct disconnect clears outputs, observation, and pending updates", async () => {
	const fixture = createPage();
	const first = fixture.sections[0];
	if (!first) throw new Error("見出しがありません");
	first.link.setAttribute("aria-current", "page");
	first.link.setAttribute("data-state", "authored");
	const page = await mount(fixture);
	page.first.heading.textContent = "更新";
	page.controller.offsetValue = 50;
	page.controller.disconnect();
	await scrollToHeading(page.second.heading, 80);
	page.controller.refresh();
	await settle();
	expect(page.controller.currentId).toBeNull();
	expect(first.link.getAttribute("aria-current")).toBe("page");
	expect(first.link.dataset.state).toBe("authored");
	expect(page.second.link.hasAttribute("data-state")).toBe(false);
	page.controller.connect();
	await settle();
	expect(page.controller.currentId).toBe("usage");
	expect(warnings).toEqual([]);
});

test("[toc-observer-cleanup][toc-observer-cleanup-negative] Disconnect releases observers, listeners, and scheduled frames", async () => {
	const page = await mount();
	const mutation = vi.spyOn(MutationObserver.prototype, "disconnect");
	const intersection = vi.spyOn(IntersectionObserver.prototype, "disconnect");
	const resize = vi.spyOn(ResizeObserver.prototype, "disconnect");
	const documentListener = vi.spyOn(document, "removeEventListener");
	const windowListener = vi.spyOn(window, "removeEventListener");
	const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");
	window.dispatchEvent(new Event("resize"));
	page.controller.disconnect();
	expect(mutation).toHaveBeenCalledOnce();
	expect(intersection).toHaveBeenCalledOnce();
	expect(resize).toHaveBeenCalledOnce();
	expect(documentListener).toHaveBeenCalledWith("scroll", expect.any(Function));
	for (const type of ["resize", "hashchange", "pageshow"]) {
		expect(windowListener).toHaveBeenCalledWith(type, expect.any(Function));
	}
	expect(cancelFrame).toHaveBeenCalledOnce();
});
