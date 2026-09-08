import type { UserEvent } from "vite-plus/test/browser/context";

export type CatalogEngine = "chromium" | "firefox" | "webkit";

export type CatalogScenarioContext = {
	main: HTMLElement;
	userEvent: UserEvent;
	settle: () => Promise<void>;
};

export type CatalogScenarioSkip = {
	engine: CatalogEngine;
	token: string;
	reason: string;
};

export type CatalogScenario = {
	run: (context: CatalogScenarioContext) => Promise<void>;
	skips: readonly CatalogScenarioSkip[];
};

export const required = <ElementType extends Element>(
	main: HTMLElement,
	selector: string,
): ElementType => {
	const element = main.querySelector<ElementType>(selector);
	if (element === null) throw new Error(`Missing ${selector} in catalog scenario`);
	return element;
};

export const requiredAll = <ElementType extends Element>(
	main: HTMLElement,
	selector: string,
): ElementType[] => {
	const elements = Array.from(main.querySelectorAll<ElementType>(selector));
	if (elements.length === 0) throw new Error(`Missing ${selector} in catalog scenario`);
	return elements;
};

export const press = async (userEvent: UserEvent, keys: readonly string[]) => {
	for (const key of keys) await userEvent.keyboard(`{${key}}`);
};

export const syncInput = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
};
