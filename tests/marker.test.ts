// @vitest-environment jsdom
/*
 * DOM-level tests for the marker invariants (plan U1 / AE1): exactly one
 * .prozen-active-leaf at any time, idempotent re-activation, tolerance of
 * leaves without a containerEl, and the entry-animation window ending on
 * migration. Exercises the real updateMarker/clearAllMarkers code in
 * main.ts against jsdom, with the obsidian module stubbed out.
 */
import { beforeEach, describe, expect, it } from "vitest";
import Prozen from "../main";

const MARKER = "prozen-active-leaf";
const ROOT = { root: true };

interface FakeLeaf {
	view: { getViewType: () => string };
	getRoot: () => unknown;
	containerEl?: HTMLElement;
}

function makeLeaf(viewType = "markdown", withEl = true): FakeLeaf {
	const leaf: FakeLeaf = {
		view: { getViewType: () => viewType },
		getRoot: () => ROOT,
	};
	if (withEl) {
		const el = document.createElement("div");
		el.classList.add("workspace-leaf");
		document.body.appendChild(el);
		leaf.containerEl = el;
	}
	return leaf;
}

function makePlugin(): any {
	const plugin: any = Object.create(Prozen.prototype);
	plugin.sessionActive = true;
	plugin.enteringTimer = null;
	plugin.app = { workspace: { rootSplit: ROOT } };
	return plugin;
}

function markerCount(): number {
	return document.querySelectorAll("." + MARKER).length;
}

describe("marker invariants (updateMarker/clearAllMarkers)", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		document.body.className = "";
	});

	it("marks the target leaf's container (AE1)", () => {
		const plugin = makePlugin();
		const a = makeLeaf();
		plugin.updateMarker(a);
		expect(a.containerEl!.classList.contains(MARKER)).toBe(true);
		expect(markerCount()).toBe(1);
	});

	it("is idempotent for the same leaf — still exactly one marker", () => {
		const plugin = makePlugin();
		const a = makeLeaf();
		plugin.updateMarker(a);
		plugin.updateMarker(a);
		expect(a.containerEl!.classList.contains(MARKER)).toBe(true);
		expect(markerCount()).toBe(1);
	});

	it("moves the marker on migration — old leaf loses it, exactly one remains", () => {
		const plugin = makePlugin();
		const a = makeLeaf();
		const b = makeLeaf();
		plugin.updateMarker(a);
		plugin.updateMarker(b);
		expect(a.containerEl!.classList.contains(MARKER)).toBe(false);
		expect(b.containerEl!.classList.contains(MARKER)).toBe(true);
		expect(markerCount()).toBe(1);
	});

	it("clears stray duplicate markers before setting the new one", () => {
		const plugin = makePlugin();
		const stray = document.createElement("div");
		stray.classList.add(MARKER);
		document.body.appendChild(stray);
		const a = makeLeaf();
		plugin.updateMarker(a);
		expect(markerCount()).toBe(1);
		expect(a.containerEl!.classList.contains(MARKER)).toBe(true);
	});

	it("tolerates a leaf without a containerEl — no throw, no marker", () => {
		const plugin = makePlugin();
		const bare = makeLeaf("markdown", false);
		expect(() => plugin.updateMarker(bare)).not.toThrow();
		expect(markerCount()).toBe(0);
	});

	it("does not mark an empty view (session stays dormant)", () => {
		const plugin = makePlugin();
		const empty = makeLeaf("empty");
		plugin.updateMarker(empty);
		expect(markerCount()).toBe(0);
	});

	it("ends the entry-animation window when the marker migrates (AC-18)", () => {
		const plugin = makePlugin();
		document.body.classList.add("prozen-entering");
		const a = makeLeaf();
		const b = makeLeaf();
		plugin.updateMarker(a);
		expect(document.body.classList.contains("prozen-entering")).toBe(true);
		plugin.updateMarker(b);
		expect(document.body.classList.contains("prozen-entering")).toBe(false);
	});
});
