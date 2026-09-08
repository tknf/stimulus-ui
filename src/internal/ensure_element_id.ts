const counters = new WeakMap<Document, Map<string, number>>();

export const ensureElementId = (element: HTMLElement, prefix: string): string => {
	if (element.id !== "") {
		return element.id;
	}

	const document = element.ownerDocument;
	let documentCounters = counters.get(document);
	if (documentCounters === undefined) {
		documentCounters = new Map<string, number>();
		counters.set(document, documentCounters);
	}

	let counter = documentCounters.get(prefix) ?? 0;
	let id = "";
	do {
		counter += 1;
		id = `${prefix}-${counter}`;
	} while (document.getElementById(id) !== null);

	documentCounters.set(prefix, counter);
	element.id = id;
	return id;
};
