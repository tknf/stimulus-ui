import { describe, expect, test } from "vite-plus/test";
import { isImeKeydown } from "../src/internal/ime";

const keydown = (init: KeyboardEventInit = {}) =>
	new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "a", ...init });

const keyCode229 = () => {
	const event = keydown();
	Object.defineProperty(event, "keyCode", { configurable: true, value: 229 });
	return event;
};

describe("isImeKeydown", () => {
	test("[listbox-typeahead-ime-negative] Identifies isComposing or keyCode 229 as IME keydown", () => {
		expect(isImeKeydown(keydown({ isComposing: true }))).toBe(true);
		expect(isImeKeydown(keyCode229())).toBe(true);
		expect(isImeKeydown(keydown())).toBe(false);
	});
});
