import { invoke } from '@tauri-apps/api/core'
import type { DbInterface, NodeWithLayout } from './db'

export class TauriDb implements DbInterface {
  async getMapNodes(mapId: number): Promise<NodeWithLayout[]> {
    return invoke<NodeWithLayout[]>('get_map_nodes', { mapId })
  }

  async createNode(
    mapId: number,
    content: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<number> {
    return invoke<number>('create_node', { mapId, content, x, y, width, height })
  }

  async updateNodeContent(nodeId: number, content: string): Promise<void> {
    return invoke('update_node_content', { nodeId, content })
  }

  async updateNodeLayout(
    nodeId: number,
    mapId: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<void> {
    return invoke('update_node_layout', { nodeId, mapId, x, y, width, height })
  }

  async updateNodeParent(
    nodeId: number,
    newParentId: number | null,
    mapId: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<void> {
    // Tauri v2 auto-converts snake_case Rust param names to camelCase on the JS side.
    // The Rust command signature uses node_id, new_parent_id, map_id, x, y, width, height.
    return invoke('update_node_parent', { nodeId, newParentId, mapId, x, y, width, height })
  }

  async deleteNode(nodeId: number): Promise<void> {
    return invoke('delete_node', { nodeId })
  }
}
