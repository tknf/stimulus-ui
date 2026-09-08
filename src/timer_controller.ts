import { Controller } from "@hotwired/stimulus";

export type TimerFinishDetail = {
	value: number;
	elapsed: number;
	reason: "timer";
};

export type TimerMilestoneDetail = TimerFinishDetail & { values: number[] };

type TimerState = "idle" | "running" | "paused" | "finished";
type TimerConfiguration = {
	direction: "down" | "up";
	duration: number;
	milestones: number[];
};

/**
 * Tracks elapsed time and milestones using timestamp differences.
 *
 * @see https://github.com/tknf/stimulus-ui/blob/main/design/contracts/timer.contract.json
 */
export default class TimerController extends Controller<HTMLElement> {
	static targets = ["display"];
	static values = {
		direction: { type: String, default: "down" },
		duration: { type: Number, default: 0 },
		milestones: { type: Array, default: [] },
	};

	declare readonly displayTargets: HTMLElement[];
	declare directionValue: string;
	declare durationValue: number;
	declare milestonesValue: unknown[];
	private connected = false;
	private enhanced = false;
	private warningIssued = false;
	private completionWarningIssued = false;
	private reconcileQueued = false;
	private configuration?: TimerConfiguration;
	private currentState: TimerState = "idle";
	private currentElapsed = 0;
	private notifiedElapsed = 0;
	private startedAt = 0;
	private finishPending = false;
	private revision = 0;
	private timer?: number;
	private observer?: MutationObserver;

	connect = () => {
		this.connected = true;
		this.warningIssued = false;
		this.completionWarningIssued = false;
		this.observer = new MutationObserver(this.scheduleReconcile);
		this.observer.observe(this.element, {
			attributes: true,
			attributeFilter: [
				"data-timer-direction-value",
				"data-timer-duration-value",
				"data-timer-milestones-value",
			],
		});
		this.element.ownerDocument.addEventListener("visibilitychange", this.handleVisibility);
		this.element.ownerDocument.defaultView?.addEventListener("pageshow", this.handleVisibility);
		this.reconcile();
	};

	disconnect = () => {
		this.commitPause();
		this.connected = false;
		this.enhanced = false;
		this.observer?.disconnect();
		this.observer = undefined;
		this.element.ownerDocument.removeEventListener("visibilitychange", this.handleVisibility);
		this.element.ownerDocument.defaultView?.removeEventListener("pageshow", this.handleVisibility);
	};

	displayTargetConnected = () => this.scheduleReconcile();
	displayTargetDisconnected = () => this.scheduleReconcile();

	/**
	 * Last synchronized display value in milliseconds. Returns zero while invalid or disconnected.
	 * Reading does not update state.
	 */
	get value(): number {
		return this.enhanced ? this.valueAt(this.currentElapsed) : 0;
	}

	/**
	 * Last synchronized elapsed time in milliseconds, clamped to a finite duration. Returns zero
	 * while invalid or disconnected.
	 */
	get elapsed(): number {
		return this.enhanced ? this.currentElapsed : 0;
	}

	/**
	 * Starts from idle or resumes from paused without custom events. Does nothing while running or
	 * finished.
	 *
	 * @returns No return value.
	 */
	start = () => {
		if (
			!this.ensureEnhanced() ||
			this.currentState === "running" ||
			this.currentState === "finished"
		) {
			return;
		}
		this.revision += 1;
		this.startedAt = Date.now() - this.currentElapsed;
		this.currentState = "running";
		this.syncState();
		this.scheduleTick();
	};

	/**
	 * Synchronizes to the current time and pauses, or finishes if the endpoint has been reached.
	 * Does not notify milestones or completion crossed by this call.
	 *
	 * @returns No return value.
	 */
	pause = () => {
		if (this.ensureEnhanced()) {
			this.commitPause();
		}
	};

	/**
	 * Stops and restores zero elapsed time, the initial display value, and idle state without custom
	 * events. Milestones become eligible for notification again.
	 *
	 * @returns No return value.
	 */
	reset = () => {
		if (this.ensureEnhanced()) {
			this.commitReset();
		}
	};

	private isAttached = () =>
		this.connected &&
		this.element.isConnected &&
		(this.element.getAttribute("data-controller") ?? "").split(/\s+/).includes(this.identifier);

	private ensureEnhanced = () => {
		if (!this.isAttached()) {
			return false;
		}
		this.reconcile();
		return this.enhanced;
	};

	private readConfiguration = (): TimerConfiguration | undefined => {
		try {
			const direction = this.directionValue;
			const duration = this.durationValue;
			const milestones: unknown[] = this.milestonesValue;
			if (
				(direction !== "down" && direction !== "up") ||
				!Number.isFinite(duration) ||
				duration < 0 ||
				(direction === "down" && duration === 0)
			) {
				return undefined;
			}
			if (
				!milestones.every(
					(value): value is number =>
						typeof value === "number" &&
						Number.isFinite(value) &&
						value >= 0 &&
						(duration === 0 || value <= duration),
				)
			) {
				return undefined;
			}
			return {
				direction,
				duration,
				milestones: [...new Set(milestones)].sort((a, b) => (direction === "up" ? a - b : b - a)),
			};
		} catch {
			return undefined;
		}
	};

