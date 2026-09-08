import { ensureElementId } from "./ensure_element_id";

export type ListboxOptionEntry = {
	option: HTMLLIElement;
	value: string;
};

export const isEnabledVisibleOption = (option: HTMLLIElement) =>
	!option.hidden && option.getAttribute("aria-disabled") !== "true";

export const enabledVisibleOptions = (
	options: readonly HTMLLIElement[],
	valueOf: (option: HTMLLIElement) => string,
): ListboxOptionEntry[] =>
	options.filter(isEnabledVisibleOption).map((option) => ({ option, value: valueOf(option) }));

export const nextListboxOption = (
	options: readonly ListboxOptionEntry[],
	active: HTMLLIElement | undefined,
	key: "ArrowUp" | "ArrowDown" | "Home" | "End",
) => {
	if (options.length === 0) {
		return undefined;
	}
	if (key === "Home") {
		return options[0]?.option;
	}
	if (key === "End") {
		return options.at(-1)?.option;
	}

	const index = options.findIndex(({ option }) => option === active);
	const direction = key === "ArrowDown" ? 1 : -1;
	const nextIndex =
		index < 0
			? direction === 1
				? 0
				: options.length - 1
			: (index + direction + options.length) % options.length;
	return options[nextIndex]?.option;
};

export const syncListboxActiveDescendant = (
	owner: HTMLElement,
	active: HTMLLIElement | undefined,
	options: readonly ListboxOptionEntry[],
	prefix: string,
) => {
	const activeEntry = options.find(({ option }) => option === active);
	if (!activeEntry) {
		owner.removeAttribute("aria-activedescendant");
		return;
	}

	owner.setAttribute("aria-activedescendant", ensureElementId(activeEntry.option, prefix));
};
