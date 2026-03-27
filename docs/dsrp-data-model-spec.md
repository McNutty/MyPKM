# DSRP Data Model Spec: Ambit MVP

**Author:** Derek, DSRP & Systems Thinking Expert
**Date:** 2026-03-23
**Status:** FOR IMPLEMENTATION -- deliver to Silas for schema build
**Companion doc:** `docs/derek-dsrp-review.md` (Section 6 outlines this document's scope)

---

## Purpose

This document is the formal data model spec for Ambit MVP (Phase 1: Distinctions + Systems). It is written for Silas to implement directly. Every design decision in this document has a DSRP grounding, stated explicitly so the rationale is not lost when implementation pressures arise.

The spec covers three tables: `nodes`, `maps`, `layout`. It does not cover Phase 2 (Relationships), Phase 3 (Perspectives), full-text search, or collaboration. What is deferred and why is stated in Section 7.

---

## Section 1: DSRP-to-Data Mapping

This table is the formal translation layer between DSRP theory and the MVP schema. Every column that exists has a DSRP justification. Every DSRP concept that does not have a column yet has an explanation of why.

| DSRP Concept | Data Representation | Table / Column | Notes |
|---|---|---|---|
| **Distinction** | A row in `nodes` | `nodes` | The act of making a Distinction is the act of creating a node. The node's existence in the database is the Distinction. |
| **Distinction identity** | The node's stable primary key | `nodes.id` | A Distinction's identity must survive moves, renames, and restructuring. The ID never changes. This is why move = UPDATE `parent_id`, never DELETE + INSERT. |
| **Distinction boundary / label** | The node's text content | `nodes.content` | What makes this thing this thing and not something else. The label draws the boundary. |
| **System (whole)** | A node whose `id` appears as `parent_id` on at least one other node | `nodes.id` referenced by `nodes.parent_id` | Being a whole is a relational fact, not an intrinsic property of the node. There is no `is_container` flag. Whether a node is a whole is determined by querying whether any other node's `parent_id` points to it. |
| **System (part)** | A node with a non-null `parent_id` | `nodes.parent_id` (non-null) | Being a part is also relational. The same node is simultaneously a whole (if it has children) and a part (if it has a parent). This is the fractal nature of DSRP. |
| **Part-whole relationship** | The foreign key from child to parent | `nodes.parent_id` FK | One level of the hierarchy. Arbitrary depth via recursive CTE. This single FK encodes the entire Systems structure of the MVP. |
| **Top-level Distinction** | A node with no parent | `nodes.parent_id IS NULL` | A Distinction does not require a containing System to exist. Top-level nodes are valid DSRP objects. NULL is correct here, not a missing-data anomaly. |
| **Map / canvas** | A row in `maps` | `maps` | The workspace context within which thinking is organized. Not a DSRP System -- closer to a Perspective in the technical DSRP sense. Maps are first-class entities, not special nodes. See design decision in Section 2. |
| **Spatial position** | A row in `layout` | `layout.x`, `layout.y`, `layout.width`, `layout.height` | Visual representation of a node on a specific map. Separate from structural identity. A node's position is a property of its appearance in a given view, not a property of the node itself. |
| **Relationship (R)** | Not implemented in MVP | -- | Deferred to Phase 2. The schema is designed to accommodate it. See Section 7. |
| **Perspective (P)** | Not implemented in MVP | -- | Deferred to Phase 3. The layout table's (node_id, map_id) design already supports multiple views. See Section 7. |

### Key Principle: No Caste System Among Nodes

The schema does not distinguish between "container nodes" and "leaf nodes." Every node is equally capable of being a parent. The `node_type` column distinguishes DSRP element types (`card` now, `relationship` in Phase 2) -- it does not distinguish structural capability. Do not add `is_container`, `can_have_children`, or `has_children` columns. These would encode a DSRP violation directly into the database.

---

## Section 2: Design Decisions

These decisions are stated explicitly so they are on record and do not get relitigated during implementation.

### Decision 1: Maps are a separate table, not special nodes

A map is not a node with `parent_id = NULL` and some `is_map = true` flag. It is a distinct entity in a distinct table.

**Why:** A node is a Distinction -- something being thought about. A map is the context within which thinking is being done. These are categorically different things. If maps were special nodes, we would be forced into the DSRP violation of treating the map as a System that contains everything on it -- i.e., every top-level card would be "a part of the map." That is wrong. Top-level cards exist in a map's viewing context; they are not structurally contained by it. `parent_id = NULL` is the correct encoding for a top-level card, and there should be no "root map node" sitting above them.

Additionally, in Phase 3, a single node needs to appear in multiple maps/Perspectives with different positions. This requires maps to have their own IDs that layout rows can reference. A node-as-map design forecloses this cleanly.

### Decision 2: parent_id is structural; x/y/width/height are visual. Never conflate.

The `parent_id` on `nodes` encodes the DSRP part-whole relationship. The `x, y, width, height` on `layout` encode how a node appears visually on a given map. These two things are correlated in Phase 1 (your structural parent is also your visual container) but they are not the same thing and must not live in the same column.

**Why it matters now:** Conflating them works fine until Phase 3 (Perspectives), at which point a node might appear visually isolated on one Perspective even though structurally it is a child of something. If the structural relationship is on the layout table, you cannot have one without the other.

**Instruction:** `parent_id` stays on `nodes` (structural). `x, y, width, height` go in `layout` (visual). No spatial data on `nodes`. No structural parent reference on `layout`.

### Decision 3: node_type exists from day one, is always 'card' in Phase 1

The `node_type TEXT NOT NULL DEFAULT 'card'` column is added to `nodes` at MVP. Its only valid value in Phase 1 is `'card'`. In Phase 2 it gains `'relationship'` as a valid value.

**Why:** Adding this column in Phase 2, when Relationship nodes need to exist in the `nodes` table, would require a schema migration and a data backfill. Adding it now costs nothing and means Phase 2 is a CHECK constraint change plus new application logic, not a schema migration.

**This column is not a caste system.** It does not distinguish "nodes that can have children" from "nodes that cannot." It distinguishes DSRP element types (card, relationship). A relationship node in Phase 2 is itself a Distinction -- it can, in theory, have children. The column does not restrict structural capability.

### Decision 4: Move = UPDATE parent_id, never DELETE + INSERT

When a user moves a node from one parent to another (or to the top level), the implementation must issue an `UPDATE nodes SET parent_id = ? WHERE id = ?`. It must never issue a `DELETE` followed by an `INSERT`.

**Why:** The node's ID is its DSRP identity. Deleting and reinserting assigns a new ID, severing any future relationship edges (Phase 2) that reference the old ID. Even in Phase 1, before relationship edges exist, establishing this as a firm invariant now prevents accidental breakage during Phase 2 development.

### Decision 5: Integer primary keys for MVP; UUID migration flagged for collaboration

Phase 1 uses `INTEGER PRIMARY KEY` (SQLite autoincrement). This is simple, fast, and correct for single-user local-first.

**Flag for future:** If Ambit ever needs multi-user sync or cloud collaboration, integer PKs assigned by a single SQLite instance will conflict. At that point, a migration to UUID v4 or v7 is required. This is a known future cost, not an oversight.

---

## Section 3: Full Annotated DDL

The three tables in dependency order (no FK can reference a table that does not exist yet).

```sql
-- ============================================================
-- TABLE: maps
-- ============================================================
-- A map is the canvas / workspace context for a session of
-- DSRP thinking. It is not a DSRP System node. It is the
-- container for spatial layout records, not for nodes.
--
-- Nodes are NOT children of maps in any structural sense.
-- A node "appears on" a map (via the layout table).
-- A node "belongs to" its parent node (via parent_id).
-- These are different relationships.
-- ============================================================

CREATE TABLE maps (
    id          INTEGER PRIMARY KEY,  -- stable identity, never reassigned
    name        TEXT    NOT NULL,     -- user-visible canvas name; no uniqueness
                                      -- constraint (users can have two maps
                                      -- with the same name; that is their choice)
    created_at  TEXT    NOT NULL,     -- ISO-8601 UTC timestamp, e.g. '2026-03-23T14:00:00Z'
    updated_at  TEXT    NOT NULL      -- updated on name change; not on layout changes
                                      -- (layout changes update the layout row, not the map row)
);


-- ============================================================
-- TABLE: nodes
-- ============================================================
-- A node represents a DSRP Distinction. Every card on every
-- map is a row in this table. The node's existence is the act
-- of Distinction-making.
--
-- Structural relationships (part-whole / Systems) are encoded
-- via parent_id. Visual positions are in the layout table.
--
-- DO NOT add:
--   - is_container (every node can be a container)
--   - has_children (derived by querying; not a stored property)
--   - x, y, width, height (those go in layout)
--   - map_id (a node is not owned by a map; it appears on maps
--             via layout rows)
-- ============================================================

CREATE TABLE nodes (
    id          INTEGER PRIMARY KEY,

    -- STRUCTURAL: The DSRP part-whole relationship.
    -- NULL = top-level Distinction (no containing System).
    -- Non-null = this node is a part of the referenced node.
    -- ON DELETE RESTRICT: you must move or delete children
    -- before deleting a parent. Do not cascade-delete children
    -- silently; that would erase user thinking without warning.
    parent_id   INTEGER REFERENCES nodes(id) ON DELETE RESTRICT,

    -- The label/text of the card. This is the Distinction
    -- boundary -- what makes this thing this thing.
    -- Empty string is valid (a card can be created before
    -- the user has named it). NULL is not valid; use ''.
    content     TEXT    NOT NULL DEFAULT '',

    -- DSRP element type. 'card' for Phase 1.
    -- 'relationship' added in Phase 2 (no schema migration needed).
    -- This is NOT a structural capability flag. It identifies
    -- which DSRP operation this node represents.
    -- Extend the CHECK list in Phase 2: CHECK(node_type IN ('card', 'relationship'))
    node_type   TEXT    NOT NULL DEFAULT 'card'
                        CHECK(node_type IN ('card')),

    created_at  TEXT    NOT NULL,  -- ISO-8601 UTC
    updated_at  TEXT    NOT NULL,  -- ISO-8601 UTC; update on content/parent change

    -- JSON escape hatch, per established schema practice.
    -- Use for: rendering hints, color/style overrides, app-level
    -- metadata that does not yet warrant its own column.
    -- Do not use for structural data (parent, type) or spatial
    -- data (x, y) -- those have dedicated columns.
    -- NULL is valid (no metadata yet).
    metadata    TEXT    -- must be valid JSON or NULL; enforced at app layer
);

-- Index for the most common structural query:
-- "give me all children of node X" => WHERE parent_id = X
CREATE INDEX idx_nodes_parent_id ON nodes(parent_id);

-- Index for node_type if Phase 2 queries filter by type frequently.
-- Omit if premature; add it in Phase 2 when needed.
-- CREATE INDEX idx_nodes_node_type ON nodes(node_type);


-- ============================================================
-- TABLE: layout
-- ============================================================
-- A layout row places a node on a map at a specific visual
-- position. This is the ONLY place spatial data lives.
--
-- One row = one node appearing on one map.
-- At MVP: a node appears at most once per map (UNIQUE constraint).
-- In Phase 3 (Perspectives): this constraint may evolve into
-- a (node_id, perspective_id) uniqueness model, or the map
-- concept itself may expand. The current structure supports
-- Phase 3 without changes if Perspectives are modeled as maps.
--
-- A node with no layout rows exists in the database but is
-- not currently visible on any canvas. This is a valid state.
-- (A user may create a node, then decide where to place it.)
-- ============================================================

CREATE TABLE layout (
    id          INTEGER PRIMARY KEY,

    -- The node being placed. NOT NULL: a layout row without a
    -- node makes no sense.
    node_id     INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    -- ON DELETE CASCADE: if a node is deleted, its layout rows
    -- are also deleted automatically. Position data for a
    -- deleted node is meaningless.

    -- The map this position belongs to. NOT NULL.
    map_id      INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    -- ON DELETE CASCADE: if a map is deleted, all its layout
    -- rows are deleted. Nodes themselves are NOT deleted
    -- (they may appear on other maps, or be re-placed later).

    -- Visual position and size on the map canvas.
    -- REAL (floating point) to support sub-pixel positioning
    -- and fractional zoom/scale values from the rendering layer.
    -- Units are canvas units (not pixels; the renderer converts).
    x           REAL    NOT NULL,
    y           REAL    NOT NULL,
    width       REAL    NOT NULL CHECK(width > 0),
    height      REAL    NOT NULL CHECK(height > 0),

    -- MVP constraint: one node appears at most once per map.
    -- This enforces the Phase 1 invariant that a node has a
    -- single unambiguous position within any given canvas view.
    -- If Phase 3 Perspectives use a separate perspectives table
    -- (rather than extending maps), this constraint stays as-is
    -- and a new layout-like table is added for perspectives.
    UNIQUE(node_id, map_id)
);

-- Index for the most common layout query:
-- "give me all nodes on map X" => WHERE map_id = X
CREATE INDEX idx_layout_map_id ON layout(map_id);

-- Index for looking up a node's position across maps:
-- "is this node on any map? which?" => WHERE node_id = X
-- (Also enforced by the UNIQUE constraint, which implies an index,
-- but an explicit index is clearer and ensures query planner use.)
CREATE INDEX idx_layout_node_id ON layout(node_id);
```

---

## Section 4: Constraint Inventory

This table documents every constraint on the schema, where it is enforced, and why it is enforced at that layer rather than another.

| Constraint | Enforced At | Mechanism | Rationale |
|---|---|---|---|
| `nodes.parent_id` is a valid node ID or NULL | **Database** | FK constraint `REFERENCES nodes(id)` | Referential integrity. A node cannot point to a parent that does not exist. The database enforces this absolutely. |
| Deleting a parent with children is blocked | **Database** | `ON DELETE RESTRICT` on `nodes.parent_id` | Prevents silent data loss. The application must explicitly resolve children (move or delete them) before deleting a parent. Do not use `ON DELETE CASCADE` here: cascading deletes would silently destroy nested thinking. |
| `nodes.content` is never NULL | **Database** | `NOT NULL DEFAULT ''` | Prevents query errors on content operations. Empty string is the correct "no label yet" state. |
| `nodes.node_type` is a known value | **Database** | `CHECK(node_type IN ('card'))` | Prevents invalid type values being written. Extend the CHECK list in Phase 2; do not remove the constraint. |
| `layout.width > 0`, `layout.height > 0` | **Database** | `CHECK` constraints | A zero or negative dimension is a rendering error, not a valid state. Catch it at the data layer. |
| Each node appears at most once per map | **Database** | `UNIQUE(node_id, map_id)` on `layout` | MVP invariant: unambiguous single position per node per map. Enforced at the DB layer because it is structural, not cosmetic. |
| Deleting a node removes its layout rows | **Database** | `ON DELETE CASCADE` on `layout.node_id` | Layout data for a non-existent node is meaningless garbage. Cascade is correct here because layout rows have no independent existence. |
| Deleting a map removes its layout rows | **Database** | `ON DELETE CASCADE` on `layout.map_id` | Same reasoning. The map's layout rows belong to the map. The nodes themselves survive map deletion. |
| No cycles in the parent_id chain | **Application** | Pre-write cycle check (see Section 6) | SQLite CHECK constraints cannot express recursive conditions. The application must verify before any INSERT or UPDATE that sets a `parent_id`. See the cycle detection query in Section 6. |
| Child visual bounds fit within parent visual bounds | **Application** | Canvas rendering layer (Wren) | This is a rendering invariant, not a data invariant. The database stores whatever dimensions the app writes. The rendering layer must enforce that parent bounds auto-expand to contain children. Attempting to enforce this in the DB would require complex triggers and is not worth it. |
| `parent_id` and spatial position are never conflated | **Application** | Code review + schema design | There is no database constraint that prevents the app from deriving parent_id from layout positions. This is a design discipline constraint enforced via this document and code review. |
| `metadata` column is valid JSON or NULL | **Application** | JSON validation before write | SQLite has no native JSON column type constraint (CHECK with `json_valid()` is possible but adds overhead). Validate in the application layer before writing. |
| Move = UPDATE, never DELETE + INSERT | **Application** | Code review + application pattern | The database cannot enforce this. The application must never issue a DELETE on a node in order to "move" it. This invariant preserves node IDs across all restructuring operations. |
| `created_at` and `updated_at` are ISO-8601 UTC | **Application** | Timestamp generation before write | SQLite stores TEXT; format is the application's responsibility. Always write UTC, always write full ISO-8601 (include 'Z' or '+00:00'). |

---

## Section 5: Six Key Queries

All queries are written for SQLite. Each query includes an explanation of what it retrieves and why it is needed.

### Query 1: Get All Direct Children of a Node

**Purpose:** Basic parent-child traversal. Used when rendering the contents of a card (one level down).

```sql
-- Get all direct children of node :parent_id.
-- Returns node content and type; join layout separately if positions are needed.
-- This is intentionally a one-level query. Use Query 2 for full subtrees.

SELECT
    n.id,
    n.parent_id,
    n.content,
    n.node_type,
    n.created_at,
    n.updated_at,
    n.metadata
FROM nodes n
WHERE n.parent_id = :parent_id    -- :parent_id is the node whose children we want
ORDER BY n.created_at ASC;        -- stable ordering by creation time
                                   -- the app may use layout.x/y for visual ordering instead;
                                   -- this is the fallback when no spatial order is imposed
```

**Notes:**
- When `parent_id` is NULL, this query returns zero rows (no children). That is correct behavior for a leaf node.
- The `idx_nodes_parent_id` index makes this O(number of children), not O(total nodes).
- Do not add a LIMIT here. Arbitrary depth and arbitrary breadth are core DSRP requirements.

---

### Query 2: Get All Descendants of a Node (Full Subtree via Recursive CTE)

**Purpose:** Full subtree traversal. Used for "select this card and everything inside it," bulk export, subtree deletion check, and the "render sub-canvas" base query (extended in Query 6).

```sql
-- Get all descendants of node :root_id, at all depths.
-- Includes depth level so the caller can reconstruct tree structure.
-- Does NOT include :root_id itself (use a UNION or separate query if needed).

WITH RECURSIVE subtree(id, parent_id, content, node_type, depth) AS (
    -- Anchor: direct children of the target node
    SELECT
        n.id,
        n.parent_id,
        n.content,
        n.node_type,
        1 AS depth
    FROM nodes n
    WHERE n.parent_id = :root_id

    UNION ALL

    -- Recursive step: children of the previously found nodes
    SELECT
        n.id,
        n.parent_id,
        n.content,
        n.node_type,
        s.depth + 1
    FROM nodes n
    INNER JOIN subtree s ON n.parent_id = s.id
)
SELECT
    id,
    parent_id,
    content,
    node_type,
    depth
FROM subtree
ORDER BY depth ASC, id ASC;   -- breadth-first ordering; useful for tree reconstruction
```

**Notes:**
- SQLite supports recursive CTEs since version 3.8.3. Tauri bundles a recent SQLite; this is not a compatibility concern.
- The recursion terminates naturally when no more children exist. No depth limit is needed or desirable (DSRP systems are fractal; imposing a depth limit is a DSRP violation).
- The `depth` column is included so the caller can reconstruct the tree without re-querying parent relationships. At depth 1, parent is `:root_id`. At depth 2, parent is one of the depth-1 rows. The `parent_id` column in the result makes explicit reconstruction unambiguous.
- If you need to include `:root_id` itself in the result (for "give me this card and all its contents"), add it as a second anchor:

```sql
-- Variant that includes the root node itself at depth 0:
WITH RECURSIVE subtree(id, parent_id, content, node_type, depth) AS (
    -- Root node itself
    SELECT n.id, n.parent_id, n.content, n.node_type, 0
    FROM nodes n
    WHERE n.id = :root_id

    UNION ALL

    SELECT n.id, n.parent_id, n.content, n.node_type, s.depth + 1
    FROM nodes n
    INNER JOIN subtree s ON n.parent_id = s.id
)
SELECT id, parent_id, content, node_type, depth
FROM subtree
ORDER BY depth ASC, id ASC;
```

---

### Query 3: Get Full Ancestor Chain (Path to Root)

**Purpose:** Breadcrumb navigation. Used to render the path "Map > Bicycle > Wheels > Front Wheel" when a user has navigated into a sub-canvas. Also used in cycle detection (see Section 6).

```sql
-- Get all ancestors of node :node_id, ordered from immediate parent to root.
-- Does NOT include :node_id itself.
-- Returns ancestors in ascending depth order (parent first, root last).

WITH RECURSIVE ancestors(id, parent_id, content, depth) AS (
    -- Anchor: the immediate parent of the target node
    SELECT
        n.id,
        n.parent_id,
        n.content,
        1 AS depth
    FROM nodes n
    WHERE n.id = (SELECT parent_id FROM nodes WHERE id = :node_id)
      AND n.id IS NOT NULL   -- handle top-level nodes (parent_id = NULL) gracefully

    UNION ALL

    -- Recursive step: walk up the tree
    SELECT
        n.id,
        n.parent_id,
        n.content,
        a.depth + 1
    FROM nodes n
    INNER JOIN ancestors a ON n.id = a.parent_id
    WHERE a.parent_id IS NOT NULL  -- stop when we reach a node with no parent (root)
)
SELECT
    id,
    parent_id,
    content,
    depth
FROM ancestors
ORDER BY depth ASC;   -- depth 1 = immediate parent, highest depth = root
```

**Notes:**
- If `:node_id` is a top-level node (`parent_id = NULL`), the anchor returns zero rows and the CTE returns an empty result. That is correct: a top-level node has no ancestors.
- For breadcrumb rendering, ORDER BY `depth DESC` to get root-first order. The query uses ASC so the caller can choose.
- This query also underpins cycle detection. See Section 6.

---

### Query 4: Get All Top-Level Nodes on a Map

**Purpose:** Render the initial canvas state. Top-level nodes are those with `parent_id = NULL` that have a layout row on the requested map.

```sql
-- Get all top-level nodes (parent_id IS NULL) that appear on map :map_id.
-- Returns node data and spatial position together.
-- These are the "root" cards on this canvas -- not children of anything.

SELECT
    n.id,
    n.content,
    n.node_type,
    n.metadata,
    l.x,
    l.y,
    l.width,
    l.height
FROM nodes n
INNER JOIN layout l
    ON l.node_id = n.id
   AND l.map_id = :map_id
WHERE n.parent_id IS NULL          -- top-level Distinctions only
ORDER BY l.x ASC, l.y ASC;        -- spatial ordering (left-to-right, top-to-bottom)
                                    -- rendering engine may apply its own ordering
```

**Notes:**
- `INNER JOIN` is correct: we only want nodes that actually have a position on this map. A node with `parent_id = NULL` that has no layout row for this map is not on this canvas.
- This query does NOT return the children of the top-level nodes. Use Query 6 (full subtree with layout) to get the full render tree.
- The WHERE clause `n.parent_id IS NULL` is the DSRP assertion: these cards are Distinctions without a containing System on this map. They are placed in the map's viewing context; they are not parts of the map.

---

### Query 5: Get a Single Node with Its Layout Position on a Specific Map

**Purpose:** Point lookup. Used when the user clicks a card, when the app needs to update a single card's position after a drag, or when checking whether a node is on a given map.

```sql
-- Get node :node_id with its position on map :map_id.
-- Returns NULL / no rows if the node is not on this map.

SELECT
    n.id,
    n.parent_id,
    n.content,
    n.node_type,
    n.created_at,
    n.updated_at,
    n.metadata,
    l.id        AS layout_id,
    l.x,
    l.y,
    l.width,
    l.height
FROM nodes n
LEFT JOIN layout l
    ON l.node_id = n.id
   AND l.map_id = :map_id
WHERE n.id = :node_id;
```

**Notes:**
- `LEFT JOIN` (not INNER JOIN) is intentional: we always get the node data, even if it has no layout row on this map. The caller can use `layout_id IS NULL` to detect "node exists but is not on this map."
- Use `INNER JOIN` instead if you only want nodes that are definitively on this map (tighter query for render paths where you know the node should be there).
- The `layout_id` alias is returned so the application has the layout row's ID for subsequent UPDATE statements (e.g., after a drag operation updates x/y).

---

### Query 6: Get Full Subtree with Layout Positions (The "Render Sub-Canvas" Query)

**Purpose:** The most complex and most important read in the MVP. Powers "zoom into this card" -- gives the rendering layer everything it needs to draw a card and all of its descendants in their correct positions on a given map.

This is the query Silas should prototype first, as noted in `derek-dsrp-review.md` Section 4.

```sql
-- Get node :root_id and all its descendants, with their layout positions on map :map_id.
-- This is the primary render query for sub-canvas navigation.
--
-- Returns:
--   - Every node in the subtree (including :root_id itself)
--   - The node's structural parent (for tree reconstruction)
--   - The node's depth relative to :root_id
--   - The node's spatial position on :map_id (NULL columns if not placed on this map)
--
-- The rendering layer uses depth + parent_id to reconstruct the tree structure.
-- It uses x/y/width/height to position each card.
-- It uses layout_id for subsequent position-update writes.

WITH RECURSIVE subtree(id, parent_id, content, node_type, metadata, depth) AS (
    -- Anchor: the root node itself (depth 0)
    SELECT
        n.id,
        n.parent_id,
        n.content,
        n.node_type,
        n.metadata,
        0 AS depth
    FROM nodes n
    WHERE n.id = :root_id

    UNION ALL

    -- Recursive step: children at each subsequent depth
    SELECT
        n.id,
        n.parent_id,
        n.content,
        n.node_type,
        n.metadata,
        s.depth + 1
    FROM nodes n
    INNER JOIN subtree s ON n.parent_id = s.id
)
SELECT
    s.id,
    s.parent_id,
    s.content,
    s.node_type,
    s.metadata,
    s.depth,
    l.id        AS layout_id,  -- NULL if this node has no position on :map_id
    l.map_id,
    l.x,
    l.y,
    l.width,
    l.height
FROM subtree s
LEFT JOIN layout l
    ON l.node_id = s.id
   AND l.map_id = :map_id      -- constrain to the specific map being rendered
ORDER BY s.depth ASC, s.id ASC;
```

**Notes:**
- `LEFT JOIN layout` is correct. A node in the subtree might not have a layout row on this map yet (it was moved here structurally but not yet given a position). The rendering layer must handle `layout_id IS NULL` rows -- either auto-placing the node or prompting for placement.
- The `depth` column enables the rendering layer to process nodes level by level, ensuring parent bounds are calculated before child bounds are rendered inside them.
- The `layout_id` column is the FK for UPDATE statements when the user drags a child card. The rendering layer should cache these IDs after the initial load.
- **Performance note:** This query joins a recursive CTE against the layout table. For MVP-scale graphs (hundreds of nodes), this is fast. For very large subtrees (thousands of nodes), consider materializing the subtree to a temp table first. Do not optimize prematurely.
- **Binding `:root_id` to a top-level node ID** (where `parent_id IS NULL`) gives you the entire map's structural tree. This can serve as the full-canvas initial load query.

---

## Section 6: Cycle Detection

SQLite CHECK constraints cannot evaluate recursive conditions, so cycle detection must live in the application layer. It must run before any INSERT into `nodes` with a non-null `parent_id`, and before any UPDATE to `nodes.parent_id`.

### When to Run Cycle Detection

| Operation | Check Required | Reason |
|---|---|---|
| INSERT node with `parent_id = NULL` | No | A new top-level node cannot create a cycle. |
| INSERT node with `parent_id = X` | Yes | The new node will be in X's ancestor chain; X must not be a descendant of the new node (it cannot be, since the new node does not exist yet, so INSERT is always safe). **Exception:** if the INSERT assigns a specific `id` (not autoincrement), check anyway. |
| UPDATE `parent_id` from A to B | Yes | B must not be a descendant of the node being moved. |
| UPDATE `parent_id` to NULL | No | Setting a node to top-level cannot create a cycle. |

**Practical note for Phase 1:** Since `id` is always autoincrement and the node does not exist before INSERT, a cycle via INSERT is impossible. Cycle detection is only strictly required for UPDATE operations on `parent_id`. Document this clearly so the Phase 2 team does not skip the check when adding relationship nodes.

### Cycle Detection Query

```sql
-- Check whether setting node :node_id's parent to :proposed_parent_id would create a cycle.
-- Returns one row with cycle_exists = 1 if a cycle would result; 0 or no rows if safe.
--
-- Logic: A cycle exists if :node_id appears anywhere in the ancestor chain of
-- :proposed_parent_id. In other words: walk up from :proposed_parent_id to the root.
-- If :node_id is encountered along the way, setting it as the parent of itself
-- (directly or indirectly) would close a loop.

WITH RECURSIVE ancestor_chain(id, parent_id) AS (
    -- Anchor: start at the proposed new parent
    SELECT n.id, n.parent_id
    FROM nodes n
    WHERE n.id = :proposed_parent_id

    UNION ALL

    -- Walk up: follow parent_id links toward the root
    SELECT n.id, n.parent_id
    FROM nodes n
    INNER JOIN ancestor_chain ac ON n.id = ac.parent_id
    WHERE ac.parent_id IS NOT NULL  -- stop at top-level nodes
)
SELECT
    CASE WHEN EXISTS (
        SELECT 1 FROM ancestor_chain WHERE id = :node_id
    ) THEN 1 ELSE 0 END AS cycle_exists;
```

**Application usage pattern:**

```
BEFORE: UPDATE nodes SET parent_id = :proposed_parent_id WHERE id = :node_id

1. Run cycle detection query with (:node_id, :proposed_parent_id)
2. If cycle_exists = 1: abort the operation, return error to UI
   ("This move would create a circular containment, which is not allowed.")
3. If cycle_exists = 0: proceed with UPDATE
```

**Edge case -- self-parent:** The simplest cycle (a node whose `parent_id = id`) is caught by the check above (`:proposed_parent_id = :node_id` means the anchor immediately matches). As an additional defense, the application can also check `proposed_parent_id != node_id` before running the full query.

**Performance:** The ancestor chain is bounded by tree depth. For well-structured DSRP maps, this is rarely more than 10-20 levels. The query is fast.

---

## Section 7: What This Defers and Why

These items are intentionally excluded from the MVP schema. Each has a note on how the current schema accommodates the future addition.

### Phase 2: Relationships (R)

**What:** A DSRP Relationship connects two Distinctions with a directional connection (action/reaction). It is not a nesting relationship. Relationships must be first-class entities -- they can themselves be named, described, and in theory related to other things.

**What the Phase 2 schema will add:**
- `node_type` CHECK constraint extended to include `'relationship'`
- A `relationship_edges` table: `(id, relationship_node_id, source_node_id, target_node_id, role)` where `role` is `'action'` or `'reaction'`
- The Relationship node itself is a row in `nodes` (same table, `node_type = 'relationship'`), giving it an ID, content (the label on the line), and the ability to have children in theory

**Why the current schema does not block this:**
- `node_type TEXT NOT NULL DEFAULT 'card'` is already in the table; Phase 2 just extends the CHECK constraint
- Node IDs are already in a shared space; Relationship nodes get IDs from the same sequence
- The layout table already supports placing Relationship nodes on maps (if they get a visual representation)

**What the Phase 2 team must not do:** Implement Relationships as a `links` table with no corresponding `nodes` row. That would deny Relationships their DSRP identity and make them non-extensible.

### Phase 3: Perspectives (P)

**What:** A DSRP Perspective has two components: a point (the observer) and a view (what is seen from that point). At minimum, a Perspective is a named viewpoint with its own spatial layout of nodes.

**What Phase 3 will likely add:**
- A `perspectives` table: `(id, map_id, name, owner_point, created_at, updated_at)` -- or Perspectives replace/extend the maps concept
- The `layout` table's UNIQUE constraint `(node_id, map_id)` evolves to `(node_id, perspective_id)`, or a parallel `perspective_layout` table is added
- The same node appears in multiple Perspectives with different positions -- the current layout table structure already supports this via different `map_id` values

**Why the current schema does not block this:**
- The separate `layout` table (not spatial data on `nodes`) is the key architectural decision. It means a node's identity is fully decoupled from its appearance in any view.
- Maps-as-separate-entities (not special nodes) means a smooth evolution from "map" to "perspective" is possible without restructuring the nodes table.

**Risk to avoid in Phase 3:** Building Perspectives as "saved camera states" (zoom level + pan offset) rather than "distinct spatial layouts per node." The former is a feature. The latter is the DSRP-correct foundation. The `layout` table design assumes the latter.

### Full-Text Search (Post-MVP)

**What:** Searching across all node content.

**How to add:** SQLite FTS5 virtual table over `nodes.content`, using the same pattern as the existing PKM schema.

```sql
-- Phase N addition (do not add at MVP):
CREATE VIRTUAL TABLE nodes_fts USING fts5(
    content,
    content='nodes',
    content_rowid='id'
);
```

**Why deferred:** FTS adds write-time indexing overhead and rebuild complexity. For MVP, the node graph is small enough that a LIKE query on `nodes.content` is adequate. Add FTS when search becomes a real user need.

### Collaboration (Future)

**What:** Multiple users editing the same map in real time, or syncing across devices.

**Schema impact:** Integer autoincrement primary keys assigned by a single SQLite instance are incompatible with multi-user sync (two clients will assign the same ID to different nodes). A migration to UUID v4 or v7 primary keys is required before any collaboration feature ships.

**Why deferred:** Local-first, single-user is the MVP and the foreseeable near-term product. UUID keys add complexity and slightly larger storage for no current benefit. This is a known future migration cost, not an oversight.

**Flag for the team:** Do not add any feature that implicitly depends on cross-device node ID consistency (e.g., shareable links containing node IDs) until the UUID migration is complete. Once such links exist in the wild, migrating PKs becomes much harder.

---

## Section 8: Quick Reference -- Invariants for Silas and Wren

These are the rules that must be true at all times. Post this list in the implementation repo.

1. **Every node row is a Distinction.** It exists because a user (or the app) made a distinction between this thing and everything else.
2. **`parent_id = NULL` is valid and correct** for a top-level card. It is not an error or an orphan. Do not add a default root node to avoid nulls.
3. **No caste system.** Any node can be a parent. Do not add `is_container`, `has_children`, or capability-controlling flags.
4. **`parent_id` is structural. x/y are visual. They never swap.** The structural parent lives on `nodes`. The visual position lives on `layout`.
5. **Maps are not nodes.** A map is a viewing context, not a containing System. Top-level cards are not "parts of" a map.
6. **Move = UPDATE `parent_id`. Never DELETE + INSERT.** Node IDs are permanent identities.
7. **No cycles.** Run the cycle detection query before every UPDATE to `parent_id`.
8. **UNIQUE(node_id, map_id)** in `layout`. At MVP, a node appears exactly once per map.
9. **ON DELETE RESTRICT on `nodes.parent_id`.** The application must resolve children before deleting a parent. No silent cascading deletion of user thinking.
10. **ON DELETE CASCADE on `layout`.** Layout rows have no independent existence. They follow their node and map.

---

*Questions on this spec: come find Derek. Questions on implementation specifics not covered here: Silas has authority to make the call, provided the DSRP invariants in this document are preserved.*

*This spec covers the MVP (Phase 1: Distinctions + Systems). It does not speak for Phase 2 (Relationships) or Phase 3 (Perspectives) beyond the deferral notes in Section 7.*

-- Derek, 2026-03-23
