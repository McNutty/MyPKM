# Ambit — DSRP-Native Schema

**File:** `data/dsrp_schema.sql` (source of truth)
**Database:** `data/pkm.db` (gitignored)
**Engine:** SQLite 3 — WAL mode, foreign keys enforced
**Author:** Silas, PKM Database Architect
**Spec:** `docs/dsrp-data-model-spec.md` (Derek, 2026-03-23)
**Created:** 2026-03-23
**Phase:** 1 MVP — Distinctions + Systems

---

## Overview

This is the DSRP-native database schema for Ambit. Every design decision is grounded in DSRP theory. The schema implements Phase 1: Distinctions (nodes) and Systems (part-whole hierarchy via `parent_id`). Relationships (R) and Perspectives (P) are deferred — see Section 7 of the spec for details.

The full annotated DDL, with inline DSRP rationale, lives in `data/dsrp_schema.sql`. This document summarizes each table, documents all constraints, and provides the key query patterns for application developers.

### DSRP-to-Data Mapping Summary

| DSRP Concept | Data Representation | Location |
|---|---|---|
| Distinction | A row in `nodes` | `nodes` table |
| Distinction identity | Stable integer primary key | `nodes.id` |
| Distinction boundary / label | Text content of the card | `nodes.content` |
| System (whole) | Node whose `id` is referenced as `parent_id` by another | Relational fact on `nodes` |
| System (part) | Node with non-null `parent_id` | `nodes.parent_id` |
| Part-whole relationship | FK from child to parent | `nodes.parent_id` |
| Top-level Distinction | Node with `parent_id IS NULL` | `nodes.parent_id` IS NULL |
| Map / canvas | Row in `maps` | `maps` table |
| Spatial position | Row in `layout` | `layout` table |
| Relationship (R) | **Not implemented — Phase 2** | — |
| Perspective (P) | **Not implemented — Phase 3** | — |

### Key Design Principles

- **No caste system among nodes.** Any node can be a parent. There is no `is_container`, `has_children`, or `can_have_children` column. These would be DSRP violations encoded directly in the database.
- **`parent_id` is structural. x/y are visual. They never conflate.** The structural parent lives on `nodes`. The visual position lives on `layout`. These are correlated in Phase 1 but are not the same thing.
- **Maps are not nodes.** A map is a viewing context, not a containing System. Top-level cards are not "parts of" a map. Maps are a separate table for this reason.
- **Move = UPDATE `parent_id`. Never DELETE + INSERT.** Node IDs are permanent DSRP identities.
- **`parent_id = NULL` is valid and correct** for a top-level card. It is not an error or an orphan.

---

## PRAGMA Settings

Applied at initialization and re-applied on every new connection (SQLite does not persist these across connections):

| PRAGMA | Value | Reason |
|---|---|---|
| `foreign_keys` | ON | Enforce referential integrity absolutely |
| `journal_mode` | WAL | Concurrent reads during writes; safer crash recovery |

---

## Tables

### `maps`

The canvas / workspace context for a session of DSRP thinking. A map is not a DSRP System node. It is the container for spatial layout records, not for nodes. Nodes are not children of maps structurally — they appear on maps via the `layout` table.

| Column | Type | Constraints | DSRP Purpose |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Stable map identity; referenced by `layout.map_id` |
| `name` | TEXT | NOT NULL | User-visible canvas name. No uniqueness constraint — users may have two maps with the same name. |
| `created_at` | TEXT | NOT NULL | ISO-8601 UTC timestamp |
| `updated_at` | TEXT | NOT NULL | Updated on name change only. Layout changes update the `layout` row, not the map row. |

---

### `nodes`

A node represents a DSRP Distinction. Every card on every map is a row in this table. The node's existence in the database is the act of Distinction-making.

| Column | Type | Constraints | DSRP Purpose |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Stable identity — survives moves, renames, restructuring. Never reassigned. |
| `parent_id` | INTEGER | FK → `nodes(id)`, ON DELETE RESTRICT, nullable | The DSRP part-whole relationship. NULL = top-level Distinction (no containing System). Non-null = this node is a part of the referenced node. |
| `content` | TEXT | NOT NULL DEFAULT '' | The Distinction boundary — what makes this thing this thing. Empty string is the "not yet labeled" state. NULL is never valid. |
| `node_type` | TEXT | NOT NULL DEFAULT 'card', CHECK(node_type IN ('card')) | DSRP element type. Phase 1 only allows 'card'. Phase 2 will extend to 'relationship'. This is NOT a structural capability flag. |
| `created_at` | TEXT | NOT NULL | ISO-8601 UTC |
| `updated_at` | TEXT | NOT NULL | ISO-8601 UTC; updated on content or parent_id change |
| `metadata` | TEXT | nullable | JSON blob for rendering hints, color/style overrides, app-level metadata not yet warranting its own column. Must be valid JSON or NULL — validated at the application layer. Do not use for structural or spatial data. |

