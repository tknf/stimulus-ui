import { Controller } from "@hotwired/stimulus";

type CopySource = "target" | "text" | "selection";
type CopyReason = "pointer" | "keyboard";

export type ClipboardBeforeCopyDetail = {
	text: string;
	source: CopySource;
	reason: CopyReason;
};

export type ClipboardCopyDetail = ClipboardBeforeCopyDetail & {
	ok: boolean;
	error: DOMException | null;
};

/**
 * Copies target text, configured text, or a selection through the Async Clipboard API.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/clipboard.contract.json
 */
export default class ClipboardController extends Controller<HTMLElement> {
	static targets = ["trigger", "source"];

	static values = {
		source: { type: String, default: "target" },
		text: { type: String, default: "" },
	};

	declare readonly triggerTargets: HTMLElement[];
	declare readonly sourceTargets: HTMLElement[];
	declare readonly sourceValue: string;
	declare readonly textValue: string;

	private connected = false;
	private connectionVersion = 0;
	private boundTrigger: HTMLButtonElement | null = null;
	private warningIssued = false;

	connect = () => {
		this.connected = true;
		this.connectionVersion += 1;
		this.warningIssued = false;

		if (!this.isValidMarkup()) {
			this.warnInvalidMarkup();
			return;
		}

		const trigger = this.triggerTargets[0];
		if (trigger === undefined || !(trigger instanceof HTMLButtonElement)) {
			return;
		}
		trigger.addEventListener("click", this.handleClick);
		this.boundTrigger = trigger;
	};

	disconnect = () => {
		this.connected = false;
		this.connectionVersion += 1;
		this.unbindTrigger();
	};

	/**
	 * Copies the source text through the Async Clipboard API. Intended for a Stimulus action
	 * receiving a trusted user-activation event. Missing or synthetic events resolve without writing
	 * or emitting custom events. Clipboard access requires browser user activation.
	 *
	 * @returns Resolves when the copy attempt has completed or was ignored.
	 */
	copy = async (event?: Event): Promise<void> => {
		if (!this.connected || !event || !event.isTrusted) {
			return;
		}

		const reason = this.copyReason(event);
		if (!reason) {
			return;
		}

		const text = this.copyText();
		if (text === null || text === "") {
			return;
		}

		const version = this.connectionVersion;
		const beforeCopy = new CustomEvent<ClipboardBeforeCopyDetail>("clipboard:beforecopy", {
			bubbles: true,
			cancelable: true,
			detail: { text, source: this.sourceValue as CopySource, reason },
		});
		if (!this.element.dispatchEvent(beforeCopy)) {
			return;
		}
		if (!this.connected || version !== this.connectionVersion) {
			return;
		}

		let ok = false;
		let error: DOMException | null = null;
		try {
			await navigator.clipboard.writeText(text);
			ok = true;
		} catch (caught) {
			error = this.toDomException(caught);
		}

		if (!this.connected || version !== this.connectionVersion) {
			return;
		}
		this.element.dispatchEvent(
			new CustomEvent<ClipboardCopyDetail>("clipboard:copy", {
				bubbles: true,
				detail: {
					text,
					source: this.sourceValue as CopySource,
					reason,
					ok,
					error,
				},
			}),
		);
	};

	private isValidMarkup = () => {
		const trigger = this.triggerTargets[0];
		const triggerIsValid =
			this.triggerTargets.length === 1 &&
			trigger instanceof HTMLButtonElement &&
			trigger.type === "button";
		const sourceIsValid =
			this.sourceValue === "target" ||
			this.sourceValue === "text" ||
			this.sourceValue === "selection";
		const targetSourceIsValid = this.sourceValue !== "target" || this.sourceTargets.length === 1;
		const textSourceIsValid = this.sourceValue !== "text" || this.textValue !== "";

		return triggerIsValid && sourceIsValid && targetSourceIsValid && textSourceIsValid;
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'clipboard controller: Provide exactly one native <button type="button"> trigger target. Set source to target, text, or selection; target requires exactly one source target, and text requires a nonempty text value. Enhancement has been disabled.',
		);
	};

	private unbindTrigger = () => {
		this.boundTrigger?.removeEventListener("click", this.handleClick);
		this.boundTrigger = null;
	};

	private handleClick = (event: MouseEvent) => {
		void this.copy(event);
	};

	private copyReason = (event: Event): CopyReason | undefined => {
		if (event instanceof KeyboardEvent) {
			return "keyboard";
		}
		if (event instanceof MouseEvent) {
			return event.detail === 0 ? "keyboard" : "pointer";
		}
		return undefined;
	};

	private copyText = (): string | null => {
		switch (this.sourceValue) {
			case "target": {
				const source = this.sourceTargets[0];
				if (!source) {
					return null;
				}
				return source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement
					? source.value
					: (source.textContent ?? "");
			}
			case "text":
				return this.textValue;
			case "selection": {
				const selection = this.element.ownerDocument.defaultView?.getSelection();
				if (!selection || selection.rangeCount === 0) {
					return null;
				}
				for (let index = 0; index < selection.rangeCount; index += 1) {
					if (!this.isRangeWithinRoot(selection.getRangeAt(index))) {
						return null;
					}
				}
				const text = selection.toString();
				return text === "" ? null : text;
			}
			default:
				return null;
		}
	};

	private isRangeWithinRoot = (range: Range) =>
		this.element.contains(range.startContainer) && this.element.contains(range.endContainer);

	private toDomException = (error: unknown): DOMException => {
		if (error instanceof DOMException) {
			return error;
		}
		const message = error instanceof Error ? error.message : String(error);
		return new DOMException(message, "UnknownError");
	};
}
