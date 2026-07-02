import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			// The obsidian package is types-only; unit tests resolve it to a stub.
			obsidian: fileURLToPath(new URL("./tests/obsidian-stub.ts", import.meta.url)),
		},
		// Prefer .ts over .js so "../main" resolves to main.ts, not the built
		// main.js bundle at the repo root.
		extensions: [".ts", ".mts", ".js", ".mjs", ".json"],
	},
});
