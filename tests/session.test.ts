import { describe, expect, it } from "vitest";
import {
	decideMarker,
	decideToggle,
	isPersistedSessionActive,
	shouldEngageWrapper,
	shouldExitOnEsc,
	shouldExitOsFullscreen,
	type LeafContext,
} from "../src/session";

const note = (over: Partial<LeafContext> = {}): LeafContext => ({
	viewKind: "other",
	inRootSplit: true,
	inMainWindow: true,
	...over,
});

describe("decideToggle", () => {
	it("enters on a note in the root split of the main window", () => {
		expect(decideToggle(false, note())).toBe("enter");
	});

	it("enters on a graph view", () => {
		expect(decideToggle(false, note({ viewKind: "graph" }))).toBe("enter");
	});

	it("does not enter on an empty view", () => {
		expect(decideToggle(false, note({ viewKind: "empty" }))).toBe("noop");
	});

	it("does not enter with no active leaf", () => {
		expect(decideToggle(false, null)).toBe("noop");
	});

	it("does not enter from a sidebar leaf", () => {
		expect(decideToggle(false, note({ inRootSplit: false }))).toBe("noop");
	});

	it("does not enter from a popout-window leaf", () => {
		expect(decideToggle(false, note({ inMainWindow: false }))).toBe("noop");
	});

	// T3/T4: toggle-off is unconditional — the exit trap the old code had.
	it("exits while active even when the active view is empty", () => {
		expect(decideToggle(true, note({ viewKind: "empty" }))).toBe("exit");
	});

	it("exits while active even with no active leaf", () => {
		expect(decideToggle(true, null)).toBe("exit");
	});

	it("exits while active from a popout leaf", () => {
		expect(decideToggle(true, note({ inMainWindow: false }))).toBe("exit");
	});
});

describe("decideMarker", () => {
	it("ignores every event while the session is off", () => {
		expect(decideMarker(false, note())).toBe("ignore");
	});

	it("moves the marker to a newly active note (AE1)", () => {
		expect(decideMarker(true, note())).toBe("move");
	});

	it("moves the marker to a graph leaf (AE2)", () => {
		expect(decideMarker(true, note({ viewKind: "graph" }))).toBe("move");
	});

	it("clears the marker on an empty view but keeps the session (AE3)", () => {
		expect(decideMarker(true, note({ viewKind: "empty" }))).toBe("clear");
	});

	// T27: the API allows a null leaf.
	it("ignores a null leaf", () => {
		expect(decideMarker(true, null)).toBe("ignore");
	});

	// T9: sidebar focus must not steal or drop the overlay.
	it("ignores sidebar leaves", () => {
		expect(decideMarker(true, note({ inRootSplit: false }))).toBe("ignore");
	});

	// T11: popout windows are out of scope and must not be styled.
	it("ignores popout-window leaves", () => {
		expect(decideMarker(true, note({ inMainWindow: false }))).toBe("ignore");
	});
});

describe("shouldExitOnEsc", () => {
	const base = {
		sessionActive: true,
		wrapperEngaged: false,
		modalOpen: false,
		suggestionOpen: false,
		vimMode: false,
	};

	it("exits windowed Zen on a bare Esc", () => {
		expect(shouldExitOnEsc(base)).toBe(true);
	});

	it("does nothing when the session is off", () => {
		expect(shouldExitOnEsc({ ...base, sessionActive: false })).toBe(false);
	});

	it("defers to the fullscreen wrapper's own exit detection", () => {
		expect(shouldExitOnEsc({ ...base, wrapperEngaged: true })).toBe(false);
	});

	// AC-8: first Esc closes the modal, not the session.
	it("lets an open modal consume Esc", () => {
		expect(shouldExitOnEsc({ ...base, modalOpen: true })).toBe(false);
	});

	it("lets an open suggestion popup consume Esc", () => {
		expect(shouldExitOnEsc({ ...base, suggestionOpen: true })).toBe(false);
	});

	// Documented vim carve-out: Esc leaves insert mode, never Zen.
	it("never exits on Esc while vim mode is enabled", () => {
		expect(shouldExitOnEsc({ ...base, vimMode: true })).toBe(false);
	});
});

describe("isPersistedSessionActive", () => {
	it("accepts a persisted true flag", () => {
		expect(isPersistedSessionActive(true)).toBe(true);
		expect(isPersistedSessionActive("true")).toBe(true);
	});

	it("treats null, garbage, and absent values as inactive", () => {
		expect(isPersistedSessionActive(null)).toBe(false);
		expect(isPersistedSessionActive(undefined)).toBe(false);
		expect(isPersistedSessionActive(false)).toBe(false);
		expect(isPersistedSessionActive("yes")).toBe(false);
		expect(isPersistedSessionActive({ active: true })).toBe(false);
		expect(isPersistedSessionActive(1)).toBe(false);
	});
});

describe("wrapper decisions", () => {
	it("engages only on desktop with the setting on", () => {
		expect(shouldEngageWrapper(true, true)).toBe(true);
		expect(shouldEngageWrapper(true, false)).toBe(false);
		expect(shouldEngageWrapper(false, true)).toBe(false);
	});

	// AC-9 / T17: restore the window's pre-Zen fullscreen state.
	it("leaves OS fullscreen only when the wrapper created it", () => {
		expect(shouldExitOsFullscreen(true, false)).toBe(true);
		expect(shouldExitOsFullscreen(true, true)).toBe(false);
		expect(shouldExitOsFullscreen(false, false)).toBe(false);
	});
});
