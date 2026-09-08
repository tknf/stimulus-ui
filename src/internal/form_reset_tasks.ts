// Defer to a task because reset-listener microtasks run before native reset.
export const createFormResetTasks = () => {
	const timers = new Set<ReturnType<typeof setTimeout>>();

	const schedule = (callback: () => void) => {
		const timer = setTimeout(() => {
			timers.delete(timer);
			callback();
		}, 0);
		timers.add(timer);
	};

	const cancel = () => {
		for (const timer of timers) {
			clearTimeout(timer);
		}
		timers.clear();
	};

	return { schedule, cancel };
};
