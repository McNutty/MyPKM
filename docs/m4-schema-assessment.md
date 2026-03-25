# M4 Schema Assessment
**Author:** Silas, PKM Database Architect
**Date:** 2026-03-25
**Status:** Final

---

## Summary

The existing schema and Rust layer are in good shape for M4. The `maps` table is present and structurally correct. Cascade delete for map deletion is partially -- but not fully -- handled by FK constraints, and requires one deliberate workaround. The notes column is a straightforward additive migration. No destructive schema changes are needed.

Two new Rust commands are needed for model management. One new command and one query extension are needed for the note panel. One architectural note requires attention before Feature 1 is built.

---

## Question 1: Model CRUD -- What Already Exists vs. What Is Missing

### What already exists

The `maps` table is defined in `db.rs` (`SCHEMA_DDL`):

```
maps (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT, updated_at TEXT)
```

The `layout` table has `map_id` as a foreign key referencing `maps(id) ON DELETE CASCADE`. This is correct.

`get_map_nodes(map_id)` is implemented in `commands.rs` and filters nodes by `layout.map_id`. It is already multi-model-aware.

`get_map_relationships(map_id)` is implemented but currently ignores `_map_id` -- it returns all relationships globally. The comment in the code acknowledges this: "the single-map invariant means this is equivalent to all relationships on the given map." This must be fixed before Feature 1 ships (see note below).

A default map is seeded at init time if no maps exist: `INSERT INTO maps (name, ...) VALUES ('My Canvas', ...)`. This satisfies the "default model on first run" requirement.

### What is missing

The following four Rust commands do not exist and must be written for M4:

| Command | Signature | Notes |
|---|---|---|
| `create_map` | `(name: String) -> Result<MapData, String>` | Insert into `maps`, return `{id, name}` |
| `get_all_maps` | `() -> Result<Vec<MapData>, String>` | `SELECT id, name FROM maps ORDER BY created_at` |
| `rename_map` | `(id: i64, name: String) -> Result<(), String>` | `UPDATE maps SET name = ?, updated_at = ?` |
| `delete_map` | `(id: i64) -> Result<i64, String>` | See cascade analysis in Question 2 |

A new shared struct is also needed:

```rust
pub struct MapData {
    pub id: i64,
    pub name: String,
}
```

### The `get_map_relationships` scoping issue

Currently `get_map_relationships` ignores its `map_id` argument and returns all relationships. This was acceptable under the single-map invariant but breaks immediately once Feature 1 ships and multiple maps exist. Relationships need to be scoped to a map.

The cleanest fix is to add a `map_id` column to the `relationships` table. However, the current design does not have this -- relationships are associated with a map implicitly through the nodes they connect (which have layout rows on specific maps). Since the same node theoretically could appear on multiple maps (a future Perspectives scenario), we cannot reliably infer map membership from endpoints.

For M4, the pragmatic approach is: add `map_id INTEGER REFERENCES maps(id) ON DELETE CASCADE` to the `relationships` table, populated at insert time from the `map_id` argument already passed to `create_relationship`. The `get_map_relationships` filter then becomes `WHERE r.map_id = ?1`.

This is an additive migration (new nullable column, backfilled for existing rows) and does not require a table rebuild. The migration script is described in Question 4.

---

## Question 2: Cascade Delete -- Does `delete_map` Clean Up Cleanly?

This requires careful analysis. The M4 spec requires that deleting a map removes all its nodes, layout rows, and relationships with no orphaned data.

### What cascades automatically

- `layout.map_id -> maps(id) ON DELETE CASCADE`: Deleting a map removes all its layout rows. This is correct.
- `layout.node_id -> nodes(id) ON DELETE CASCADE`: Deleting a node removes its layout rows. This is the inverse direction and does not help here.
- `relationships.source_id -> nodes(id) ON DELETE CASCADE`: Deleting a node cascades to its relationship rows.
- `relationships.rel_node_id -> nodes(id) ON DELETE CASCADE`: Deleting a companion node cascades to the relationship row.

### The problem

