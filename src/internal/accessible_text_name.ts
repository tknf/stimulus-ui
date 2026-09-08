export const hasAccessibleTextName = (element: HTMLElement, allowText: boolean) => {
	const labels = (element.getAttribute("aria-labelledby") ?? "")
		.split(/\s+/)
		.filter(Boolean)
		.map((id) => element.ownerDocument.getElementById(id))
		.filter((label) => label !== null);
	if (labels.length > 0) {
		// Include subtree text when the directly referenced label itself is hidden.
		return labels.some((label) => hasTextName(label, isHiddenNameSource(label), true));
	}
	return (
		(element.getAttribute("aria-label") ?? "").trim() !== "" || (allowText && hasTextName(element))
	);
};

const isHiddenNameSource = (element: Element) => {
	const style = getComputedStyle(element);
	return (
		(element instanceof HTMLElement && element.hidden !== false) ||
		element.getAttribute("aria-hidden") === "true" ||
		style.display === "none" ||
		style.visibility === "hidden" ||
		style.visibility === "collapse" ||
		style.contentVisibility === "hidden"
	);
};

const hasTextName = (element: Element, includeHidden = false, includeSvg = false): boolean =>
	Array.from(element.childNodes).some((node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			return (node.textContent ?? "").trim() !== "";
		}
		if (!(node instanceof Element) || (!includeSvg && node instanceof SVGElement)) {
			return false;
		}
		if (
			["SCRIPT", "STYLE", "TEMPLATE"].includes(node.tagName.toUpperCase()) ||
			(!includeHidden && isHiddenNameSource(node))
		) {
			return false;
		}
		return hasTextName(node, includeHidden, includeSvg);
	});
