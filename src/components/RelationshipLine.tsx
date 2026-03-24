/**
 * RelationshipLine -- renders a single directed relationship between two cards.
 *
 * Receives absolute canvas-space positions for both cards and draws an SVG
 * quadratic Bezier curve from the source card's edge through the relationship
 * card's position to the target card's edge, with an arrowhead at the target
 * end and an action label card at the curve's midpoint (or user-dragged position).
 *
 * Visual states:
 *   Normal:     solid gray (#666), thin line
 *   Selected:   blue (#1976d2), slightly thicker
 *   Unlabeled:  dashed, faded (#aaa), italic "unlabeled" placeholder
 *
 * Curve geometry:
 *   The path is a quadratic Bezier: M start Q controlPt end
 *   For a quadratic Bezier, the point on the curve at t=0.5 is:
 *     P(0.5) = 0.25*start + 0.5*Q + 0.25*end
 *   We want the curve to pass through the card center at t=0.5, so we solve
 *   for Q given the desired midpoint (cardPos):
 *     Q = 2*cardPos - 0.5*start - 0.5*end
 *   This keeps the label visually on the arrow rather than floating above it.
 *   When the card is at the computed midpoint (no user offset), the Bezier
 *   control point lies on the line between start and end and the curve is
 *   a straight line, as expected.
 *
 * A wide transparent hit-area path (12px) sits behind the visible path to
 * make clicking the curve easy without requiring pixel-perfect aim.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { RelationshipData } from '../store/types'
import { computeEdgePoint } from '../store/canvas-store'

interface CardRect {
  x: number
  y: number
  width: number
  height: number
}

// ============================================================================
// RelationshipLine
// ============================================================================

interface RelationshipLineProps {
  rel: RelationshipData
  sourcePos: CardRect
  targetPos: CardRect
  /** Absolute canvas-space position of the relationship card (control point) */
  cardX: number
  cardY: number
  isSelected: boolean
  /**
   * Whether this line's label is currently being edited.
   * When true, both the card label and the EditInput are hidden/shown
   * respectively by the overlay -- the line itself doesn't change.
   */
  isEditing: boolean
  onSelect: (relId: number) => void
  onEditStart: (relId: number) => void
}

export const RelationshipLine: React.FC<RelationshipLineProps> = ({
  rel,
  sourcePos,
  targetPos,
  cardX,
  cardY,
  isSelected,
  isEditing,
  onSelect,
  onEditStart,
}) => {
  const isUnlabeled = rel.action === ''

  // Compute edge-to-edge endpoints by aiming toward the relationship label card
  // position rather than the opposite card's center. The Bezier curve goes
  // source -> labelCard -> target, so the arrow should exit/enter each card
  // in the direction of the label card. This means two relationships between
  // the same pair of cards exit at different points when their label cards are
  // pulled in different directions. When the label card sits at the geometric
  // midpoint (default), this is nearly identical to center-to-center aiming.
  const sourceCenter = {
    x: sourcePos.x + sourcePos.width / 2,
    y: sourcePos.y + sourcePos.height / 2,
  }
  const targetCenter = {
    x: targetPos.x + targetPos.width / 2,
    y: targetPos.y + targetPos.height / 2,
  }

  // Label card position as the aim target for both edge points.
  const labelCardPos = { x: cardX, y: cardY }

  const start = computeEdgePoint(
    sourceCenter,
    labelCardPos,
    { x: sourcePos.x, y: sourcePos.y, w: sourcePos.width, h: sourcePos.height }
  )
  const end = computeEdgePoint(
    targetCenter,
    labelCardPos,
    { x: targetPos.x, y: targetPos.y, w: targetPos.width, h: targetPos.height }
  )

  // Compute the Bezier control point such that the curve passes through the
  // card center at t=0.5. For a quadratic Bezier, P(0.5) = 0.25*start +
  // 0.5*Q + 0.25*end. Solving for Q given the desired curve point (cardX, cardY):
  //   Q = 2*(cardX,cardY) - 0.5*start - 0.5*end
  // This keeps the label sitting on the arrow, not floating above it.
  const ctrlX = 2 * cardX - 0.5 * start.x - 0.5 * end.x
  const ctrlY = 2 * cardY - 0.5 * start.y - 0.5 * end.y
  const pathD = `M ${start.x} ${start.y} Q ${ctrlX} ${ctrlY} ${end.x} ${end.y}`

  // Visual style
  const stroke = isSelected ? '#1976d2' : isUnlabeled ? '#aaa' : '#666'
  const strokeWidth = isSelected ? 2 : 1.5
  const strokeDasharray = isUnlabeled ? '6 4' : undefined
  const arrowId = `arrow-${rel.id}${isSelected ? '-sel' : isUnlabeled ? '-unlab' : ''}`

  const handleLineClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onSelect(rel.id)
    },
    [rel.id, onSelect]
  )

  const handleLineDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onSelect(rel.id)
      onEditStart(rel.id)
    },
    [rel.id, onSelect, onEditStart]
  )

  return (
    <>
      {/* SVG fragment -- rendered inside the shared SVG overlay in App.tsx */}
      <defs>
        <marker
          id={arrowId}
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L0,6 L8,3 z" fill={stroke} />
        </marker>
      </defs>

      {/* Wide transparent hit area for easy clicking.
          Uses a curved path matching the visible line, with a wide invisible stroke.
          pointerEvents='stroke' fires events even though the SVG parent has none. */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(0,0,0,0)"
        strokeWidth={12}
        pointerEvents="stroke"
        style={{ cursor: 'pointer' }}
        onClick={handleLineClick}
        onDoubleClick={handleLineDoubleClick}
      />

      {/* Visible curved line */}
      <path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        markerEnd={`url(#${arrowId})`}
        style={{ cursor: 'pointer', pointerEvents: 'none' }}
      />
    </>
  )
}

