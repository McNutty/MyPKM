use rusqlite::{Connection, Result as SqlResult};
use tauri::{AppHandle, Manager};

// ============================================================
// Schema DDL
// Only CREATE TABLE and CREATE INDEX statements from
// data/dsrp_schema.sql. PRAGMAs are applied separately on
// every connection open (SQLite does not persist them).
// ============================================================
const SCHEMA_DDL: &str = "
CREATE TABLE IF NOT EXISTS maps (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
    id          INTEGER PRIMARY KEY,
    parent_id   INTEGER REFERENCES nodes(id) ON DELETE RESTRICT,
    content     TEXT    NOT NULL DEFAULT '',
    node_type   TEXT    NOT NULL DEFAULT 'card'
                        CHECK(node_type IN ('card', 'relationship', 'model')),
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    metadata    TEXT
);

CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_node_type ON nodes(node_type);

CREATE TABLE IF NOT EXISTS layout (
    id          INTEGER PRIMARY KEY,
    node_id     INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    map_id      INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    x           REAL    NOT NULL,
    y           REAL    NOT NULL,
    width       REAL    NOT NULL CHECK(width > 0),
    height      REAL    NOT NULL CHECK(height > 0),
    UNIQUE(node_id, map_id)
);

CREATE INDEX IF NOT EXISTS idx_layout_map_id ON layout(map_id);
CREATE INDEX IF NOT EXISTS idx_layout_node_id ON layout(node_id);

CREATE TABLE IF NOT EXISTS relationships (
    id          INTEGER PRIMARY KEY,
    source_id   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_id   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    action      TEXT    NOT NULL DEFAULT '',
    rel_node_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    metadata    TEXT
);

CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id);
";

