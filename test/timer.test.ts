import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser/context";
import TimerController, {
	type TimerFinishDetail,
	type TimerMilestoneDetail,
} from "../src/timer_controller";

let application: Application;
let warnings: string[];
let originalWarn: typeof console.warn;
let controllers: TimerController[];

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
};
const createTimer = (attributes: Record<string, string> = {}) => {
	const root = document.createElement("div");
	root.setAttribute("data-controller", "timer");
	root.setAttribute("data-timer-duration-value", "1000");
	for (const [name, value] of Object.entries(attributes)) {
		root.setAttribute(name, value);
	}
	const display = document.createElement("span");
	display.setAttribute("data-timer-target", "display");
	display.setAttribute("role", "timer");
	display.textContent = "1000 ミリ秒";
	root.append(display);
	for (const method of ["start", "pause", "reset"]) {
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = method;
		button.setAttribute("data-action", `timer#${method}`);
		root.append(button);
	}
	return { root, display };
};
const mount = async (fixture = createTimer()) => {
	document.body.append(fixture.root);
	await settle();
	const controller = application.getControllerForElementAndIdentifier(fixture.root, "timer");
	if (!(controller instanceof TimerController)) {
		throw new Error("timer controller がありません");
	}
	controllers.push(controller);
	return { ...fixture, controller };
};
const useClock = () => {
	vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
	vi.setSystemTime(100000);
};
const listen = (root: HTMLElement) => {
	const events: {
		type: string;
		detail: TimerFinishDetail | TimerMilestoneDetail;
		state: string | undefined;
		cancelable: boolean;
		bubbles: boolean;
	}[] = [];
	for (const type of ["timer:milestone", "timer:finish"]) {
		root.addEventListener(type, (event) => {
			const custom = event as CustomEvent<TimerFinishDetail | TimerMilestoneDetail>;
			events.push({
				type,
				detail: custom.detail,
				state: root.dataset.state,
				cancelable: event.cancelable,
				bubbles: event.bubbles,
			});
		});
	}
	return events;
};

beforeEach(() => {
	document.body.replaceChildren();
	controllers = [];
	warnings = [];
	originalWarn = console.warn;
	console.warn = (message?: unknown) => warnings.push(String(message));
	application = Application.start();
	application.register("timer", TimerController);
});
afterEach(async () => {
	for (const controller of controllers) {
		controller.disconnect();
	}
	vi.useRealTimers();
	document.body.replaceChildren();
	await settle();
	application.stop();
	console.warn = originalWarn;
	vi.restoreAllMocks();
});

test("[timer-state][timer-state-negative] Exposes initial values and state only on the root and preserves numbers, ARIA, and presentation", async () => {
	const { root, display, controller } = await mount();
	expect(controller.value).toBe(1000);
	expect(controller.elapsed).toBe(0);
	expect(root.dataset.state).toBe("idle");
	expect(root.style.getPropertyValue("--timer-value")).toBe("1000");
	expect(root.style.getPropertyValue("--timer-duration")).toBe("1000");
	expect(display.getAttribute("role")).toBe("timer");
	expect(display.textContent).toBe("1000 ミリ秒");
	expect(display.hasAttribute("data-state")).toBe(false);
	expect(root.hasAttribute("role")).toBe(false);
	expect(root.hasAttribute("aria-live")).toBe(false);
	expect(display.hasAttribute("aria-live")).toBe(false);
	expect(root.className).toBe("");
	expect(root.style.length).toBe(2);
	expect(warnings).toEqual([]);
});

test("[timer-drift][timer-drift-negative] Corrects values using timestamp differences even when callbacks are delayed", async () => {
	const { controller, root } = await mount();
	useClock();
	controller.start();
	vi.setSystemTime(100650);
	vi.advanceTimersByTime(100);
	expect(controller.elapsed).toBe(750);
	expect(controller.value).toBe(250);
	expect(root.dataset.state).toBe("running");
	vi.advanceTimersByTime(300);
	expect(controller.value).toBe(0);
	expect(controller.elapsed).toBe(1000);
	expect(root.dataset.state).toBe("finished");
});

test("[timer-up][timer-direction-negative] Countup reports elapsed time without a limit when duration is zero", async () => {
	const { controller, root } = await mount(
		createTimer({ "data-timer-direction-value": "up", "data-timer-duration-value": "0" }),
	);
	useClock();
	expect(controller.value).toBe(0);
	expect(root.style.getPropertyValue("--timer-duration")).toBe("");
	controller.start();
	vi.setSystemTime(160000);
	vi.advanceTimersByTime(100);
	expect(controller.value).toBe(60100);
	expect(root.dataset.state).toBe("running");
	controller.durationValue = 500;
	controller.start();
	vi.advanceTimersByTime(600);
	expect(controller.value).toBe(500);
	expect(root.dataset.state).toBe("finished");
});