	private scheduleReconcile = () => {
		if (!this.connected || this.reconcileQueued) {
			return;
		}
		this.reconcileQueued = true;
		queueMicrotask(() => {
			this.reconcileQueued = false;
			if (this.isAttached()) {
				this.reconcile();
			}
		});
	};

	private reconcile = () => {
		const configuration = this.readConfiguration();
		const [display] = this.displayTargets;
		if (
			!configuration ||
			this.displayTargets.length !== 1 ||
			!(display instanceof HTMLElement) ||
			display === this.element ||
			!this.element.contains(display)
		) {
			this.commitPause();
			this.enhanced = false;
			this.element.removeAttribute("data-state");
			this.element.style.removeProperty("--timer-value");
			this.element.style.removeProperty("--timer-duration");
			if (!this.warningIssued) {
				this.warningIssued = true;
				console.warn(
					"timer controller: Provide exactly one HTMLElement display target inside the root. Set direction to down or up, with finite nonnegative duration and milestones. Counting down requires a positive duration. Enhancement has been disabled.",
				);
			}
			return;
		}
		const changed = JSON.stringify(configuration) !== JSON.stringify(this.configuration);
		this.configuration = configuration;
		this.enhanced = true;
		if (!display.hasAttribute("role")) {
			display.setAttribute("role", "timer");
			if (!this.completionWarningIssued) {
				this.completionWarningIssued = true;
				console.warn('timer controller: Added role="timer". Include them in your markup.');
			}
		}
		if (changed) {
			this.commitReset();
		} else {
			this.syncState();
		}
	};

	private valueAt = (elapsed: number) =>
		this.configuration?.direction === "down" ? this.configuration.duration - elapsed : elapsed;

	private sampleTime = () => {
		if (this.currentState !== "running" || !this.configuration) {
			return;
		}
		const elapsed = Math.max(this.currentElapsed, Date.now() - this.startedAt);
		const duration = this.configuration.duration;
		this.currentElapsed = duration > 0 ? Math.min(duration, elapsed) : elapsed;
		if (duration > 0 && this.currentElapsed >= duration) {
			this.currentState = "finished";
			this.finishPending = true;
		}
	};

	private commitPause = () => {
		this.revision += 1;
		this.stopTimer();
		this.sampleTime();
		if (this.currentState === "running") {
			this.currentState = "paused";
		}
		this.notifiedElapsed = this.currentElapsed;
		this.finishPending = false;
		if (this.enhanced) {
			this.syncState();
		}
	};

	private commitReset = () => {
		this.revision += 1;
		this.stopTimer();
		this.currentElapsed = 0;
		this.notifiedElapsed = 0;
		this.finishPending = false;
		this.currentState = "idle";
		this.syncState();
	};

	private syncState = () => {
		this.element.dataset.state = this.currentState;
		this.element.style.setProperty("--timer-value", String(this.valueAt(this.currentElapsed)));
		if (this.configuration && this.configuration.duration > 0) {
			this.element.style.setProperty("--timer-duration", String(this.configuration.duration));
		} else {
			this.element.style.removeProperty("--timer-duration");
		}
	};

	private stopTimer = () => {
		if (this.timer !== undefined) {
			this.element.ownerDocument.defaultView?.clearTimeout(this.timer);
			this.timer = undefined;
		}
	};

	private scheduleTick = () => {
		this.stopTimer();
		if (!this.isAttached() || (this.currentState !== "running" && !this.finishPending)) {
			return;
		}
		const revision = this.revision;
		this.timer = this.element.ownerDocument.defaultView?.setTimeout(() => {
			if (revision !== this.revision || !this.isAttached()) {
				return;
			}
			this.timer = undefined;
			this.tick();
		}, 100);
	};

	private handleVisibility = (event: Event) => {
		if (event.isTrusted && !this.element.ownerDocument.hidden) {
			this.stopTimer();
			this.tick();
		}
	};

	private tick = () => {
		if (!this.ensureEnhanced() || !this.configuration) {
			return;
		}
		this.sampleTime();
		this.syncState();
		if (!this.element.ownerDocument.hidden) {
			const revision = this.revision;
			const previous = this.valueAt(this.notifiedElapsed);
			const value = this.valueAt(this.currentElapsed);
			const values = this.configuration.milestones.filter((milestone) =>
				this.configuration?.direction === "up"
					? previous < milestone && milestone <= value
					: value <= milestone && milestone < previous,
			);
			const finish = this.finishPending;
			const detail = {
				value,
				elapsed: this.currentElapsed,
				reason: "timer",
			} satisfies TimerFinishDetail;
			this.notifiedElapsed = this.currentElapsed;
			this.finishPending = false;
			if (values.length > 0) {
				this.dispatch("milestone", {
					detail: { ...detail, values } satisfies TimerMilestoneDetail,
					bubbles: true,
					cancelable: false,
				});
			}
			if (!this.ensureEnhanced() || revision !== this.revision) {
				return;
			}
			if (finish) {
				this.dispatch("finish", { detail, bubbles: true, cancelable: false });
			}
		}
		this.scheduleTick();
	};
}
