// keyCode 229 identifies IME keydown (UI Events §7.3.1). Engines differ in key and isComposing; see the IME section in docs/notes/browser-engine-differences.md.
export const isImeKeydown = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229;