`nodes` does not have a direct FK to `maps`. Nodes are associated with a map only through layout rows. Deleting a map cascades to `layout` rows only -- the nodes themselves are left behind as orphans. Those orphan nodes then have no layout row on any map, making them invisible but still occupying space in the database.

This is the FK constraint gap. Deleting a map via `DELETE FROM maps WHERE id = ?` will:
1. Cascade-delete all `layout` rows for that map. (Correct.)
2. Leave all `nodes` that were only on that map as orphans. (Incorrect.)
3. Leave all `relationships` between those nodes intact (until the orphan nodes are eventually cleaned up). (Incorrect.)

### Recommendation for `delete_map`

`delete_map` must be implemented as an explicit multi-step transaction in Rust, not a simple `DELETE FROM maps`. The correct sequence is:

1. Collect all node IDs that have layout rows on this map AND have no layout rows on any other map (i.e., nodes that exist exclusively on this map and will become true orphans).
2. For those nodes, delete relationships (source_id, target_id, or rel_node_id in the orphan set) and companion nodes, using the same pattern already established in `delete_node_cascade`.
3. Delete the map row. The cascade cleans up layout rows automatically.

Alternatively -- and this is the simpler approach for M4 -- collect all node IDs with a layout row on this map, delete their relationship rows explicitly, then delete the nodes themselves deepest-first (respecting the `ON DELETE RESTRICT` on `nodes.parent_id`), then delete the map. This mirrors `delete_node_cascade` logic and is already well-tested.

The simpler approach is the right call for M4. The edge case of a node appearing on multiple maps (Perspectives) does not exist yet. When it does, the cleanup logic will need to change, but that is a Future problem.

The conclusion for Q28 in the M4 open questions: cascade delete does NOT happen cleanly via FK constraints alone. `delete_map` requires explicit Rust logic. This is not a schema deficiency -- it is a deliberate consequence of the normalized design where nodes are not directly owned by a map.

---

## Question 3: Notes Column -- Column or Separate Table?

**Recommendation: add `notes TEXT` as a nullable column on the `nodes` table.**

The M4 spec's own recommendation is correct here, and I concur. The reasoning:

- Notes in M4 are per-card, one block of text per card, no versioning required, no multi-author concern. This is a 1:1 relationship between a node and its note content.
- A separate `node_notes` table would add a join to every card-fetch query and buy nothing in return for M4's use case.
- The `nodes` table already has a `metadata TEXT` JSON column for open-ended extras, but notes are not metadata -- they are first-class content that the user directly authors and reads. Stuffing notes into the JSON blob would make them invisible to any future FTS indexing and harder to query. A dedicated column is the right call.
- `notes TEXT DEFAULT NULL` is an additive migration: one `ALTER TABLE ADD COLUMN` statement, idempotent with the existing error-swallowing pattern already in `db.rs`.

The column should be nullable (not `DEFAULT ''`), so we can distinguish "this card has never had a note written" from "this card has an empty note." The frontend treats `NULL` and `''` identically for display, but it matters for analytics and future features.

When notes grow to require versioning, full-text search, or block-level structure, extract to a separate table at that point. For M4, the column is the right tool.

---

## Question 4: Schema Migrations Needed

Two additive migrations are required. Both follow the established idempotent `ALTER TABLE ADD COLUMN` pattern already in `db.rs` (the error-swallowing block that catches "duplicate column name").

### Migration A: `nodes.notes`

```sql
ALTER TABLE nodes ADD COLUMN notes TEXT DEFAULT NULL
```

Add this to the existing migration block in `db.rs`. No data migration needed -- existing rows get `NULL`, which is the correct default.

### Migration B: `relationships.map_id`

```sql
ALTER TABLE relationships ADD COLUMN map_id INTEGER REFERENCES maps(id) ON DELETE CASCADE
```

This column starts as `NULL` for all existing rows. A backfill is needed for existing relationship rows so that `get_map_relationships` does not silently exclude them after the filter is added. The backfill can be done in Rust immediately after the `ALTER TABLE`:

```sql
UPDATE relationships
SET map_id = (
    SELECT l.map_id FROM layout l WHERE l.node_id = relationships.source_id LIMIT 1
)
WHERE map_id IS NULL
```

