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
                        CHECK(node_type IN ('card', 'relationship')),
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
    min_width   REAL    DEFAULT NULL,
    min_height  REAL    DEFAULT NULL,
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

/// Open (or create) the SQLite database for Plectica in the app data directory.
///
/// Steps performed on every open:
///   1. Resolve the app data directory via Tauri's path API.
///   2. Open / create `plectica.db` there.
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

    let db_path = app_data_dir.join("plectica.db");

    eprintln!("[db] Opening database at: {}", db_path.display());

    // --- 2. Open connection ---
    let conn = Connection::open(&db_path)?;

    // --- 3. PRAGMAs (must run on every connection) ---
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;

    // --- 4. Schema DDL (idempotent) ---
    conn.execute_batch(SCHEMA_DDL)?;

    // --- 4a. Additive migrations for existing databases ---
    // ALTER TABLE ADD COLUMN is idempotent here: we match on the "duplicate
    // column name" error text and silently ignore it so this block is safe to
    // run on every startup regardless of DB age.
    for sql in &[
        "ALTER TABLE layout ADD COLUMN min_width  REAL DEFAULT NULL",
        "ALTER TABLE layout ADD COLUMN min_height REAL DEFAULT NULL",
        // Phase 2: relationship-as-node. Add rel_node_id to relationships.
        "ALTER TABLE relationships ADD COLUMN rel_node_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE",
    ] {
        if let Err(e) = conn.execute_batch(sql) {
            if !e.to_string().contains("duplicate column name") {
                return Err(e);
            }
        }
    }

    // --- 4b. Rebuild nodes table to expand the node_type CHECK constraint ---
    // SQLite cannot ALTER a CHECK constraint. The only safe path is a
    // table rebuild: rename -> recreate -> copy -> drop old.
    // We detect whether the rebuild is needed by checking if the current
    // schema definition still contains the old single-value CHECK.
    // This block is idempotent: once the new schema is in place, the
    // string match fails and the block is skipped on all subsequent startups.
    let old_check_present: bool = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
            [],
            |row| row.get::<_, String>(0),
        )
        .map(|sql| sql.contains("CHECK(node_type IN ('card'))"))
        .unwrap_or(false);

    if old_check_present {
        eprintln!("[db] Migrating nodes table: expanding node_type CHECK constraint...");
        conn.execute_batch("
            PRAGMA foreign_keys = OFF;

            BEGIN;

            ALTER TABLE nodes RENAME TO nodes_old;

            CREATE TABLE nodes (
                id          INTEGER PRIMARY KEY,
                parent_id   INTEGER REFERENCES nodes(id) ON DELETE RESTRICT,
                content     TEXT    NOT NULL DEFAULT '',
                node_type   TEXT    NOT NULL DEFAULT 'card'
                                    CHECK(node_type IN ('card', 'relationship')),
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
