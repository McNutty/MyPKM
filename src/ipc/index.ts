import { StubDb } from './db-stub'
import { TauriDb } from './db-tauri'
import type { DbInterface } from './db'

export type { NodeWithLayout, DbInterface } from './db'

// Detect Tauri environment at module init time.
// Both classes are statically imported but only one is instantiated,
// so the unused class is tree-shaken in non-Tauri builds.
// Top-level await is avoided: build target is es2021 (vite.config.ts).
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const db: DbInterface = isTauri ? new TauriDb() : new StubDb()
