---
date: 2026-07-01
topic: zen-core-v2-one-engine-resilient-session
---

# Zen Core v2: One Engine, Resilient Session

## Summary

Rebuild ProZen's Zen mode core on the CSS pseudo-fullscreen engine (already shipped for mobile) as the single presentation mechanism on all platforms, make desktop's native OS fullscreen an optional window-level wrapper, and promote Zen state to a persistent session that follows the active leaf and survives app reloads and mobile webview eviction.

---

## Problem Frame

ProZen's Zen mode is currently two divergent implementations: desktop fullscreens the active leaf's container via the native Fullscreen API, while mobile/tablet applies a CSS pseudo-fullscreen because the mobile webview has no Fullscreen API. State is a single in-memory variable (`zenLeaf`) or `document.fullscreenElement`, with no workspace event handling and no persistence.

This produces the plugin's oldest documented defect — the README's Known Issue: switching tabs (Ctrl-Tab) or views (Ctrl-G) while in Zen breaks Zen styling, leaving the workspace half-styled. On tablet the pain is worse and routine: iPadOS/Android aggressively evict backgrounded webviews, so checking another app mid-writing-session silently dumps the user back into full chrome. Meanwhile, upstream users have asked for Zen without forced OS fullscreen (#19), for command-palette access inside Zen (#14/#17) — impossible on desktop today because popups render outside the fullscreened leaf element — and the two code paths mean every future feature must be built and tested twice.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation (autonomous pipeline run; the user pre-accepted recommendations). The items below are agent inferences that fill gaps in the input — un-validated bets that should be reviewed before planning proceeds.*

- Desktop's default experience keeps the fullscreen *feel*: a new "Fullscreen window" setting (default ON) makes entering Zen also fullscreen the app at window level. Turning it OFF yields windowed Zen (upstream #19). Existing users see no surprising default change.
- The optional desktop fullscreen wraps the *window/app*, not the leaf's container element, so Obsidian modals, the command palette, and suggestion popups remain structurally visible inside Zen.
- Zen follows the active leaf by default with no "exit on navigation" alternative in v1 — the README's own stated wish ("make jumping to tabs possible while staying in Zen").
- Session restore after relaunch re-enters Zen via the CSS engine only; native window fullscreen is not auto-re-requested (browser fullscreen requires a user gesture — planning should verify how this constraint applies in Obsidian's Electron/webview contexts).
- Restoring "Zen was active" applies to whatever note/leaf is active after launch, rather than reopening the exact file the user was zenning (Obsidian already restores the workspace layout itself).
- Suggestion/popover suppression CSS (`body.prozen-zen …`) now also applies on desktop; visible behavior is equivalent to today (desktop popups are currently invisible in Zen for structural reasons). Restoring autocomplete inside Zen is a separate, already-ideated feature.
- Switching to an empty leaf while Zen is active keeps the session alive but applies no styling (mirrors the existing empty-view guard).

---

## Key Flows

- F1. Enter and stay in Zen across navigation
  - **Trigger:** User runs the "Zen mode" command (or hotkey) on a note.
  - **Actors:** Writer (desktop or tablet).
  - **Steps:** Zen presentation applies to the active leaf → user switches tabs / follows a link / opens the quick switcher → Zen styling migrates to the newly active leaf automatically.
  - **Outcome:** The user remains in uninterrupted Zen on the new note; no half-styled workspace.
  - **Covered by:** R1, R4, R5.

- F2. Interrupted session on tablet
  - **Trigger:** While in Zen on iPad, the user switches to another app; the OS evicts Obsidian's webview; the user returns.
  - **Actors:** Writer (tablet).
  - **Steps:** Obsidian relaunches → plugin reads persisted session state → Zen re-applies to the active leaf without user action.
  - **Outcome:** The user is back in Zen where they left off.
  - **Covered by:** R6, R7.

- F3. Windowed Zen on desktop
  - **Trigger:** User disables "Fullscreen window" in settings, then enters Zen.
  - **Actors:** Writer (desktop).
  - **Steps:** Zen presentation covers the Obsidian window only → user keeps other apps visible alongside → user exits via the same command or Esc.
  - **Outcome:** Distraction-free Zen without OS fullscreen (upstream #19).
  - **Covered by:** R2, R3, R8.

---

## Requirements

**Engine unification**
- R1. The CSS pseudo-fullscreen presentation (active leaf stretched over the app window, chrome hidden, vignette applied) is the single Zen mechanism on all platforms; platform branches in behavior are limited to the optional OS-fullscreen wrapper and mobile-only chrome (navbar/toolbar).
- R2. A new "Fullscreen window" setting (desktop only, default ON) controls whether entering Zen also puts the app into OS fullscreen at the window level; when OFF, Zen is windowed. On mobile the setting is absent (pseudo-fullscreen is inherently windowed).
- R3. With the wrapper ON, exiting OS fullscreen (e.g., Esc) exits Zen entirely — no half state. With the wrapper OFF, the Zen command and Esc both exit windowed Zen on desktop.

**Resilient session**
- R4. Zen state is an owned session, not a per-leaf style application: when the active leaf changes while Zen is on, Zen presentation moves to the newly active leaf (styling removed from the old leaf, applied to the new one), including correct view-type treatment (linear vignette for text views, radial + controls-hiding for graph).
- R5. When the newly active view is empty, the session stays active but no styling is applied until a non-empty leaf becomes active.
- R6. Zen session state (at minimum: "Zen active", plus whatever identity planning deems safe) persists across app restarts and mobile webview eviction.
- R7. On launch with a persisted active session, Zen re-applies automatically via the CSS engine on both platforms; on desktop the OS-fullscreen wrapper is not auto-re-requested.

**Compatibility**
- R8. All existing settings (vignette opacity/scales, fade-in duration, header/scrollbar/graph-controls toggles, mobile toolbar toggle, force content centering) keep working unchanged under the unified engine.
- R9. The README Known Issue entry for tab-cycling is removed/updated once resolved, and the mobile exit documentation stays accurate.

---

## Acceptance Examples

- AE1. **Covers R1, R4.** Given Zen is active on note A (desktop, wrapper ON), when the user presses Ctrl-Tab to note B, then note B is displayed in full Zen presentation (vignette, hidden chrome) and note A's leaf carries no leftover Zen classes.
- AE2. **Covers R4.** Given Zen is active on a markdown note, when the user switches to the graph view leaf, then the radial vignette applies and graph controls are hidden per the existing setting.
- AE3. **Covers R5.** Given Zen is active, when the user switches to an empty tab, then no Zen styling is applied to it, and switching back to a note re-applies Zen.
- AE4. **Covers R2, R3.** Given "Fullscreen window" is OFF on desktop, when the user enters Zen, then the OS window state is unchanged (windowed), all chrome inside the window is hidden, and Esc exits Zen.
- AE5. **Covers R3.** Given "Fullscreen window" is ON and Zen is active, when the user presses Esc (leaving OS fullscreen), then Zen exits completely — no vignette or hidden-chrome remnants.
- AE6. **Covers R6, R7.** Given Zen is active on tablet, when the OS kills the backgrounded app and the user reopens Obsidian, then Zen re-applies automatically to the active note without running the command.
- AE7. **Covers R7.** Given Zen was active on desktop with wrapper ON, when the app restarts, then Zen re-applies in windowed presentation and the window is NOT auto-fullscreened.
- AE8. **Covers R8.** Given any combination of existing settings, when Zen is entered on either platform, then each toggle behaves exactly as it does today.

---

## Success Criteria

- Tab cycling, quick-switching, and link navigation while in Zen never produce a broken/half-styled workspace — the README Known Issue is resolved and removed.
- A tablet user who app-switches mid-session returns to find Zen intact, with zero extra taps.
- Desktop users gain windowed Zen (#19) and retain command-palette access inside Zen (#14) without losing the current fullscreen default feel.
- One presentation code path serves both platforms: a downstream implementer adding a future Zen feature should not need to write desktop-specific and mobile-specific variants of it.
- Handoff quality: ce-plan can derive the implementation directly from R1–R9 + AE1–AE8 without inventing product behavior.

---

## Scope Boundaries

- No exit-affordance UI (ribbon icon, floating exit button, tap zones) — separate ideation item (idea 2).
- No session stats, goals, or timers (ideas 3, 7).
- No focus dimming, typewriter scroll, appearance/width controls, or autocomplete allow-list (ideas 4–6).
- No auto-Zen rules (frontmatter/folder), presets, or public API/events.
- No multi-window / popout-window support; single main window only.
- No changes to vignette visuals, animation behavior, or settings UI beyond the one new toggle.
- No attempt to auto-re-enter OS fullscreen after relaunch.

---

## Key Decisions

- CSS engine as the universal mechanism, OS fullscreen as optional wrapper: parity-by-construction beats maintaining two divergent paths; the mobile mechanism already proves the presentation works.
- Wrapper targets the window, not the leaf element: keeps modals/palette/popups structurally usable in Zen and makes leaf-follow a pure class migration instead of fullscreen re-request churn.
- Zen follows the active leaf (rather than exiting on navigation): matches the README author's stated intent and converts the top documented bug into the requested feature.

---

## Dependencies / Assumptions

- Relies on Obsidian workspace events (`active-leaf-change`, layout-ready) behaving equivalently on desktop and mobile — believed true, verify in planning.
- Continues to use internal API surfaces the plugin already touches (`(leaf as any).containerEl`, `view.editMode?.editorEl`, graph `dataEngine.controlsEl`); no new internal surface should be added without noting fragility.
- Browser/Electron fullscreen-requires-user-gesture constraint shapes R7 — verify exact behavior in Obsidian's Electron build during planning.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] Best mechanism for window-level fullscreen on desktop: `document.documentElement.requestFullscreen()`, Electron window fullscreen via Obsidian API, or fullscreening the workspace root — pick the least fragile.
- [Affects R4][Technical] Exact event set needed to cover all navigation paths (active-leaf-change vs layout-change vs file-open) without redundant re-application.
- [Affects R6][Technical] What leaf/file identity, if any, is safe to persist given `(leaf as any).containerEl` fragility — or whether "Zen active" alone is sufficient.
- [Affects R8][Needs research] Whether `body.prozen-zen` popup-suppression CSS causes any desktop regression not present today (e.g., themes styling `.suggestion-container` differently).
