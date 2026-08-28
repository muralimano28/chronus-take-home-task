import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        clearMocks: true,
        testTimeout: 10000,
        setupFiles: ["./tests/setup.ts"],
        globalSetup: ["./tests/global-setup.ts"],
        fileParallelism: false,
    },
});