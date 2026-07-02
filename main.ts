import { App, ItemView, Platform, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from "obsidian";
import {
	decideMarker,
	decideToggle,
	isPersistedSessionActive,
	shouldEngageWrapper,
	shouldExitOnEsc,
	shouldExitOsFullscreen,
	shouldSuppressFullscreenEvent,
	type LeafContext,
} from "./src/session";

interface PluginSettings {
	animationDuration: number,
	showHeader: boolean,
	showScroll: boolean,
	showGraphControls: boolean,
	showMobileToolbar: boolean,
	forceReadable: boolean,
	fullscreenWindow: boolean,
	vignetteOpacity: number,
	vignetteScaleLinear: number,
	vignetteScaleRadial: number
}

const DEFAULT_SETTINGS: PluginSettings = {
	animationDuration: 2,
	showHeader: false,
	showScroll: false,
	showGraphControls: false,
	showMobileToolbar: false,
	forceReadable: true,
	fullscreenWindow: true,
	vignetteOpacity: 0.75,
	vignetteScaleLinear: 20,
	vignetteScaleRadial: 75
}

const SESSION_STORAGE_KEY = "prozen-session";
const MARKER_CLASS = "prozen-active-leaf";
const BODY_CLASSES = [
	"prozen-zen",
	"prozen-entering",
	"prozen-show-header",
	"prozen-show-scroll",
	"prozen-show-graph-controls",
	"prozen-readable",
	"prozen-hide-toolbar",
];

// containerEl is not part of the public WorkspaceLeaf typings, but every
// shipped zen plugin relies on it; a narrow cast keeps the surface explicit.
interface LeafWithContainer {
	containerEl?: HTMLElement;
}

// window.electronWindow is a global Obsidian defines on every desktop window
// (an @electron/remote BrowserWindow handle). Undocumented — every access is
// optional-chained, with the HTML Fullscreen API as fallback.
interface ElectronWindowLike {
	isFullScreen?: () => boolean;
	setFullScreen?: (flag: boolean) => void;
	on?: (event: string, listener: () => void) => void;
	removeListener?: (event: string, listener: () => void) => void;
}

// vault.getConfig is private API; used only to honor the vim-mode Esc carve-out.
interface VaultWithConfig {
	getConfig?: (key: string) => unknown;
}

export default class Prozen extends Plugin {
	settings: PluginSettings;
	private sessionActive = false;
	private prevWasFullscreen = false;
	private wrapperMode: "electron" | "domfs" | null = null;
	// Invalidates in-flight async fullscreen work (the domfs requestFullscreen
	// promise) when the wrapper is released or re-engaged before it settles.
	private wrapperGeneration = 0;
	// Plugin-initiated setFullScreen(false) calls suppress the external-exit
	// listener until this timestamp (Electron emits the events asynchronously).
	private suppressFullscreenEventsUntil = 0;
	private enteringTimer: number | null = null;
	private leaveFullScreenListener: (() => void) | null = null;

	// The wrapper put (or found) the window in OS fullscreen for this session.
	private get wrapperEngaged(): boolean {
		return this.wrapperMode !== null;
	}

	async onload() {
		await this.loadSettings();
		this.addCommand({
			id: "zenmode",
			name: "Zen mode",
			callback: this.toggleZen.bind(this),
		});
		this.addSettingTab(new ProzenSettingTab(this.app, this));

		// Register events inside onLayoutReady to skip the leaf-change storm
		// during workspace construction, then restore any persisted session.
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.workspace.on("active-leaf-change", (leaf) => this.onActiveLeafChange(leaf))
			);
			this.registerDomEvent(document, "keydown", (evt) => this.onKeydown(evt));
			this.registerDomEvent(document, "fullscreenchange", () => this.onDomFullscreenChange());
			this.restoreSession();
		});
	}

	onunload() {
		// Tear down visuals and the wrapper, but keep the persisted flag:
		// a plugin update (unload -> load) restores the session.
		this.teardownVisuals();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	toggleZen() {
		const action = decideToggle(this.sessionActive, this.activeLeafContext());
		if (action === "exit") {
			this.exitZen();
		} else if (action === "enter") {
			this.enterZen({ animate: true, wrapper: true });
		}
	}

	private enterZen(opts: { animate: boolean; wrapper: boolean }) {
		this.sessionActive = true;
		this.applyCssVariables();
		this.applyBodyClasses();
		if (opts.animate) this.startEnteringAnimation();
		this.updateMarker(this.activeLeaf());
		this.persistSession(true);
		if (opts.wrapper) this.engageWrapper();
	}

	private exitZen() {
		this.teardownVisuals();
		this.persistSession(false);
	}

	// Shared by exitZen and onunload: removes every visual/system effect the
	// session created. Tolerates partially-applied state.
	private teardownVisuals() {
		this.sessionActive = false;
		this.clearEnteringTimer();
		document.body.classList.remove(...BODY_CLASSES);
		this.clearAllMarkers();
		this.releaseWrapper();
	}

	// ---------- Session restore (R6/R7) ----------

	private restoreSession() {
		try {
			if (!isPersistedSessionActive(this.app.loadLocalStorage(SESSION_STORAGE_KEY))) return;
			// CSS engine only: no OS fullscreen (needs a user gesture and would
			// be hostile at launch), no entry animation (no flash on startup).
			this.enterZen({ animate: false, wrapper: false });
		} catch (error) {
			// A broken restore (e.g. selector drift after an Obsidian update)
			// must degrade to "Zen off" once, not recur on every launch.
			this.persistSession(false);
			this.teardownVisuals();
			console.error("ProZen: failed to restore Zen session; cleared the persisted flag.", error);
		}
	}

	private persistSession(active: boolean) {
		// Per-device on purpose: data.json can sync across devices, and a Zen
		// session on the iPad must not fullscreen the desktop at next launch.
		this.app.saveLocalStorage(SESSION_STORAGE_KEY, active ? true : null);
	}

	// ---------- Active-leaf tracking (R4/R5) ----------

	private onActiveLeafChange(leaf: WorkspaceLeaf | null) {
		const action = decideMarker(this.sessionActive, this.leafContext(leaf));
		if (action === "clear") {
			this.clearAllMarkers();
		} else if (action === "move") {
			this.updateMarker(leaf);
		}
	}

	private updateMarker(leaf: WorkspaceLeaf | null) {
		const previous = document.querySelector("." + MARKER_CLASS);
		// Clearing every occurrence first makes duplicate markers structurally
		// impossible, even across leaf drags and layout rebuilds.
		this.clearAllMarkers();
		if (!leaf) return;
		// Re-checking the decision here is defense-in-depth for the enterZen
		// call path, which invokes updateMarker without a prior decideMarker.
		if (decideMarker(this.sessionActive, this.leafContext(leaf)) !== "move") return;
		const containerEl = (leaf as unknown as LeafWithContainer).containerEl;
		if (!containerEl) return;
		containerEl.classList.add(MARKER_CLASS);
		// Migrating to a different leaf inside the entry-animation window would
		// restart the CSS animation on the newly matched element — end the
		// window instead so the fade plays once per session entry.
		if (previous && previous !== containerEl) {
			this.clearEnteringTimer();
		}
	}

	private clearAllMarkers() {
		document.querySelectorAll("." + MARKER_CLASS).forEach((el) => el.classList.remove(MARKER_CLASS));
	}

	private activeLeaf(): WorkspaceLeaf | null {
		return this.app.workspace.getActiveViewOfType(ItemView)?.leaf ?? null;
	}

	private activeLeafContext(): LeafContext | null {
		return this.leafContext(this.activeLeaf());
	}

	private leafContext(leaf: WorkspaceLeaf | null): LeafContext | null {
		if (!leaf) return null;
		const viewType = leaf.view?.getViewType() ?? "empty";
		const containerEl = (leaf as unknown as LeafWithContainer).containerEl ?? null;
		let inRootSplit = false;
		try {
			inRootSplit = leaf.getRoot() === this.app.workspace.rootSplit;
		} catch {
			inRootSplit = false;
		}
		return {
			viewKind: viewType === "empty" ? "empty" : viewType === "graph" ? "graph" : "other",
			inRootSplit,
			inMainWindow: containerEl ? containerEl.ownerDocument === document : false,
		};
	}

	// ---------- Presentation (R1/R8) ----------

	private applyCssVariables() {
		const root = document.documentElement;
		root.style.setProperty("--fadeIn-duration", this.settings.animationDuration + "s");
		root.style.setProperty("--vignette-opacity", String(this.settings.vignetteOpacity));
		root.style.setProperty("--vignette-scale-linear", this.settings.vignetteScaleLinear + "%");
		root.style.setProperty("--vignette-scale-radial", this.settings.vignetteScaleRadial + "%");
	}

	private applyBodyClasses() {
		const body = document.body;
		body.classList.add("prozen-zen");
		body.classList.toggle("prozen-show-header", this.settings.showHeader);
		body.classList.toggle("prozen-show-scroll", this.settings.showScroll);
		body.classList.toggle("prozen-show-graph-controls", this.settings.showGraphControls);
		body.classList.toggle("prozen-readable", this.settings.forceReadable);
		body.classList.toggle("prozen-hide-toolbar", !this.settings.showMobileToolbar);
	}

	// Settings changes take effect immediately during an active session.
	refreshZenAppearance() {
		if (!this.sessionActive) return;
		this.applyCssVariables();
		this.applyBodyClasses();
	}

	private startEnteringAnimation() {
		this.clearEnteringTimer();
		document.body.classList.add("prozen-entering");
		const durationMs = Math.max(0, (Number(this.settings.animationDuration) || 0) * 1000);
		this.enteringTimer = window.setTimeout(() => {
			document.body.classList.remove("prozen-entering");
			this.enteringTimer = null;
		}, durationMs);
	}

	private clearEnteringTimer() {
		if (this.enteringTimer !== null) {
			window.clearTimeout(this.enteringTimer);
			this.enteringTimer = null;
		}
		document.body.classList.remove("prozen-entering");
	}

	// ---------- OS-fullscreen wrapper (R2/R3) ----------

	private electronWindow(): ElectronWindowLike | null {
		if (!Platform.isDesktopApp) return null;
		return (window as unknown as { electronWindow?: ElectronWindowLike }).electronWindow ?? null;
	}

	private engageWrapper() {
		if (!shouldEngageWrapper(Platform.isDesktopApp, this.settings.fullscreenWindow)) return;
		if (this.wrapperEngaged) return;
		const win = this.electronWindow();
		if (win?.setFullScreen && win.isFullScreen) {
			this.prevWasFullscreen = win.isFullScreen();
			this.attachLeaveFullScreenListener(win);
			if (!this.prevWasFullscreen) {
				// No suppression here: setFullScreen(true) emits enter-full-screen,
				// never leave-full-screen, so any leave event after entering is a
				// genuine external exit and must end the session.
				win.setFullScreen(true);
			}
			this.wrapperMode = "electron";
		} else {
			// Fallback: HTML Fullscreen API on the document root, so modals and
			// popups stay visible. Exit is observed via fullscreenchange. The
			// generation token invalidates this async work if the session exits
			// (or re-engages) before the promise settles.
			this.prevWasFullscreen = false;
			this.wrapperMode = "domfs";
			const generation = ++this.wrapperGeneration;
			document.documentElement.requestFullscreen?.()
				.then(() => {
					if (generation !== this.wrapperGeneration) {
						// The session released the wrapper while the request was in
						// flight — leave fullscreen again instead of stranding the
						// window fullscreen with Zen already off.
						document.exitFullscreen?.().catch(() => { /* already out */ });
					}
				})
				.catch(() => {
					// Transient-activation rejection: continue windowed.
					if (generation === this.wrapperGeneration) {
						this.wrapperMode = null;
					}
				});
		}
	}

	// Called from exitZen/teardown and from the mid-session setting toggle.
	// Detaches the listener BEFORE restoring window state so the plugin's own
	// setFullScreen(false) can never be mistaken for an external exit.
	private releaseWrapper() {
		this.wrapperGeneration++;
		const win = this.electronWindow();
		this.detachLeaveFullScreenListener(win);
		if (!this.wrapperEngaged) return;
		if (this.wrapperMode === "electron") {
			// First arg is true by construction: the wrapperEngaged guard above
			// already established the wrapper owns the window's fullscreen state.
			if (shouldExitOsFullscreen(true, this.prevWasFullscreen) && win?.setFullScreen) {
				this.suppressFullscreenEventsUntil = Date.now() + 2000;
				win.setFullScreen(false);
			}
		} else if (this.wrapperMode === "domfs" && document.fullscreenElement) {
			document.exitFullscreen?.().catch(() => { /* already out */ });
		}
		this.wrapperMode = null;
		this.prevWasFullscreen = false;
	}

	private attachLeaveFullScreenListener(win: ElectronWindowLike) {
		if (this.leaveFullScreenListener || !win.on) return;
		this.leaveFullScreenListener = () => this.onExternalFullscreenExit();
		win.on("leave-full-screen", this.leaveFullScreenListener);
	}

	private detachLeaveFullScreenListener(win: ElectronWindowLike | null) {
		if (this.leaveFullScreenListener && win?.removeListener) {
			win.removeListener("leave-full-screen", this.leaveFullScreenListener);
		}
		this.leaveFullScreenListener = null;
	}

	// Esc-in-fullscreen, F11, the macOS green button, OS gestures: any external
	// exit from OS fullscreen ends the session completely (R3, AE5).
	// The suppression window can only be open here after a rapid settings
	// OFF→ON re-engage (release detaches this listener before its own
	// setFullScreen(false), so the plugin's own exits never reach it) — and
	// in that one case swallowing the stale leave event is correct.
	private onExternalFullscreenExit() {
		if (shouldSuppressFullscreenEvent(Date.now(), this.suppressFullscreenEventsUntil)) {
			this.suppressFullscreenEventsUntil = 0;
			return;
		}
		if (this.sessionActive && this.wrapperEngaged) this.exitZen();
	}

	private onDomFullscreenChange() {
		if (this.wrapperMode !== "domfs") return;
		if (!document.fullscreenElement && this.sessionActive && this.wrapperEngaged) {
			this.exitZen();
		}
	}

	// Mid-session "Fullscreen window" toggle: window-chrome change only —
	// the session (and its styling) stays.
	onFullscreenWindowSettingChange(enabled: boolean) {
		if (!this.sessionActive || !Platform.isDesktopApp) return;
		if (enabled) {
			this.engageWrapper();
		} else {
			this.releaseWrapper();
		}
	}

	// ---------- Esc handling (R3) ----------

	private onKeydown(evt: KeyboardEvent) {
		if (evt.key !== "Escape") return;
		// An Esc that Obsidian's keymap or CodeMirror already consumed (closing
		// a modal or suggestion synchronously) arrives here defaultPrevented —
		// honoring it preserves two-press semantics regardless of DOM timing.
		if (evt.defaultPrevented) return;
		const vault = this.app.vault as unknown as VaultWithConfig;
		const exit = shouldExitOnEsc({
			sessionActive: this.sessionActive,
			wrapperEngaged: this.wrapperEngaged,
			modalOpen: !!document.querySelector(".modal"),
			suggestionOpen: !!document.querySelector(".suggestion-container"),
			vimMode: vault.getConfig?.("vimMode") === true,
		});
		if (exit) {
			evt.preventDefault();
			this.exitZen();
		}
	}
}

