export const wrapNavigationIndex = (index: number, length: number): number | undefined => {
	if (length <= 0) {
		return undefined;
	}
	return ((index % length) + length) % length;
};

export const horizontalArrowDelta = (key: string, direction: string): -1 | 1 | undefined => {
	if (key !== "ArrowLeft" && key !== "ArrowRight") {
		return undefined;
	}
	if (key === "ArrowLeft") {
		return direction === "rtl" ? 1 : -1;
	}
	return direction === "rtl" ? -1 : 1;
};
