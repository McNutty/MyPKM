/**
 * Core data types for the custom canvas prototype.
 *
 * Key design: every card has a position relative to its parent's content area.
 * The canvas root is the implicit parent for top-level cards.
 * This naturally supports recursive nesting -- a card's absolute position is
 * computed by walking up the parent chain and accumulating transforms.
 */

export interface CardData {
  id: string
  label: string
  /** Position relative to parent's content area (or canvas origin if parentId is null) */
  x: number
  y: number
  /** Explicit width/height. For containers, this may be overridden by auto-resize. */
  w: number
  h: number
  /** Parent card ID, or null for top-level cards */
  parentId: string | null
  /** Nesting depth (computed, for coloring) */
  depth: number
  /** Background color */
  color: string
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
  cardId: string
  /** Offset from the card's top-left to the mouse position (in card-local coords) */
  offsetX: number
  offsetY: number
  /** Whether we are currently hovering over a potential nest target */
  nestTargetId: string | null
}

export interface ResizeState {
  cardId: string
  /** Which edge/corner is being resized */
  handle: 'se' // For now, only support southeast (bottom-right) corner
  startW: number
  startH: number
  startMouseX: number
  startMouseY: number
}
