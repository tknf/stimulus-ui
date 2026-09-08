export const installEventLog = (main: HTMLElement) => {
	const eventNames = (main.dataset.catalogEvents ?? "").split(/\s+/).filter(Boolean);
	const log = main.querySelector<HTMLUListElement>(".catalog-events");

	if (log === null) return;

	for (const eventName of eventNames) {
		document.addEventListener(eventName, (event) => {
			if (!(event.target instanceof HTMLElement) || !main.contains(event.target)) return;

			const entry = document.createElement("li");
			const controller = event.target.dataset.controller ?? "";
			const detail = event instanceof CustomEvent ? JSON.stringify(event.detail) : "";
			entry.textContent = `${event.type} ${controller} ${detail}`;
			log.append(entry);
		});
	}
};