**Indexes:**

| Index | Column | Purpose |
|---|---|---|
| `idx_nodes_parent_id` | `parent_id` | Most common structural query: "give me all children of node X." Makes WHERE parent_id = X O(number of children), not O(total nodes). |

---

### `layout`

A layout row places a node on a map at a specific visual position. This is the only place spatial data lives. The separation of structural relationships (`parent_id` on `nodes`) from visual positions (this table) is a core architectural invariant.

One row = one node appearing on one map. At MVP, a node appears at most once per map (UNIQUE constraint).

A node with no layout rows exists in the database but is not currently visible on any canvas. This is a valid state.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Layout row identity; returned as `layout_id` in queries for use in drag-update writes |
| `node_id` | INTEGER | NOT NULL, FK → `nodes(id)`, ON DELETE CASCADE | The node being placed |
| `map_id` | INTEGER | NOT NULL, FK → `maps(id)`, ON DELETE CASCADE | The map this position belongs to |
| `x` | REAL | NOT NULL | Canvas x-coordinate (canvas units, not pixels) |
| `y` | REAL | NOT NULL | Canvas y-coordinate (canvas units, not pixels) |
| `width` | REAL | NOT NULL, CHECK(width > 0) | Card width in canvas units |
| `height` | REAL | NOT NULL, CHECK(height > 0) | Card height in canvas units |

**Table-level constraint:**

| Constraint | Mechanism | Purpose |
|---|---|---|
| UNIQUE(node_id, map_id) | Unique constraint | MVP invariant: one node has exactly one unambiguous position per map |

**Indexes:**

| Index | Column | Purpose |
|---|---|---|
| `idx_layout_map_id` | `map_id` | Most common layout query: "give me all nodes on map X" |
| `idx_layout_node_id` | `node_id` | Node-to-map lookup: "is this node on any map, and which?" |

---

## Constraint Inventory

### Database-Enforced Constraints

| Constraint | Mechanism | Rationale |
|---|---|---|
| `nodes.parent_id` references a valid node ID or NULL | FK `REFERENCES nodes(id)` | Referential integrity. A node cannot point to a parent that does not exist. |
| Deleting a parent with children is blocked | `ON DELETE RESTRICT` on `nodes.parent_id` | Prevents silent data loss. The application must explicitly resolve children (move or delete them) before deleting a parent. CASCADE is wrong here: it would silently destroy nested user thinking. |
| `nodes.content` is never NULL | `NOT NULL DEFAULT ''` | Prevents query errors on content operations. Empty string is the correct "no label yet" state. |
| `nodes.node_type` is a known value | `CHECK(node_type IN ('card'))` | Prevents invalid type values. Extend the CHECK list in Phase 2; do not remove the constraint. |
| `layout.width > 0` and `layout.height > 0` | `CHECK` constraints | A zero or negative dimension is a rendering error, not a valid state. Caught at the data layer. |
| Each node appears at most once per map | `UNIQUE(node_id, map_id)` on `layout` | MVP invariant: unambiguous single position per node per map. |
| Deleting a node removes its layout rows | `ON DELETE CASCADE` on `layout.node_id` | Layout data for a non-existent node is meaningless. Layout rows have no independent existence. |
| Deleting a map removes its layout rows | `ON DELETE CASCADE` on `layout.map_id` | Same reasoning. The nodes themselves survive map deletion and may be re-placed later. |

### Application-Layer Constraints

| Constraint | Mechanism | Rationale |
|---|---|---|
| No cycles in the `parent_id` chain | Pre-write cycle detection query (see below) | SQLite CHECK constraints cannot express recursive conditions. Must run before any UPDATE that sets a `parent_id`. |
| Child visual bounds fit within parent visual bounds | Canvas rendering layer (Wren) | A rendering invariant, not a data invariant. The database stores whatever dimensions the app writes; the rendering layer enforces containment. |
| `parent_id` and spatial position are never conflated | Code review + schema design | No database constraint prevents the app from deriving `parent_id` from layout positions. Enforced by design discipline and code review. |
| `metadata` is valid JSON or NULL | JSON validation before write | SQLite has no native JSON type constraint. Validate in the application before writing. |
| Move = UPDATE `parent_id`, never DELETE + INSERT | Code review + application pattern | The database cannot enforce this. The application must never DELETE a node to "move" it. This invariant preserves node IDs across all restructuring operations. |
| `created_at` and `updated_at` are ISO-8601 UTC | Timestamp generation before write | SQLite stores TEXT; format is the application's responsibility. Always write UTC, always include 'Z' or '+00:00'. |

---

## Cycle Detection (Application Layer)

Run the cycle detection query before every `UPDATE nodes SET parent_id = :proposed_parent_id`. Do not run it for `INSERT` with autoincrement IDs (the new node does not exist yet, so a cycle via INSERT is impossible). Do not run it when setting `parent_id = NULL` (removing a parent cannot create a cycle).

