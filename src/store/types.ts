/**
 * Core data types for the Plectica 2.0 canvas app.
 *
 * Key design: every card has a position relative to its parent's content area.
 * The canvas root is the implicit parent for top-level cards.
 * This naturally supports recursive nesting -- a card's absolute position is
 * computed by walking up the parent chain and accumulating transforms.
 *
 * Field naming aligns with the DB schema (NodeWithLayout) rather than the
 * prototype -- `content` not `label`, `width`/`height` not `w`/`h`,
 * numeric IDs not string IDs.
 */

export interface CardData {
  id: number
  content: string
  /** Position relative to parent's content area (or canvas origin if parentId is null) */
  x: number
  y: number
  /** Explicit width/height. For containers, this may be overridden by auto-resize. */
  width: number
  height: number
  /** Parent card ID, or null for top-level cards */
  parentId: number | null
  /** Nesting depth (computed, for coloring). All cards are depth 0 at M1. */
  depth: number
  /** Background color (derived from depth) */
  color: string
  /**
   * Minimum width/height remembered from the last manual resize.
   * autoResizeParent will never shrink this card below these values.
   * null means no floor -- autoResizeParent uses MIN_W/MIN_H as the floor.
   */
  minWidth: number | null
  minHeight: number | null
}

export interface CanvasViewport {
  /** Pan offset in screen pixels */
  panX: number
  panY: number
  /** Zoom level (1.0 = 100%) */
  zoom: number
}

export interface DragState {
  /** The card being dragged */
  cardId: number
  /** Offset from the card's top-left to the mouse position (in canvas-space coords) */
  offsetX: number
  offsetY: number
  /** Whether we are currently hovering over a potential nest target */
  nestTargetId: number | null
  /**
   * Current absolute canvas-space position of the dragged card's top-left corner.
   * Updated every mousemove. Used by the root-level ghost renderer (Fix 1) to
   * position the card outside its parent's DOM subtree, escaping stacking contexts.
   */
  absX: number
  absY: number
}

export interface ResizeState {
  cardId: number
  /** Which edge/corner is being resized */
  handle: 'se' // For now, only support southeast (bottom-right) corner
  startWidth: number
  startHeight: number
  startMouseX: number
  startMouseY: number
}

export interface RelationshipData {
  id: number
  sourceId: number
  targetId: number
  action: string
  relNodeId: number | null
}

/**
 * Active state while the user is drawing a new relationship line by dragging
 * from a connection handle. Tracks where the drag started (source card) and
 * the current mouse position in canvas coordinates for rendering the
 * in-progress line.
 */
export interface ConnectingState {
  sourceId: number
  /** Canvas-space X where the drag started (center of source card edge) */
  startX: number
  /** Canvas-space Y where the drag started (center of source card edge) */
  startY: number
}
