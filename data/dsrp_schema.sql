-- ============================================================
-- Plectica 2.0 — DSRP-Native Schema
-- Phase 1 MVP: Distinctions + Systems
-- ============================================================
-- Author:    Silas, PKM Database Architect
-- Spec:      docs/dsrp-data-model-spec.md (Derek, 2026-03-23)
-- Created:   2026-03-23
-- Engine:    SQLite 3 (WAL mode, foreign keys enforced)
-- ============================================================
--
-- Three tables in dependency order:
--   1. maps    — canvas / workspace contexts
--   2. nodes   — DSRP Distinctions (cards)
--   3. layout  — visual positions (nodes on maps)
--
-- What is NOT in this file (deferred to future phases):
--   - Phase 2: relationship_edges table, node_type = 'relationship'
--   - Phase 3: perspectives table, perspective_layout
--   - Post-MVP: nodes_fts (FTS5 full-text search)
--   - Future: UUID primary key migration for collaboration
--
-- These PRAGMAs must also be re-applied on every new connection.
-- SQLite does not persist them across connections.
-- ============================================================

PRAGMA foreign_keys  = ON;
PRAGMA journal_mode  = WAL;


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


-- ============================================================
-- APPLICATION-LAYER REFERENCE: CYCLE DETECTION
-- ============================================================
-- SQLite CHECK constraints cannot evaluate recursive conditions.
-- Cycle detection MUST run in the application layer before any
-- UPDATE to nodes.parent_id (and before any INSERT with a
-- non-null parent_id if a specific id is supplied).
--
-- When to run:
--   INSERT with parent_id = NULL         -> No check required
--   INSERT with parent_id = X (autoincrement) -> No check required (node doesn't exist yet)
--   INSERT with parent_id = X (explicit id)   -> Run check
--   UPDATE parent_id from A to B         -> Run check
--   UPDATE parent_id to NULL             -> No check required
--
-- Cycle detection query:
-- Bind :node_id (the node being moved) and :proposed_parent_id (its new parent).
-- Returns cycle_exists = 1 if the move would create a cycle; 0 if safe.
--
-- Application usage pattern:
--   1. Run this query with (:node_id, :proposed_parent_id)
--   2. If cycle_exists = 1: abort, return error to UI
--      ("This move would create a circular containment, which is not allowed.")
--   3. If cycle_exists = 0: proceed with UPDATE
--   4. Additional defense: check proposed_parent_id != node_id before the full query.
--
-- WITH RECURSIVE ancestor_chain(id, parent_id) AS (
--     -- Anchor: start at the proposed new parent
--     SELECT n.id, n.parent_id
--     FROM nodes n
--     WHERE n.id = :proposed_parent_id
--
--     UNION ALL
--
--     -- Walk up: follow parent_id links toward the root
--     SELECT n.id, n.parent_id
--     FROM nodes n
--     INNER JOIN ancestor_chain ac ON n.id = ac.parent_id
--     WHERE ac.parent_id IS NOT NULL  -- stop at top-level nodes
-- )
-- SELECT
--     CASE WHEN EXISTS (
--         SELECT 1 FROM ancestor_chain WHERE id = :node_id
--     ) THEN 1 ELSE 0 END AS cycle_exists;
--
-- Performance: ancestor chain is bounded by tree depth.
-- For well-structured DSRP maps, typically 10-20 levels. Fast.
-- ============================================================


-- ============================================================
-- KEY QUERIES (COMMENTED EXAMPLES FOR APPLICATION REFERENCE)
-- ============================================================
-- These are the six core read patterns for Phase 1.
-- All queries are written for SQLite with named bind parameters.
-- ============================================================


-- ------------------------------------------------------------
-- Query 1: Get All Direct Children of a Node
-- Purpose: Basic parent-child traversal. Used when rendering
--          the contents of a card (one level down).
-- Notes:
--   - One-level only; use Query 2 for full subtrees.
--   - idx_nodes_parent_id makes this O(number of children).
--   - Do not add LIMIT; arbitrary depth/breadth is required.
--   - When parent_id is NULL, returns zero rows (correct).
-- ------------------------------------------------------------
--
-- SELECT
--     n.id,
--     n.parent_id,
--     n.content,
--     n.node_type,
--     n.created_at,
--     n.updated_at,
--     n.metadata
-- FROM nodes n
-- WHERE n.parent_id = :parent_id
-- ORDER BY n.created_at ASC;


-- ------------------------------------------------------------
-- Query 2: Get All Descendants of a Node (Full Subtree)
-- Purpose: Full subtree traversal. Used for "select this card
--          and everything inside it," bulk export, subtree
--          deletion checks, and as the base for Query 6.
-- Notes:
--   - Does NOT include :root_id itself (children only).
--   - depth column enables tree reconstruction without
--     re-querying parent relationships.
--   - No depth limit: DSRP systems are fractal.
--   - Variant below includes the root at depth 0.
-- ------------------------------------------------------------
--
-- WITH RECURSIVE subtree(id, parent_id, content, node_type, depth) AS (
--     SELECT n.id, n.parent_id, n.content, n.node_type, 1 AS depth
--     FROM nodes n
--     WHERE n.parent_id = :root_id
--
--     UNION ALL
--
--     SELECT n.id, n.parent_id, n.content, n.node_type, s.depth + 1
--     FROM nodes n
--     INNER JOIN subtree s ON n.parent_id = s.id
-- )
-- SELECT id, parent_id, content, node_type, depth
-- FROM subtree
-- ORDER BY depth ASC, id ASC;
--
-- -- Variant that includes the root node itself at depth 0:
-- WITH RECURSIVE subtree(id, parent_id, content, node_type, depth) AS (
--     SELECT n.id, n.parent_id, n.content, n.node_type, 0
--     FROM nodes n
--     WHERE n.id = :root_id
--
--     UNION ALL
--
--     SELECT n.id, n.parent_id, n.content, n.node_type, s.depth + 1
--     FROM nodes n
--     INNER JOIN subtree s ON n.parent_id = s.id
-- )
-- SELECT id, parent_id, content, node_type, depth
-- FROM subtree
-- ORDER BY depth ASC, id ASC;


-- ------------------------------------------------------------
-- Query 3: Get Full Ancestor Chain (Path to Root)
-- Purpose: Breadcrumb navigation. Renders the path
--          "Map > Bicycle > Wheels > Front Wheel."
--          Also underpins cycle detection.
-- Notes:
--   - Does NOT include :node_id itself.
--   - Returns ancestors depth 1 = immediate parent, highest = root.
--   - ORDER BY depth DESC for root-first breadcrumb order.
--   - If :node_id is top-level (parent_id = NULL), returns 0 rows.
-- ------------------------------------------------------------
--
-- WITH RECURSIVE ancestors(id, parent_id, content, depth) AS (
--     SELECT n.id, n.parent_id, n.content, 1 AS depth
--     FROM nodes n
--     WHERE n.id = (SELECT parent_id FROM nodes WHERE id = :node_id)
--       AND n.id IS NOT NULL
--
--     UNION ALL
--
--     SELECT n.id, n.parent_id, n.content, a.depth + 1
--     FROM nodes n
--     INNER JOIN ancestors a ON n.id = a.parent_id
--     WHERE a.parent_id IS NOT NULL
-- )
-- SELECT id, parent_id, content, depth
-- FROM ancestors
-- ORDER BY depth ASC;


-- ------------------------------------------------------------
-- Query 4: Get All Top-Level Nodes on a Map
-- Purpose: Render the initial canvas state. Top-level nodes
--          are parent_id IS NULL with a layout row on the map.
-- Notes:
--   - INNER JOIN: only nodes with a position on this map.
--   - Does not return children; use Query 6 for the full tree.
--   - WHERE parent_id IS NULL is the DSRP assertion: these
--     cards are Distinctions without a containing System.
-- ------------------------------------------------------------
--
-- SELECT
--     n.id,
--     n.content,
--     n.node_type,
--     n.metadata,
--     l.x,
--     l.y,
--     l.width,
--     l.height
-- FROM nodes n
-- INNER JOIN layout l
--     ON l.node_id = n.id
--    AND l.map_id = :map_id
-- WHERE n.parent_id IS NULL
-- ORDER BY l.x ASC, l.y ASC;


-- ------------------------------------------------------------
-- Query 5: Get a Single Node with Its Layout on a Specific Map
-- Purpose: Point lookup. Used on card click, after drag,
--          or when checking whether a node is on a given map.
-- Notes:
--   - LEFT JOIN: always returns node data even if no layout row.
--   - layout_id IS NULL means node exists but is not on this map.
--   - Use INNER JOIN instead if you need "on this map" only.
--   - layout_id is returned for subsequent UPDATE after drag.
-- ------------------------------------------------------------
--
-- SELECT
--     n.id,
--     n.parent_id,
--     n.content,
--     n.node_type,
--     n.created_at,
--     n.updated_at,
--     n.metadata,
--     l.id    AS layout_id,
--     l.x,
--     l.y,
--     l.width,
--     l.height
-- FROM nodes n
-- LEFT JOIN layout l
--     ON l.node_id = n.id
--    AND l.map_id = :map_id
-- WHERE n.id = :node_id;


-- ------------------------------------------------------------
-- Query 6: Get Full Subtree with Layout Positions
--          ("The Render Sub-Canvas Query")
-- Purpose: Powers "zoom into this card." Gives the rendering
--          layer everything needed to draw a card and all its
--          descendants with correct positions on a given map.
--          Also serves as the full-canvas initial load query
--          when :root_id is a top-level node.
-- Notes:
--   - LEFT JOIN layout: nodes may lack a position on this map
--     (moved structurally but not yet placed visually).
--     Rendering layer must handle layout_id IS NULL rows.
--   - depth enables level-by-level processing (parent bounds
--     before child bounds).
--   - layout_id is the FK for UPDATE after drag; cache it.
--   - Performance: fast at MVP scale (hundreds of nodes).
--     For thousands of nodes, consider materializing the
--     subtree to a temp table. Do not optimize prematurely.
-- ------------------------------------------------------------
--
-- WITH RECURSIVE subtree(id, parent_id, content, node_type, metadata, depth) AS (
--     SELECT n.id, n.parent_id, n.content, n.node_type, n.metadata, 0 AS depth
--     FROM nodes n
--     WHERE n.id = :root_id
--
--     UNION ALL
--
--     SELECT n.id, n.parent_id, n.content, n.node_type, n.metadata, s.depth + 1
--     FROM nodes n
--     INNER JOIN subtree s ON n.parent_id = s.id
-- )
-- SELECT
--     s.id,
--     s.parent_id,
--     s.content,
--     s.node_type,
--     s.metadata,
--     s.depth,
--     l.id        AS layout_id,
--     l.map_id,
--     l.x,
--     l.y,
--     l.width,
--     l.height
-- FROM subtree s
-- LEFT JOIN layout l
--     ON l.node_id = s.id
--    AND l.map_id = :map_id
-- ORDER BY s.depth ASC, s.id ASC;
