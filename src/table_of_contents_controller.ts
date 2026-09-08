import { Controller } from "@hotwired/stimulus";
import { hasAccessibleTextName } from "./internal/accessible_text_name";

/**
 * Tracks the current section in an authored page-local table of contents.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/table-of-contents.contract.json
 */
export default class TableOfContentsController extends Controller<HTMLElement> {
	static targets = ["nav", "link", "heading"];
	static values = { offset: { type: Number, default: 0 } };
	declare readonly navTargets: HTMLElement[];
	declare readonly linkTargets: HTMLElement[];
	declare readonly headingTargets: HTMLElement[];
	declare offsetValue: number;
	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private current: string | null = null;
	private frame: number | undefined;
	private observer?: MutationObserver;
	private intersectionObserver?: IntersectionObserver;
	private resizeObserver?: ResizeObserver;
	private observedHeadings: HTMLElement[] = [];
	private originalAttributes = new Map<
		HTMLElement,
		{ current: string | null; state: string | null }
	>();

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		const view = this.element.ownerDocument.defaultView;
		this.element.ownerDocument.addEventListener("scroll", this.scheduleRefresh, { passive: true });
		view?.addEventListener("resize", this.scheduleRefresh);
		view?.addEventListener("hashchange", this.scheduleRefresh);
		view?.addEventListener("pageshow", this.scheduleRefresh);
		this.observer = new MutationObserver(this.scheduleRefresh);
		this.observer.observe(this.element, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: [
				"id",
				"href",
				"aria-label",
				"aria-labelledby",
				"hidden",
				"inert",
				"aria-hidden",
				"style",
				"class",
				"data-table-of-contents-offset-value",
			],
		});
		this.intersectionObserver = new IntersectionObserver(this.scheduleRefresh);
		this.resizeObserver = new ResizeObserver(this.scheduleRefresh);
		this.refresh();
	};

	disconnect = () => {
		this.connected = false;
		this.enhanced = false;
		const view = this.element.ownerDocument.defaultView;
		this.element.ownerDocument.removeEventListener("scroll", this.scheduleRefresh);
		view?.removeEventListener("resize", this.scheduleRefresh);
		view?.removeEventListener("hashchange", this.scheduleRefresh);
		view?.removeEventListener("pageshow", this.scheduleRefresh);
		this.observer?.disconnect();
		this.intersectionObserver?.disconnect();
		this.resizeObserver?.disconnect();
		this.observedHeadings = [];
		if (this.frame !== undefined) {
			view?.cancelAnimationFrame(this.frame);
		}
		this.frame = undefined;
		this.restoreAll();
	};

	navTargetConnected = () => this.scheduleRefresh();
	navTargetDisconnected = () => this.scheduleRefresh();
	linkTargetConnected = () => this.scheduleRefresh();
	linkTargetDisconnected = (link: HTMLElement) => {
		this.restoreLink(link);
		this.scheduleRefresh();
	};
	headingTargetConnected = () => this.scheduleRefresh();
	headingTargetDisconnected = () => this.scheduleRefresh();
	offsetValueChanged = () => this.scheduleRefresh();

	/**
	 * Heading ID last output as the current position, or null without a candidate, with invalid
	 * markup, or while disconnected.
	 */
	get currentId(): string | null {
		return this.current;
	}

	/**
	 * Synchronously recomputes markup validity and the current position without events. Call after
	 * layout changes that observers cannot detect, such as external stylesheet changes.
	 *
	 * @returns No return value.
	 */
	refresh = () => {
		if (!this.connected || !this.element.isConnected) {
			return;
		}
		this.updateObservedHeadings();
		this.enhanced = this.isValidMarkup();
		if (!this.enhanced) {
			this.restoreAll();
			if (!this.warningIssued) {
				this.warningIssued = true;
				console.warn(
					"table-of-contents controller: Provide a named <nav> with page-local <a> targets and matching named h1-h6 targets with unique IDs in a one-to-one relationship. Set offset to a finite nonnegative number. Enhancement has been disabled.",
				);
			}
			return;
		}
		this.syncState();
	};

	private scheduleRefresh = () => {
		if (!this.connected || this.frame !== undefined) {
			return;
		}
		this.frame = this.element.ownerDocument.defaultView?.requestAnimationFrame(() => {
			this.frame = undefined;
			this.refresh();
		});
	};

	private updateObservedHeadings = () => {
		const headings = this.headingTargets;
		if (
			headings.length === this.observedHeadings.length &&
			headings.every((heading, index) => heading === this.observedHeadings[index])
		) {
			return;
		}
		this.intersectionObserver?.disconnect();
		this.resizeObserver?.disconnect();
		this.resizeObserver?.observe(this.element.ownerDocument.documentElement);
		this.resizeObserver?.observe(this.element);
		for (const heading of headings) {
			this.intersectionObserver?.observe(heading);
			this.resizeObserver?.observe(heading);
		}
		this.observedHeadings = headings;
	};

	private linkId = (link: HTMLElement) => {
		if (!(link instanceof HTMLAnchorElement) || !link.hasAttribute("href")) {
			return null;
		}
		try {
			const url = new URL(link.href);
			const current = new URL(this.element.ownerDocument.URL);
			if (
				url.origin !== current.origin ||
				url.pathname !== current.pathname ||
				url.search !== current.search
			) {
				return null;
			}
			return decodeURIComponent(url.hash.slice(1)) || null;
		} catch {
			return null;
		}
	};

	private isValidMarkup = () => {
		const [nav] = this.navTargets;
		const headings = this.headingTargets;
		const links = this.linkTargets;
		const ids = headings.map((heading) => heading.id);
		const linkIds = links.map(this.linkId);
		return (
			this.navTargets.length === 1 &&
			nav?.tagName === "NAV" &&
			hasAccessibleTextName(nav, false) &&
			Number.isFinite(this.offsetValue) &&
			this.offsetValue >= 0 &&
			headings.length > 0 &&
			links.length === headings.length &&
			new Set(ids).size === ids.length &&
			new Set(linkIds).size === linkIds.length &&
			headings.every(
				(heading) =>
					heading instanceof HTMLHeadingElement &&
					heading.id !== "" &&
					!/\s/.test(heading.id) &&
					this.element.ownerDocument.getElementById(heading.id) === heading &&
					hasAccessibleTextName(heading, true),
			) &&
			links.every(
				(link) =>
					nav.contains(link) &&
					hasAccessibleTextName(link, true) &&
					ids.some((id) => id === this.linkId(link)),
			)
		);
	};

	private isAvailable = (heading: HTMLElement) => {
		if (heading.getClientRects().length === 0) {
			return false;
		}
		for (let element: HTMLElement | null = heading; element; element = element.parentElement) {
			const style = getComputedStyle(element);
			if (
				element.hidden !== false ||
				element.inert ||
				element.getAttribute("aria-hidden") === "true" ||
				style.display === "none" ||
				style.visibility === "hidden" ||
				style.visibility === "collapse" ||
				style.contentVisibility === "hidden"
			) {
				return false;
			}
		}
		return true;
	};

	private syncState = () => {
		const headings = this.headingTargets.filter(this.isAvailable);
		const document = this.element.ownerDocument;
		const viewport = document.documentElement.clientHeight;
		const offset = Math.min(this.offsetValue, Math.max(0, viewport - 1));
		const scroller = document.scrollingElement;
		const range = scroller ? scroller.scrollHeight - viewport : 0;
		const atBottom = scroller !== null && range > 1 && range - scroller.scrollTop <= 1;
		const passed = headings.filter((heading) => heading.getBoundingClientRect().top <= offset + 1);
		this.current = (atBottom ? headings.at(-1) : (passed.at(-1) ?? headings[0]))?.id ?? null;
		for (const link of this.linkTargets) {
			if (!this.originalAttributes.has(link)) {
				this.originalAttributes.set(link, {
					current: link.getAttribute("aria-current"),
					state: link.getAttribute("data-state"),
				});
			}
			const current = this.linkId(link) === this.current;
			link.setAttribute("aria-current", current ? "location" : "false");
			link.setAttribute("data-state", current ? "current" : "inactive");
		}
	};

	private restoreLink = (link: HTMLElement) => {
		const original = this.originalAttributes.get(link);
		if (!original) {
			return;
		}
		for (const [name, value] of [
			["aria-current", original.current],
			["data-state", original.state],
		] as const) {
			if (value === null) {
				link.removeAttribute(name);
			} else {
				link.setAttribute(name, value);
			}
		}
		this.originalAttributes.delete(link);
	};

	private restoreAll = () => {
		for (const link of this.originalAttributes.keys()) {
			this.restoreLink(link);
		}
		this.current = null;
	};
}
