/**
 * Card component -- renders a single card and recursively renders its children.
 *
 * Each card is a positioned <div> inside its parent's content area.
 * Children are rendered as nested divs. CSS `overflow: visible` allows children
 * to be seen even if they temporarily exceed the parent bounds (before
 * auto-resize kicks in).
 *
 * The key insight: by using the DOM's natural nesting (div inside div),
 * coordinate transforms are AUTOMATIC. A child at (10, 10) inside a parent
 * at (100, 100) is automatically at (110, 110) in canvas space.
 *
 * Text editing: clicking the text area enters edit mode (<textarea>).
 * On blur or Enter (without Shift), the onContentChange callback fires and
 * the parent (App.tsx) persists to the DB.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { CardData, DragState } from '../store/types'
import { getChildren, HEADER_HEIGHT } from '../store/canvas-store'

interface CardProps {
  card: CardData
  allCards: Map<number, CardData>
  dragState: DragState | null
  selectedId: number | null
  onDragStart: (cardId: number, e: React.MouseEvent) => void
  onResizeStart: (cardId: number, e: React.MouseEvent) => void
  onSelect: (cardId: number) => void
  onContentChange: (cardId: number, newContent: string) => void
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
  onContentChange,
  zoom,
}) => {
  const children = getChildren(allCards, card.id)
  const isNestTarget = dragState?.nestTargetId === card.id
  const isSelected = selectedId === card.id
  const isDragging = dragState?.cardId === card.id

  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(card.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Keep editValue in sync when content changes externally (e.g. on load)
  useEffect(() => {
    if (!isEditing) {
      setEditValue(card.content)
    }
  }, [card.content, isEditing])

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      // Place cursor at end
      const len = textareaRef.current.value.length
      textareaRef.current.setSelectionRange(len, len)
    }
  }, [isEditing])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) return // Don't start drag while editing
      e.stopPropagation()
      onSelect(card.id)
      onDragStart(card.id, e)
    },
    [card.id, onDragStart, onSelect, isEditing]
  )

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      onResizeStart(card.id, e)
    },
    [card.id, onResizeStart]
  )

  const handleTextClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!isEditing) {
        onSelect(card.id)
        setIsEditing(true)
      }
    },
    [card.id, onSelect, isEditing]
  )

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim()
    setIsEditing(false)
    if (trimmed !== card.content) {
      onContentChange(card.id, trimmed)
    }
  }, [card.id, card.content, editValue, onContentChange])

  const handleTextareaBlur = useCallback(() => {
    commitEdit()
  }, [commitEdit])

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commitEdit()
      } else if (e.key === 'Escape') {
        // Discard changes
        setEditValue(card.content)
        setIsEditing(false)
      }
    },
    [card.content, commitEdit]
  )

  const handleTextareaMouseDown = useCallback((e: React.MouseEvent) => {
    // Prevent drag from starting when clicking inside the textarea
    e.stopPropagation()
  }, [])

  return (
    <div
      data-card-id={card.id}
      style={{
        position: 'absolute',
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
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
        cursor: isEditing ? 'default' : 'grab',
        userSelect: 'none',
        transition: isDragging ? 'none' : 'box-shadow 0.15s ease',
        opacity: isDragging ? 0.85 : 1,
        zIndex: isDragging ? 1000 : card.depth,
        overflow: 'visible', // Children can temporarily exceed bounds
        contain: 'layout style', // Performance: isolate layout recalc
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Header / Label area */}
      <div
        style={{
          height: HEADER_HEIGHT,
          padding: '0 8px',
          display: 'flex',
          alignItems: 'center',
          fontSize: Math.max(10, Math.min(14, 14 / Math.max(1, card.depth * 0.3 + 0.7))),
          fontWeight: 600,
          color: '#333',
          borderBottom: children.length > 0 ? '1px solid rgba(0,0,0,0.1)' : 'none',
          cursor: isEditing ? 'default' : 'grab',
        }}
        onMouseDown={handleMouseDown}
      >
        {children.length > 0 && (
          <span style={{ color: '#999', fontWeight: 400, marginLeft: 'auto', fontSize: 11 }}>
            ({children.length})
          </span>
        )}
      </div>

      {/* Content / text area */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: `${HEADER_HEIGHT}px 8px 8px`,
          cursor: isEditing ? 'text' : 'grab',
        }}
        onClick={handleTextClick}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleTextareaBlur}
            onKeyDown={handleTextareaKeyDown}
            onMouseDown={handleTextareaMouseDown}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              background: 'transparent',
              resize: 'none',
              outline: 'none',
              fontSize: 13,
              fontFamily: 'inherit',
              color: '#333',
              cursor: 'text',
              lineHeight: 1.4,
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 13,
              color: card.content ? '#333' : '#aaa',
              fontStyle: card.content ? 'normal' : 'italic',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              wordBreak: 'break-word',
              pointerEvents: 'none',
            }}
          >
            {card.content || 'Click to edit'}
          </span>
        )}
      </div>

      {/* Content area -- children render here */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: card.height - HEADER_HEIGHT,
          marginTop: HEADER_HEIGHT,
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
            onContentChange={onContentChange}
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
          zIndex: 10,
        }}
      />

      {/* Nest target highlight overlay -- kept for M2, not activated at M1 */}
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
