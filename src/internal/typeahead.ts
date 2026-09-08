import { isImeKeydown } from "./ime";

export type TypeaheadResult = {
	consumed: boolean;
	index?: number;
};

export type Typeahead = {
	handleKeydown: <T>(
		event: KeyboardEvent,
		candidates: readonly T[],
		labelOf: (candidate: T) => string,
		currentIndex: number,
	) => TypeaheadResult;
	disconnect: () => void;
};

const bufferTimeout = 500;

export const createTypeahead = (): Typeahead => {
	let buffer = "";
	let timer: ReturnType<typeof setTimeout> | undefined;

	const clearBuffer = () => {
		buffer = "";
		timer = undefined;
	};

	const scheduleBufferClear = () => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		timer = setTimeout(clearBuffer, bufferTimeout);
	};

	const handleKeydown = <T>(
		event: KeyboardEvent,
		candidates: readonly T[],
		labelOf: (candidate: T) => string,
		currentIndex: number,
	): TypeaheadResult => {
		if (
			event.key.length !== 1 ||
			event.key === " " ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			isImeKeydown(event)
		) {
			return { consumed: false };
		}

		const key = event.key.toLowerCase();
		const previous = buffer.toLowerCase();
		buffer =
			previous !== "" && previous.split("").every((character) => character === key)
				? key
				: `${buffer}${event.key}`;
		scheduleBufferClear();

		if (candidates.length === 0) {
			return { consumed: true };
		}

		const search = buffer.toLowerCase();
		const start =
			(((currentIndex + 1) % candidates.length) + candidates.length) % candidates.length;
		for (let offset = 0; offset < candidates.length; offset += 1) {
			const index = (start + offset) % candidates.length;
			const candidate = candidates[index];
			if (candidate !== undefined && labelOf(candidate).toLowerCase().startsWith(search)) {
				return { consumed: true, index };
			}
		}

		return { consumed: true };
	};

	const disconnect = () => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		clearBuffer();
	};

	return { handleKeydown, disconnect };
};