// ============================================================================
// RelationshipCard
// ============================================================================

/**
 * RelationshipCard -- the HTML label element that sits on top of the SVG curve
 * at the user-dragged position (or the computed midpoint when never dragged).
 * Rendered by RelationshipOverlay as a sibling of the SVG, positioned
 * absolutely in the same canvas-transform coordinate space.
 *
 * Draggable: mousedown starts a drag tracked by App.tsx via onDragStart.
 */
interface RelationshipCardProps {
  rel: RelationshipData
  /** Absolute canvas-space X of the card center */
  cardX: number
  /** Absolute canvas-space Y of the card center */
  cardY: number
  isSelected: boolean
  isEditing: boolean
  onSelect: (relId: number) => void
  onEditStart: (relId: number) => void
  onDragStart: (relId: number, e: React.MouseEvent) => void
}

export const RelationshipCard: React.FC<RelationshipCardProps> = ({
  rel,
  cardX,
  cardY,
  isSelected,
  isEditing,
  onSelect,
  onEditStart,
  onDragStart,
}) => {
  const isUnlabeled = rel.action === ''

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onSelect(rel.id)
    },
    [rel.id, onSelect]
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onSelect(rel.id)
      onEditStart(rel.id)
    },
    [rel.id, onSelect, onEditStart]
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      // Left-button only; right-button is context menu territory
      if (e.button !== 0) return
      onDragStart(rel.id, e)
    },
    [rel.id, onDragStart]
  )

  // Hide card while the EditInput is active -- the input takes its place.
  if (isEditing) return null

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        left: cardX,
        top: cardY,
        transform: 'translate(-50%, -50%)',
        // Width is clamped; content wraps if the label is long.
        minWidth: 60,
        maxWidth: 120,
        padding: '2px 7px',
        backgroundColor: '#fff',
        border: `1px ${isUnlabeled ? 'dashed' : 'solid'} ${isSelected ? '#1976d2' : '#bdbdbd'}`,
        borderRadius: 4,
        fontSize: 11,
        fontFamily: 'inherit',
        fontStyle: isUnlabeled ? 'italic' : 'normal',
        color: isSelected ? '#1976d2' : isUnlabeled ? '#aaa' : '#555',
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        cursor: 'grab',
        userSelect: 'none',
        // Sit above the SVG line (z=1) but below ghosts (z=10000)
        zIndex: 2,
        // Subtle shadow to lift it off the canvas
        boxShadow: isSelected
          ? '0 0 0 2px rgba(25,118,210,0.15)'
          : '0 1px 3px rgba(0,0,0,0.10)',
      }}
    >
      {isUnlabeled ? 'unlabeled' : rel.action}
    </div>
  )
}

