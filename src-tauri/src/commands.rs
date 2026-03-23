use std::sync::Mutex;
use rusqlite::Connection;
use serde::Serialize;

// ============================================================
// Shared types
// ============================================================

/// A node joined with its layout row on a specific map.
/// Field names match the TypeScript `NodeWithLayout` interface in
/// `src/ipc/db.ts` exactly (snake_case serialized via serde).
#[derive(Debug, Serialize)]
pub struct NodeWithLayout {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub content: String,
    pub node_type: String,
    pub metadata: Option<String>,
    pub layout_id: i64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

// ============================================================
// Helper: map rusqlite errors to descriptive strings
// ============================================================
fn sql_err(context: &str, e: rusqlite::Error) -> String {
    format!("[db] {}: {}", context, e)
}

// ============================================================
// IPC Commands
// ============================================================

/// Return all nodes that have a layout row on the given map,
/// joined with their layout data.
///
/// Matches: `DbInterface.getMapNodes(mapId)`
#[tauri::command]
pub fn get_map_nodes(
    state: tauri::State<'_, Mutex<Connection>>,
    map_id: i64,
) -> Result<Vec<NodeWithLayout>, String> {
    let conn = state.lock().map_err(|e| format!("[db] mutex poisoned: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.parent_id, n.content, n.node_type, n.metadata, \
                    l.id AS layout_id, l.x, l.y, l.width, l.height \
             FROM nodes n \
             INNER JOIN layout l ON l.node_id = n.id \
             WHERE l.map_id = ?1",
        )
        .map_err(|e| sql_err("prepare get_map_nodes", e))?;

    let rows = stmt
        .query_map([map_id], |row| {
            Ok(NodeWithLayout {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                content: row.get(2)?,
                node_type: row.get(3)?,
                metadata: row.get(4)?,
                layout_id: row.get(5)?,
                x: row.get(6)?,
                y: row.get(7)?,
                width: row.get(8)?,
                height: row.get(9)?,
            })
        })
        .map_err(|e| sql_err("query get_map_nodes", e))?;

    let mut nodes = Vec::new();
    for row in rows {
        nodes.push(row.map_err(|e| sql_err("row get_map_nodes", e))?);
    }

    Ok(nodes)
}

/// Insert a new card node and its layout row on the given map.
/// Returns the new node's ID.
///
/// Matches: `DbInterface.createNode(mapId, content, x, y, width, height)`
#[tauri::command]
pub fn create_node(
    state: tauri::State<'_, Mutex<Connection>>,
    map_id: i64,
    content: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<i64, String> {
    let conn = state.lock().map_err(|e| format!("[db] mutex poisoned: {}", e))?;

    // Run inside a transaction so both inserts succeed or neither does.
    conn.execute("BEGIN", [])
        .map_err(|e| sql_err("BEGIN create_node", e))?;

    let result = (|| -> Result<i64, rusqlite::Error> {
        // Insert the node.
        conn.execute(
            "INSERT INTO nodes (parent_id, content, node_type, created_at, updated_at) \
             VALUES (NULL, ?1, 'card', datetime('now'), datetime('now'))",
            rusqlite::params![content],
        )?;
        let node_id = conn.last_insert_rowid();

        // Insert the layout row.
        conn.execute(
            "INSERT INTO layout (node_id, map_id, x, y, width, height) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![node_id, map_id, x, y, width, height],
        )?;

        Ok(node_id)
    })();

    match result {
        Ok(node_id) => {
            conn.execute("COMMIT", [])
                .map_err(|e| sql_err("COMMIT create_node", e))?;
            Ok(node_id)
        }
        Err(e) => {
            // Best-effort rollback; ignore secondary errors.
            let _ = conn.execute("ROLLBACK", []);
            Err(sql_err("create_node transaction", e))
        }
    }
}

/// Update a node's text content. Also bumps updated_at.
///
/// Matches: `DbInterface.updateNodeContent(nodeId, content)`
#[tauri::command]
pub fn update_node_content(
    state: tauri::State<'_, Mutex<Connection>>,
    node_id: i64,
    content: String,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("[db] mutex poisoned: {}", e))?;

    let rows_affected = conn
        .execute(
            "UPDATE nodes SET content = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![content, node_id],
        )
        .map_err(|e| sql_err("update_node_content", e))?;

    if rows_affected == 0 {
        return Err(format!("[db] update_node_content: node {} not found", node_id));
    }

    Ok(())
}

/// Update a node's spatial position and size on a specific map.
/// Only touches the layout table -- structural data (parent_id) is unchanged.
///
/// Matches: `DbInterface.updateNodeLayout(nodeId, mapId, x, y, width, height)`
#[tauri::command]
pub fn update_node_layout(
    state: tauri::State<'_, Mutex<Connection>>,
    node_id: i64,
    map_id: i64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("[db] mutex poisoned: {}", e))?;

    let rows_affected = conn
        .execute(
            "UPDATE layout SET x = ?1, y = ?2, width = ?3, height = ?4 \
             WHERE node_id = ?5 AND map_id = ?6",
            rusqlite::params![x, y, width, height, node_id, map_id],
        )
        .map_err(|e| sql_err("update_node_layout", e))?;

    if rows_affected == 0 {
        return Err(format!(
            "[db] update_node_layout: no layout row found for node {} on map {}",
            node_id, map_id
        ));
    }

    Ok(())
}

/// Delete a node by ID. The layout row cascades automatically via FK.
///
/// Note: the schema uses ON DELETE RESTRICT on nodes.parent_id, so this
/// command will fail (rusqlite returns an error) if the node has children.
/// The error is propagated to the frontend as a descriptive string.
///
/// Matches: `DbInterface.deleteNode(nodeId)`
#[tauri::command]
pub fn delete_node(
    state: tauri::State<'_, Mutex<Connection>>,
    node_id: i64,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("[db] mutex poisoned: {}", e))?;

    let rows_affected = conn
        .execute(
            "DELETE FROM nodes WHERE id = ?1",
            rusqlite::params![node_id],
        )
        .map_err(|e| {
            // Provide a clear message for the FK RESTRICT case.
            if e.to_string().contains("FOREIGN KEY") {
                format!(
                    "[db] delete_node: node {} has children and cannot be deleted until \
                     they are removed first",
                    node_id
                )
            } else {
                sql_err("delete_node", e)
            }
        })?;

    if rows_affected == 0 {
        return Err(format!("[db] delete_node: node {} not found", node_id));
    }

    Ok(())
}
