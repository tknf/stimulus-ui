/// <reference types="vite-plus/client" />

import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { server, userEvent } from "vite-plus/test/browser/context";
import DisclosureController from "../src/disclosure_controller";
import markup from "./compositions/navigation_menu.html?raw";
import NavigationDemoController from "./compositions/navigation_menu_controller";

let application: Application;

const mount = async () => {
	document.body.innerHTML = markup;
	const details = Array.from(document.querySelectorAll("details"));
	const first = details[0];
	const second = details[1];
	const trigger = first?.querySelector("summary");
	const nextTrigger = second?.querySelector("summary");
	const links = first?.querySelectorAll("a");
	const link = links?.[0];
	const lastLink = links?.[1];
	const outside = document.querySelector("button");
	if (!first || !second || !trigger || !nextTrigger || !link || !lastLink || !outside) {
		throw new Error("navigation menu の検証用 markup がありません");
	}
	// Pointer position persists across tests, so normalize the initial hover condition.
	await userEvent.hover(outside);
	application = Application.start();
	application.register("disclosure", DisclosureController);
	application.register("navigation-demo", NavigationDemoController);
	await expect.poll(() => first.dataset.state).toBe("closed");
	return { first, second, trigger, nextTrigger, link, lastLink, outside };
};

beforeEach(() => {
	vi.spyOn(console, "warn");
});

afterEach(() => {
	application.stop();
	document.body.innerHTML = "";
	expect(console.warn).not.toHaveBeenCalled();
	vi.restoreAllMocks();
});

describe("Navigation menu composition", () => {
	test("Opens and closes with Enter/Space, reaches links with Tab, and returns to the trigger with Escape", async () => {
		const { first, trigger, link } = await mount();
		trigger.focus();
		await userEvent.keyboard("{Enter}");
		expect(first.open).toBe(true);
		// WebKit native link navigation uses Option+Tab; see the engine-difference notes.
		await userEvent.keyboard(server.browser === "webkit" ? "{Alt>}{Tab}{/Alt}" : "{Tab}");
		expect(document.activeElement).toBe(link);
		await userEvent.keyboard("{Escape}");
		expect(first.open).toBe(false);
		expect(document.activeElement).toBe(trigger);
		await userEvent.keyboard(" ");
		expect(first.open).toBe(true);
		await userEvent.keyboard(" ");
		expect(first.open).toBe(false);
	});

	test("Opens on hover, stays open while entering the panel, and closes on exit", async () => {
		const { first, trigger, link, outside } = await mount();
		outside.focus();
		await userEvent.hover(trigger);
		expect(first.open).toBe(true);
		expect(document.activeElement).toBe(outside);
		await userEvent.hover(link);
		expect(first.open).toBe(true);
		await userEvent.hover(outside);
		expect(first.open).toBe(false);
	});

	test("Escape closes hover content without moving focus even when focus is outside navigation", async () => {
		const { first, trigger, outside } = await mount();
		outside.focus();
		await userEvent.hover(trigger);
		expect(first.open).toBe(true);
		await userEvent.keyboard("{Escape}");
		expect(first.open).toBe(false);
		expect(document.activeElement).toBe(outside);
	});

	test("Stays open on pointer exit while the panel has focus and closes when Tab enters the next disclosure", async () => {
		const { first, second, trigger, nextTrigger, link, lastLink, outside } = await mount();
		await userEvent.hover(trigger);
		link.focus();
		await userEvent.hover(outside);
		expect(first.open).toBe(true);
		lastLink.focus();
		await userEvent.tab();
		expect(document.activeElement).toBe(nextTrigger);
		expect(first.open).toBe(false);
		await userEvent.keyboard("{Enter}");
		expect(second.open).toBe(true);
		outside.focus();
		expect(second.open).toBe(false);
	});

	test("Escape while hovering keeps it closed, and synthetic or IME Escape is ignored", async () => {
		const { first, trigger, link } = await mount();
		await userEvent.hover(trigger);
		link.focus();
		link.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(first.open).toBe(true);
		link.addEventListener(
			"keydown",
			(event) => Object.defineProperty(event, "keyCode", { value: 229 }),
			{ capture: true, once: true },
		);
		await userEvent.keyboard("{Escape}");
		expect(first.open).toBe(true);
		await userEvent.keyboard("{Escape}");
		expect(first.open).toBe(false);
		expect(document.activeElement).toBe(trigger);
	});
});