class ProzenSettingTab extends PluginSettingTab {
	plugin: Prozen;

	constructor(app: App, plugin: Prozen) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		this.containerEl.createEl("h3", {
			text: "Vignette",
		})

// VIGNETTE OPACITY SETTING
		let vignetteOpacityNumber: HTMLDivElement;
		new Setting(containerEl)
			.setName('Opacity')
			.setDesc("Intensity of vignette's dimming effect. Set to 0 to turn vignetting off.")
			.addSlider((slider) => slider
				.setLimits(0.00,1,0.01)
				.setValue(this.plugin.settings.vignetteOpacity)
				.onChange(async (value) => {
					vignetteOpacityNumber.innerText = " " + value.toString();
					this.plugin.settings.vignetteOpacity = value;
					this.plugin.refreshZenAppearance();
					await this.plugin.saveSettings();
				}))
				.settingEl.createDiv("", (el: HTMLDivElement) => {
					vignetteOpacityNumber = el;
					el.style.minWidth = "2.0em";
					el.style.textAlign = "right";
					el.innerText = " " + this.plugin.settings.vignetteOpacity.toString();
				});

// VIGNETTE SCALE LINEAR SETTING
		let vignetteScaleLinearNumber: HTMLDivElement;
		new Setting(containerEl)
			.setName('Scale in text views')
			.setDesc("Determines how close to the screen's center vignetting spreads from both sides of the screen, as linear gradients.")
			.addSlider((slider) => slider
				.setLimits(5,50,5)
				.setValue(this.plugin.settings.vignetteScaleLinear)
				.onChange(async (value) => {
					vignetteScaleLinearNumber.innerText = " " + value.toString();
					this.plugin.settings.vignetteScaleLinear = value;
					this.plugin.refreshZenAppearance();
					await this.plugin.saveSettings();
				}))
				.settingEl.createDiv("", (el: HTMLDivElement) => {
					vignetteScaleLinearNumber = el;
					el.style.minWidth = "2.0em";
					el.style.textAlign = "right";
					el.innerText = " " + this.plugin.settings.vignetteScaleLinear.toString();
				});
// VIGNETTE SCALE RADIAL SETTING
		let vignetteScaleRadialNumber: HTMLDivElement;
		new Setting(containerEl)
			.setName('Scale in graph view')
			.setDesc("Determines how close to the screen's center vignetting spreads from borders of the screen, as a radial gradient.")
			.addSlider((slider) => slider
				.setLimits(5,100,5)
				.setValue(this.plugin.settings.vignetteScaleRadial)
				.onChange(async (value) => {
					vignetteScaleRadialNumber.innerText = " " + value.toString();
					this.plugin.settings.vignetteScaleRadial = value;
					this.plugin.refreshZenAppearance();
					await this.plugin.saveSettings();
				}))
				.settingEl.createDiv("", (el: HTMLDivElement) => {
					vignetteScaleRadialNumber = el;
					el.style.minWidth = "2.0em";
					el.style.textAlign = "right";
					el.innerText = " " + this.plugin.settings.vignetteScaleRadial.toString();
				});

