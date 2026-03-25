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
    pub min_width: Option<f64>,
    pub min_height: Option<f64>,
}

// ============================================================
// Helper: map rusqlite errors to descriptive strings
// ============================================================
fn sql_err(context: &str, e: rusqlite::Error) -> String {
    format!("{}: {}", context, e)
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
    let conn = state.lock().map_err(|e| format!("Database lock error: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.parent_id, n.content, n.node_type, n.metadata, \
                    l.id AS layout_id, l.x, l.y, l.width, l.height, \
                    l.min_width, l.min_height \
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
                min_width: row.get(10)?,
                min_height: row.get(11)?,
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
    let conn = state.lock().map_err(|e| format!("Database lock error: {}", e))?;

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
            "INSERT INTO layout (node_id, map_id, x, y, width, height, min_width, min_height) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL)",
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
    let conn = state.lock().map_err(|e| format!("Database lock error: {}", e))?;

    let rows_affected = conn
        .execute(
            "UPDATE nodes SET content = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![content, node_id],
        )
        .map_err(|e| sql_err("update_node_content", e))?;

    if rows_affected == 0 {
        return Err(format!("Card {} not found", node_id));
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
    min_width: Option<f64>,
    min_height: Option<f64>,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Database lock error: {}", e))?;

    let rows_affected = conn
        .execute(
            "UPDATE layout SET x = ?1, y = ?2, width = ?3, height = ?4, \
             min_width = ?5, min_height = ?6 \
             WHERE node_id = ?7 AND map_id = ?8",
            rusqlite::params![x, y, width, height, min_width, min_height, node_id, map_id],
        )
        .map_err(|e| sql_err("update_node_layout", e))?;

    if rows_affected == 0 {
        return Err(format!(
            "No layout found for card {} on map {}",
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
    let conn = state.lock().map_err(|e| format!("Database lock error: {}", e))?;

    let rows_affected = conn
        .execute(
            "DELETE FROM nodes WHERE id = ?1",
            rusqlite::params![node_id],
        )
        .map_err(|e| {
            // Provide a clear message for the FK RESTRICT case.
            if e.to_string().contains("FOREIGN KEY") {
                format!(
                    "Card {} has children and cannot be deleted until they are removed first",
                    node_id
                )
            } else {
                sql_err("delete_node", e)
            }
        })?;

    if rows_affected == 0 {
        return Err(format!("Card {} not found", node_id));
    }

    Ok(())
}

/// Delete a node and its entire descendant subtree in a single transaction.
///
/// This command bypasses the FK RESTRICT constraint that `delete_node` runs
/// into when a node has children. It works in five steps inside one
/// transaction:
///
///   1. Collect the full descendant set (including the root node itself) via
///      a recursive CTE. Each row carries its depth so we can derive a
///      correct topological deletion order (deepest nodes first).
///   2. Read all `rel_node_id` values from relationships whose source, target,
///      OR rel_node_id is in the descendant set. These companion nodes must be
///      explicitly deleted because the FK flows nodes -> relationships, not
///      the other way. Collecting by rel_node_id covers the case where a
///      relationship label node was nested inside the subtree but the
///      relationship's source/target are both outside it.
///   3. Delete all relationship rows that reference any descendant node via
///      source_id, target_id, OR rel_node_id. This three-column filter is the
///      critical fix: previously only source_id/target_id were checked, which
///      left behind relationship rows whose rel_node_id pointed into the
///      subtree, blocking deletion of those descendant nodes.
///   4. Delete the companion relationship-nodes collected in step 2 (those
///      that are not already in the descendant set and thus not covered by
///      step 5).
///   5. Delete descendant nodes deepest-first, using the depth value from the
///      CTE as the primary sort key (desc) and id as a stable tiebreaker.
///      This is a true topological sort and correctly satisfies ON DELETE
///      RESTRICT on nodes.parent_id regardless of insertion order.
///
/// Returns the total count of deleted nodes (descendants + companion nodes).
///
/// Matches: `DbInterface.deleteNodeCascade(nodeId)`
#[tauri::command]
pub fn delete_node_cascade(
    state: tauri::State<'_, Mutex<Connection>>,
    node_id: i64,
) -> Result<i64, String> {
    let conn = state.lock().map_err(|e| format!("Database lock error: {}", e))?;

    // ----------------------------------------------------------------
    // 1. Collect all descendant node IDs (inclusive of root) with depth.
    //    depth = 0 is the root being deleted; depth increases with each
    //    level of nesting. We sort deepest-first in step 5.
    // ----------------------------------------------------------------
    let mut desc_stmt = conn
        .prepare(
            "WITH RECURSIVE descendants(id, depth) AS (
                 SELECT id, 0 FROM nodes WHERE id = ?1
                 UNION ALL
                 SELECT n.id, d.depth + 1
                 FROM nodes n JOIN descendants d ON n.parent_id = d.id
             )
             SELECT id, depth FROM descendants",
        )
        .map_err(|e| sql_err("prepare delete_node_cascade descendants", e))?;

    // Collect as (id, depth) pairs so we can sort topologically later.
    let descendant_pairs: Vec<(i64, i64)> = desc_stmt
        .query_map(rusqlite::params![node_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| sql_err("query delete_node_cascade descendants", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| sql_err("collect delete_node_cascade descendants", e))?;

    if descendant_pairs.is_empty() {
        return Err(format!("Card {} not found", node_id));
    }

    let descendant_ids: Vec<i64> = descendant_pairs.iter().map(|(id, _)| *id).collect();

    // ----------------------------------------------------------------
    // 2. Collect rel_node_ids for all relationships touching descendants
    //    via source_id, target_id, OR rel_node_id.
    //
    //    The rel_node_id arm is the critical addition: it catches the case
    //    where a companion label node is nested inside the subtree but the
    //    relationship's source and target are both outside it. Without this
    //    arm the relationship row would survive step 3, then block step 5
    //    from deleting the companion node.
    //
    //    We exclude companions that are already in the descendant set;
    //    those will be deleted naturally in step 5 and do not need the
    //    separate companion-delete pass in step 4.
    // ----------------------------------------------------------------
    let placeholders: String = descendant_ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");

    let rel_query = format!(
        "SELECT rel_node_id FROM relationships \
         WHERE (source_id IN ({p}) OR target_id IN ({p}) OR rel_node_id IN ({p})) \
         AND rel_node_id IS NOT NULL",
        p = placeholders
    );

    let params: Vec<rusqlite::types::Value> = descendant_ids
        .iter()
        .map(|id| rusqlite::types::Value::Integer(*id))
        .collect();

    let mut rel_stmt = conn
        .prepare(&rel_query)
        .map_err(|e| sql_err("prepare delete_node_cascade rel_node_ids", e))?;

    // Companions that are NOT already going to be deleted as descendants.
    let descendant_id_set: std::collections::HashSet<i64> =
        descendant_ids.iter().cloned().collect();

    let companion_ids: Vec<i64> = rel_stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| row.get(0))
        .map_err(|e| sql_err("query delete_node_cascade rel_node_ids", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| sql_err("collect delete_node_cascade rel_node_ids", e))?
        .into_iter()
        .filter(|id| !descendant_id_set.contains(id))
        .collect();

    // ----------------------------------------------------------------
    // 3-5. Execute all deletions inside a transaction.
    // ----------------------------------------------------------------
    conn.execute("BEGIN", [])
        .map_err(|e| sql_err("BEGIN delete_node_cascade", e))?;

    let result = (|| -> Result<i64, rusqlite::Error> {
        // 3. Delete ALL relationship rows that touch the descendant set via
        //    any of their three node FKs (source_id, target_id, rel_node_id).
        //    This is the complete filter: no relationship row that references
        //    a descendant will survive to block subsequent node deletes.
        let del_rel_query = format!(
            "DELETE FROM relationships \
             WHERE source_id IN ({p}) OR target_id IN ({p}) OR rel_node_id IN ({p})",
            p = placeholders
        );
        conn.execute(
            &del_rel_query,
            rusqlite::params_from_iter(params.iter()),
        )?;

        // 4. Delete companion relationship-nodes that are NOT in the
        //    descendant set (those are handled in step 5).
        for companion_id in &companion_ids {
            conn.execute(
                "DELETE FROM nodes WHERE id = ?1",
                rusqlite::params![companion_id],
            )?;
        }

        // 5. Delete descendant nodes deepest-first.
        //    Sort by depth DESC (leaves before parents), with id DESC as a
        //    stable tiebreaker for nodes at the same depth level.
        //    This is a correct topological sort that satisfies ON DELETE
        //    RESTRICT on nodes.parent_id regardless of insertion order.
        //    (The previous heuristic of sorting by id DESC was only correct
        //    when children were always inserted after parents, which is not
        //    guaranteed for companion relationship-nodes.)
        let mut sorted_pairs = descendant_pairs.clone();
        sorted_pairs.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(b.0.cmp(&a.0)));

        for (desc_id, _depth) in &sorted_pairs {
            conn.execute(
                "DELETE FROM nodes WHERE id = ?1",
                rusqlite::params![desc_id],
            )?;
        }

        let total_deleted = (sorted_pairs.len() + companion_ids.len()) as i64;
        Ok(total_deleted)
    })();

    match result {
        Ok(count) => {
            conn.execute("COMMIT", [])
                .map_err(|e| sql_err("COMMIT delete_node_cascade", e))?;
            Ok(count)
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(sql_err("delete_node_cascade transaction", e))
        }
    }
}

// ============================================================
// Relationship commands
// ============================================================

/// A relationship between two nodes.
/// Field names match the TypeScript `RelationshipData` interface in
/// `src/ipc/db.ts` exactly (snake_case serialized via serde).
///
/// `rel_node_id`: the companion node (node_type = 'relationship') that
/// represents this relationship's label on the canvas. None for legacy rows
/// that pre-date the relationship-as-node schema.
#[derive(Debug, Serialize)]
pub struct RelationshipData {
    pub id: i64,
    pub source_id: i64,
    pub target_id: i64,
    pub action: String,
    pub rel_node_id: Option<i64>,
}

/// Insert a new relationship between two nodes.
/// Returns the created relationship including its new ID and rel_node_id.
///
/// In a single transaction:
///   1. Creates a companion node (node_type = 'relationship') whose content
///      mirrors the action label. This node is the canvas-renderable entity.
///   2. Inserts a layout row for that node at (0, 0) with placeholder size
///      80x28. The frontend must update the position after rendering.
///   3. Inserts the relationship row referencing both endpoint nodes and the
///      new companion node via rel_node_id.
///
/// `map_id` is used to place the companion node's layout row. When
/// relationships gain their own map_id column this parameter will scope the
/// relationship row as well.
///
/// Matches: `DbInterface.createRelationship(sourceId, targetId, action, mapId)`
#[tauri::command]
pub fn create_relationship(
    state: tauri::State<'_, Mutex<Connection>>,
    source_id: i64,
    target_id: i64,
    action: String,
    map_id: i64,
) -> Result<RelationshipData, String> {
    let conn = state.lock().map_err(|e| format!("Database lock error: {}", e))?;

    conn.execute("BEGIN", [])
        .map_err(|e| sql_err("BEGIN create_relationship", e))?;

    let result = (|| -> Result<RelationshipData, rusqlite::Error> {
        // 1. Create the companion relationship-node. Content mirrors action.
        conn.execute(
            "INSERT INTO nodes (parent_id, content, node_type, created_at, updated_at) \
             VALUES (NULL, ?1, 'relationship', datetime('now'), datetime('now'))",
            rusqlite::params![action],
        )?;
        let rel_node_id = conn.last_insert_rowid();

        // 2. Place the companion node on the map at a placeholder position.
        //    The frontend will move it to its midpoint position after first render.
        conn.execute(
            "INSERT INTO layout (node_id, map_id, x, y, width, height, min_width, min_height) \
             VALUES (?1, ?2, 0.0, 0.0, 80.0, 28.0, NULL, NULL)",
            rusqlite::params![rel_node_id, map_id],
        )?;

        // 3. Insert the relationship row, linking source, target, and the companion node.
        conn.execute(
            "INSERT INTO relationships (source_id, target_id, action, rel_node_id) \
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![source_id, target_id, action, rel_node_id],
        )?;
        let id = conn.last_insert_rowid();

        Ok(RelationshipData {
            id,
            source_id,
            target_id,
            action,
            rel_node_id: Some(rel_node_id),
        })
    })();

    match result {
        Ok(data) => {
            conn.execute("COMMIT", [])
                .map_err(|e| sql_err("COMMIT create_relationship", e))?;
            Ok(data)
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(sql_err("create_relationship transaction", e))
        }
    }
}

/// Return all relationships.
/// For now the single-map invariant means this is equivalent to
/// "all relationships on the given map." When relationships gain
/// a map_id column, filter by it here.
///
/// The label is sourced from the companion node's content (authoritative)
/// when rel_node_id is present, falling back to the denormalized action
/// column for legacy rows where rel_node_id IS NULL.
///
/// Matches: `DbInterface.getMapRelationships(mapId)`
#[tauri::command]
pub fn get_map_relationships(
    state: tauri::State<'_, Mutex<Connection>>,
    _map_id: i64,
) -> Result<Vec<RelationshipData>, String> {
    let conn = state.lock().map_err(|e| format!("Database lock error: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT r.id, r.source_id, r.target_id, \
                    COALESCE(n.content, r.action) AS action, \
                    r.rel_node_id \
             FROM relationships r \
             LEFT JOIN nodes n ON n.id = r.rel_node_id",
        )
        .map_err(|e| sql_err("prepare get_map_relationships", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(RelationshipData {
                id: row.get(0)?,
                source_id: row.get(1)?,
                target_id: row.get(2)?,
                action: row.get(3)?,
                rel_node_id: row.get(4)?,
            })
        })
        .map_err(|e| sql_err("query get_map_relationships", e))?;

    let mut rels = Vec::new();
    for row in rows {
        rels.push(row.map_err(|e| sql_err("row get_map_relationships", e))?);
    }

    Ok(rels)
}

/// Update the action label on a relationship. Also bumps updated_at.
///
/// Keeps both the denormalized `action` column and the companion node's
/// `content` in sync. The node update is a no-op (0 rows affected) for
/// legacy rows where rel_node_id IS NULL -- that is intentional and not
/// treated as an error.
///
/// Matches: `DbInterface.updateRelationship(id, action)`
#[tauri::command]
pub fn update_relationship(
    state: tauri::State<'_, Mutex<Connection>>,
    id: i64,
    action: String,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Database lock error: {}", e))?;

    conn.execute("BEGIN", [])
        .map_err(|e| sql_err("BEGIN update_relationship", e))?;

    let result = (|| -> Result<(), rusqlite::Error> {
        // Update the denormalized action column on the relationship row.
        let rows_affected = conn.execute(
            "UPDATE relationships SET action = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![action, id],
        )?;

        if rows_affected == 0 {
            // Signal "not found" to the outer match via QueryReturnedNoRows.
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        // Sync the companion node's content (authoritative label source).
        // Uses a subquery to locate rel_node_id so no extra round-trip is needed.
        // Intentionally does nothing if rel_node_id IS NULL (legacy row).
        conn.execute(
            "UPDATE nodes \
             SET content = ?1, updated_at = datetime('now') \
             WHERE id = (SELECT rel_node_id FROM relationships WHERE id = ?2)",
            rusqlite::params![action, id],
        )?;

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", [])
                .map_err(|e| sql_err("COMMIT update_relationship", e))?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                Err(format!("Relationship {} not found", id))
            } else {
                Err(sql_err("update_relationship transaction", e))
            }
        }
    }
}

/// Swap the direction of a relationship: source_id <-> target_id.
/// SQLite evaluates the SET expressions using the old column values,
/// so a single UPDATE statement is sufficient -- no temporaries needed.
///
/// Matches: `DbInterface.flipRelationship(id)`
#[tauri::command]
pub fn flip_relationship(
    state: tauri::State<'_, Mutex<Connection>>,
    id: i64,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Database lock error: {}", e))?;

    let rows_affected = conn
        .execute(
            "UPDATE relationships \
             SET source_id = target_id, target_id = source_id, \
                 updated_at = datetime('now') \
             WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| sql_err("flip_relationship", e))?;

    if rows_affected == 0 {
        return Err(format!("Relationship {} not found", id));
    }

    Ok(())
}

/// Delete a relationship by ID, and also delete its companion node.
///
/// SQLite FK cascades only flow in one direction per constraint. The FK
/// `relationships.rel_node_id -> nodes.id ON DELETE CASCADE` means deleting
/// the *node* cascades to the relationship row -- but deleting the
/// *relationship* row does not cascade to the node. We handle that direction
/// explicitly inside a transaction:
///
///   1. Read rel_node_id from the relationship (may be NULL for legacy rows).
///   2. DELETE FROM relationships WHERE id = ?   (removes the edge)
///   3. DELETE FROM nodes WHERE id = rel_node_id  (removes the label node;
///      its layout row cascades automatically via nodes -> layout FK)
///
/// Step 3 is skipped if rel_node_id is NULL.
///
/// Matches: `DbInterface.deleteRelationship(id)`
#[tauri::command]
pub fn delete_relationship(
    state: tauri::State<'_, Mutex<Connection>>,
    id: i64,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Database lock error: {}", e))?;

    // Read rel_node_id before opening the transaction so we know what to clean up.
    let rel_node_id: Option<i64> = conn
        .query_row(
            "SELECT rel_node_id FROM relationships WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| {
            if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                format!("Relationship {} not found", id)
            } else {
                sql_err("delete_relationship lookup", e)
            }
        })?;

    conn.execute("BEGIN", [])
        .map_err(|e| sql_err("BEGIN delete_relationship", e))?;

    let result = (|| -> Result<(), rusqlite::Error> {
        // Delete the relationship row first.
        conn.execute(
            "DELETE FROM relationships WHERE id = ?1",
            rusqlite::params![id],
        )?;

        // Delete the companion node if one exists.
        // The node's layout row is removed automatically via ON DELETE CASCADE
        // on layout.node_id -> nodes.id.
        if let Some(node_id) = rel_node_id {
            conn.execute(
                "DELETE FROM nodes WHERE id = ?1",
                rusqlite::params![node_id],
            )?;
        }

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", [])
                .map_err(|e| sql_err("COMMIT delete_relationship", e))?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(sql_err("delete_relationship transaction", e))
        }
    }
}

/// Reparent a node and update its layout atomically.
///
/// Sets `nodes.parent_id` to `new_parent_id` (which may be NULL for a
/// top-level card) and simultaneously writes the new local-coordinate
/// position to the `layout` row. Both mutations succeed or both roll back.
///
/// Cycle detection: before touching the database, we check that
/// `new_parent_id != node_id` (self-reference). If `new_parent_id` is
/// Some, we then run a recursive ancestor-chain CTE to verify that
/// `node_id` does not already appear in the ancestry of the proposed
/// parent. Setting `parent_id = NULL` (unnesting to top level) bypasses
/// the cycle check entirely -- NULL cannot form a cycle.
///
/// Matches: `DbInterface.updateNodeParent(nodeId, newParentId, mapId, x, y, width, height)`
#[tauri::command]
pub fn update_node_parent(
    state: tauri::State<'_, Mutex<Connection>>,
    node_id: i64,
    new_parent_id: Option<i64>,
    map_id: i64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    min_width: Option<f64>,
    min_height: Option<f64>,
) -> Result<(), String> {
    // ----------------------------------------------------------------
    // 1. Self-reference check (no DB call needed).
    // ----------------------------------------------------------------
    if new_parent_id == Some(node_id) {
        return Err("A card cannot be its own parent".to_string());
    }

    let conn = state.lock().map_err(|e| format!("Database lock error: {}", e))?;

    // ----------------------------------------------------------------
    // 2. Cycle detection (only when reparenting to a real node).
    //    Walk the ancestor chain of `proposed_parent` upward. If
    //    `node_id` appears anywhere in that chain, the move would create
    //    a cycle.
    // ----------------------------------------------------------------
    if let Some(proposed_parent) = new_parent_id {
        let cycle_exists: i64 = conn
            .query_row(
                "WITH RECURSIVE ancestor_chain(id, parent_id) AS (
                     SELECT n.id, n.parent_id
                     FROM nodes n
                     WHERE n.id = ?1
                     UNION ALL
                     SELECT n.id, n.parent_id
                     FROM nodes n
                     INNER JOIN ancestor_chain ac ON n.id = ac.parent_id
                     WHERE ac.parent_id IS NOT NULL
                 )
                 SELECT CASE WHEN EXISTS (
                     SELECT 1 FROM ancestor_chain WHERE id = ?2
                 ) THEN 1 ELSE 0 END",
                rusqlite::params![proposed_parent, node_id],
                |row| row.get(0),
            )
            .map_err(|e| sql_err("update_node_parent cycle detection", e))?;

        if cycle_exists == 1 {
            return Err(
                "This move would create a circular containment, which is not allowed."
                    .to_string(),
            );
        }
    }

    // ----------------------------------------------------------------
    // 3 + 4. UPDATE nodes and layout inside a transaction.
    // ----------------------------------------------------------------
    conn.execute("BEGIN", [])
        .map_err(|e| sql_err("BEGIN update_node_parent", e))?;

    let result = (|| -> Result<(), rusqlite::Error> {
        // 3. Update structural parent and bump updated_at.
        let rows_affected = conn.execute(
            "UPDATE nodes SET parent_id = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![new_parent_id, node_id],
        )?;

        if rows_affected == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        // 4. Update spatial layout (coordinates are local to new parent).
        let layout_rows_affected = conn.execute(
            "UPDATE layout SET x = ?1, y = ?2, width = ?3, height = ?4, \
             min_width = ?5, min_height = ?6 \
             WHERE node_id = ?7 AND map_id = ?8",
            rusqlite::params![x, y, width, height, min_width, min_height, node_id, map_id],
        )?;

        if layout_rows_affected == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        Ok(())
    })();

    // ----------------------------------------------------------------
    // 5. COMMIT or ROLLBACK.
    // ----------------------------------------------------------------
    match result {
        Ok(()) => {
            conn.execute("COMMIT", [])
                .map_err(|e| sql_err("COMMIT update_node_parent", e))?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            // Distinguish the "not found" case from a generic DB error.
            if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                Err(format!(
                    "Card {} or its layout row on map {} not found",
                    node_id, map_id
                ))
            } else {
                Err(sql_err("update_node_parent transaction", e))
            }
        }
    }
}