test("[timer-api][timer-pause-negative] Pause, resume, and reset preserve accurate elapsed time without API notifications", async () => {
	const { controller, root } = await mount(
		createTimer({ "data-timer-milestones-value": "[800,500,0]" }),
	);
	const events = listen(root);
	useClock();
	controller.start();
	vi.setSystemTime(100350);
	controller.pause();
	expect(controller.value).toBe(650);
	expect(root.dataset.state).toBe("paused");
	vi.advanceTimersByTime(5000);
	expect(controller.value).toBe(650);
	expect(events).toEqual([]);
	controller.start();
	vi.advanceTimersByTime(100);
	expect(controller.value).toBe(550);
	expect(events).toEqual([]);
	controller.reset();
	expect(controller.value).toBe(1000);
	expect(root.dataset.state).toBe("idle");
	controller.start();
	vi.setSystemTime(Date.now() + 1200);
	controller.pause();
	expect(root.dataset.state).toBe("finished");
	controller.start();
	expect(root.dataset.state).toBe("finished");
	expect(events).toEqual([]);
});

test("[timer-milestones][timer-milestone-negative][timer-finish-negative] Aggregates crossed milestones in order and reports finish once after committing state", async () => {
	const { controller, root } = await mount(
		createTimer({ "data-timer-milestones-value": "[0,800,500,800,1000]" }),
	);
	const events = listen(root);
	useClock();
	controller.start();
	vi.setSystemTime(101000);
	vi.advanceTimersByTime(100);
	expect(events).toEqual([
		{
			type: "timer:milestone",
			detail: { values: [800, 500, 0], value: 0, elapsed: 1000, reason: "timer" },
			state: "finished",
			cancelable: false,
			bubbles: true,
		},
		{
			type: "timer:finish",
			detail: { value: 0, elapsed: 1000, reason: "timer" },
			state: "finished",
			cancelable: false,
			bubbles: true,
		},
	]);
	vi.advanceTimersByTime(2000);
	expect(events).toHaveLength(2);
	controller.reset();
	controller.start();
	vi.advanceTimersByTime(1000);
	expect(events.filter((event) => event.type === "timer:finish")).toHaveLength(2);
});

test("[timer-clock-backward][timer-clock-negative] Does not roll back committed elapsed time when the clock moves backward", async () => {
	const { controller } = await mount();
	useClock();
	controller.start();
	vi.advanceTimersByTime(500);
	vi.setSystemTime(99000);
	vi.advanceTimersByTime(200);
	expect(controller.elapsed).toBe(500);
	vi.setSystemTime(100600);
	vi.advanceTimersByTime(100);
	expect(controller.elapsed).toBe(700);
});

test("[timer-hidden][timer-hidden-negative] Defers milestones and finish while hidden and reports them together when visible", async () => {
	const { controller, root } = await mount(
		createTimer({ "data-timer-milestones-value": "[800,500,0]" }),
	);
	const events = listen(root);
	useClock();
	const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
	controller.start();
	vi.advanceTimersByTime(1500);
	expect(controller.value).toBe(0);
	expect(events).toEqual([]);
	hidden.mockReturnValue(false);
	vi.advanceTimersByTime(100);
	expect(events.map((event) => event.type)).toEqual(["timer:milestone", "timer:finish"]);
	expect(events[0]?.detail).toMatchObject({ values: [800, 500, 0] });
	vi.advanceTimersByTime(1000);
	expect(events).toHaveLength(2);
});

test("[timer-reentrancy][timer-reentrancy-negative] Does not emit stale finish after milestone listeners reset, reconfigure, remove targets, or disconnect", async () => {
	for (const change of ["reset", "duration", "target", "disconnect", "controller"]) {
		const { controller, root, display } = await mount(
			createTimer({ "data-timer-milestones-value": "[0]" }),
		);
		const events = listen(root);
		useClock();
		root.addEventListener(
			"timer:milestone",
			() => {
				if (change === "reset") controller.reset();
				if (change === "duration") controller.durationValue = 2000;
				if (change === "target") display.remove();
				if (change === "disconnect") controller.disconnect();
				if (change === "controller") root.removeAttribute("data-controller");
			},
			{ once: true },
		);
		controller.start();
		vi.advanceTimersByTime(1000);
		expect(
			events.map((event) => event.type),
			change,
		).toEqual(["timer:milestone"]);
		controller.disconnect();
		vi.useRealTimers();
		root.remove();
		await settle();
	}
});

test("[timer-invalid][timer-validation-negative] Disables invalid settings, JSON, or targets with one warning and resumes after repair", async () => {
	const { controller, root, display } = await mount();
	useClock();
	controller.start();
	vi.advanceTimersByTime(200);
	for (const [name, value] of [
		["direction", "bad"],
		["duration", "-1"],
		["duration", "0"],
		["duration", "Infinity"],
		["milestones", "bad-json"],
		["milestones", "{}"],
		["milestones", '["500"]'],
		["milestones", "[-1]"],
		["milestones", "[2000]"],
	]) {
		root.setAttribute(`data-timer-${name}-value`, value ?? "");
		controller.start();
		expect(root.hasAttribute("data-state")).toBe(false);
		expect(root.style.getPropertyValue("--timer-value")).toBe("");
		expect(controller.value).toBe(0);
		root.setAttribute("data-timer-direction-value", "down");
		root.setAttribute("data-timer-duration-value", "1000");
		root.setAttribute("data-timer-milestones-value", "[]");
	}
	display.remove();
	controller.start();
	expect(root.hasAttribute("data-state")).toBe(false);
	root.append(display);
	controller.start();
	expect(root.dataset.state).toBe("running");
	expect(warnings).toHaveLength(1);
});

