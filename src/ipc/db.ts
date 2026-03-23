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
}

export interface DbInterface {
  getMapNodes(mapId: number): Promise<NodeWithLayout[]>
  createNode(mapId: number, content: string, x: number, y: number, width: number, height: number): Promise<number>
  updateNodeContent(nodeId: number, content: string): Promise<void>
  updateNodeLayout(nodeId: number, mapId: number, x: number, y: number, width: number, height: number): Promise<void>
  deleteNode(nodeId: number): Promise<void>
}
