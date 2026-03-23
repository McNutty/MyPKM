/**
 * Card component -- renders a single card and recursively renders its children.
 *
 * This is the heart of the custom approach. Each card is a positioned <div>
 * inside its parent's content area. Children are rendered as nested divs.
 * CSS `overflow: visible` allows children to be seen even if they temporarily
 * exceed the parent bounds (before auto-resize kicks in).
 *
 * The key insight: by using the DOM's natural nesting (div inside div),
 * coordinate transforms are AUTOMATIC. A child at (10, 10) inside a parent
 * at (100, 100) is automatically at (110, 110) in canvas space. No manual
 * transform math needed for rendering. The browser does it for us.
 */

import React, { useCallback, useRef } from 'react'
import { CardData, DragState } from './types'
import { getChildren, HEADER_HEIGHT, PADDING } from './store'

interface CardProps {
  card: CardData
  allCards: Map<string, CardData>
  dragState: DragState | null
  selectedId: string | null
  onDragStart: (cardId: string, e: React.MouseEvent) => void
  onResizeStart: (cardId: string, e: React.MouseEvent) => void
  onSelect: (cardId: string) => void
  zoom: number
}

export const Card: React.FC<CardProps> = React.memo(({
  card,
  allCards,
  dragState,
  selectedId,
  onDragStart,
  onResizeStart,
  onSelect,
  zoom,
}) => {
  const children = getChildren(allCards, card.id)
  const isNestTarget = dragState?.nestTargetId === card.id
  const isSelected = selectedId === card.id
  const isDragging = dragState?.cardId === card.id

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onSelect(card.id)
      onDragStart(card.id, e)
    },
    [card.id, onDragStart, onSelect]
  )

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      onResizeStart(card.id, e)
    },
    [card.id, onResizeStart]
  )

  return (
    <div
      data-card-id={card.id}
      style={{
        position: 'absolute',
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        backgroundColor: card.color,
        border: isNestTarget
          ? '3px solid #2196f3'
          : isSelected
          ? '2px solid #1976d2'
          : '1px solid #bdbdbd',
        borderRadius: 6,
        boxShadow: isDragging
          ? '0 8px 24px rgba(0,0,0,0.2)'
          : isSelected
          ? '0 2px 8px rgba(25,118,210,0.3)'
          : '0 1px 3px rgba(0,0,0,0.1)',
        cursor: 'grab',
        userSelect: 'none',
        transition: isDragging ? 'none' : 'box-shadow 0.15s ease',
        opacity: isDragging ? 0.85 : 1,
        zIndex: isDragging ? 1000 : card.depth,
        overflow: 'visible', // Children can temporarily exceed bounds
        contain: 'layout style', // Performance: isolate layout recalc
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Header / Label */}
      <div
        style={{
          height: HEADER_HEIGHT,
          padding: '4px 8px',
          fontSize: Math.max(10, Math.min(14, 14 / Math.max(1, card.depth * 0.3 + 0.7))),
          fontWeight: 600,
          color: '#333',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          borderBottom: children.length > 0 ? '1px solid rgba(0,0,0,0.1)' : 'none',
          pointerEvents: 'none', // Don't interfere with drag
        }}
      >
        {card.label}
        {children.length > 0 && (
          <span style={{ color: '#999', fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
            ({children.length})
          </span>
        )}
      </div>

      {/* Content area -- children render here */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: card.h - HEADER_HEIGHT,
          overflow: 'visible',
        }}
      >
        {children.map((child) => (
          <Card
            key={child.id}
            card={child}
            allCards={allCards}
            dragState={dragState}
            selectedId={selectedId}
            onDragStart={onDragStart}
            onResizeStart={onResizeStart}
            onSelect={onSelect}
            zoom={zoom}
          />
        ))}
      </div>

      {/* Resize handle (bottom-right corner) */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          position: 'absolute',
          right: -1,
          bottom: -1,
          width: 14,
          height: 14,
          cursor: 'se-resize',
          background: 'transparent',
          borderRight: '2px solid #999',
          borderBottom: '2px solid #999',
          borderRadius: '0 0 4px 0',
          opacity: isSelected ? 1 : 0,
          transition: 'opacity 0.15s',
        }}
      />

      {/* Nest target highlight overlay */}
      {isNestTarget && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 6,
            backgroundColor: 'rgba(33, 150, 243, 0.1)',
            pointerEvents: 'none',
            zIndex: 999,
          }}
        />
      )}
    </div>
  )
})

Card.displayName = 'Card'
