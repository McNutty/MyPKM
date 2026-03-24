/**
 * RelationshipLine -- renders a single directed relationship between two cards.
 *
 * Receives absolute canvas-space positions for both cards and draws an SVG
 * line from the source card's edge to the target card's edge, with an
 * arrowhead at the target end and an action label at the midpoint.
 *
 * Visual states:
 *   Normal:     solid gray (#666), thin line
 *   Selected:   blue (#1976d2), slightly thicker
 *   Unlabeled:  dashed, faded (#aaa), italic "unlabeled" placeholder
 *
 * A wide transparent hit-area stroke (12px) sits behind the visible line to
 * make clicking the line easy without requiring pixel-perfect aim.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
// useState/useRef/useEffect used by EditInput; useCallback used by RelationshipLine
import type { RelationshipData } from '../store/types'
import { computeEdgePoint } from '../store/canvas-store'

interface CardRect {
  x: number
  y: number
  width: number
  height: number
}

interface RelationshipLineProps {
  rel: RelationshipData
  sourcePos: CardRect
  targetPos: CardRect
  isSelected: boolean
  /** Whether this line's label is currently being edited (hides text label) */
  isEditing: boolean
  onSelect: (relId: number) => void
  onEditStart: (relId: number) => void
}

export const RelationshipLine: React.FC<RelationshipLineProps> = ({
  rel,
  sourcePos,
  targetPos,
  isSelected,
  isEditing,
  onSelect,
  onEditStart,
}) => {
  const isUnlabeled = rel.action === ''

  // Compute edge-to-edge endpoints.
  const sourceCenter = {
    x: sourcePos.x + sourcePos.width / 2,
    y: sourcePos.y + sourcePos.height / 2,
  }
  const targetCenter = {
    x: targetPos.x + targetPos.width / 2,
    y: targetPos.y + targetPos.height / 2,
  }

  const start = computeEdgePoint(
    sourceCenter,
    targetCenter,
    { x: sourcePos.x, y: sourcePos.y, w: sourcePos.width, h: sourcePos.height }
  )
  const end = computeEdgePoint(
    targetCenter,
    sourceCenter,
    { x: targetPos.x, y: targetPos.y, w: targetPos.width, h: targetPos.height }
  )

  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2

  // (angle computed but not used directly -- the SVG marker uses orient="auto")

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
          Uses a visible-but-transparent stroke; pointerEvents='stroke' means
          the hit area fires events even though the SVG parent has none. */}
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke="rgba(0,0,0,0)"
        strokeWidth={12}
        pointerEvents="stroke"
        style={{ cursor: 'pointer' }}
        onClick={handleLineClick}
        onDoubleClick={handleLineDoubleClick}
      />

      {/* Visible line */}
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        markerEnd={`url(#${arrowId})`}
        style={{ cursor: 'pointer', pointerEvents: 'none' }}
      />

      {/* Action label -- rendered as a foreignObject so we get HTML text */}
      {!isEditing && (
        <text
          x={midX}
          y={midY - 6}
          textAnchor="middle"
          fontSize={11}
          fill={isSelected ? '#1976d2' : isUnlabeled ? '#aaa' : '#555'}
          fontStyle={isUnlabeled ? 'italic' : 'normal'}
          style={{ cursor: 'pointer', userSelect: 'none', pointerEvents: 'all' }}
          onClick={handleLineClick}
          onDoubleClick={handleLineDoubleClick}
        >
          {isUnlabeled ? 'unlabeled' : rel.action}
        </text>
      )}

    </>
  )
}

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
  selectedRelId: number | null
  editingRelId: number | null
  onSelectRel: (relId: number) => void
  onLabelCommit: (relId: number, action: string) => void
  onEditStart: (relId: number) => void
  onEditCancel: () => void
  // In-progress connection draw
  connectingSource?: { x: number; y: number } | null
  connectingMouse?: { x: number; y: number } | null
}

import { getAbsolutePosition } from '../store/canvas-store'

export const RelationshipOverlay: React.FC<RelationshipOverlayProps> = ({
  relationships,
  cards,
  selectedRelId,
  editingRelId,
  onSelectRel,
  onLabelCommit,
  onEditStart,
  onEditCancel,
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
    midX: number
    midY: number
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

    // Precompute midpoint for the edit input positioning
    const srcCenter = { x: srcAbs.x + srcCard.width / 2, y: srcAbs.y + srcCard.height / 2 }
    const tgtCenter = { x: tgtAbs.x + tgtCard.width / 2, y: tgtAbs.y + tgtCard.height / 2 }
    const start = computeEdgePoint(srcCenter, tgtCenter, { x: sourcePos.x, y: sourcePos.y, w: sourcePos.width, h: sourcePos.height })
    const end = computeEdgePoint(tgtCenter, srcCenter, { x: targetPos.x, y: targetPos.y, w: targetPos.width, h: targetPos.height })

    lines.push({
      rel,
      sourcePos,
      targetPos,
      midX: (start.x + end.x) / 2,
      midY: (start.y + end.y) / 2,
    })
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
          // Offset so the origin matches the canvas coordinate system even when
          // large negative coordinates are used (shift by 8000px in each direction).
          overflow: 'visible',
          pointerEvents: 'none', // Cards underneath remain interactive
          zIndex: 1,             // Above cards' z=depth but below ghosts (z=10000)
        }}
      >
        {lines.map(({ rel, sourcePos, targetPos }) => (
          <RelationshipLine
            key={rel.id}
            rel={rel}
            sourcePos={sourcePos}
            targetPos={targetPos}
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

      {/* Inline label editor -- rendered as an HTML element positioned at the
          line midpoint so it gets proper focus/keyboard handling. The transform
          must match the canvas zoom/pan applied by the parent transform div. */}
      {editingLine && (
        <EditInput
          key={editingLine.rel.id}
          rel={editingLine.rel}
          midX={editingLine.midX}
          midY={editingLine.midY}
          onCommit={onLabelCommit}
          onCancel={onEditCancel}
        />
      )}
    </>
  )
}

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
