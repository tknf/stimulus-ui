import { required, type CatalogScenario } from "./types";

const BROKEN_IMAGE = "data:image/png;base64,broken";
const VALID_IMAGE =
	"data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22%3E%3C/svg%3E";

export const scenario: CatalogScenario = {
	async run({ main, settle }) {
		const root = required<HTMLElement>(main, '[data-controller="avatar"]');
		const image = required<HTMLImageElement>(root, '[data-avatar-target="image"]');

		Object.defineProperty(image, "complete", { configurable: true, get: () => false });
		Object.defineProperty(image, "naturalWidth", { configurable: true, get: () => 0 });
		image.src = VALID_IMAGE;
		await Promise.resolve();
		await new Promise<void>((resolve) => queueMicrotask(resolve));
		Reflect.deleteProperty(image, "complete");
		Reflect.deleteProperty(image, "naturalWidth");
		await settle();
		image.src = BROKEN_IMAGE;
		await settle();
		image.src = VALID_IMAGE;
		await settle();
	},
	skips: [],
};