// ============================================================================
// RelationshipOverlay
// ============================================================================

/**
 * Overlay component -- wraps all RelationshipLine instances in a single SVG
 * that spans the full canvas-transform space. Rendered inside the canvas
 * transform div in App.tsx, above cards but with pointer-events arranged so
 * cards remain draggable.
 *
 * The inline editing input is rendered as a separate DOM element positioned
 * over the SVG at the line midpoint -- it must sit outside the SVG element
 * so it receives proper focus and keyboard events.
 */
interface RelationshipOverlayProps {
  relationships: RelationshipData[]
  cards: Map<number, import('../store/types').CardData>
  /** Absolute canvas-space position for each relationship card, keyed by rel.id */
  relCardPositions: Map<number, { x: number; y: number }>
  selectedRelId: number | null
  editingRelId: number | null
  onSelectRel: (relId: number) => void
  onLabelCommit: (relId: number, action: string) => void
  onEditStart: (relId: number) => void
  onEditCancel: () => void
  onRelCardDragStart: (relId: number, e: React.MouseEvent) => void
  // In-progress connection draw
  connectingSource?: { x: number; y: number } | null
  connectingMouse?: { x: number; y: number } | null
}

import { getAbsolutePosition } from '../store/canvas-store'

export const RelationshipOverlay: React.FC<RelationshipOverlayProps> = ({
  relationships,
  cards,
  relCardPositions,
  selectedRelId,
  editingRelId,
  onSelectRel,
  onLabelCommit,
  onEditStart,
  onEditCancel,
  onRelCardDragStart,
  connectingSource,
  connectingMouse,
}) => {
  // Build position lookup: for each relationship, resolve absolute rects for
  // both source and target. Skip any relationship where either card is missing
  // (e.g. after a delete that hasn't yet persisted).
  type LineData = {
    rel: RelationshipData
    sourcePos: CardRect
    targetPos: CardRect
    /** Absolute canvas position of the relationship card / Bezier control point */
    cardX: number
    cardY: number
  }

  const lines: LineData[] = []
  for (const rel of relationships) {
    const srcCard = cards.get(rel.sourceId)
    const tgtCard = cards.get(rel.targetId)
    if (!srcCard || !tgtCard) continue

    const srcAbs = getAbsolutePosition(cards, rel.sourceId)
    const tgtAbs = getAbsolutePosition(cards, rel.targetId)

    const sourcePos: CardRect = { x: srcAbs.x, y: srcAbs.y, width: srcCard.width, height: srcCard.height }
    const targetPos: CardRect = { x: tgtAbs.x, y: tgtAbs.y, width: tgtCard.width, height: tgtCard.height }

    // Compute the geometric midpoint of the edge-to-edge line as the default
    // relationship card position (falls back to this when no user offset exists).
    const srcCenter = { x: srcAbs.x + srcCard.width / 2, y: srcAbs.y + srcCard.height / 2 }
    const tgtCenter = { x: tgtAbs.x + tgtCard.width / 2, y: tgtAbs.y + tgtCard.height / 2 }
    const start = computeEdgePoint(srcCenter, tgtCenter, { x: sourcePos.x, y: sourcePos.y, w: sourcePos.width, h: sourcePos.height })
    const end = computeEdgePoint(tgtCenter, srcCenter, { x: targetPos.x, y: targetPos.y, w: targetPos.width, h: targetPos.height })
    const defaultMidX = (start.x + end.x) / 2
    const defaultMidY = (start.y + end.y) / 2

    // Use stored position if available and non-zero; otherwise fall back to midpoint.
    const stored = relCardPositions.get(rel.id)
    const cardX = (stored && (stored.x !== 0 || stored.y !== 0)) ? stored.x : defaultMidX
    const cardY = (stored && (stored.x !== 0 || stored.y !== 0)) ? stored.y : defaultMidY

    lines.push({ rel, sourcePos, targetPos, cardX, cardY })
  }

  // Find the line being edited so we can render the input overlay
  const editingLine = editingRelId !== null ? lines.find(l => l.rel.id === editingRelId) : null

  return (
    <>
      {/* SVG layer -- covers entire canvas transform space */}
      <svg
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          // Large enough to cover typical canvas usage. Lines outside this area
          // are clipped, which is acceptable for MVP. A future improvement would
          // compute a tight bounding box from all card positions.
          width: 32000,
          height: 32000,
          overflow: 'visible',
          pointerEvents: 'none', // Cards underneath remain interactive
          zIndex: 1,             // Above cards' z=depth but below ghosts (z=10000)
        }}
      >
        {lines.map(({ rel, sourcePos, targetPos, cardX, cardY }) => (
          <RelationshipLine
            key={rel.id}
            rel={rel}
            sourcePos={sourcePos}
            targetPos={targetPos}
            cardX={cardX}
            cardY={cardY}
            isSelected={selectedRelId === rel.id}
            isEditing={editingRelId === rel.id}
            onSelect={onSelectRel}
            onEditStart={onEditStart}
          />
        ))}

        {/* In-progress connection draw: dashed line from source edge to mouse */}
        {connectingSource && connectingMouse && (
          <>
            <line
              x1={connectingSource.x}
              y1={connectingSource.y}
              x2={connectingMouse.x}
              y2={connectingMouse.y}
              stroke="#1976d2"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              opacity={0.7}
            />
            <circle
              cx={connectingMouse.x}
              cy={connectingMouse.y}
              r={4}
              fill="#1976d2"
              opacity={0.7}
            />
          </>
        )}
      </svg>

      {/* Relationship label cards -- one HTML div per relationship, positioned
          at the card position (user-dragged or midpoint). Rendered outside the
          SVG so they get proper z-stacking and click/keyboard handling. */}
      {lines.map(({ rel, cardX, cardY }) => (
        <RelationshipCard
          key={rel.id}
          rel={rel}
          cardX={cardX}
          cardY={cardY}
          isSelected={selectedRelId === rel.id}
          isEditing={editingRelId === rel.id}
          onSelect={onSelectRel}
          onEditStart={onEditStart}
          onDragStart={onRelCardDragStart}
        />
      ))}

      {/* Inline label editor -- rendered as an HTML element positioned at the
          card position so it gets proper focus/keyboard handling. The transform
          must match the canvas zoom/pan applied by the parent transform div. */}
      {editingLine && (
        <EditInput
          key={editingLine.rel.id}
          rel={editingLine.rel}
          midX={editingLine.cardX}
          midY={editingLine.cardY}
          onCommit={onLabelCommit}
          onCancel={onEditCancel}
        />
      )}
    </>
  )
}

// ============================================================================
// EditInput
// ============================================================================

// Separate component so its own state (editValue) is isolated
const EditInput: React.FC<{
  rel: RelationshipData
  midX: number
  midY: number
  onCommit: (id: number, action: string) => void
  onCancel: () => void
}> = ({ rel, midX, midY, onCommit, onCancel }) => {
  const [value, setValue] = useState(rel.action)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  const commit = useCallback(() => onCommit(rel.id, value.trim()), [rel.id, value, onCommit])

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') {
          setValue(rel.action)
          onCancel()
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: midX,
        top: midY - 26,
        transform: 'translateX(-50%)',
        width: 120,
        fontSize: 11,
        fontFamily: 'inherit',
        padding: '2px 6px',
        border: '1px solid #1976d2',
        borderRadius: 4,
        outline: 'none',
        backgroundColor: '#fff',
        color: '#333',
        zIndex: 5000,
        textAlign: 'center',
      }}
      placeholder="Describe relationship"
    />
  )
}
