import type { DbInterface, MapData, NodeWithLayout, RelationshipData, CreateModelResult, BreadcrumbItem } from './db'

export class StubDb implements DbInterface {
  private nodes: Map<number, NodeWithLayout> = new Map()
  private relationships: Map<number, RelationshipData> = new Map()
  private maps: Map<number, MapData> = new Map([[1, { id: 1, name: 'My Canvas' }]])
  private nextNodeId = 1
  private nextLayoutId = 1
  private nextRelId = 1
  private nextMapId = 2
  // model node_id -> backing map_id
  private modelBacking: Map<number, number> = new Map()

  async getMapNodes(_mapId: number): Promise<NodeWithLayout[]> {
    // Ignores mapId for simplicity -- single map at M1
    return Array.from(this.nodes.values())
  }

  async createNode(
    _mapId: number,
    content: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<number> {
    const id = this.nextNodeId++
    const layout_id = this.nextLayoutId++
    const node: NodeWithLayout = {
      id,
      parent_id: null,
      content,
      node_type: 'card',
      metadata: null,
      layout_id,
      x,
      y,
      width,
      height,
    }
    this.nodes.set(id, node)
    return id
  }

  async updateNodeContent(nodeId: number, content: string): Promise<void> {
    const node = this.nodes.get(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)
    this.nodes.set(nodeId, { ...node, content })
  }

  async updateNodeLayout(
    nodeId: number,
    _mapId: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<void> {
    const node = this.nodes.get(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)
    this.nodes.set(nodeId, { ...node, x, y, width, height })
  }

  async updateNodeParent(
    nodeId: number,
    newParentId: number | null,
    _mapId: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<void> {
    const node = this.nodes.get(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)

    // Self-reference check
    if (newParentId === nodeId) {
      throw new Error(`Node ${nodeId} cannot be its own parent`)
    }

    // Cycle detection: walk the ancestor chain of newParentId and check for nodeId
    if (newParentId !== null) {
      let cursor: number | null = newParentId
      const visited = new Set<number>()
      while (cursor !== null) {
        if (cursor === nodeId) {
          throw new Error('This move would create a circular containment, which is not allowed.')
        }
        if (visited.has(cursor)) break // Safety: stop on already-visited node
        visited.add(cursor)
        const ancestor = this.nodes.get(cursor)
        cursor = ancestor?.parent_id ?? null
      }
    }

    this.nodes.set(nodeId, { ...node, parent_id: newParentId, x, y, width, height })
  }

  async deleteNode(nodeId: number): Promise<void> {
    if (!this.nodes.has(nodeId)) throw new Error(`Node ${nodeId} not found`)
    this.nodes.delete(nodeId)
  }

  async deleteNodeCascade(nodeId: number): Promise<number> {
    // Recursively collect all descendants and delete them
    const toDelete: number[] = []
    const collect = (id: number) => {
      toDelete.push(id)
      for (const [cid, node] of this.nodes) {
        if (node.parent_id === id) collect(cid)
      }
    }
    collect(nodeId)
    for (const id of toDelete) this.nodes.delete(id)
    return toDelete.length
  }

  async createRelationship(
    sourceId: number,
    targetId: number,
    action: string,
    _mapId: number
  ): Promise<RelationshipData> {
    const id = this.nextRelId++
    // Generate a fake relNodeId that won't collide with real node IDs in the stub.
    const relNodeId = 100000 + id
    const rel: RelationshipData = { id, sourceId, targetId, action, relNodeId }
    this.relationships.set(id, rel)
    return rel
  }

  async getMapRelationships(_mapId: number): Promise<RelationshipData[]> {
    return Array.from(this.relationships.values())
  }

  async updateRelationship(id: number, action: string): Promise<void> {
    const rel = this.relationships.get(id)
    if (!rel) throw new Error(`Relationship ${id} not found`)
    this.relationships.set(id, { ...rel, action })
  }

  async reattachRelationship(id: number, newSourceId: number, newTargetId: number): Promise<void> {
    const rel = this.relationships.get(id)
    if (!rel) throw new Error(`Relationship ${id} not found`)
    this.relationships.set(id, { ...rel, sourceId: newSourceId, targetId: newTargetId })
  }

  async flipRelationship(id: number): Promise<void> {
    const rel = this.relationships.get(id)
    if (!rel) throw new Error(`Relationship ${id} not found`)
    this.relationships.set(id, { ...rel, sourceId: rel.targetId, targetId: rel.sourceId })
  }

  async deleteRelationship(id: number): Promise<void> {
    if (!this.relationships.has(id)) throw new Error(`Relationship ${id} not found`)
    this.relationships.delete(id)
  }

  // --- Map (canvas) management (M4) ---

  async createMap(name: string): Promise<MapData> {
    const id = this.nextMapId++
    const map: MapData = { id, name }
    this.maps.set(id, map)
    return map
  }

  async getAllMaps(): Promise<MapData[]> {
    return Array.from(this.maps.values())
  }

  async renameMap(id: number, name: string): Promise<void> {
    const map = this.maps.get(id)
    if (!map) throw new Error(`Map ${id} not found`)
    this.maps.set(id, { ...map, name })
  }

  async deleteMap(id: number): Promise<number> {
    if (!this.maps.has(id)) throw new Error(`Map ${id} not found`)
    this.maps.delete(id)
    return id
  }

  // --- Model card operations (M5) ---

  async createModelCard(
    _mapId: number,
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<CreateModelResult> {
    const node_id = this.nextNodeId++
    const layout_id = this.nextLayoutId++
    const map_id = this.nextMapId++

    // Create the backing map
    this.maps.set(map_id, { id: map_id, name })

    // Create the model node
    const node: NodeWithLayout = {
      id: node_id,
      parent_id: null,
      content: name,
      node_type: 'model',
      metadata: null,
      layout_id,
      x,
      y,
      width,
      height,
    }
    this.nodes.set(node_id, node)
    this.modelBacking.set(node_id, map_id)

    return { node_id, layout_id, map_id, name }
  }

  async getModelMapId(nodeId: number): Promise<number> {
    const mapId = this.modelBacking.get(nodeId)
    if (mapId === undefined) throw new Error(`No backing map for node ${nodeId}`)
    return mapId
  }

  async getBreadcrumbPath(mapId: number): Promise<BreadcrumbItem[]> {
    // In the stub, we only have flat maps -- no parent hierarchy.
    // Return Home (map 1) if the target is not map 1, otherwise just Home.
    const target = this.maps.get(mapId)
    if (!target) throw new Error(`Map ${mapId} not found`)
    const home = this.maps.get(1)
    if (mapId === 1) {
      return [{ map_id: 1, name: home?.name ?? 'Home' }]
    }
    return [
      { map_id: 1, name: home?.name ?? 'Home' },
      { map_id: mapId, name: target.name },
    ]
  }
}