test("[timer-completion][timer-role-negative] Warns once when completing role and preserves authored ARIA and numbers", async () => {
	const fixture = createTimer();
	fixture.display.removeAttribute("role");
	const { controller, display } = await mount(fixture);
	expect(display.getAttribute("role")).toBe("timer");
	expect(warnings).toHaveLength(1);
	display.removeAttribute("role");
	controller.reset();
	expect(warnings).toHaveLength(1);
	display.setAttribute("role", "timer status");
	display.setAttribute("aria-live", "polite");
	display.setAttribute("aria-label", "読み上げ時間");
	controller.reset();
	expect(display.getAttribute("role")).toBe("timer status");
	expect(display.getAttribute("aria-live")).toBe("polite");
	expect(display.getAttribute("aria-label")).toBe("読み上げ時間");
	expect(display.textContent).toBe("1000 ミリ秒");
});

test("[timer-config-target] Configuration changes reset timing, while identical settings and simultaneous target replacement preserve it", async () => {
	const { controller, root, display } = await mount();
	useClock();
	controller.start();
	vi.advanceTimersByTime(300);
	controller.durationValue = 1000;
	await settle();
	expect(controller.elapsed).toBe(300);
	const replacement = display.cloneNode(true);
	display.replaceWith(replacement);
	await settle();
	vi.advanceTimersByTime(100);
	expect(controller.elapsed).toBe(400);
	controller.durationValue = 2000;
	await settle();
	expect(controller.value).toBe(2000);
	expect(root.dataset.state).toBe("idle");
	controller.start();
	controller.milestonesValue = [1000];
	await settle();
	expect(root.dataset.state).toBe("idle");
});

test("[timer-cleanup][timer-cleanup-negative] Direct disconnect clears scheduling and observation and reconnect resumes from paused", async () => {
	const { controller, root } = await mount();
	useClock();
	const events = listen(root);
	controller.start();
	vi.setSystemTime(100250);
	const observer = vi.spyOn(MutationObserver.prototype, "disconnect");
	const listener = vi.spyOn(document, "removeEventListener");
	const windowListener = vi.spyOn(window, "removeEventListener");
	controller.disconnect();
	expect(root.dataset.state).toBe("paused");
	expect(root.style.getPropertyValue("--timer-value")).toBe("750");
	expect(vi.getTimerCount()).toBe(0);
	expect(observer).toHaveBeenCalledOnce();
	expect(listener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
	expect(windowListener).toHaveBeenCalledWith("pageshow", expect.any(Function));
	vi.advanceTimersByTime(5000);
	controller.start();
	expect(events).toEqual([]);
	controller.connect();
	expect(controller.value).toBe(750);
	controller.start();
	vi.advanceTimersByTime(100);
	expect(controller.value).toBe(650);
});

test("[timer-native][timer-native-tick-negative] Supports native button pointer, Enter, and Space without moving focus as time passes", async () => {
	const { controller, root } = await mount();
	const [start, pause, reset] = Array.from(root.querySelectorAll("button"));
	if (!start || !pause || !reset) throw new Error("操作buttonが足りません");
	await userEvent.click(start);
	expect(root.dataset.state).toBe("running");
	await userEvent.keyboard("{Tab}{Enter}");
	expect(document.activeElement).toBe(pause);
	expect(root.dataset.state).toBe("paused");
	await userEvent.keyboard("{Tab} ");
	expect(root.dataset.state).toBe("idle");
	await userEvent.keyboard("{Shift>}{Tab}{/Shift}{Shift>}{Tab}{/Shift}{Enter}");
	expect(document.activeElement).toBe(start);
	// Allow callback and polling delays beyond the one-second duration.
	await expect.poll(() => controller.value, { timeout: 3000 }).toBe(0);
	expect(document.activeElement).toBe(start);
	expect(root.dataset.state).toBe("finished");
});

test("[timer-synthetic][timer-synthetic-negative] Synthetic visibilitychange and pageshow do not synchronize time or emit notifications", async () => {
	const { controller, root } = await mount(createTimer({ "data-timer-milestones-value": "[800]" }));
	const events = listen(root);
	useClock();
	controller.start();
	vi.setSystemTime(100350);
	document.dispatchEvent(new Event("visibilitychange"));
	window.dispatchEvent(new Event("pageshow"));
	expect(controller.elapsed).toBe(0);
	expect(events).toEqual([]);
	vi.advanceTimersByTime(100);
	expect(controller.elapsed).toBe(450);
	expect(events).toHaveLength(1);
});
