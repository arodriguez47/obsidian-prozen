---
date: 2026-07-01
topic: prozen-features-desktop-tablet
focus: what features would be helpful to add to this Obsidian Zen mode plugin, ensuring it works both on desktop and tablet
mode: repo-grounded
---

# Ideation: ProZen Features (Desktop + Tablet)

## Grounding Context

**Codebase Context.** ProZen is a single-file TypeScript Obsidian plugin (`main.ts`, 309 lines; `styles.css`, 88 lines). Zen mode = fullscreen distraction-free view: desktop uses the native Fullscreen API on the leaf's `containerEl`; mobile/tablet uses a CSS pseudo-fullscreen (`.prozen-fullscreen` fixed-position leaf + `body.prozen-zen`) because the mobile webview has no Fullscreen API. Current features: vignette (linear/radial, opacity + scale), fade-in animation, hide header/scrollbar/graph-controls, mobile editing-toolbar toggle, autocomplete/popover suppression in mobile Zen, force readable line width, safe-area insets. Single toggle command; state is a bare `zenLeaf` instance variable (mobile) or `document.fullscreenElement` (desktop). Known pain: tab cycling breaks Zen styling (README known issue); no persistence across reload; mobile exit is undiscoverable (pull-down command palette); desktop/mobile code paths diverge.

**Past learnings.** None — no `docs/solutions/` exists yet.

**External context.** Upstream ProZen issues are first-party demand signal: #12 word count/stats, #16 adjustable line width, #19 don't force fullscreen, #20 activation button, #14/#17 command-palette/navigation access in Zen, #13 Scrivener-composition-mode parity, #15 iPad support (shipped in this fork). Ecosystem prior art: Typewriter Mode (typewriter scroll, paragraph/sentence dimming, Hemingway mode), Ultra Zen Mode (tablet-first, floating exit button, granular toggles), Minimal+Hider combo friction. Outside Obsidian: iA Writer (Sentence/Paragraph/Typewriter focus), Ulysses (Writing Goals, iPad parity trajectory), FocusWriter (goals/timers), Scrivener (paper width, backdrop), OmmWriter (ambience), e-reader edge-tap zones. ProZen's differentiator vs all competitors: the vignette/dimming aesthetic.

## Topic Axes

- A1 — Mode control & entry/exit (triggering, exiting, discoverability, non-fullscreen zen, tab-switch resilience)
- A2 — Focus & writing experience inside Zen (typewriter scroll, dimming, line width, editing feel)
- A3 — Session & progress feedback (word count, goals, timers, session stats)
- A4 — Ambience & visual framing (vignette extensions, backdrops, brightness, animations)
- A5 — Platform parity & robustness (desktop/tablet parity mechanics, persistence, fragile internal APIs, view support)

## Ranked Ideas

