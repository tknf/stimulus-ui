import { afterEach, expect, test } from "vite-plus/test";
import { server, userEvent } from "vite-plus/test/browser/context";

afterEach(() => document.body.replaceChildren());

for (const type of ["date", "time"] as const) {
	test(`Native ${type} input receives trusted keyboard operations on the host platform`, async () => {
		const input = document.createElement("input");
		input.type = type;
		const initialValue = type === "date" ? "2026-08-20" : "12:00";
		const outside = document.createElement("button");
		outside.type = "button";
		document.body.append(input, outside);
		const events: Array<{ type: string; key: string; trusted: boolean; value: string }> = [];
		for (const name of ["keydown", "input", "change"]) {
			input.addEventListener(name, (event) =>
				events.push({
					type: event.type,
					key: event instanceof KeyboardEvent ? event.key : "",
					trusted: event.isTrusted,
					value: input.value,
				}),
			);
		}
		const observations = [];
		for (const keys of [
			"{ArrowUp}",
			"{ArrowRight}{ArrowUp}",
			"{Home}{ArrowUp}",
			"{ControlOrMeta>}a{/ControlOrMeta}20260821",
			"{ArrowLeft}13{ArrowRight}30",
		]) {
			input.value = initialValue;
			events.length = 0;
			input.focus();
			await userEvent.keyboard(keys);
			outside.focus();
			observations.push({ keys, value: input.value, events: [...events] });
			expect(events.some((event) => event.type === "keydown" && event.trusted)).toBe(true);
		}
		console.info(
			JSON.stringify({ platform: server.platform, browser: server.browser, type, observations }),
		);
	});
}

test("Native non-modal dialog close reports focus behavior on the host platform", () => {
	const trigger = document.createElement("button");
	const outside = document.createElement("button");
	const dialog = document.createElement("dialog");
	const inside = document.createElement("button");
	trigger.type = outside.type = inside.type = "button";
	dialog.append(inside);
	document.body.append(trigger, outside, dialog);
	trigger.focus();
	dialog.show();
	outside.focus();
	expect(document.activeElement).toBe(outside);
	dialog.close();
	expect(dialog.open).toBe(false);
	console.info(
		JSON.stringify({
			platform: server.platform,
			browser: server.browser,
			outsidePreserved: document.activeElement === outside,
			triggerRestored: document.activeElement === trigger,
		}),
	);
});
