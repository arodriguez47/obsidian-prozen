---
title: "feat: Zen Core v2 — one engine, resilient session"
type: feat
status: active
date: 2026-07-01
origin: docs/brainstorms/2026-07-01-zen-core-v2-requirements.md
---

# feat: Zen Core v2 — one engine, resilient session

## Summary

Rebuild Zen mode as a **body-class CSS engine**: `document.body` carries the session state, CSS selectors target the active root-split leaf via a single JS-maintained marker class, and all per-leaf styling (vignette, chrome hiding, readable width, graph controls) becomes declarative CSS. Desktop OS fullscreen becomes an optional window-level wrapper (`electronWindow.setFullScreen`, new "Fullscreen window" setting, default ON). The session persists per-device via `App.saveLocalStorage` and restores at `onLayoutReady` through the CSS engine only.

---

## Problem Frame

Zen mode is two divergent implementations (native leaf fullscreen on desktop, CSS pseudo-fullscreen on mobile) with state in a bare instance variable — so tab switching breaks styling (README Known Issue), reloads/webview eviction silently drop the session, and upstream users can't get windowed Zen (#19) or the command palette inside Zen (#14). See origin doc for the full frame.

---

## Assumptions

*This plan was authored without synchronous user confirmation (autonomous pipeline run). The items below are plan-time agent inferences — un-validated bets that downstream review should scrutinize.*

- **CSS-driven leaf following replaces JS style migration.** The origin doc implied moving styles between leaves in an `active-leaf-change` handler; research on shipped plugins (ultra-zen-mode, paperbenni/obsidian-zenmode, Maxymillion/zen) shows the robust architecture is body-level state classes + CSS selectors, with JS maintaining only a single active-leaf marker class. Product behavior (R4) is unchanged; the mechanism is safer.
- **Session persistence uses per-device `App.saveLocalStorage`/`loadLocalStorage` (public API since 1.8.7), not `data.json`.** The ideation seed suggested `saveData`; the origin requirements doc left the mechanism open (its outstanding question deferred the choice to planning). Research found `data.json` can sync across devices (entering Zen on the iPad would auto-zen the desktop) and races with settings writes. Per-device localStorage preserves R6's behavior without cross-device leakage. Consequence: `minAppVersion` rises to 1.8.7.
- **Sidebar focus does not move or end Zen.** The marker stays on the last root-split leaf when a sidebar/drawer leaf becomes active.
- **The persisted flag survives plugin unload/update** — visual state is torn down in `onunload`, but the flag is kept so a plugin update (unload→load) restores Zen (shipped precedent: paperbenni). Deliberate consequence: disabling and later re-enabling the plugin also restores Zen.
- **Settings changes live-apply during an active session** (CSS variables and body classes update immediately), extending the existing live-apply pattern of the mobile-toolbar toggle.
- **Exiting Zen restores the window's pre-Zen OS-fullscreen state** — if the user was already OS-fullscreen before entering Zen, exiting Zen leaves the window fullscreen.
- **Vim carve-out for Esc:** when vim mode is enabled, Esc does not exit windowed Zen (vim users press Esc constantly); this is documented rather than made configurable in v1.
- **Entry animation plays on session entry only**, not on every leaf migration (a transient body class gates the animation).
- **Test scope:** pure-logic unit tests (vitest) for the session decision module plus a manual verification checklist; no browser/E2E harness for an Obsidian plugin of this size. The vitest harness, `src/` split, and accompanying toolchain bumps (typescript ^5, @types/node ^20) are agent-introduced scope additions beyond origin R9, accepted to pin down the 27-transition state machine in a previously test-free plugin.

---

## Requirements

Traced from origin (docs/brainstorms/2026-07-01-zen-core-v2-requirements.md):

- R1. Single CSS presentation engine on all platforms; platform branches limited to the OS-fullscreen wrapper and mobile-only chrome.
- R2. "Fullscreen window" setting (desktop only, default ON) controls the OS-fullscreen wrapper; absent on mobile.
- R3. Wrapper ON: leaving OS fullscreen (Esc/F11/OS gesture) exits Zen fully. Wrapper OFF: command and Esc exit windowed Zen.
- R4. Zen presentation follows the newly active root-split leaf, with correct view-type treatment (linear vignette for text, radial + hidden controls for graph).
- R5. Empty active views keep the session alive with no styling.
- R6. Session state persists across app restarts and mobile webview eviction.
- R7. Restore re-applies Zen via the CSS engine only; never auto-re-requests OS fullscreen.
- R8. All existing settings keep working unchanged.
- R9. README updated (Known Issue removed; new settings and behavior documented).

