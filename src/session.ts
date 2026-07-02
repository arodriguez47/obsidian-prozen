/*
 * Pure decision logic for the Zen session state machine.
 * No Obsidian or DOM imports — main.ts gathers the inputs, these functions
 * decide, main.ts applies the effects. Keeping this platform-free lets the
 * test suite exercise every state transition without an Obsidian mock.
 */

export type ViewKind = "empty" | "graph" | "other";

export interface LeafContext {
	viewKind: ViewKind;
	/** Leaf lives in the main editor area (workspace.rootSplit), not a sidebar/drawer. */
	inRootSplit: boolean;
	/** Leaf's DOM lives in the main window's document, not a popout window. */
	inMainWindow: boolean;
}

export type ToggleAction = "exit" | "enter" | "noop";

/*
 * Toggling off must work from ANY state — including when the active view is
 * empty or in a popout — so the session-active check comes before every
 * enter guard. (A user parked on an empty tab could otherwise never exit;
 * mobile has no Esc key.)
 */
export function decideToggle(sessionActive: boolean, leaf: LeafContext | null): ToggleAction {
	if (sessionActive) return "exit";
	if (!leaf) return "noop";
	if (leaf.viewKind === "empty") return "noop";
	if (!leaf.inRootSplit || !leaf.inMainWindow) return "noop";
	return "enter";
}

export type MarkerAction = "ignore" | "clear" | "move";

/*
 * The marker follows the active leaf only within the main window's root
 * split. Sidebar/drawer focus and popout windows leave the current marker
 * untouched; an empty view clears the marker but keeps the session alive
 * (dormant) so styling returns on the next real leaf.
 */
export function decideMarker(sessionActive: boolean, leaf: LeafContext | null): MarkerAction {
	if (!sessionActive) return "ignore";
	if (!leaf) return "ignore";
	if (!leaf.inMainWindow) return "ignore";
	if (!leaf.inRootSplit) return "ignore";
	if (leaf.viewKind === "empty") return "clear";
	return "move";
}

export interface EscGuards {
	sessionActive: boolean;
	/** OS-fullscreen wrapper engaged — its own exit detection owns Esc. */
	wrapperEngaged: boolean;
	modalOpen: boolean;
	suggestionOpen: boolean;
	vimMode: boolean;
}

export function shouldExitOnEsc(g: EscGuards): boolean {
	return (
		g.sessionActive &&
		!g.wrapperEngaged &&
		!g.modalOpen &&
		!g.suggestionOpen &&
		!g.vimMode
	);
}

/** Garbage, null, or absent persisted data all read as "no session". */
export function isPersistedSessionActive(raw: unknown): boolean {
	return raw === true || raw === "true";
}

export function shouldEngageWrapper(isDesktopApp: boolean, fullscreenWindowSetting: boolean): boolean {
	return isDesktopApp && fullscreenWindowSetting;
}

/*
 * On exit, only leave OS fullscreen if the wrapper put the window there.
 * A user who was already fullscreen before entering Zen keeps their state.
 */
export function shouldExitOsFullscreen(wrapperEngaged: boolean, prevWasFullscreen: boolean): boolean {
	return wrapperEngaged && !prevWasFullscreen;
}
