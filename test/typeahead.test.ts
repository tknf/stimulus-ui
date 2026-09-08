import { afterEach, describe, expect, test } from "vite-plus/test";
import { createTypeahead } from "../src/internal/typeahead";

const wait = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const keydown = (key: string, init: KeyboardEventInit = {}) =>
	new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init });

const keyCode229 = () => {
	const event = keydown("a");
	Object.defineProperty(event, "keyCode", { configurable: true, value: 229 });
	return event;
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("typeahead", () => {
	test("[listbox-typeahead][listbox-typeahead-wrap-negative] Checks prefix matching, case insensitivity, wrapping, and repeated-character navigation", () => {
		const typeahead = createTypeahead();
		const candidates = ["Alpha", "Bravo", "Beta", "charlie"];
		try {
			expect(
				typeahead.handleKeydown(keydown("b"), candidates, (candidate) => candidate, -1),
			).toEqual({
				consumed: true,
				index: 1,
			});
			expect(
				typeahead.handleKeydown(keydown("b"), candidates, (candidate) => candidate, 1),
			).toEqual({
				consumed: true,
				index: 2,
			});

			typeahead.disconnect();
			expect(
				typeahead.handleKeydown(keydown("b"), candidates, (candidate) => candidate, 2),
			).toEqual({
				consumed: true,
				index: 1,
			});
			typeahead.disconnect();
			expect(
				typeahead.handleKeydown(keydown("C"), candidates, (candidate) => candidate, 2),
			).toEqual({
				consumed: true,
				index: 3,
			});
		} finally {
			typeahead.disconnect();
		}
	});

	test("[listbox-typeahead-space-negative][listbox-typeahead-ime-negative] Ignores Space, modified keys, and keydown during IME composition", () => {
		const typeahead = createTypeahead();
		const candidates = ["Alpha"];
		try {
			for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
				expect(
					typeahead.handleKeydown(keydown("a", init), candidates, (candidate) => candidate, -1),
				).toEqual({ consumed: false });
			}
			expect(
				typeahead.handleKeydown(keydown(" "), candidates, (candidate) => candidate, -1),
			).toEqual({ consumed: false });
			expect(
				typeahead.handleKeydown(
					keydown("a", { isComposing: true }),
					candidates,
					(candidate) => candidate,
					-1,
				),
			).toEqual({ consumed: false });
			expect(
				typeahead.handleKeydown(keyCode229(), candidates, (candidate) => candidate, -1),
			).toEqual({ consumed: false });
		} finally {
			typeahead.disconnect();
		}
	});

	test("[listbox-typeahead] Accumulates two different characters to narrow prefix matching", () => {
		const typeahead = createTypeahead();
		const candidates = ["Alpha", "Beta", "Bravo", "Charlie"];
		try {
			expect(
				typeahead.handleKeydown(keydown("b"), candidates, (candidate) => candidate, -1),
			).toEqual({
				consumed: true,
				index: 1,
			});
			expect(
				typeahead.handleKeydown(keydown("r"), candidates, (candidate) => candidate, 1),
			).toEqual({
				consumed: true,
				index: 2,
			});
		} finally {
			typeahead.disconnect();
		}
	});

	test("Clears the buffer after 500 ms without input", async () => {
		const typeahead = createTypeahead();
		const candidates = ["Alpha", "Beta"];
		try {
			expect(
				typeahead.handleKeydown(keydown("b"), candidates, (candidate) => candidate, -1),
			).toEqual({
				consumed: true,
				index: 1,
			});
			await wait(550);
			expect(
				typeahead.handleKeydown(keydown("a"), candidates, (candidate) => candidate, 1),
			).toEqual({
				consumed: true,
				index: 0,
			});
		} finally {
			typeahead.disconnect();
		}
	});
});
