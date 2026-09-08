import { Controller } from "@hotwired/stimulus";

export type AvatarStatus = "loading" | "loaded" | "error";

/**
 * Synchronizes native image loading with an author-provided fallback.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/avatar.contract.json
 */
export default class AvatarController extends Controller<HTMLElement> {
	static targets = ["image", "fallback"];

	declare readonly imageTargets: HTMLElement[];
	declare readonly fallbackTargets: HTMLElement[];

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private reconcileQueued = false;
	private currentStatus: AvatarStatus | null = null;
	private boundImage: HTMLImageElement | null = null;
	private observer?: MutationObserver;

	/**
	 * Last committed image status: loading, loaded, or error. Returns null until the first valid
	 * synchronization.
	 */
	get status(): AvatarStatus | null {
		return this.currentStatus;
	}

	connect = () => {
		this.connected = true;
		this.enhanced = false;
		this.warningIssued = false;
		this.reconcileQueued = false;
		this.observer?.disconnect();
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, {
			attributeFilter: ["src", "srcset", "sizes", "alt"],
			attributes: true,
			subtree: true,
		});
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.disableEnhancement();
		this.observer?.disconnect();
		this.observer = undefined;
		this.reconcileQueued = false;
	};

	imageTargetConnected = () => this.scheduleReconcile();
	imageTargetDisconnected = () => this.scheduleReconcile();
	fallbackTargetConnected = () => this.scheduleReconcile();
	fallbackTargetDisconnected = () => this.scheduleReconcile();

	private scheduleReconcile = () => {
		if (!this.connected || this.reconcileQueued) {
			return;
		}

		this.reconcileQueued = true;
		queueMicrotask(() => {
			this.reconcileQueued = false;
			if (this.connected) {
				this.reconcile();
			}
		});
	};

	private reconcile = () => {
		if (!this.isValidMarkup()) {
			this.disableEnhancement();
			this.warnInvalidMarkup();
			return;
		}

		this.enableEnhancement();
	};

	private enableEnhancement = () => {
		const image = this.currentImage();
		if (image === null) {
			return;
		}

		if (this.boundImage !== image) {
			this.unbindImage();
			this.boundImage = image;
			image.addEventListener("load", this.handleLoad);
			image.addEventListener("error", this.handleError);
		}

		this.enhanced = true;
		this.syncState(this.statusFromImage(image));
	};

	private disableEnhancement = () => {
		this.enhanced = false;
		this.unbindImage();
	};

	private unbindImage = () => {
		if (this.boundImage === null) {
			return;
		}

		this.boundImage.removeEventListener("load", this.handleLoad);
		this.boundImage.removeEventListener("error", this.handleError);
		this.boundImage = null;
	};

	private currentImage = (): HTMLImageElement | null => {
		const image = this.imageTargets[0];
		return image instanceof HTMLImageElement ? image : null;
	};

	private currentFallback = (): HTMLElement | null => this.fallbackTargets[0] ?? null;

	private isValidMarkup = () => {
		const image = this.imageTargets[0];
		const fallback = this.fallbackTargets[0];
		const imageCountValid = this.imageTargets.length === 1;
		const fallbackCountValid = this.fallbackTargets.length === 1;
		const imageTypeValid = image instanceof HTMLImageElement;
		const fallbackTypeValid = fallback instanceof HTMLElement;
		const imageFocusableValid = imageTypeValid && image.tabIndex < 0;
		const targetDistinct = image !== undefined && image !== fallback;
		const altValid = imageTypeValid && image.hasAttribute("alt");

		return (
			this.element instanceof HTMLElement &&
			imageCountValid &&
			fallbackCountValid &&
			imageTypeValid &&
			fallbackTypeValid &&
			targetDistinct &&
			imageFocusableValid &&
			altValid &&
			this.element.contains(image) &&
			this.element.contains(fallback)
		);
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			"avatar controller: Use an HTMLElement root, exactly one nonfocusable native <img> image target with an alt attribute, and exactly one HTMLElement fallback target. Enhancement has been disabled.",
		);
	};

	private statusFromImage = (image: HTMLImageElement): AvatarStatus => {
		if (!image.complete) {
			return "loading";
		}
		return image.naturalWidth > 0 ? "loaded" : "error";
	};

	private isCurrentTrustedImageEvent = (event: Event) => {
		return (
			this.connected &&
			this.enhanced &&
			this.boundImage !== null &&
			event.target === this.boundImage &&
			event.isTrusted
		);
	};

	private handleLoad = (event: Event) => {
		if (!this.isCurrentTrustedImageEvent(event)) {
			return;
		}
		this.commitStatus("loaded");
	};

	private handleError = (event: Event) => {
		if (!this.isCurrentTrustedImageEvent(event)) {
			return;
		}
		this.commitStatus("error");
	};

	private commitStatus = (status: AvatarStatus) => {
		const image = this.boundImage;
		const fallback = this.currentFallback();
		if (image === null || fallback === null) {
			return;
		}

		this.currentStatus = status;
		this.element.dataset.state = status;
		if (status === "loaded") {
			image.removeAttribute("aria-hidden");
		} else {
			image.setAttribute("aria-hidden", "true");
		}
		fallback.hidden = status === "loaded";
	};

	private syncState = (status: AvatarStatus) => {
		this.commitStatus(status);
	};
}
