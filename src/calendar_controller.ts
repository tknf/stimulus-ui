import { Controller } from "@hotwired/stimulus";

type CalendarReason = "pointer" | "keyboard";
type CalendarMode = "single" | "range";

export type CalendarChangeDetail = {
	value?: string;
	previousValue?: string;
	start?: string;
	end?: string;
	previousStart?: string;
	previousEnd?: string;
	reason: CalendarReason;
};

const DATE_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_MODES: CalendarMode[] = ["single", "range"];

/**
 * Adds single or range date selection and roving focus to an authored calendar grid.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/calendar.contract.json
 */
export default class CalendarController extends Controller<HTMLElement> {
	static targets = ["day"];
	static values = {
		mode: { type: String, default: "single" },
		value: { type: String, default: "" },
		start: { type: String, default: "" },
		end: { type: String, default: "" },
	};

	declare readonly dayTargets: HTMLElement[];
	declare modeValue: string;
	declare valueValue: string;
	declare startValue: string;
	declare endValue: string;

	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private reconcileQueued = false;
	private currentValue = "";
	private currentStart = "";
	private currentEnd = "";
	private currentDay?: HTMLButtonElement;
	private observer?: MutationObserver;

	connect = () => {
		this.connected = true;
		this.enhanced = false;
		this.warningIssued = false;
		this.reconcileQueued = false;
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, {
			attributeFilter: ["data-calendar-value", "disabled", "type"],
			attributes: true,
			childList: true,
			subtree: true,
		});
		this.scheduleReconcile();
	};

	disconnect = () => {
		this.connected = false;
		this.removeListeners();
		this.enhanced = false;
		this.observer?.disconnect();
		this.observer = undefined;
		this.reconcileQueued = false;
	};

	dayTargetConnected = () => this.scheduleReconcile();
	dayTargetDisconnected = () => this.scheduleReconcile();
	modeValueChanged = () => this.scheduleReconcile();
	valueValueChanged = () => this.scheduleReconcile();
	startValueChanged = () => this.scheduleReconcile();
	endValueChanged = () => this.scheduleReconcile();

	/**
	 * Selected date in single mode; an empty string clears selection. Assignment synchronizes
	 * selection and state without custom events. In range mode, reads return an empty string and
	 * writes do nothing.
	 */
	get value() {
		return this.modeValue === "single" ? this.currentValue : "";
	}

	/**
	 * Selected date in single mode; an empty string clears selection. Assignment synchronizes
	 * selection and state without custom events. In range mode, reads return an empty string and
	 * writes do nothing.
	 */
	set value(value: string) {
		if (this.modeValue !== "single" || !this.ensureEnhanced()) {
			return;
		}
		this.commitSingle(this.normalizeDateValue(value));
	}

	/**
	 * Range start date. Assignment emits no events and clears end when the new start follows it. In
	 * single mode, reads return an empty string and writes do nothing.
	 */
	get start() {
		return this.modeValue === "range" ? this.currentStart : "";
	}

	/**
	 * Range start date. Assignment emits no events and clears end when the new start follows it. In
	 * single mode, reads return an empty string and writes do nothing.
	 */
	set start(value: string) {
		if (this.modeValue !== "range" || !this.ensureEnhanced()) {
			return;
		}

		const nextStart = this.normalizeDateValue(value);
		if (nextStart === "") {
			this.commitRange("", "");
			return;
		}

		const nextEnd = this.currentEnd !== "" && nextStart > this.currentEnd ? "" : this.currentEnd;
		this.commitRange(nextStart, nextEnd);
	}

	/**
	 * Range end date. Assignment emits no events and ignores dates before start. In single mode,
	 * reads return an empty string and writes do nothing.
	 */
	get end() {
		return this.modeValue === "range" ? this.currentEnd : "";
	}

	/**
	 * Range end date. Assignment emits no events and ignores dates before start. In single mode,
	 * reads return an empty string and writes do nothing.
	 */
	set end(value: string) {
		if (this.modeValue !== "range" || !this.ensureEnhanced()) {
			return;
		}

		const nextEnd = this.normalizeDateValue(value);
		if (nextEnd !== "" && (this.currentStart === "" || nextEnd < this.currentStart)) {
			return;
		}
		this.commitRange(this.currentStart, nextEnd);
	}

	private ensureEnhanced = () => {
		if (this.connected && !this.enhanced) {
			this.reconcile();
		}
		return this.enhanced;
	};

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
		this.restoreSelection();
		this.syncState();
	};

	private enableEnhancement = () => {
		if (this.enhanced) {
			return;
		}

		this.enhanced = true;
		this.element.addEventListener("click", this.handleClick);
		this.element.addEventListener("keydown", this.handleKeydown);
		this.element.addEventListener("focusin", this.handleFocusin);
	};

	private disableEnhancement = () => {
		if (!this.enhanced) {
			return;
		}

		this.enhanced = false;
		this.removeListeners();
	};

	private removeListeners = () => {
		this.element.removeEventListener("click", this.handleClick);
		this.element.removeEventListener("keydown", this.handleKeydown);
		this.element.removeEventListener("focusin", this.handleFocusin);
	};

	private isValidMarkup = () => {
		const days = this.orderedDays();
		if (days.length === 0 || !CALENDAR_MODES.includes(this.modeValue as CalendarMode)) {
			return false;
		}

		const values = new Set<string>();
		let previousValue = "";
		for (const [index, day] of days.entries()) {
			if (
				!(day instanceof HTMLButtonElement) ||
				day.type !== "button" ||
				!this.element.contains(day)
			) {
				return false;
			}

			const value = day.dataset.calendarValue ?? "";
			if (!DATE_VALUE_PATTERN.test(value) || values.has(value)) {
				return false;
			}
			if (index > 0 && value <= previousValue) {
				return false;
			}
			values.add(value);
			previousValue = value;
		}

		return true;
	};

	private warnInvalidMarkup = () => {
		if (this.warningIssued) {
			return;
		}
		this.warningIssued = true;
		console.warn(
			'calendar controller: Provide one or more native <button type="button"> day targets inside the root with unique data-calendar-value="YYYY-MM-DD" values in ascending order. Set mode to single or range. Enhancement has been disabled.',
		);
	};

	private restoreSelection = () => {
		if (this.modeValue === "single") {
			this.currentValue = this.normalizeDateValue(this.valueValue);
			this.currentStart = "";
			this.currentEnd = "";
			if (this.valueValue !== this.currentValue) {
				this.valueValue = this.currentValue;
			}
			return;
		}

		this.currentValue = "";
		this.currentStart = this.normalizeDateValue(this.startValue);
		this.currentEnd = this.normalizeDateValue(this.endValue);
		if (this.currentStart === "") {
			this.currentEnd = "";
		}
		if (this.currentEnd !== "" && this.currentEnd < this.currentStart) {
			this.currentEnd = "";
		}
		this.syncRangeValues();
	};

	private syncState = () => {
		for (const day of this.orderedDays()) {
			const value = day.dataset.calendarValue ?? "";
			let selected = false;
			let state: string | undefined;

			if (this.modeValue === "single") {
				selected = value === this.currentValue;
				state = selected ? "selected" : undefined;
			} else {
				selected =
					value === this.currentStart || (this.currentEnd !== "" && value === this.currentEnd);
				if (value === this.currentStart && this.currentStart !== "") {
					state = "range-start";
				} else if (value === this.currentEnd && this.currentEnd !== "") {
					state = "range-end";
				} else if (
					this.currentStart !== "" &&
					this.currentEnd !== "" &&
					value > this.currentStart &&
					value < this.currentEnd
				) {
					state = "in-range";
				}
			}

			day.setAttribute("aria-pressed", String(selected));
			if (state === undefined) {
				delete day.dataset.state;
			} else {
				day.dataset.state = state;
			}
		}

		this.syncRovingTabindex();
	};

	private syncRovingTabindex = () => {
		const days = this.orderedDays();
		const enabledDays = this.enabledDays(days);
		if (enabledDays.length === 0) {
			this.currentDay = undefined;
			for (const day of days) {
				day.setAttribute("tabindex", "-1");
			}
			return;
		}

		if (this.currentDay === undefined || !enabledDays.includes(this.currentDay)) {
			this.currentDay = this.selectedDay(enabledDays) ?? enabledDays[0];
		}

		for (const day of days) {
			day.setAttribute("tabindex", day === this.currentDay ? "0" : "-1");
		}
	};

	private selectedDay = (days: HTMLButtonElement[]) => {
		const values =
			this.modeValue === "single" ? [this.currentValue] : [this.currentStart, this.currentEnd];
		return days.find((day) => values.includes(day.dataset.calendarValue ?? ""));
	};

	private enabledDays = (days = this.orderedDays()) =>
		days.filter(
			(day): day is HTMLButtonElement =>
				day instanceof HTMLButtonElement && day.type === "button" && !day.disabled,
		);

	private focusTarget = (target: HTMLButtonElement) => {
		if (!this.enabledDays().includes(target)) {
			return;
		}
		this.currentDay = target;
		this.syncRovingTabindex();
		target.focus();
	};

	private handleFocusin = (event: FocusEvent) => {
		if (!this.ensureEnhanced()) {
			return;
		}
		const day = this.dayFromEvent(event);
		if (day === undefined || !this.enabledDays().includes(day)) {
			return;
		}
		this.currentDay = day;
		this.syncRovingTabindex();
	};

	private handleKeydown = (event: KeyboardEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}

		const day = this.dayFromEvent(event);
		if (day === undefined || !this.enabledDays().includes(day)) {
			return;
		}

		const days = this.orderedDays();
		const index = days.indexOf(day);
		if (index < 0) {
			return;
		}

		let target: HTMLButtonElement | undefined;
		if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			const direction = getComputedStyle(this.element).direction === "rtl" ? -1 : 1;
			const step = event.key === "ArrowLeft" ? -direction : direction;
			let nextIndex = index + step;
			while (nextIndex >= 0 && nextIndex < days.length) {
				const candidate = days[nextIndex];
				if (
					candidate instanceof HTMLButtonElement &&
					candidate.type === "button" &&
					!candidate.disabled
				) {
					target = candidate;
					break;
				}
				nextIndex += step;
			}
		} else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
			const offset = event.key === "ArrowUp" ? -7 : 7;
			const candidate = days[index + offset];
			if (
				candidate instanceof HTMLButtonElement &&
				candidate.type === "button" &&
				!candidate.disabled
			) {
				target = candidate;
			}
		} else {
			return;
		}

		event.preventDefault();
		if (target !== undefined) {
			this.focusTarget(target);
		}
	};

	private handleClick = (event: MouseEvent) => {
		if (!this.ensureEnhanced() || !event.isTrusted) {
			return;
		}

		const day = this.dayFromEvent(event);
		if (day === undefined || day.disabled) {
			return;
		}

		const value = day.dataset.calendarValue ?? "";
		this.requestSelection(value, event.detail === 0 ? "keyboard" : "pointer");
	};

	private requestSelection = (value: string, reason: CalendarReason) => {
		if (this.modeValue === "single") {
			if (value === this.currentValue) {
				return;
			}
			const detail: CalendarChangeDetail = {
				previousValue: this.currentValue,
				reason,
				value,
			};
			if (!this.dispatchBeforeChange(detail)) {
				return;
			}
			this.commitSingle(value);
			this.element.dispatchEvent(
				new CustomEvent<CalendarChangeDetail>("calendar:change", { bubbles: true, detail }),
			);
			return;
		}

		const previousStart = this.currentStart;
		const previousEnd = this.currentEnd;
		let start = previousStart;
		let end = previousEnd;
		if (previousEnd !== "") {
			start = value;
			end = "";
		} else if (previousStart === "") {
			start = value;
			end = "";
		} else if (value < previousStart) {
			start = value;
			end = "";
		} else {
			end = value;
		}

		const detail: CalendarChangeDetail = {
			end,
			previousEnd,
			previousStart,
			reason,
			start,
		};
		if (!this.dispatchBeforeChange(detail)) {
			return;
		}
		this.commitRange(start, end);
		this.element.dispatchEvent(
			new CustomEvent<CalendarChangeDetail>("calendar:change", { bubbles: true, detail }),
		);
	};

	private commitSingle = (value: string) => {
		this.currentValue = value;
		this.syncSingleValue();
		this.syncState();
	};

	private dispatchBeforeChange = (detail: CalendarChangeDetail) => {
		const beforeChange = new CustomEvent<CalendarChangeDetail>("calendar:beforechange", {
			bubbles: true,
			cancelable: true,
			detail,
		});
		return this.element.dispatchEvent(beforeChange);
	};

	private commitRange = (start: string, end: string) => {
		this.currentStart = start;
		this.currentEnd = end;
		this.syncRangeValues();
		this.syncState();
	};

	private syncSingleValue = () => {
		if (this.valueValue !== this.currentValue) {
			this.valueValue = this.currentValue;
		}
	};

	private syncRangeValues = () => {
		if (this.startValue !== this.currentStart) {
			this.startValue = this.currentStart;
		}
		if (this.endValue !== this.currentEnd) {
			this.endValue = this.currentEnd;
		}
	};

	private dayFromEvent = (event: Event) =>
		event
			.composedPath()
			.find(
				(candidate): candidate is HTMLButtonElement =>
					candidate instanceof HTMLButtonElement && this.dayTargets.includes(candidate),
			);

	private dayOrder = (left: HTMLElement, right: HTMLElement) => {
		if (left === right) {
			return 0;
		}
		return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
	};

	private orderedDays = () => [...this.dayTargets].sort(this.dayOrder);

	private normalizeDateValue = (value: unknown) =>
		value === "" || !DATE_VALUE_PATTERN.test(String(value)) ? "" : String(value);
}