**When to check:**

| Operation | Check Required |
|---|---|
| INSERT node, parent_id = NULL (autoincrement) | No |
| INSERT node, parent_id = X (autoincrement) | No — node doesn't exist yet |
| INSERT node, parent_id = X (explicit id supplied) | Yes |
| UPDATE parent_id from A to B | Yes |
| UPDATE parent_id to NULL | No |

**Usage pattern:**
1. Run the cycle detection query with `:node_id` and `:proposed_parent_id`.
2. If `cycle_exists = 1`: abort, return error to UI ("This move would create a circular containment, which is not allowed.").
3. If `cycle_exists = 0`: proceed with UPDATE.
4. Additional defense: check `proposed_parent_id != node_id` before running the full query (catches the self-parent case immediately).

The full cycle detection query is included as a comment block in `data/dsrp_schema.sql`.

---

## Key Queries

All six queries are included as commented examples in `data/dsrp_schema.sql`. Summary:

| Query | Purpose |
|---|---|
| Query 1: Direct children of a node | Basic parent-child traversal; one level down |
| Query 2: Full subtree (recursive CTE) | All descendants at all depths; includes depth column for tree reconstruction |
| Query 3: Ancestor chain to root | Breadcrumb navigation; also underpins cycle detection |
| Query 4: Top-level nodes on a map | Initial canvas render — `parent_id IS NULL` nodes with a layout row on the map |
| Query 5: Single node with layout | Point lookup; returns `layout_id` for drag-update writes |
| Query 6: Full subtree with layout (render query) | The primary render query — node :root_id and all descendants with positions on a given map |

Query 6 is the most important and most complex. It is a recursive CTE joined to `layout` via LEFT JOIN (nodes in the subtree may not have a layout row on the current map). The rendering layer must handle `layout_id IS NULL` rows. Binding `:root_id` to a top-level node serves as the full-canvas initial load query.

---

## Deferred to Future Phases

### Phase 2: Relationships (R)

**Will add:**
- `node_type` CHECK constraint extended to include `'relationship'`
- A `relationship_edges` table: `(id, relationship_node_id, source_node_id, target_node_id, role)` where `role` is `'action'` or `'reaction'`
- Relationship nodes are rows in `nodes` (same table, `node_type = 'relationship'`), giving them an ID, content (label on the line), and the ability to have children

**Current schema is ready:** `node_type` column is already in `nodes`; the CHECK constraint just needs extending. No schema migration required.

**What Phase 2 must not do:** Implement Relationships as a `links` table with no corresponding `nodes` row. That would deny Relationships their DSRP identity and make them non-extensible.

### Phase 3: Perspectives (P)

**Will likely add:**
- A `perspectives` table, or an extension of the `maps` concept
- The `layout` UNIQUE constraint `(node_id, map_id)` may evolve to `(node_id, perspective_id)`, or a parallel `perspective_layout` table is added

**Current schema is ready:** The separate `layout` table (not spatial data on `nodes`) fully decouples node identity from visual appearance. The same node can appear in multiple maps/perspectives with different positions — only a new `map_id` (or `perspective_id`) is needed.

### Full-Text Search (Post-MVP)

**How to add** (do not add at MVP):

```sql
CREATE VIRTUAL TABLE nodes_fts USING fts5(
    content,
    content='nodes',
    content_rowid='id'
);
```

**Why deferred:** FTS adds write-time indexing overhead and rebuild complexity. For MVP, the node graph is small enough that a LIKE query on `nodes.content` is adequate.

### Collaboration (Future)

Integer autoincrement primary keys assigned by a single SQLite instance are incompatible with multi-user sync. A migration to UUID v4 or v7 is required before any collaboration feature ships. Do not add features that depend on cross-device node ID consistency (e.g., shareable links with node IDs) until this migration is complete.

---

## Invariants Quick Reference

1. Every node row is a Distinction. It exists because a distinction was made between this thing and everything else.
2. `parent_id = NULL` is valid and correct for a top-level card. It is not an error or orphan.
3. No caste system. Any node can be a parent. Do not add `is_container`, `has_children`, or capability-controlling flags.
4. `parent_id` is structural. x/y are visual. They never swap.
5. Maps are not nodes. A map is a viewing context, not a containing System.
6. Move = UPDATE `parent_id`. Never DELETE + INSERT. Node IDs are permanent identities.
7. No cycles. Run the cycle detection query before every UPDATE to `parent_id`.
8. UNIQUE(node_id, map_id) in `layout`. At MVP, a node appears exactly once per map.
9. ON DELETE RESTRICT on `nodes.parent_id`. Resolve children before deleting a parent. No silent cascading deletion of user thinking.
10. ON DELETE CASCADE on `layout`. Layout rows have no independent existence. They follow their node and map.
