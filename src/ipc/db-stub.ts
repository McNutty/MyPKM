import type { DbInterface, NodeWithLayout, RelationshipData } from './db'

export class StubDb implements DbInterface {
  private nodes: Map<number, NodeWithLayout> = new Map()
  private relationships: Map<number, RelationshipData> = new Map()
  private nextNodeId = 1
  private nextLayoutId = 1
  private nextRelId = 1

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
      min_width: null,
      min_height: null,
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
    minWidth: number | null,
    minHeight: number | null
  ): Promise<void> {
    const node = this.nodes.get(nodeId)
    if (!node) throw new Error(`Node ${nodeId} not found`)
    this.nodes.set(nodeId, { ...node, x, y, width, height, min_width: minWidth, min_height: minHeight })
  }

  async updateNodeParent(
    nodeId: number,
    newParentId: number | null,
    _mapId: number,
    x: number,
    y: number,
    width: number,
    height: number,
    minWidth: number | null,
    minHeight: number | null
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

    this.nodes.set(nodeId, { ...node, parent_id: newParentId, x, y, width, height, min_width: minWidth, min_height: minHeight })
  }

  async deleteNode(nodeId: number): Promise<void> {
    if (!this.nodes.has(nodeId)) throw new Error(`Node ${nodeId} not found`)
    this.nodes.delete(nodeId)
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

  async flipRelationship(id: number): Promise<void> {
    const rel = this.relationships.get(id)
    if (!rel) throw new Error(`Relationship ${id} not found`)
    this.relationships.set(id, { ...rel, sourceId: rel.targetId, targetId: rel.sourceId })
  }

  async deleteRelationship(id: number): Promise<void> {
    if (!this.relationships.has(id)) throw new Error(`Relationship ${id} not found`)
    this.relationships.delete(id)
  }
}