**Origin flows:** F1 (enter and stay in Zen across navigation), F2 (interrupted session on tablet), F3 (windowed Zen on desktop).
**Origin acceptance examples:** AE1–AE8 (all carried into unit test scenarios / verification below).

Flow analysis (Phase 1.5) produced a 27-transition state inventory; its critical findings are folded into the units: unconditional toggle-off (T3/T4 exit trap), root-split scoping (T9 sidebars), popout guard (T11), dead-leaf tolerance (T12), view-mode re-apply (T13), wrapper/exit-detection reconciliation (T14/T15/T17), Esc precedence (T16), deferred-view/graph restore safety (T20), persist-on-transition timing (T21), unload teardown (T22), mid-session settings semantics (T23–T25).

---

## Scope Boundaries

Carried from origin: no exit-affordance UI, no stats/goals/timers, no focus dimming/typewriter, no appearance/width controls, no autocomplete allow-list, no auto-Zen rules/presets/public API, no popout-window support (but the engine must *guard* against popouts — enter is a no-op from popout leaves, and body classes never leak into popout documents), no changes to vignette visuals or animation design beyond gating replay.

Plan-local additions:
- Desktop windowed multi-split behavior: the fixed overlay intentionally covers sibling splits; switching focus to the sibling's leaf migrates Zen to it. Documented, not "fixed".
- No configurable Esc behavior; no configurable restore policy (always restore) in v1.

### Deferred to Follow-Up Work

- Exit-affordance UI (floating exit button / tap zones) — ideation idea 2, natural next PR on top of this engine.
- Configurable vim-mode Esc behavior if users request it.

---

## Context & Research

### Relevant Code and Patterns

- `main.ts` — entire current implementation (309 lines): settings + `DEFAULT_SETTINGS` merge pattern, CSS-variable injection via `root.style.setProperty` (lines 63–67), `Platform.isMobileApp` branch (74–91), `enterZen`/`exitZen` body-class pattern (93–110), settings tab live-apply precedent for the mobile toolbar (284–287).
- `styles.css` — vignette gradients driven by CSS variables (12–28), `.prozen-fullscreen` fixed overlay with safe-area insets (41–51), mobile chrome suppression under `body.prozen-zen` (56–77).
- Existing bug to not port: desktop toggle-off targets the *newly active* leaf (`removeStyles(leaf)` at main.ts:82–84) instead of the session's leaf.

### External References (research verified against Obsidian 1.13.1 bundle and shipped plugin sources)

