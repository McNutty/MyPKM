import { invoke } from '@tauri-apps/api/core'
import type { DbInterface, MapData, NodeWithLayout, RelationshipData, CreateModelResult, BreadcrumbItem } from './db'

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
    height: number,
  ): Promise<void> {
    return invoke('update_node_parent', { nodeId, newParentId, mapId, x, y, width, height })
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

  // --- Map (canvas) management (M4) ---

  async createMap(name: string): Promise<MapData> {
    return invoke<MapData>('create_map', { name })
  }

  async getAllMaps(): Promise<MapData[]> {
    return invoke<MapData[]>('get_all_maps')
  }

  async renameMap(id: number, name: string): Promise<void> {
    return invoke('rename_map', { id, name })
  }

  async deleteMap(id: number): Promise<number> {
    return invoke<number>('delete_map', { id })
  }

  // --- Model card operations (M5) ---

  async createModelCard(
    mapId: number,
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<CreateModelResult> {
    return invoke<CreateModelResult>('create_model_card', { mapId, name, x, y, width, height })
  }

  async getModelMapId(nodeId: number): Promise<number> {
    return invoke<number>('get_model_map_id', { nodeId })
  }

  async getBreadcrumbPath(mapId: number): Promise<BreadcrumbItem[]> {
    return invoke<BreadcrumbItem[]>('get_breadcrumb_path', { mapId })
  }
}
