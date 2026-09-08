import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import FileDropController from "../src/file_drop_controller";

type FileDropEvent = CustomEvent<{ files: File[] }>;

let application: Application;
let originalWarn: typeof console.warn;

const settle = async () => {
	await Promise.resolve();
	await new Promise<void>((resolve) => queueMicrotask(resolve));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const mount = async (rootAttributes = "", inputAttributes = "") => {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<div data-controller="file-drop" ${rootAttributes}><span data-testid="child">zone</span><input type="file" data-file-drop-target="input" aria-label="ファイル" ${inputAttributes}></div>`,
	);
	await settle();

	const root = document.body.lastElementChild;
	const input = root?.querySelector('[data-file-drop-target="input"]');
	const child = root?.querySelector('[data-testid="child"]');
	if (
		!(root instanceof HTMLElement) ||
		!(input instanceof HTMLInputElement) ||
		!(child instanceof HTMLElement)
	) {
		throw new Error("file-drop を作成できませんでした");
	}
	return { root, input, child };
};

const mountRaw = async (markup: string) => {
	document.body.insertAdjacentHTML("beforeend", markup);
	await settle();
	const root = document.body.lastElementChild;
	if (!(root instanceof HTMLElement)) throw new Error("file-drop root がありません");
	return root;
};

const dataTransferWithFiles = (...files: File[]) => {
	const dataTransfer = new DataTransfer();
	for (const file of files) dataTransfer.items.add(file);
	return dataTransfer;
};

const dataTransferWithText = () => {
	const dataTransfer = new DataTransfer();
	dataTransfer.items.add("text", "text/plain");
	return dataTransfer;
};

const dragEvent = (type: string, dataTransfer: DataTransfer) =>
	new DragEvent(type, {
		bubbles: true,
		cancelable: true,
		dataTransfer,
	});

beforeEach(() => {
	document.body.innerHTML = "";
	originalWarn = console.warn;
	application = Application.start();
	application.register("file-drop", FileDropController);
});

afterEach(() => {
	vi.restoreAllMocks();
	console.warn = originalWarn;
	application.stop();
	document.body.innerHTML = "";
});

describe("file-drop", () => {
	test("[file-drop-state-sync][file-drop-state-sync-negative] Synchronizes dragover/idle across descendant pointer movement and Files detection while preserving authored attributes", async () => {
		const { root, input, child } = await mount(
			'data-state="authored" data-preserve="yes" aria-label="ファイルを受け付けます" style="--custom: preserved"',
			'id="authored-file" name="upload"',
		);

		expect(root.dataset.state).toBe("idle");
		expect(root.dataset.preserve).toBe("yes");
		expect(root.getAttribute("aria-label")).toBe("ファイルを受け付けます");
		expect(root.style.getPropertyValue("--custom")).toBe("preserved");
		expect(input.id).toBe("authored-file");
		expect(input.name).toBe("upload");

		const fileData = dataTransferWithFiles(new File(["a"], "a.txt", { type: "text/plain" }));
		const enter = dragEvent("dragenter", fileData);
		root.dispatchEvent(enter);
		expect(enter.defaultPrevented).toBe(true);
		expect(root.dataset.state).toBe("dragover");

		const over = dragEvent("dragover", fileData);
		root.dispatchEvent(over);
		expect(over.defaultPrevented).toBe(true);
		expect(root.dataset.state).toBe("dragover");

		child.dispatchEvent(dragEvent("dragenter", fileData));
		expect(root.dataset.state).toBe("dragover");
		child.dispatchEvent(dragEvent("dragleave", fileData));
		expect(root.dataset.state).toBe("dragover");
		root.dispatchEvent(dragEvent("dragleave", fileData));
		expect(root.dataset.state).toBe("idle");

		const textData = dataTransferWithText();
		const textEnter = dragEvent("dragenter", textData);
		const textOver = dragEvent("dragover", textData);
		root.dispatchEvent(textEnter);
		root.dispatchEvent(textOver);
		expect(textEnter.defaultPrevented).toBe(false);
		expect(textOver.defaultPrevented).toBe(false);
		expect(root.dataset.state).toBe("idle");
	});

	test("[file-drop-intake][file-drop-intake-negative] Accepts drops and checks beforedrop/drop order, detail, cancellation, and absence of native events", async () => {
		const { root, input } = await mount();
		const file = new File(["hello"], "a.txt", { type: "text/plain" });
		const dataTransfer = dataTransferWithFiles(file);
		const order: string[] = [];
		const beforeDetails: File[][] = [];
		const dropDetails: File[][] = [];
		let nativeInputEvents = 0;
		let nativeChangeEvents = 0;
		input.addEventListener("input", () => {
			nativeInputEvents += 1;
		});
		input.addEventListener("change", () => {
			nativeChangeEvents += 1;
		});
		root.addEventListener("file-drop:beforedrop", (event) => {
			const customEvent = event as FileDropEvent;
			order.push("before");
			beforeDetails.push(customEvent.detail.files);
			expect(customEvent.bubbles).toBe(true);
			expect(customEvent.cancelable).toBe(true);
			if (beforeDetails.length === 1) expect(input.files?.length ?? 0).toBe(0);
		});
		root.addEventListener("file-drop:drop", (event) => {
			const customEvent = event as FileDropEvent;
			order.push("drop");
			dropDetails.push(customEvent.detail.files);
			expect(customEvent.bubbles).toBe(true);
			expect(customEvent.cancelable).toBe(false);
		});

		root.dispatchEvent(dragEvent("drop", dataTransfer));
		expect(order).toEqual(["before", "drop"]);
		expect(beforeDetails).toEqual([[file]]);
		expect(dropDetails).toEqual([[file]]);
		expect(input.files?.length).toBe(1);
		expect(input.files?.[0]).toBe(file);
		expect(nativeInputEvents).toBe(0);
		expect(nativeChangeEvents).toBe(0);
		expect(root.dataset.state).toBe("idle");

		const previousFiles = input.files;
		root.addEventListener("file-drop:beforedrop", (event) => event.preventDefault(), {
			once: true,
		});
		const cancelledFile = new File(["cancelled"], "cancelled.txt");
		root.dispatchEvent(dragEvent("drop", dataTransferWithFiles(cancelledFile)));
		expect(order).toEqual(["before", "drop", "before"]);
		expect(dropDetails).toHaveLength(1);
		expect(input.files).toBe(previousFiles);
		expect(input.files?.[0]).toBe(file);
		expect(nativeInputEvents).toBe(0);
		expect(nativeChangeEvents).toBe(0);
		expect(root.dataset.state).toBe("idle");
	});

	test("[file-drop-multiple-enforce][file-drop-multiple-enforce-negative] Rejects multiple-file drops without multiple and accepts them with it", async () => {
		const first = new File(["a"], "a.txt");
		const second = new File(["b"], "b.txt");
		const single = await mount();
		let singleEvents = 0;
		single.root.addEventListener("file-drop:beforedrop", () => {
			singleEvents += 1;
		});
		single.root.addEventListener("file-drop:drop", () => {
			singleEvents += 1;
		});
		single.root.dispatchEvent(dragEvent("dragenter", dataTransferWithFiles(first, second)));
		expect(single.root.dataset.state).toBe("dragover");
		single.root.dispatchEvent(dragEvent("drop", dataTransferWithFiles(first, second)));
		expect(single.input.files?.length ?? 0).toBe(0);
		expect(singleEvents).toBe(0);
		expect(single.root.dataset.state).toBe("idle");

		const multiple = await mount("", "multiple");
		let multipleEvents = 0;
		multiple.root.addEventListener("file-drop:beforedrop", () => {
			multipleEvents += 1;
		});
		multiple.root.addEventListener("file-drop:drop", () => {
			multipleEvents += 1;
		});
		multiple.root.dispatchEvent(dragEvent("drop", dataTransferWithFiles(first, second)));
		expect(multiple.input.files?.length).toBe(2);
		expect(multiple.input.files?.[0]).toBe(first);
		expect(multiple.input.files?.[1]).toBe(second);
		expect(multipleEvents).toBe(2);
	});

	test("[file-drop-disabled-guard][file-drop-disabled-guard-negative] Neither changes state nor accepts drops when the input is disabled", async () => {
		const { root, input } = await mount("", "disabled");
		const file = new File(["a"], "a.txt");
		let events = 0;
		root.addEventListener("file-drop:beforedrop", () => {
			events += 1;
		});
		root.addEventListener("file-drop:drop", () => {
			events += 1;
		});

		const enter = dragEvent("dragenter", dataTransferWithFiles(file));
		root.dispatchEvent(enter);
		expect(enter.defaultPrevented).toBe(false);
		expect(root.dataset.state).toBe("idle");

		root.dispatchEvent(dragEvent("drop", dataTransferWithFiles(file)));
		expect(input.files?.length ?? 0).toBe(0);
		expect(events).toBe(0);
		expect(root.dataset.state).toBe("idle");
	});

	test("[file-drop-semantic-validation][file-drop-semantic-validation-negative] Warns once and disables invalid markup without throwing", async () => {
		const warnings: string[] = [];
		console.warn = (message?: unknown) => warnings.push(String(message));
		try {
			const invalidMarkups = [
				'<input type="file" data-controller="file-drop">',
				'<div data-controller="file-drop"></div>',
				'<div data-controller="file-drop"><input type="file" data-file-drop-target="input"><input type="file" data-file-drop-target="input"></div>',
				'<div data-controller="file-drop"><input type="text" data-file-drop-target="input"></div>',
			];

			for (const [index, markup] of invalidMarkups.entries()) {
				const root = await mountRaw(markup);
				expect(warnings).toHaveLength(index + 1);
				expect(warnings[index]).toContain("file-drop controller");
				expect(warnings[index]).toContain('native <input type="file">');
				expect(warnings[index]).toContain("Enhancement has been disabled");
				expect(root.dataset.state).toBeUndefined();

				const event = dragEvent("dragenter", dataTransferWithFiles(new File(["a"], "a.txt")));
				expect(() => root.dispatchEvent(event)).not.toThrow();
				expect(event.defaultPrevented).toBe(false);
			}

			const { root: validRoot, input: validInput } = await mount();
			validInput.remove();
			await settle();
			expect(validRoot.dataset.state).toBeUndefined();
			validRoot.insertAdjacentHTML(
				"beforeend",
				'<input type="file" data-file-drop-target="input" aria-label="交換後のファイル">',
			);
			await settle();
			expect(validRoot.dataset.state).toBe("idle");
			const replacement = validRoot.querySelector<HTMLInputElement>(
				'[data-file-drop-target="input"]',
			);
			if (!replacement) throw new Error("交換後の input がありません");
			validRoot.dispatchEvent(dragEvent("drop", dataTransferWithFiles(new File(["a"], "a.txt"))));
			expect(replacement.files?.length).toBe(1);
		} finally {
			console.warn = originalWarn;
		}
	});

	test("[file-drop-disconnect-cleanup][file-drop-disconnect-cleanup-negative] Resets counters and avoids duplicate listeners across disconnect and reconnect", async () => {
		const { root, input } = await mount();
		const removeEventListener = vi.spyOn(root, "removeEventListener");
		let beforeCount = 0;
		let dropCount = 0;
		root.addEventListener("file-drop:beforedrop", () => {
			beforeCount += 1;
		});
		root.addEventListener("file-drop:drop", () => {
			dropCount += 1;
		});
		const file = new File(["a"], "a.txt");

		root.dispatchEvent(dragEvent("dragenter", dataTransferWithFiles(file)));
		expect(root.dataset.state).toBe("dragover");
		root.removeAttribute("data-controller");
		await settle();
		expect(root.dataset.state).toBe("dragover");
		expect(removeEventListener).toHaveBeenCalledWith("dragenter", expect.any(Function));
		const disconnectedDrop = dragEvent("drop", dataTransferWithFiles(file));
		root.dispatchEvent(disconnectedDrop);
		expect(disconnectedDrop.defaultPrevented).toBe(false);
		expect(beforeCount).toBe(0);
		expect(dropCount).toBe(0);
		expect(input.files?.length ?? 0).toBe(0);

		root.setAttribute("data-controller", "file-drop");
		await settle();
		expect(root.dataset.state).toBe("idle");
		root.dispatchEvent(dragEvent("dragover", dataTransferWithFiles(file)));
		expect(root.dataset.state).toBe("idle");

		root.dispatchEvent(dragEvent("dragenter", dataTransferWithFiles(file)));
		root.dispatchEvent(dragEvent("drop", dataTransferWithFiles(file)));
		expect(beforeCount).toBe(1);
		expect(dropCount).toBe(1);
		expect(input.files?.length).toBe(1);
	});
});
