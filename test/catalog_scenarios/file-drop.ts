import { required, type CatalogScenario } from "./types";

const dragEvent = (type: string, dataTransfer: DataTransfer) =>
	new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });

export const scenario: CatalogScenario = {
	async run({ main, settle }) {
		const root = required<HTMLElement>(main, '[data-controller="file-drop"]');
		const transfer = new DataTransfer();
		transfer.items.add(new File(["catalog"], "catalog.txt", { type: "text/plain" }));

		root.dispatchEvent(dragEvent("dragenter", transfer));
		root.dispatchEvent(dragEvent("dragleave", transfer));
		root.dispatchEvent(dragEvent("drop", transfer));
		await settle();
	},
	skips: [],
};