This uses the source node's layout row to infer the map. It is a best-effort backfill -- it works correctly under the current single-map invariant where every node belongs to exactly one map (map ID 1). Any rows that still have `map_id IS NULL` after the backfill are orphaned data from a pre-map-scoping era and can be left as-is or cleaned up separately.

After backfilling, add an index:

```sql
CREATE INDEX IF NOT EXISTS idx_rel_map_id ON relationships(map_id)
```

Both migrations are safe to run on a live M3 database.

---

## Complete List of Rust Commands and IPC Methods Needed for M4

### New Rust commands (not yet in `commands.rs`)

| Rust function | Purpose |
|---|---|
| `create_map(name)` | Create a new map, return `MapData {id, name}` |
| `get_all_maps()` | Return all maps as `Vec<MapData>` |
| `rename_map(id, name)` | Update map name |
| `delete_map(id)` | Explicit multi-step cascade delete, return deleted map ID |
| `update_node_notes(node_id, notes)` | Set `nodes.notes` for a card |

### New IPC methods (to add to `src/ipc/db.ts`)

| TypeScript method | Maps to Rust command |
|---|---|
| `createMap(name: string): Promise<MapData>` | `create_map` |
| `getAllMaps(): Promise<MapData[]>` | `get_all_maps` |
| `renameMap(id: number, name: string): Promise<void>` | `rename_map` |
| `deleteMap(id: number): Promise<number>` | `delete_map` |
| `updateNodeNotes(nodeId: number, notes: string \| null): Promise<void>` | `update_node_notes` |

### Existing commands that need modification

| Rust function | Required change |
|---|---|
| `get_map_relationships` | Add `WHERE r.map_id = ?1` filter (after Migration B and backfill) |
| `create_relationship` | Persist `map_id` to the new column |
| `get_map_nodes` | Add `notes` field to the `NodeWithLayout` struct and SELECT |

### Existing TypeScript interface that needs extension

| Interface | Change |
|---|---|
| `NodeWithLayout` | Add `notes: string \| null` field |
| `DbInterface` | Add the five new methods listed above |

A new `MapData` interface is also needed:

```typescript
export interface MapData {
  id: number
  name: string
}
```

### Evaluation: `batch_update_layouts` for multi-select

The M4 spec (Feature 3) asks Silas to evaluate whether a `batch_update_layouts(updates: [{id, x, y, w, h}])` command is worth adding for multi-select group moves.

Assessment: defer for M4. The individual `update_node_layout` command is a single indexed UPDATE on a small table. For groups of 10-20 cards, firing 10-20 sequential IPC calls over Tauri's local bridge will complete in well under 100ms -- imperceptible to the user. A batch command adds implementation complexity (serializing the update array across the IPC boundary, handling partial failures) for no measurable benefit at M4 scale. Revisit if profiling reveals a real bottleneck in M5.

---

## What Does Not Need to Change

- The `maps` table structure is correct as-is. No columns need to be added.
- The `nodes` table structure is correct except for the `notes` column addition.
- The `layout` table is correct. The `map_id` FK and cascade are already properly defined.
- The `delete_node_cascade` command logic is sound and can be reused as the model for `delete_map`.
- All M3 commands (`create_node`, `update_node_content`, `update_node_layout`, `update_node_parent`, `delete_node`, `delete_node_cascade`, `create_relationship`, `update_relationship`, `reattach_relationship`, `flip_relationship`, `delete_relationship`) require no changes for M4.

---

## Delivery Sequence

Silas's work unblocks Wren's feature work. The sequencing:

1. Migration A (`nodes.notes`) + `update_node_notes` command -- delivers Feature 2 schema dependency.
2. Migration B (`relationships.map_id`) + backfill + `create_map`, `get_all_maps`, `rename_map`, `delete_map` commands + fix to `get_map_relationships` and `create_relationship` -- delivers Feature 1 schema dependency.
3. Extend `NodeWithLayout` struct and SELECT in `get_map_nodes` to include `notes` -- required for Feature 2 to read notes without a separate query.

Items 1 and 2 can be done in either order. Item 3 is a minor addition that should accompany Item 1.

All work can proceed immediately, in parallel with Wren's Pre-1.
