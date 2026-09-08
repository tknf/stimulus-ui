import { required, requiredAll, type CatalogScenario } from "./types";

export const scenario: CatalogScenario = {
	async run({ main, settle, userEvent }) {
		const carousels = requiredAll<HTMLElement>(main, '[data-controller="carousel"]');
		const first = carousels[0];
		const timed = carousels[1];
		if (first === undefined || timed === undefined)
			throw new Error("Missing carousel configurations");

		await userEvent.click(required<HTMLButtonElement>(first, '[data-carousel-target="next"]'));
		const play = required<HTMLButtonElement>(timed, '[data-carousel-target="play"]');
		await userEvent.click(play);
		await userEvent.click(play);
		await settle();
	},
	skips: [],
};
