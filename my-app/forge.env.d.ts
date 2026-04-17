/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

// Track A: shell renderer globals injected by Forge VitePlugin (renderer name = "shell")
declare const SHELL_VITE_DEV_SERVER_URL: string;
declare const SHELL_VITE_NAME: string;

// Track B: pill renderer globals injected by Forge VitePlugin (renderer name = "pill")
declare const PILL_VITE_DEV_SERVER_URL: string;
declare const PILL_VITE_NAME: string;

// Track C: onboarding renderer globals injected by Forge VitePlugin (renderer name = "onboarding")
declare const ONBOARDING_VITE_DEV_SERVER_URL: string | undefined;
declare const ONBOARDING_VITE_NAME: string | undefined;
