import { afterEach, expect, test } from "vite-plus/test";
import { server, userEvent } from "vite-plus/test/browser/context";
import expected from "./fixtures/native_color_observations.json";

const createColor = (attributes: Record<string, string> = {}) => {
	const input = document.createElement("input");
	input.type = "color";
	input.setAttribute("aria-label", "色");
	input.defaultValue = "#336699";
	for (const [name, value] of Object.entries(attributes)) {
		input.setAttribute(name, value);
	}
	document.body.append(input);
	return input;
};

afterEach(() => document.body.replaceChildren());

test("Records native color values and alpha/colorspace support", () => {
	const values = [
		"#12ABEF",
		"red",
		"rgb(10 20 30)",
		"#33669980",
		"color(display-p3 0.2 0.4 0.6 / 0.5)",
		"invalid",
	];
	const modes = [
		{},
		{ alpha: "" },
		{ alpha: "", colorspace: "display-p3" },
	] as const satisfies readonly Record<string, string>[];
	const observations = modes.map((attributes) => {
		const input = createColor(attributes);
		const results = values.map((value) => {
			input.value = value;
			return input.value;
		});
		const alpha: unknown = Reflect.get(input, "alpha");
		const colorSpace: unknown = Reflect.get(input, "colorSpace");
		return {
			attributes,
			alpha: typeof alpha === "boolean" ? alpha : null,
			colorSpace: typeof colorSpace === "string" ? colorSpace : null,
			results,
		};
	});
	const engine = server.browser;
	if (engine !== "chromium" && engine !== "firefox" && engine !== "webkit") {
		throw new Error("検証対象外の engine です");
	}
	expect(observations).toEqual(expected[engine]);
});

test("Closed native color inputs do not edit two axes with arrows, and API assignment/reset emit no input/change", async () => {
	const input = createColor();
	const form = document.createElement("form");
	form.append(input);
	document.body.append(form);
	const events: string[] = [];
	const keys: { key: string; trusted: boolean }[] = [];
	input.addEventListener("input", (event) => events.push(event.type));
	input.addEventListener("change", (event) => events.push(event.type));
	input.addEventListener("keydown", (event) =>
		keys.push({ key: event.key, trusted: event.isTrusted }),
	);
	input.focus();
	await userEvent.keyboard("{ArrowRight}{ArrowDown}{ArrowLeft}{ArrowUp}");
	expect(input.value).toBe("#336699");
	expect(keys).toEqual(
		["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].map((key) => ({ key, trusted: true })),
	);
	input.value = "#123456";
	expect(input.value).toBe("#123456");
	form.reset();
	expect(input.value).toBe("#336699");
	expect(events).toEqual([]);
});
