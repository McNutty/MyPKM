import { invoke } from '@tauri-apps/api/core'
import type { DbInterface, NodeWithLayout } from './db'

export class TauriDb implements DbInterface {
  async getMapNodes(mapId: number): Promise<NodeWithLayout[]> {
    return invoke<NodeWithLayout[]>('get_map_nodes', { map_id: mapId })
  }

  async createNode(
    mapId: number,
    content: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<number> {
    return invoke<number>('create_node', { map_id: mapId, content, x, y, width, height })
  }

  async updateNodeContent(nodeId: number, content: string): Promise<void> {
    return invoke('update_node_content', { node_id: nodeId, content })
  }

  async updateNodeLayout(
    nodeId: number,
    mapId: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<void> {
    return invoke('update_node_layout', { node_id: nodeId, map_id: mapId, x, y, width, height })
  }

  async deleteNode(nodeId: number): Promise<void> {
    return invoke('delete_node', { node_id: nodeId })
  }
}