		this.containerEl.createEl("h3", {
			text: "Animation",
		})
// CONTENT FADE-IN DURATION SETTING
		new Setting(containerEl)
			.setName('Fade-in duration')
			.setDesc('The duration (in seconds) of fade-in animation on entering Zen mode')
			.addText(text => text
				.setPlaceholder('1.2')
				.setValue(String(this.plugin.settings.animationDuration))
				.onChange(async (value) => {
					this.plugin.settings.animationDuration = Number(value)
					this.plugin.refreshZenAppearance();
					await this.plugin.saveSettings();
				}));

		this.containerEl.createEl("h3", {
			text: "Element Toggles",
		})

// SHOW HEADER TOGGLE SETTING
		new Setting(containerEl)
			.setName("Show header")
			.setDesc("Show the tab's header in Zen mode")
			.addToggle((toggle) =>	toggle
				.setValue(this.plugin.settings.showHeader)
				.onChange(async (value) => {
					this.plugin.settings.showHeader = value;
					this.plugin.refreshZenAppearance();
					await this.plugin.saveSettings();
			})
		);
// SHOW SCROLLBAR TOGGLE SETTING
		new Setting(containerEl)
			.setName("Show scrollbar")
			.setDesc("Show the scrollbar in Zen mode. If it is hidden, scrolling is still available with mousewheel, arrows, touchpad, etc.")
			.addToggle((toggle) =>	toggle
				.setValue(this.plugin.settings.showScroll)
				.onChange(async (value) => {
					this.plugin.settings.showScroll = value;
					this.plugin.refreshZenAppearance();
					await this.plugin.saveSettings();
			})
		);
// SHOW GRAPH CONTROLS SETTING
		new Setting(containerEl)
			.setName("Show graph controls")
			.setDesc("Show the graph view's controls in Zen mode")
			.addToggle((toggle) =>	toggle
				.setValue(this.plugin.settings.showGraphControls)
				.onChange(async (value) => {
					this.plugin.settings.showGraphControls = value;
					this.plugin.refreshZenAppearance();
					await this.plugin.saveSettings();
			})
		);
// SHOW MOBILE TOOLBAR TOGGLE SETTING
		if (Platform.isMobileApp) {
			new Setting(containerEl)
				.setName("Show editing toolbar")
				.setDesc("Show the toolbar above the keyboard while editing in Zen mode")
				.addToggle((toggle) =>	toggle
					.setValue(this.plugin.settings.showMobileToolbar)
					.onChange(async (value) => {
						this.plugin.settings.showMobileToolbar = value;
						this.plugin.refreshZenAppearance();
						await this.plugin.saveSettings();
				})
			);
		}

		this.containerEl.createEl("h3", {
			text: "Misc",
		})

// FULLSCREEN WINDOW SETTING (desktop only)
		if (Platform.isDesktopApp) {
			new Setting(containerEl)
				.setName("Fullscreen window")
				.setDesc("Also put the app window into OS fullscreen when entering Zen mode. Turn off for windowed Zen — distraction-free inside the window, other apps still visible.")
				.addToggle((toggle) => toggle
					.setValue(this.plugin.settings.fullscreenWindow)
					.onChange(async (value) => {
						this.plugin.settings.fullscreenWindow = value;
						this.plugin.onFullscreenWindowSettingChange(value);
						await this.plugin.saveSettings();
				})
			);
		}

// FORCE READABLE SETTING
		new Setting(containerEl)
			.setName("Force content centering")
			.setDesc("Center text content in Zen mode, even if in regular view it takes all of the screen's width (ignore 'Editor -> Readable line length' being off in Zen mode)")
			.addToggle((toggle) =>	toggle
				.setValue(this.plugin.settings.forceReadable)
				.onChange(async (value) => {
					this.plugin.settings.forceReadable = value;
					this.plugin.refreshZenAppearance();
					await this.plugin.saveSettings();
			})
		);
	}

}