/// Open (or create) the SQLite database for Ambit in the app data directory.
///
/// Steps performed on every open:
///   1. Resolve the app data directory via Tauri's path API.
///   2. Open / create `ambit.db` there.
///   3. Apply connection-level PRAGMAs (foreign keys, WAL mode).
///   4. Run schema DDL (idempotent: all statements use IF NOT EXISTS).
///   5. Seed the default map if no maps exist.
///   6. Validate that PRAGMAs took effect; log an error if not.
pub fn init_db(app_handle: &AppHandle) -> SqlResult<Connection> {
    // --- 1. Resolve path ---
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Tauri could not resolve app data directory");

    // Ensure the directory exists.
    std::fs::create_dir_all(&app_data_dir)
        .expect("Could not create app data directory");

    let db_path = app_data_dir.join("ambit.db");

    eprintln!("[db] Opening database at: {}", db_path.display());

    // --- 2. Open connection ---
    let conn = Connection::open(&db_path)?;

    // --- 3. PRAGMAs (must run on every connection) ---
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;

    // --- 4. Schema DDL (idempotent) ---
    conn.execute_batch(SCHEMA_DDL)?;

    // --- 4a. Additive migrations for existing databases ---
    // Idempotent schema migrations. Each statement is attempted on every
    // startup and silently ignored if the structural change has already
    // been applied:
    //   - ADD COLUMN:  ignore "duplicate column name"
    //   - DROP COLUMN: ignore "no such column" (column already absent,
    //                  e.g. on a fresh database built from the current DDL)
    for sql in &[
        // Phase 2: relationship-as-node. Add rel_node_id to relationships.
        "ALTER TABLE relationships ADD COLUMN rel_node_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE",
        // M4: scope relationships to a map so get_map_relationships can filter correctly.
        "ALTER TABLE relationships ADD COLUMN map_id INTEGER REFERENCES maps(id) ON DELETE CASCADE",
        // Post-M4: remove dead auto-shrink columns from layout.
        "ALTER TABLE layout DROP COLUMN min_width",
        "ALTER TABLE layout DROP COLUMN min_height",
    ] {
        if let Err(e) = conn.execute_batch(sql) {
            let msg = e.to_string();
            if !msg.contains("duplicate column name") && !msg.contains("no such column") {
                return Err(e);
            }
        }
    }

    // --- 4b. Backfill relationships.map_id for rows created before M4. ---
    // Infer the map from the source node's layout row. Under the M3 single-map
    // invariant every node belongs to exactly one map, so LIMIT 1 is safe and
    // unambiguous. Rows that still have map_id IS NULL after the backfill are
    // true orphans with no layout entry; they are left as-is.
    conn.execute_batch(
        "UPDATE relationships \
         SET map_id = ( \
             SELECT l.map_id FROM layout l \
             WHERE l.node_id = relationships.source_id \
             LIMIT 1 \
         ) \
         WHERE map_id IS NULL;"
    )?;

    // Index to support the WHERE map_id = ? filter in get_map_relationships.
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_rel_map_id ON relationships(map_id);"
    )?;

    // --- 4c. Rebuild nodes table to expand the node_type CHECK constraint ---
    // SQLite cannot ALTER a CHECK constraint. The only safe path is a
    // table rebuild: rename -> recreate -> copy -> drop old.
    // We detect whether the rebuild is needed by checking if the current
    // schema definition still contains the old single-value CHECK.
    // This block is idempotent: once the new schema is in place, the
    // string match fails and the block is skipped on all subsequent startups.
    let nodes_sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_default();

    let old_check_card_only = nodes_sql.contains("CHECK(node_type IN ('card'))");
    let old_check_card_rel  = nodes_sql.contains("CHECK(node_type IN ('card', 'relationship'))");

    if old_check_card_only || old_check_card_rel {
        eprintln!("[db] Migrating nodes table: expanding node_type CHECK constraint to include 'model'...");
        conn.execute_batch("
            PRAGMA foreign_keys = OFF;

            BEGIN;

            ALTER TABLE nodes RENAME TO nodes_old;

            CREATE TABLE nodes (
                id          INTEGER PRIMARY KEY,
                parent_id   INTEGER REFERENCES nodes(id) ON DELETE RESTRICT,
                content     TEXT    NOT NULL DEFAULT '',
                node_type   TEXT    NOT NULL DEFAULT 'card'
                                    CHECK(node_type IN ('card', 'relationship', 'model')),
                created_at  TEXT    NOT NULL,
                updated_at  TEXT    NOT NULL,
                metadata    TEXT
            );

            INSERT INTO nodes (id, parent_id, content, node_type, created_at, updated_at, metadata)
            SELECT              id, parent_id, content, node_type, created_at, updated_at, metadata
            FROM nodes_old;

            DROP TABLE nodes_old;

            COMMIT;

            PRAGMA foreign_keys = ON;

            CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON nodes(parent_id);
            CREATE INDEX IF NOT EXISTS idx_nodes_node_type ON nodes(node_type);
        ")?;
        eprintln!("[db] nodes table migration complete.");
    }

    // --- 4d. Add node_id column to maps (idempotent) ---
    // Links each map to the model card that represents it on a parent canvas.
    // Home map (id=1) has node_id = NULL.
    if let Err(e) = conn.execute_batch(
        "ALTER TABLE maps ADD COLUMN node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL"
    ) {
        let msg = e.to_string();
        if !msg.contains("duplicate column name") {
            return Err(e);
        }
    }
    // UNIQUE constraint can't be added via ALTER TABLE ADD COLUMN in SQLite,
    // so we enforce it via a unique index instead.
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_maps_node_id ON maps(node_id) WHERE node_id IS NOT NULL"
    ).map_err(|e| e)?;

    // --- 4e. Seed migration: existing non-Home maps become model cards ---
    // For every map where node_id IS NULL AND id != 1 (i.e., maps that existed
    // before the Models Rework), we create a backing node (node_type='model') and
    // a layout row on the Home map (id=1), then link them via maps.node_id.
    // Idempotent: only processes maps that still have node_id IS NULL AND id != 1.
    {
        // Collect maps that need backfilling.
        let mut orphan_stmt = conn.prepare(
            "SELECT id, name FROM maps WHERE node_id IS NULL AND id != 1 ORDER BY id ASC"
        )?;
        let orphan_maps: Vec<(i64, String)> = orphan_stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<SqlResult<Vec<_>>>()?;

        for (index, (map_id, map_name)) in orphan_maps.iter().enumerate() {
            let y_pos = 50.0 + (index as f64) * 150.0;

            // Insert backing model node.
            conn.execute(
                "INSERT INTO nodes (parent_id, content, node_type, created_at, updated_at) \
                 VALUES (NULL, ?1, 'model', datetime('now'), datetime('now'))",
                rusqlite::params![map_name],
            )?;
            let node_id = conn.last_insert_rowid();

            // Place it on the Home map.
            conn.execute(
                "INSERT INTO layout (node_id, map_id, x, y, width, height) \
                 VALUES (?1, 1, 50.0, ?2, 200.0, 80.0)",
                rusqlite::params![node_id, y_pos],
            )?;

            // Link the map to its new node.
            conn.execute(
                "UPDATE maps SET node_id = ?1 WHERE id = ?2",
                rusqlite::params![node_id, map_id],
            )?;

            eprintln!("[db] Backfilled model card for map {} ('{}') → node_id={}", map_id, map_name, node_id);
        }
    }

    // --- 5. Seed default map if none exists ---
    let map_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM maps",
        [],
        |row| row.get(0),
    )?;

    if map_count == 0 {
        conn.execute(
            "INSERT INTO maps (name, created_at, updated_at) \
             VALUES ('My Canvas', datetime('now'), datetime('now'))",
            [],
        )?;
        eprintln!("[db] Created default map: 'My Canvas'");
    }

    // --- 6. Validate PRAGMAs are active ---
    let fk_enabled: i64 = conn.query_row(
        "PRAGMA foreign_keys",
        [],
        |row| row.get(0),
    )?;
    if fk_enabled != 1 {
        eprintln!("[db] ERROR: foreign_keys PRAGMA is NOT active after initialization. \
                   Data integrity may be compromised.");
    } else {
        eprintln!("[db] foreign_keys: ON");
    }

    // journal_mode returns a string: "wal", "delete", etc.
    let journal_mode: String = conn.query_row(
        "PRAGMA journal_mode",
        [],
        |row| row.get(0),
    )?;
    if journal_mode.to_lowercase() != "wal" {
        eprintln!("[db] ERROR: journal_mode is '{}' after initialization, expected 'wal'. \
                   Performance and concurrent-access guarantees may be degraded.",
                  journal_mode);
    } else {
        eprintln!("[db] journal_mode: WAL");
    }

    Ok(conn)
}
