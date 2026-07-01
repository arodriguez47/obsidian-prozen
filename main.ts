import { App, ItemView, Platform, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from "obsidian";

interface PluginSettings {
	animationDuration: number,
	showHeader: boolean,
	showScroll: boolean,
	showGraphControls: boolean,
	showMobileToolbar: boolean,
	forceReadable: boolean,
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
	vignetteOpacity: 0.75,
	vignetteScaleLinear: 20,
	vignetteScaleRadial: 75
}

export default class Prozen extends Plugin {
	settings: PluginSettings;
	// Leaf currently in CSS-based (pseudo-fullscreen) Zen mode. Used on
	// platforms without the Fullscreen API, i.e. Obsidian mobile.
	zenLeaf: WorkspaceLeaf | null = null;

	async onload() {
		await this.loadSettings();
		this.addCommand({
			id: "zenmode",
			name: "Zen mode",
			callback: this.fullscreenMode.bind(this),
		});
		this.addSettingTab(new ProzenSettingTab(this.app, this));
	}

	onunload() {
		this.exitZen();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	fullscreenMode() {
		// Use ItemView for multiple view types (previously it was only MarkdownView)
		const view = this.app.workspace.getActiveViewOfType(ItemView);
		if (!view) return;
		const leaf = view.leaf;
		// Don't trigger fullscreen mode when current leaf is empty.
		if(leaf.view.getViewType() === "empty") return;

		const root = document.documentElement
		root.style.setProperty('--fadeIn-duration', this.settings.animationDuration + 's')
		root.style.setProperty('--vignette-opacity', String(this.settings.vignetteOpacity))
		root.style.setProperty('--vignette-scale-linear', this.settings.vignetteScaleLinear + '%')
		root.style.setProperty('--vignette-scale-radial', this.settings.vignetteScaleRadial + '%')

		const containerEl = (leaf as any).containerEl as HTMLElement;

		// The Fullscreen API isn't available in Obsidian mobile's webview
		// (iOS has no element fullscreen at all), so fall back to a
		// CSS-based pseudo-fullscreen there.
		if (Platform.isMobileApp || typeof containerEl.requestFullscreen !== "function") {
			this.zenLeaf ? this.exitZen() : this.enterZen(leaf);
			return;
		}

		if (!document.fullscreenElement){
			containerEl.requestFullscreen();
			this.addStyles(leaf)
		} else {
			document.exitFullscreen();
			this.removeStyles(leaf)
		}
		containerEl.onfullscreenchange = () => {
			if (!document.fullscreenElement){
				this.removeStyles(leaf)
			}
		}
	}

	enterZen(leaf: WorkspaceLeaf) {
		this.zenLeaf = leaf;
		const containerEl = (leaf as any).containerEl as HTMLElement;
		containerEl.classList.add("prozen-fullscreen");
		document.body.classList.add("prozen-zen");
		if (!this.settings.showMobileToolbar) { document.body.classList.add("prozen-hide-toolbar") }
		this.addStyles(leaf);
	}

	exitZen() {
		if (!this.zenLeaf) return;
		const leaf = this.zenLeaf;
		this.zenLeaf = null;
		const containerEl = (leaf as any).containerEl as HTMLElement;
		containerEl.classList.remove("prozen-fullscreen");
		document.body.classList.remove("prozen-zen", "prozen-hide-toolbar");
		this.removeStyles(leaf);
	}

	addStyles(leaf: WorkspaceLeaf) {
		const view = leaf.view as any;
		const viewEl: HTMLElement = view.contentEl
		const header: HTMLElement = view.headerEl
		const isGraph = leaf.view.getViewType() === "graph"

		if (!this.settings.showScroll){	viewEl.classList.add("noscroll") }
		if (isGraph && !this.settings.showGraphControls) { view.dataEngine.controlsEl.classList.add("hide") }
		isGraph ? viewEl.classList.add("vignette-radial") : viewEl.classList.add("vignette-linear")
		// editMode is only present on markdown views in editing mode (e.g.
		// not in reading mode on mobile), hence the optional chaining.
		if (!isGraph && this.settings.forceReadable) { view.editMode?.editorEl?.classList.add("is-readable-line-width") }


		viewEl.classList.add("animate")
		this.settings.showHeader ? header.classList.add("animate") : header.classList.add("hide")

	}

	removeStyles(leaf: WorkspaceLeaf) {
		const view = leaf.view as any;
		const viewEl: HTMLElement = view.contentEl
		const header: HTMLElement = view.headerEl
		const isGraph = leaf.view.getViewType() === "graph"

		if (isGraph) {
			view.dataEngine.controlsEl.classList.remove("animate", "hide")
		} else if (!(this.app.vault as any).getConfig('readableLineLength')) {
			view.editMode?.editorEl?.classList.remove("is-readable-line-width")
		}

		viewEl.classList.remove("vignette-linear", "vignette-radial", "animate", "noscroll")
		header.classList.remove("animate", "hide")
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
						document.body.classList.toggle("prozen-hide-toolbar",
							document.body.classList.contains("prozen-zen") && !value);
						await this.plugin.saveSettings();
				})
			);
		}

		this.containerEl.createEl("h3", {
			text: "Misc",
		})

// FORCE READABLE SETTING
		new Setting(containerEl)
			.setName("Force content centering")
			.setDesc("Center text content in Zen mode, even if in regular view it takes all of the screen's width (ignore 'Editor -> Readable line length' being off in Zen mode)")
			.addToggle((toggle) =>	toggle
				.setValue(this.plugin.settings.forceReadable)
				.onChange(async (value) => {
					this.plugin.settings.forceReadable = value;
					await this.plugin.saveSettings();
			})
		);
	}

}
