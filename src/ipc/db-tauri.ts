import { invoke } from '@tauri-apps/api/core'
import type { DbInterface, NodeWithLayout, RelationshipData } from './db'

// Rust returns snake_case; we remap to camelCase to match RelationshipData.
interface RustRelationship {
  id: number
  source_id: number
  target_id: number
  action: string
  rel_node_id: number | null
}

function fromRust(r: RustRelationship): RelationshipData {
  return {
    id: r.id,
    sourceId: r.source_id,
    targetId: r.target_id,
    action: r.action,
    relNodeId: r.rel_node_id ?? null,
  }
}

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
    height: number,
    minWidth: number | null,
    minHeight: number | null
  ): Promise<void> {
    return invoke('update_node_layout', { nodeId, mapId, x, y, width, height, minWidth, minHeight })
  }

  async updateNodeParent(
    nodeId: number,
    newParentId: number | null,
    mapId: number,
    x: number,
    y: number,
    width: number,
    height: number,
    minWidth: number | null,
    minHeight: number | null
  ): Promise<void> {
    // Tauri v2 auto-converts snake_case Rust param names to camelCase on the JS side.
    // The Rust command signature uses node_id, new_parent_id, map_id, x, y, width, height, min_width, min_height.
    return invoke('update_node_parent', { nodeId, newParentId, mapId, x, y, width, height, minWidth, minHeight })
  }

  async deleteNode(nodeId: number): Promise<void> {
    return invoke('delete_node', { nodeId })
  }

  async deleteNodeCascade(nodeId: number): Promise<number> {
    return invoke<number>('delete_node_cascade', { nodeId })
  }

  async createRelationship(
    sourceId: number,
    targetId: number,
    action: string,
    mapId: number
  ): Promise<RelationshipData> {
    const r = await invoke<RustRelationship>('create_relationship', { sourceId, targetId, action, mapId })
    return fromRust(r)
  }

  async getMapRelationships(mapId: number): Promise<RelationshipData[]> {
    const rows = await invoke<RustRelationship[]>('get_map_relationships', { mapId })
    return rows.map(fromRust)
  }

  async updateRelationship(id: number, action: string): Promise<void> {
    return invoke('update_relationship', { id, action })
  }

  async reattachRelationship(id: number, newSourceId: number, newTargetId: number): Promise<void> {
    return invoke('reattach_relationship', { id, newSourceId, newTargetId })
  }

  async flipRelationship(id: number): Promise<void> {
    return invoke('flip_relationship', { id })
  }

  async deleteRelationship(id: number): Promise<void> {
    return invoke('delete_relationship', { id })
  }
}