- **No core fullscreen command exists** (verified: full `app:*`/`window:*` command list in the 1.13.1 bundle). Window fullscreen mechanism: `window.electronWindow` — a global Obsidian defines on every window and whose `isFullScreen`/`maximize`/`focus` methods it calls first-party (verified in the 1.13.1 bundle); `setFullScreen` and the `leave-full-screen` event are standard BrowserWindow API on the same object but are NOT exercised by Obsidian's own code. Shipped precedent: javalent/second-window, davisriedel/obsidian-typewriter-mode (WritingFocus records `prevWasFullscreen`, listens to `leave-full-screen`). Undocumented surface → gate behind `Platform.isDesktopApp` + optional chaining, with `document.documentElement.requestFullscreen()` + `fullscreenchange` as fallback (paperbenni precedent).
- **`Element.requestFullscreen()` requires transient user activation** in Electron (no opt-out switch in Obsidian's main process — verified); `setFullScreen` does not. Validates R7.
- **Body-level state classes + declarative CSS** is how ultra-zen-mode, paperbenni, Maxymillion/zen avoid the tab-switch bug: state on `document.body`, CSS targets the active leaf, zero per-leaf JS styling. Scope of the precedent (verified against both plugins' stylesheets): they hide chrome with `display:none` under body classes — neither fixed-overlays the active leaf. The overlay half of this plan's design is ProZen's own shipped mobile mechanism, not borrowed precedent.
- **Obsidian layer stack** (official CSS vars, byte-verified in app.css): fixed leaf at `z-index: var(--layer-modal, 50)` sits above sidedock(10)/status(15), below suggestions(60)/notices(60)/menus(65)/tooltips(70), and below modals (same 50, later DOM order) — exactly the ordering R1/#14 need. Caveats: `.workspace-leaf { contain: strict !important }` (line ~6317) and a higher-specificity stacked-tabs rule require the Zen overlay rules to use `!important` and sufficient specificity; override containment with `contain: none !important` if needed (plugin CSS loads after app.css, so source order wins at equal specificity).
- **Deferred views (Obsidian ≥1.7.2):** background tabs are `DeferredView` placeholders at startup — never touch view internals during restore; class-only styling sidesteps this entirely.
- **Events:** `active-leaf-change(leaf | null)` (null possible), `layout-change` (no official docstring), `onLayoutReady` for restore (runs immediately if already ready); register workspace events *inside* `onLayoutReady` to skip the startup churn; always `this.registerEvent`.
- **Persistence:** `App.loadLocalStorage/saveLocalStorage` (public since 1.8.7) is vault-scoped and per-device; `data.json` syncs across devices when the user enables plugin sync. `onunload` does not fire on mobile webview eviction — persist on every transition, not on quit.
- **Esc:** shipped guard pattern (paperbenni): skip when a `.modal` exists, when the target is in the editor with vim mode on (`vault.config.vimMode` — private API, optional-chain it), when a suggestion container is open. Return semantics of `Scope.register`: return `false` to consume (official docs; a forum claim says the opposite — trust docs, verify at runtime).
- **Mobile pitfalls:** always give `env(safe-area-inset-*, 0px)` fallbacks; `safe-area-inset-bottom` does not update when the keyboard opens (WebKit bug 217754) — prefer `dvh`/`visualViewport` if the overlay misbehaves with the keyboard; `Platform.isDesktopApp` (runtime) gates Electron access, not `Platform.isDesktop` (UI mode).
- **Stale typings:** `node_modules/obsidian` is at API 0.16.3 (predates `isTablet`, `getLeafById`, `loadLocalStorage`, deferred views). `package.json` declares `obsidian: "latest"` but `package-lock.json` pins 0.16.3 — a bare install keeps the lock. Refresh explicitly with `npm update obsidian` (rewrites the lockfile).

### Institutional Learnings

- None — `docs/solutions/` does not exist yet. After this lands, capture the body-class-engine and localStorage-persistence learnings via `/ce-compound`.

---

## Key Technical Decisions

- **Body-class engine + one JS-maintained marker class (`prozen-active-leaf`)**: pure `.mod-active`-based CSS would drop the overlay whenever a sidebar leaf takes focus; a marker updated only for root-split, non-empty leaves gives exact R4/R5/T9 semantics while keeping every visual rule declarative. JS never rebuilds styles per leaf; it only moves one class. The fixed-overlay presentation (vs. the precedents' hide-chrome approach) is chosen on its own merits: it preserves the shipped mobile presentation exactly and keeps one identical presentation path on both platforms, at the accepted cost of the sibling-split coverage wart and in-Zen popup suppression — a hide-chrome variant would avoid both but fork the presentation per platform.
- **All internal-API styling access is deleted, not wrapped**: `view.dataEngine.controlsEl` (graph controls) → CSS `.graph-controls` rule; `view.editMode.editorEl` readable-width → ProZen-owned CSS width rule under `body.prozen-zen.prozen-readable` (also fixes the reading↔editing re-apply gap, T13). The only remaining internal surface is `leaf.containerEl` (typed narrow cast, paperbenni pattern) and the guarded `electronWindow`.
- **Wrapper = `electronWindow.setFullScreen` with prior-state capture; external-exit detection via Electron `leave-full-screen` (manual cleanup on teardown) with `body.is-fullscreen` class observation as a no-remote fallback**: covers Esc, F11, macOS green button, and gestures uniformly (T14/T15); restores pre-Zen fullscreen state on exit (T17).
- **Persist on every transition to per-device localStorage**: eviction gives no unload callback (T21); localStorage survives it and never syncs across devices.
- **Unconditional toggle-off**: the command checks "session active?" before the empty-view guard, so a user parked on an empty tab can always exit (kills the T4 exit trap; also fixes the shipped main.ts:82–84 wrong-leaf teardown).
- **Entry animation gated by a transient `prozen-entering` body class** (removed after the configured duration): fade-in on session entry, no replay on migration (T5/T8).

---

## Open Questions

### Resolved During Planning

- Window-fullscreen mechanism (origin deferred): `electronWindow.setFullScreen`, guarded, with `documentElement.requestFullscreen()` fallback — see Key Technical Decisions.
- Event set (origin deferred): `active-leaf-change` for the marker; `layout-change` only if marker loss is observed in testing; restore via `onLayoutReady`; events registered inside `onLayoutReady`.
- Persisted identity (origin deferred): boolean "active" only; restore onto whatever leaf is active after layout — leaf ids are per-device and half-official, not worth the fragility.
- Desktop `body.prozen-zen` popup-suppression regression (origin deferred): suggestion containers sit at layer 60, above the overlay at 50; keeping the existing suppression CSS reproduces today's desktop behavior (popups invisible in Zen). No regression; allow-listing is a separate ideated feature.

### Deferred to Implementation

- Whether `.workspace-split.mod-root` and `[data-type="…"]` selectors need mobile-specific adjustments (verify in emulateMobile + on-device; the marker class keeps this a CSS-only fix if so).
- Whether `layout-change` re-assertion is needed for edge cases the marker misses (leaf drag between splits, T26) — add only if observed.
- Exact Esc guard set tuning (Excalidraw-style embedded editors) — start with modal/suggestion/vim guards, extend if testing reveals conflicts.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
document.body classes (session state)          CSS (presentation, declarative)
─────────────────────────────────────          ────────────────────────────────
prozen-zen            session on               body.prozen-zen .workspace-split.mod-root
prozen-entering       transient, entry anim      .workspace-leaf.prozen-active-leaf
prozen-show-header    settings-derived             { position:fixed; inset:0;
prozen-show-scroll    settings-derived               z-index:var(--layer-modal,50);
prozen-readable       settings-derived               contain:none !important; … }
prozen-hide-toolbar   existing (mobile)          …[data-type="graph"] → radial vignette
                                                 …:not([data-type=graph]) → linear vignette
CSS variables: --vignette-*, --fadeIn-duration   .graph-controls, .view-header, scrollbars,
(written on enter AND on settings change)        readable width → pure CSS under body classes

JS responsibilities (ZenSession):
  enter(leaf)  → guard: leaf non-empty, root-split, main window
                 body classes + CSS vars + marker + persist(true) + wrapper?
  exit()       → body classes off + marker off + persist(false) + wrapper restore
  toggle()     → session-active check FIRST (unconditional off), then enter-guards
  onActiveLeafChange(leaf|null)
               → null/sidebar/popout: ignore · empty: remove marker (session alive)
                 root-split non-empty: move marker (idempotent for same leaf)
  restore()    → onLayoutReady: persisted? → enter CSS-only (never wrapper)
  teardown()   → onunload: visuals + wrapper restore + listeners; keep persisted flag

State machine (from flow analysis): S0 off · S1 on-windowed · S2 on + OS-fullscreen ·
S3 on-dormant (empty active view) · S4 restore-pending. All 27 inventoried transitions
resolve to the handlers above; toggle exits from S1/S2/S3 unconditionally.
```

---

## Implementation Units

### U1. Body-class CSS engine

**Goal:** Replace per-leaf JS styling with the declarative body-class + marker-class CSS engine; one presentation path for all platforms.

**Requirements:** R1, R4, R5, R8 (origin F1; AE1–AE3, AE8)

**Dependencies:** None

**Files:**
- Modify: `styles.css`, `main.ts`

**Approach:**
- Rewrite `styles.css`: fixed-overlay rule on `body.prozen-zen .workspace-split.mod-root .workspace-leaf.prozen-active-leaf` (with `!important` where it must beat `.workspace-leaf { contain: strict !important }` and the stacked-tabs rule; `contain: none !important`; `z-index: var(--layer-modal, 50)`; safe-area insets with `0px` fallbacks); linear vignette on non-graph view content, radial + `.graph-controls { display: none }` (gated by the graph-controls setting class) on `[data-type="graph"]`; header/scrollbar visibility and ProZen-owned readable-width rule under settings-derived body classes; entry animation gated by `body.prozen-entering`; keep existing mobile navbar/toolbar/popup-suppression rules.
- Rewrite `main.ts` session core: `enterZen` sets body classes (session + settings-derived) and CSS vars, sets the marker on the active leaf, starts the `prozen-entering` timer (tracking the timeout handle; cleared on exit, re-enter, and teardown so a rapid toggle can't truncate a later entry's animation or mutate `document.body` after unload); `exitZen` removes all of it; toggle command checks session-active first (unconditional off), then applies enter guards (non-empty view, root-split leaf, main window). Marker maintenance on `active-leaf-change`: ignore null/sidebar (`leaf.getRoot() !== workspace.rootSplit`)/popout leaves; remove marker for empty views; move marker otherwise; no-op for the same leaf. Every marker update first clears ALL existing `.prozen-active-leaf` occurrences (`querySelectorAll` over the workspace container) before setting the new one — duplicate markers are structurally impossible across drags and layout rebuilds. Focus is not managed by the plugin: it follows Obsidian's own leaf activation on marker moves. Access `leaf.containerEl` via a narrow typed interface cast (not `as any`). Delete `addStyles`/`removeStyles` and all `dataEngine`/`editMode` access.
- Register the `active-leaf-change` handler inside `onLayoutReady` via `this.registerEvent`.

**Patterns to follow:**
- Body-class engine: ultra-zen-mode / paperbenni (see Context & Research).
- CSS-variable injection: existing `fullscreenMode()` lines 63–67.
- Typed narrow cast for `containerEl`: paperbenni's `WorkspaceLeafWithContainer` pattern.

**Test scenarios:**
- Covers AE1. Happy path: session active on note A, active-leaf-change to note B → marker moves to B, exactly one marker in the workspace.
- Covers AE2. Happy path: switch to graph leaf → marker moves; (CSS applies radial treatment — manual check).
- Covers AE3. Edge case: switch to empty view → marker removed, session still active; switch back to a note → marker re-applied.
- Edge case: active-leaf-change with null leaf → no state change.
- Edge case: sidebar leaf becomes active → marker unchanged (stays on last root-split leaf).
- Edge case: same leaf re-activates → no marker churn (idempotent).
- Edge case: toggle command while session active and active view is empty → session exits fully (T4 exit trap).
- Error path: marker teardown when the marked leaf was closed → no throw, successor gets marker on next event.
- Integration (manual): rapid Ctrl-Tab across 5+ tabs leaves exactly one styled leaf, no fade-in replay (AC-18).

**Verification:**
- `npm run build` passes; on desktop, entering Zen then Ctrl-Tab/quick-switch/link-follow keeps Zen seamlessly on the new note; graph view gets radial vignette with controls hidden per setting; README Known Issue behavior is unreproducible; all existing toggles behave identically (AE8).

---

### U2. Desktop OS-fullscreen wrapper

**Goal:** New "Fullscreen window" setting (desktop only, default ON) wrapping the CSS engine in window-level OS fullscreen, with uniform external-exit detection.

**Requirements:** R2, R3 (origin F3; AE4, AE5)

**Dependencies:** U1

**Files:**
- Modify: `main.ts`

**Approach:**
- Add `fullscreenWindow: boolean` (default `true`) to settings; render the toggle in the settings tab only when `Platform.isDesktopApp`.
- On enter (desktop + setting ON): capture `prevWasFullscreen = electronWindow.isFullScreen()`, then `setFullScreen(true)`; on exit restore the prior state (only un-fullscreen if Zen set it — T17). All access guarded: `Platform.isDesktopApp` + optional chaining; if `electronWindow` is absent, fall back to `document.documentElement.requestFullscreen()` + `fullscreenchange`.
- External-exit detection: `leave-full-screen` listener on `electronWindow` (removed manually in teardown, BEFORE restoring window state) → full session exit (covers Esc-in-fullscreen, F11, green button, gestures — T14/T15). Suppress reactions to ALL plugin-initiated `setFullScreen` transitions — there are three: exit's state restore, the T25 setting toggle, and unload teardown. Use a suppress flag set before each programmatic call and cleared when the corresponding enter/leave event arrives, with a timeout fallback (Electron emits these events asynchronously — macOS fullscreen transitions take ~1s — so a naive ignore-next-event flag can swallow a genuine user exit that races the transition).
- Mid-session setting toggle (T25): ON→OFF while zenned exits OS fullscreen but keeps Zen (this is a plugin-initiated transition — the suppress flag above prevents it from self-triggering session exit); OFF→ON enters OS fullscreen immediately. Both are window-chrome changes only — no entry-animation replay.
- Remove the old per-leaf `requestFullscreen`/`onfullscreenchange` path entirely.

**Patterns to follow:**
- typewriter-mode WritingFocus: `prevWasFullscreen` capture + `leave-full-screen` handling.
- Existing mobile-toolbar setting's live-apply for the mid-session toggle behavior.

**Test scenarios:**
- Covers AE4. Happy path: setting OFF, enter Zen → window state unchanged, chrome hidden (windowed Zen).
- Covers AE5. Happy path: setting ON, enter Zen, press Esc (OS fullscreen exits) → session fully exits, no residual classes.
- Edge case: window already fullscreen before entering Zen → exit Zen leaves window fullscreen (AC-9).
- Edge case: F11/OS-gesture exit while zenned → session fully exits (AC-10).
- Edge case: toggle setting OFF mid-session → OS fullscreen exits, Zen stays; toggle ON mid-session → OS fullscreen engages (AC-11).
- Error path: `electronWindow` unavailable → fallback path engages, no throw on mobile (never invoked there).
- Integration (manual): command palette, modals, context menus, and notices all render above and are interactable inside Zen on desktop (AC-17, upstream #14).

**Verification:**
- Desktop default feel unchanged (window fullscreens); windowed Zen works with setting OFF; every OS-level fullscreen exit route ends the session cleanly.

---

### U3. Session persistence and restore

**Goal:** Zen survives app restarts and mobile webview eviction; restores via the CSS engine only.

**Requirements:** R6, R7 (origin F2; AE6, AE7)

**Dependencies:** U1, U2

**Files:**
- Modify: `main.ts`, `package.json` + `package-lock.json` (run `npm update obsidian` to refresh the locked typings — the lockfile pins 0.16.3, so a bare install won't), `manifest.json` (bump `minAppVersion` to `1.8.7`, the floor for the public `loadLocalStorage`/`saveLocalStorage` API)

**Approach:**
- Persist a boolean session flag via `app.saveLocalStorage('prozen-session', …)` on **every** enter/exit transition (eviction fires no unload — T21). Read via `app.loadLocalStorage` in `onLayoutReady`; if active, run the CSS-engine enter path against the current active leaf (dormant if the active view is empty OR lives in a popout window — T19; the flag stays set and styling arrives when a root-split leaf activates), never engaging the OS-fullscreen wrapper (R7/AE7).
- Restore enters WITHOUT the entry animation (skip `prozen-entering` on the restore path) — no fade flash at every app launch while a session is persisted.
- Wrap the restore enter path in try/catch: on throw, persist(false), tear down any partially applied classes, and log. A broken restore (e.g., selector drift after an Obsidian update) degrades to "Zen off" once instead of recurring on every startup — and plugin disable→re-enable stays a working escape hatch.
- `onunload`: tear down visuals and wrapper (restore pre-Zen fullscreen state), remove manually-attached listeners — but keep the persisted flag (plugin updates restore Zen).
- Restore must not touch view internals (deferred views, T20) — the class-only engine already guarantees this; keep it true.

**Patterns to follow:**
- paperbenni: restore body classes at load end, never re-request fullscreen on startup.
- remember-cursor-position: event-driven re-application over timing hacks.

**Test scenarios:**
- Covers AE6. Happy path: flag persisted active → restore enters CSS session at layout-ready.
- Covers AE7. Happy path: restore never calls the wrapper even with "Fullscreen window" ON.
- Edge case: restore with empty active view → dormant session, styling arrives on first leaf-change (AC-5).
- Edge case: enter → simulate kill (no exit write) → flag reads active; exit → kill → flag reads inactive (persist-on-transition, AC-6).
- Edge case: restore with graph/deferred active view → no view-internal access, no throw (AC-4).
- Error path: `loadLocalStorage` returns null/garbage → treated as inactive.
- Integration (manual, device): background Obsidian on iPad until eviction, reopen → Zen restored (F2).

**Verification:**
- Restart while zenned restores Zen on both platforms; restart after exiting does not; `onunload` leaves no classes or listeners behind while preserving the flag.

---

### U4. Esc handling for windowed Zen

**Goal:** Esc exits windowed Zen on desktop without breaking modals, suggestions, or vim.

**Requirements:** R3

**Dependencies:** U1, U2

**Files:**
- Modify: `main.ts`

**Approach:**
- `registerDomEvent(document, 'keydown')` for Escape, active only when the session is on and the OS-fullscreen wrapper is not engaged (the wrapper case is handled by `leave-full-screen`). Guards (paperbenni pattern): skip when a `.modal` is present, when a suggestion container is open, and when vim mode is enabled (`vault.config.vimMode` via optional chaining — private API, commented as such). Mobile: no Esc path; exit remains the command (pull-down palette), unchanged.
- Swallowed Esc (vim mode, open modal/suggestion) is silent by design in v1 — no toast or in-app affordance; the durable fix for exit discoverability is the exit-affordance UI already listed under Deferred to Follow-Up Work. Document the vim carve-out prominently in the README (R9).

**Test scenarios:**
- Happy path: windowed Zen, Esc → session exits.
- Edge case: modal open, Esc → modal closes, session stays; second Esc exits (AC-8).
- Edge case: vim mode enabled, Esc in editor → session stays (documented carve-out).
- Edge case: wrapper ON → this handler never fires (fullscreen path owns Esc).

**Verification:**
- Esc behaves per the precedence rules on desktop; no interference with modal/suggestion dismissal.

---

### U5. Settings live-apply and settings-tab update

**Goal:** Settings changes take effect immediately during a session; new toggle surfaced.

**Requirements:** R2, R8

**Dependencies:** U1, U2

**Files:**
- Modify: `main.ts`

**Approach:**
- Vignette sliders and fade duration re-write their CSS variables on change (they currently write only at entry — T23); element toggles flip their settings-derived body classes live when the session is active (T24), mirroring the existing mobile-toolbar live-apply. Add the "Fullscreen window" toggle (from U2) to the settings tab under a desktop-only guard.

**Test scenarios:**
- Happy path: change vignette opacity while zenned → visual update without re-entering (AC-13).
- Edge case: toggle "Show header" while zenned → header appears/disappears immediately; consistent with behavior after a tab switch.
- Test expectation for pure settings-tab layout changes: none — rendering-only, covered by manual check.

**Verification:**
- No setting requires exiting and re-entering Zen to take effect; settings changed while Zen is off apply on next entry as today.

---

### U6. Tests, build, and docs

**Goal:** Extract testable session logic, add the unit test harness, update docs.

**Requirements:** R9 (+ test scenarios across U1–U5)

**Dependencies:** U1–U5

**Files:**
- Create: `src/session.ts` (pure decision logic: toggle/enter/exit state machine, marker-move decisions, Esc-guard predicate, restore decision), `tests/session.test.ts`
- Modify: `main.ts` (imports from `src/session.ts`), `package.json` + `package-lock.json` (add `vitest` devDependency + `test` script; bump `typescript` to ^5.x and `@types/node` to ^20 in the same change — current vitest requires Node ≥20-era typings and TS 5.x types, and the repo's typescript 4.7.4 / @types/node ^16 combination fails ERESOLVE under npm 7+), `README.md`
- Note: `tsconfig.json`'s existing `"include": ["**/*.ts"]` already routes `src/` and `tests/` through the `npm run build` typecheck — by design; no include change needed.

**Approach:**
- Keep `main.ts` as the esbuild entry (root) and thin Obsidian/DOM glue; move platform-independent decisions into `src/session.ts` as pure functions so tests need no Obsidian mock (inputs: session state, view type, leaf root kind, platform flags, settings; outputs: actions). The vitest suite implements the pure-logic test scenarios enumerated in U1–U5.
- README: remove the tab-cycling Known Issue, document "Fullscreen window", windowed Zen, Esc behavior (and vim carve-out), session restore, the new minimum Obsidian version (1.8.7), and unchanged mobile exit gesture.

**Execution note:** Write the session state-machine tests alongside (or just before) extracting `src/session.ts` — the 27-transition inventory in the flow analysis is the test list; implementing the module against failing tests is cheaper than retrofitting.

**Test scenarios:**
- The pure-logic scenarios from U1–U5 (marker decisions, toggle-off precedence, restore decision, Esc guards, wrapper enter/exit/prior-state decisions) implemented in `tests/session.test.ts`.
- Happy path: `npm test` green; `npm run build` green (tsc + esbuild).

**Verification:**
- `npm test` and `npm run build` both pass; README accurately describes the new behavior; manual checklist (below) executed on desktop and in `emulateMobile`.

---

## System-Wide Impact

- **Interaction graph:** one `active-leaf-change` listener (marker), one `leave-full-screen` listener (wrapper exit), one keydown listener (Esc), `onLayoutReady` (restore). All registered per plugin-guideline cleanup norms; the manual `leave-full-screen` listener is the only non-`registerEvent` resource and must be removed in teardown.
- **Error propagation:** all Electron access optional-chained; restore treats bad persisted data as inactive; marker code tolerates null leaves and detached elements.
- **State lifecycle risks:** persisted flag vs. actual state can diverge only between a crash and next launch (by design, restores); settings and session state live in different stores (data.json vs localStorage) so no write races.
- **API surface parity:** desktop and mobile now share the entire presentation path; the wrapper and Esc handler are the only desktop-only code, both guarded by `Platform.isDesktopApp`.
- **Integration coverage:** z-index layering vs. modals/suggestions, stacked-tab mode, and mobile keyboard/safe-area behavior are covered by the manual checklist — unit tests cannot prove them.
- **Unchanged invariants:** command ID `zenmode` and command name; all existing setting keys and defaults; vignette visual design; mobile navbar/toolbar/popup suppression behavior; mobile exit gesture.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `electronWindow` is undocumented and could change | Guarded access + `requestFullscreen` fallback; worst case is wrapper degradation, CSS engine unaffected |
| `.mod-root`/`[data-type]`/`.graph-controls` selectors differ on mobile or future Obsidian versions | Marker class keeps fixes CSS-only; manual checklist includes emulateMobile; selectors chosen from current app.css audit |
| `contain: strict !important` / stacked-tabs specificity fight | Verified override strategy (source order + `!important` + specificity); explicit manual check in stacked-tab mode |
| Desktop users surprised by pseudo-fullscreen replacing leaf fullscreen | Default wrapper ON preserves the fullscreen feel; README documents the change |
| Persisted flag restores Zen after plugin update unexpectedly | Documented behavior; single-command exit; acceptable per shipped precedent (paperbenni) |
| Vim users vs Esc | Carve-out implemented and documented |

---

## Documentation / Operational Notes

- README: Known Issues entry removed; new sections for Fullscreen window setting, windowed Zen, Esc/vim behavior, session restore.
- After landing, run `/ce-compound` to seed `docs/solutions/` with the body-class-engine and per-device-persistence learnings (institutional-learnings gap noted in research).

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-07-01-zen-core-v2-requirements.md](../brainstorms/2026-07-01-zen-core-v2-requirements.md)
- Ideation artifact: [docs/ideation/2026-07-01-prozen-features-ideation.md](../ideation/2026-07-01-prozen-features-ideation.md)
- Related code: `main.ts`, `styles.css`
- Upstream issues (cmoskvitin/obsidian-prozen): #19 windowed zen, #14 palette access, #20 trigger, README Known Issue
- External: Obsidian plugin guidelines / defer-views / load-time / Layers CSS vars (docs.obsidian.md); shipped plugins — MarckFp/ultra-zen-mode, paperbenni/obsidian-zenmode, davisriedel/obsidian-typewriter-mode (WritingFocus), Maxymillion/zen, dy-sh/obsidian-remember-cursor-position
