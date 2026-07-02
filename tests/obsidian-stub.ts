/*
 * Minimal stand-in for the "obsidian" package in unit tests. The real
 * package ships type declarations only (the runtime module exists solely
 * inside the Obsidian app), so vitest needs a resolvable module to import
 * main.ts. Only the names main.ts uses as values are stubbed.
 */
export class App {}
export class ItemView {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export const Platform = { isDesktopApp: false, isMobileApp: false };
