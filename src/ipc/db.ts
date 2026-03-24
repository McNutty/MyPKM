// The IPC interface contract for Plectica 2.0
// Both the Tauri Rust backend (Silas) and the frontend (Wren) build against this.

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
  min_width: number | null
  min_height: number | null
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
  updateNodeLayout(nodeId: number, mapId: number, x: number, y: number, width: number, height: number, minWidth: number | null, minHeight: number | null): Promise<void>
  /**
   * Reparent a node and update its layout atomically.
   * Pass `newParentId = null` to unnest a card to top level.
   * The Rust backend performs self-reference and cycle-detection checks and
   * returns a descriptive error string on violation -- callers should surface
   * that string to the user and revert in-memory state.
   */
  updateNodeParent(nodeId: number, newParentId: number | null, mapId: number, x: number, y: number, width: number, height: number, minWidth: number | null, minHeight: number | null): Promise<void>
  deleteNode(nodeId: number): Promise<void>

  // --- Relationship operations (M3) ---
  createRelationship(sourceId: number, targetId: number, action: string, mapId: number): Promise<RelationshipData>
  getMapRelationships(mapId: number): Promise<RelationshipData[]>
  updateRelationship(id: number, action: string): Promise<void>
  flipRelationship(id: number): Promise<void>
  deleteRelationship(id: number): Promise<void>
}