### 1. Zen core v2: one engine, resilient session
**Description:** Unify Zen on the CSS pseudo-fullscreen engine already shipped for mobile, making it the primary mechanism on desktop too (native OS fullscreen becomes an optional add-on toggle), and promote Zen state from a bare instance variable to an owned, persistent session: an `active-leaf-change` listener re-applies Zen styling to whichever leaf becomes active (Zen follows you — fixing the README tab-cycling bug), and minimal state persists via `saveData` so Zen survives app reloads and iPadOS webview eviction. Delivers windowed Zen (#19), command palette in Zen (#14), tab-switch resilience, reload persistence, and desktop/tablet parity by construction (one code path).
**Axis:** A5 (+A1)
**Basis:** `direct:` upstream issues #19 ("option to NOT force fullscreen"), #14/#17 (palette/navigation access); README known issue "Zen mode styling turns off" on Ctrl-Tab; `main.ts:31` (`zenLeaf: WorkspaceLeaf | null` is the entire state model), `main.ts:74-91` (the divergent Platform branch); grounding pain point "desktop and mobile code paths diverge (two exit mechanisms)". Cross-cutting synthesis: 10+ raw ideas from all 6 frames converged here.
**Rationale:** Converts the plugin's oldest documented bug class and its architecture liability into the feature set upstream users asked for most. Every future feature (stats, dimming, themes) hooks one session lifecycle instead of patching two code paths — the highest-leverage move available.
**Downsides:** Behavior-change risk for desktop users who expect OS fullscreen (mitigate: keep native fullscreen as default-on option); relies on `(leaf as any).containerEl` internal API; "Zen follows leaf" semantics need care with split panes.
**Confidence:** 88%
**Complexity:** Medium-High
**Status:** Explored

### 2. Discoverable enter/exit: ribbon icon + fading exit affordance
**Description:** Add a ribbon icon to enter Zen and, inside Zen, a small semi-transparent exit control that fades out after inactivity and is revealed by tap (tablet) or mouse movement (desktop); optionally e-reader-style corner tap zones as a zero-chrome alternative.
**Axis:** A1
**Basis:** `direct:` issue #20 ("a button to activate the plugin"); `styles.css:53-55` comment admits exit depends on knowing the pull-down gesture. `external:` Ultra Zen Mode's floating exit button; Kindle/Apple Books tap zones; Note Toolbar mobile FAB pattern.
**Rationale:** Being trapped in a mode is the worst first-run experience a mode plugin can have; on a tablet with no Esc key it is the plugin's sharpest UX failure. A fading affordance fixes the trap without permanent chrome.
**Downsides:** Any visible affordance slightly dilutes zero-chrome purity; tap zones risk conflict with cursor placement.
**Confidence:** 90%
**Complexity:** Low-Medium
**Status:** Unexplored

### 3. Session stats & writing goals, revealed the Zen way
**Description:** Session word count, elapsed time, and an optional word/time goal — surfaced only in Zen-compatible ways: fade in after typing stillness, hold-to-peek, or at session boundaries (entry intention → exit receipt). Never persistent chrome.
**Axis:** A3
**Basis:** `direct:` upstream #12 ("word count / stats in Zen mode"); Obsidian mobile has no status bar, so this adds capability on tablet rather than restoring it. `external:` Ulysses Writing Goals; FocusWriter daily goals.
**Rationale:** The top numbered upstream feature request, answered without betraying the zero-chrome premise — the reveal mechanism is what makes it a ProZen feature instead of a status-bar widget.
**Downsides:** "Session" definition depends on idea 1's session model; idle-reveal timing is taste-sensitive.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 4. Semantic vignette: paragraph/sentence focus dimming + typewriter centering
**Description:** Extend ProZen's dimming from screen edges into the text: dim all but the active paragraph/sentence (CM6 line decorations sharing the vignette opacity variable), with optional typewriter scroll keeping the cursor centered — and above the on-screen keyboard on tablet.
**Axis:** A2
**Basis:** `external:` iA Writer Focus Mode (Sentence/Paragraph/Typewriter); Typewriter Mode plugin's dimming that activates "only when focus mode is active"; issue #13 (Scrivener-comparable focus). Grounding: vignette is ProZen's differentiator.
**Rationale:** Turns the signature aesthetic into a functional writing aid and closes the gap that currently forces a multi-plugin stack (Minimal + Hider + Typewriter Mode).
**Downsides:** CM6 decoration work is the most technically involved of the survivors; iA Writer's own caveat (dimming helps drafting, hurts editing) demands good defaults.
**Confidence:** 75%
**Complexity:** Medium-High
**Status:** Unexplored

### 5. Writing room: theme-aware vignette + Zen backdrop + adjustable paper width
**Description:** Fix the vignette's hardcoded black (a visual defect on light themes), defaulting to theme-aware color; add a Zen-scoped backdrop tint (warm sepia / OLED true-black / night amber) and an adjustable paper-width slider replacing the binary "Force content centering".
**Axis:** A4 (+A2 width)
**Basis:** `direct:` `styles.css:12-28` hardcodes `rgba(0,0,0,…)` while line 48 already uses `var(--background-primary)` — an inconsistency in the same stylesheet; issues #16 (line width) and #13 (backdrop). `main.ts:123` shows the binary width toggle.
**Rationale:** Two standing upstream issues plus a real visual bug, all through the CSS-variable mechanism the plugin already uses — high value per line of code.
**Downsides:** Settings surface grows; theme interaction edge cases (mid-session light/dark switch).
**Confidence:** 82%
**Complexity:** Medium
**Status:** Unexplored

### 6. In-Zen autocomplete that works: granular popup allow-list
**Description:** Replace the blanket suppression of `.suggestion-container` with an allow-list so `[[link]]`, tag, and slash-command autocomplete work inside Zen while hover popovers/tooltips stay hidden. Trivial on tablet (CSS narrowing); the desktop native-fullscreen half is solved structurally by idea 1's windowed engine.
**Axis:** A5
**Basis:** `direct:` `styles.css:72-77` hides all suggestion UI under `body.prozen-zen`; on desktop native fullscreen the dropdowns render outside the fullscreened element — so on neither platform can a user complete a wikilink in Zen today.
**Rationale:** Linking is the core Obsidian gesture; a writing mode where `[[` silently does nothing is broken for the plugin's main audience.
**Downsides:** Desktop half is dependent on idea 1 (or fragile DOM reparenting); needs a setting to preserve the "suppress everything" purist option.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 7. The vignette is the hourglass: timeboxed Zen with ambient time encoding
**Description:** Optional session duration on entry; the vignette itself animates over the session (closing inward / warming) so the frame encodes remaining time without a clock; gentle vignette pulse at the end, optional auto-exit.
**Axis:** A3
**Basis:** `reasoned:` time-awareness is the most common focus-tool feature, but a numeric readout is persistent chrome contradicting Zen's premise; the vignette is already driven by runtime CSS variables (`main.ts:63-67`), so interpolating them turns an existing aesthetic asset into an information channel. `external:` meditation-app session containers; FocusWriter timers.
**Rationale:** A session feature no competitor has, expressed through ProZen's unique differentiator — the most distinctive novel idea generated.
**Downsides:** Ambient encoding may be too subtle to read; unproven pattern (novelty cuts both ways).
**Confidence:** 65%
**Complexity:** Medium
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Auto-Zen via frontmatter/folder rules | Premature — depends on idea 1's session ontology; surprise-fullscreen UX risk. Revisit after Zen core v2 lands. |
| 2 | Zen presets/profiles (Drafting/Reading/Night) | Compounding play but premature until the settings it would bundle (width, themes, dimming) exist. |
| 3 | Do-Not-Disturb Notice suppression + exit digest | Requires monkey-patching `Notice` or fragile DOM observation; narrower value than survivors. |
| 4 | Fade-on-type auto-hiding chrome | Chrome is already hidden in Zen by default; residual value duplicates idea 2's reveal layer. |
| 5 | Intent modes: Draft (Hemingway) / Review (read-lock) | Behavior restriction is a product-philosophy shift; better explored as a brainstorm variant later. |
| 6 | Split Zen (reference + draft leaf pair) | Novel but high layout complexity and weak phone story; niche relative to cost. |
| 7 | Public Zen API + prozen:enter/exit events | Real leverage but wrong audience for now; premature before the session lifecycle it would expose stabilizes. |
| 8 | In-Zen live gesture tuning (pinch vignette) | Gesture-conflict risk; fold into idea 2's HUD/affordance layer as a follow-on. |
| 9 | Staged theater-dim exit transitions | Polish-grade next to survivors; an exit delay fights the "get me out now" expectation. |

All five axes have survivors (A1: 1,2 · A2: 4 · A3: 3,7 · A4: 5 · A5: 1,6); no coverage gaps.
