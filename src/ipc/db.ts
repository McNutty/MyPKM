// The IPC interface contract for Ambit
// Both the Tauri Rust backend (Silas) and the frontend (Wren) build against this.

/**
 * A map (canvas). Returned by createMap and getAllMaps.
 * Fields mirror the Rust `MapData` struct.
 */
export interface MapData {
  id: number
  name: string
}

export interface NodeWithLayout {
  id: number
  parent_id: number | null
  content: string
  node_type: string
  metadata: string | null
  layout_id: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * A directed relationship between two nodes.
 * Field names mirror the Rust `RelationshipData` struct (camelCase on the JS side).
 */
export interface RelationshipData {
  id: number
  sourceId: number
  targetId: number
  action: string
  /** ID of the companion node (node_type='relationship') backing this label. Null for legacy rows. */
  relNodeId: number | null
}

export interface DbInterface {
  getMapNodes(mapId: number): Promise<NodeWithLayout[]>
  createNode(mapId: number, content: string, x: number, y: number, width: number, height: number): Promise<number>
  updateNodeContent(nodeId: number, content: string): Promise<void>
  updateNodeLayout(nodeId: number, mapId: number, x: number, y: number, width: number, height: number): Promise<void>
  /**
   * Reparent a node and update its layout atomically.
   * Pass `newParentId = null` to unnest a card to top level.
   * The Rust backend performs self-reference and cycle-detection checks and
   * returns a descriptive error string on violation -- callers should surface
   * that string to the user and revert in-memory state.
   */
  updateNodeParent(nodeId: number, newParentId: number | null, mapId: number, x: number, y: number, width: number, height: number): Promise<void>
  deleteNode(nodeId: number): Promise<void>
  /**
   * Delete a node and its entire descendant subtree in one transaction.
   * Also cleans up any relationship rows and companion relationship-nodes
   * that reference the deleted descendants.
   * Returns the total count of deleted nodes (descendants + companion nodes).
   */
  deleteNodeCascade(nodeId: number): Promise<number>

  // --- Relationship operations (M3) ---
  createRelationship(sourceId: number, targetId: number, action: string, mapId: number): Promise<RelationshipData>
  getMapRelationships(mapId: number): Promise<RelationshipData[]>
  updateRelationship(id: number, action: string): Promise<void>
  /**
   * Rewire one or both endpoints of a relationship.
   * Pass the existing source/target for the end you are NOT changing.
   */
  reattachRelationship(id: number, newSourceId: number, newTargetId: number): Promise<void>
  flipRelationship(id: number): Promise<void>
  deleteRelationship(id: number): Promise<void>

  // --- Map (canvas) management (M4) ---
  /** Create a new map and return its id and name. */
  createMap(name: string): Promise<MapData>
  /** Return all maps ordered by creation time (oldest first). */
  getAllMaps(): Promise<MapData[]>
  /** Rename a map. */
  renameMap(id: number, name: string): Promise<void>
  /**
   * Delete a map and all nodes, relationships, and layout rows that belong to it.
   * The Rust command runs as a single transaction.
   * Returns the id of the deleted map.
   */
  deleteMap(id: number): Promise<number>
}
