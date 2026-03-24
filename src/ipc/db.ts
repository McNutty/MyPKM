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
}
