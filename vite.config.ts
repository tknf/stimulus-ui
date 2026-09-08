import { defineConfig } from "vite-plus";
import { defineBrowserCommand, playwright } from "vite-plus/test/browser-playwright";
import { createEngineReporter } from "./scripts/engine_reporter.mjs";

export default defineConfig({
	staged: {
		// Check the whole repository without filenames, including documentation-only changes.
		"*": () => "vp run check",
	},
	fmt: {},
	lint: {
		jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
		rules: { "vite-plus/prefer-vite-plus-imports": "error" },
		options: { typeAware: true, typeCheck: true },
		overrides: [{ files: ["src/**/*.ts"], rules: { curly: ["error", "all"] } }],
	},
	pack: {
		dts: true,
		entry: ["src/index.ts"],
		format: ["esm"],
	},
	test: {
		fileParallelism: false,
		// engine-results.json preserves test names, engines, and assertions from one run.
		// Keep standard JSON for negative controls and outputFile at the top level,
		// allowing check_negative_controls.mjs CLI --outputFile to take precedence.
		reporters: ["default", "json", createEngineReporter()],
		outputFile: { json: "test-results/results.json" },
		browser: {
			commands: {
				dialogPointer: defineBrowserCommand(
					async (
						context,
						selector: string,
						action: "down" | "move" | "up" | "release",
						x: number,
						y: number,
					) => {
						if (action === "release") {
							await context.page.mouse.up();
							return;
						}
						const box = await (await context.frame()).locator(selector).boundingBox();
						if (box === null) throw new Error("The dialog container is not visible");
						// Use fractions of the bounding box, including Browser Mode iframe scaling.
						await context.page.mouse.move(box.x + box.width * x, box.y + box.height * y);
						if (action === "down") await context.page.mouse.down();
						if (action === "up") await context.page.mouse.up();
					},
				),
				colorPointer: defineBrowserCommand(
					async (
						context,
						selector: string,
						action: "down" | "move" | "up" | "release",
						x: number,
						y: number,
					) => {
						if (action === "release") {
							await context.page.mouse.up();
							return;
						}
						const target = (await context.frame()).locator(selector);
						if (action === "down") await target.scrollIntoViewIfNeeded();
						const box = await target.boundingBox();
						if (box === null) throw new Error("The color-picker interaction target is not visible");
						await context.page.mouse.move(box.x + box.width * x, box.y + box.height * y);
						if (action === "down") await context.page.mouse.down();
						if (action === "up") await context.page.mouse.up();
					},
				),
				reorderPointer: defineBrowserCommand(
					async (
						context,
						selector: string,
						action: "down" | "move" | "up" | "release",
						x: number,
						y: number,
					) => {
						if (action === "release") {
							await context.page.mouse.up();
							return;
						}
						const target = (await context.frame()).locator(selector);
						if (action === "down") await target.scrollIntoViewIfNeeded();
						const box = await target.boundingBox();
						if (box === null) throw new Error("The list-reorder interaction target is not visible");
						await context.page.mouse.move(box.x + box.width * x, box.y + box.height * y);
						if (action === "down") await context.page.mouse.down();
						if (action === "up") await context.page.mouse.up();
					},
				),
				cropperPointer: defineBrowserCommand(
					async (
						context,
						selector: string,
						action: "down" | "move" | "up",
						x: number,
						y: number,
					) => {
						const element = (await context.frame()).locator(selector);
						const box = await element.boundingBox();
						if (box === null) throw new Error("The pointer interaction target is not visible");
						await context.page.mouse.move(box.x + x, box.y + y);
						if (action === "down") await context.page.mouse.down();
						if (action === "up") await context.page.mouse.up();
					},
				),
			},
			enabled: true,
			headless: true,
			instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
			provider: playwright(),
		},
	},
});
