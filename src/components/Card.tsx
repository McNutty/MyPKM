/**
 * Card component -- renders a single card and recursively renders its children.
 *
 * Layout structure:
 *   ┌──────────────────────────────────┐
 *   │ [Title text]          (n)        │  <- header row, always visible, always bordered
 *   ├──────────────────────────────────┤  <- separator always present
 *   │  child card                      │
 *   │  child card                      │  <- children area (only present when card has parts)
 *   └──────────────────────────────────┘
 *
 * Text (the Distinction label) lives in the header row, left-aligned.
 * Children are stacked in the content area below the separator.
 *
 * Coordinate note: children are absolutely positioned within the content area
 * div, which sits directly below the header. getAbsolutePosition() in
 * canvas-store adds HEADER_HEIGHT when crossing a parent boundary, matching
 * this DOM offset.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { CardData, DragState } from '../store/types'
import { getChildren, HEADER_HEIGHT } from '../store/canvas-store'

const RESIZE_EDGE = 16

interface CardProps {
  card: CardData
  allCards: Map<number, CardData>
  dragState: DragState | null
  draggingId: number | null
  selectedId: number | null
  newCardId: number | null
  dropTargetId: number | null
  onDragStart: (cardId: number, e: React.MouseEvent) => void
  onSelect: (cardId: number) => void
  onContentChange: (cardId: number, newContent: string) => void
  onResetSize: (cardId: number) => void
  onAutoFocusConsumed: () => void
  zoom: number
  ghostZIndex?: number
}

export const Card: React.FC<CardProps> = React.memo(({
  card,
  allCards,
  dragState,
  draggingId,
  selectedId,
  newCardId,
  dropTargetId,
  onDragStart,
  onSelect,
  onContentChange,
  onResetSize,
  onAutoFocusConsumed,
  zoom,
  ghostZIndex,
}) => {
  const children = getChildren(allCards, card.id)
  const isNestTarget = dragState?.nestTargetId === card.id
  const isSelected = selectedId === card.id
  const isDragging = dragState?.cardId === card.id
  // Issue 2: unified drop target -- this card is where the dragged card will land.
  // Either it's the explicit nest target (new parent on title-bar hover) or it's
  // the current parent of the dragged card (card stays here when released).
  const isDropTarget = dropTargetId === card.id

  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(card.content)
  const [isInResizeZone, setIsInResizeZone] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Keep editValue in sync when content changes externally (e.g. on load)
  useEffect(() => {
    if (!isEditing) {
      setEditValue(card.content)
    }
  }, [card.content, isEditing])

  // Auto-focus when this card was just created (newCardId matches our id).
  // We enter edit mode immediately and clear the signal so it doesn't re-trigger.
  useEffect(() => {
    if (newCardId === card.id) {
      setIsEditing(true)
      onAutoFocusConsumed()
    }
  }, [newCardId, card.id, onAutoFocusConsumed])

  // Focus the textarea whenever we enter edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      // Place cursor at end of existing content
      const len = textareaRef.current.value.length
      textareaRef.current.setSelectionRange(len, len)
    }
  }, [isEditing])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) return
      e.stopPropagation()
      onSelect(card.id)
      onDragStart(card.id, e)
    },
    [card.id, onDragStart, onSelect, isEditing]
  )

  // Double-clicking the header text area enters edit mode.
  // Uses onDoubleClick so a single click still just selects the card.
  // stopPropagation prevents the canvas-level onDoubleClick from firing
  // (which would create a new card).
  const handleHeaderDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onSelect(card.id)
      setIsEditing(true)
    },
    [card.id, onSelect]
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
        setEditValue(card.content)
        setIsEditing(false)
      }
    },
    [card.content, commitEdit]
  )

  const handleTextareaMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  // Purely visual -- no mousedown handling involved. Checks whether the cursor
  // is within the resize edge zone (bottom or right within RESIZE_EDGE px) and
  // toggles the se-resize cursor. Mirrors the same RESIZE_EDGE constant used
  // in App.tsx's pendingDrag promotion.
  const handleRootMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isEditing) {
      setIsInResizeZone(false)
      return
    }
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const localX = e.clientX - rect.left
    const localY = e.clientY - rect.top
    const nearRight = localX >= rect.width - RESIZE_EDGE
    const nearBottom = localY >= rect.height - RESIZE_EDGE
    setIsInResizeZone(nearRight || nearBottom)
  }, [isEditing])

  const handleRootMouseLeave = useCallback(() => {
    setIsInResizeZone(false)
  }, [])

  // Double-clicking the body area (below the header) resets the card to its
  // default size. stopPropagation prevents the canvas-level double-click from
  // firing (which would create a new card).
  const handleBodyDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onResetSize(card.id)
    },
    [card.id, onResetSize]
  )

  const titleFontSize = Math.max(10, Math.min(14, 14 / Math.max(1, card.depth * 0.3 + 0.7)))

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
        border: isDropTarget
          ? '2px dashed #2196f3'
          : isSelected
          ? '2px solid #1976d2'
          : '1px solid #bdbdbd',
        borderRadius: 6,
        boxShadow: isDragging
          ? '0 8px 24px rgba(0,0,0,0.2)'
          : isSelected
          ? '0 2px 8px rgba(25,118,210,0.3)'
          : '0 1px 3px rgba(0,0,0,0.1)',
        cursor: isEditing ? 'default' : isInResizeZone ? 'se-resize' : 'grab',
        userSelect: 'none',
        transition: isDragging ? 'none' : 'box-shadow 0.15s ease',
        opacity: isDragging ? 0.85 : 1,
        // Fix 1: ghostZIndex overrides the normal depth-based z-index when this
        // instance is the root-level ghost rendered outside all stacking contexts.
        zIndex: ghostZIndex !== undefined ? ghostZIndex : isDragging ? 1000 : card.depth,
        // overflow must remain visible so child cards that overflow their
        // parent container are still rendered.
        overflow: 'visible',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleRootMouseMove}
      onMouseLeave={handleRootMouseLeave}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Header row -- ALWAYS visible. Contains the card's title/label.      */}
      {/* The bottom border is the separator line, always rendered.           */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          flexShrink: 0,
          height: HEADER_HEIGHT,
          minHeight: HEADER_HEIGHT,
          padding: '0 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: '1px solid rgba(0,0,0,0.12)',
          cursor: isEditing ? 'text' : 'grab',
          overflow: 'hidden',
        }}
        onMouseDown={isEditing ? undefined : handleMouseDown}
        onDoubleClick={handleHeaderDoubleClick}
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
              flex: 1,
              height: HEADER_HEIGHT - 6,
              border: 'none',
              background: 'transparent',
              resize: 'none',
              outline: 'none',
              fontSize: titleFontSize,
              fontFamily: 'inherit',
              fontWeight: 600,
              color: '#333',
              cursor: 'text',
              lineHeight: 1.4,
              padding: 0,
              // Single-line feel inside the header
              overflowY: 'hidden',
            }}
          />
        ) : (
          <span
            style={{
              flex: 1,
              fontSize: titleFontSize,
              fontWeight: 600,
              color: card.content ? '#333' : '#aaa',
              fontStyle: card.content ? 'normal' : 'italic',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              pointerEvents: 'none',
              textAlign: 'left',
            }}
          >
            {card.content || 'Untitled'}
          </span>
        )}

        {/* Child count badge */}
        {children.length > 0 && (
          <span style={{
            flexShrink: 0,
            color: '#999',
            fontWeight: 400,
            fontSize: 11,
            pointerEvents: 'none',
          }}>
            ({children.length})
          </span>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Content area -- children render here as absolutely-positioned cards */}
      {/* Double-click on the body (not on a child card) resets to default size */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          overflow: 'visible',
        }}
        onDoubleClick={handleBodyDoubleClick}
      >
        {children.map((child) => {
          // Fix 1: suppress the nested instance of the card being dragged.
          // It is rendered separately at root level as a ghost card to escape
          // CSS stacking contexts. Rendering it here too would show a
          // duplicate at the original position while dragging.
          if (child.id === draggingId) return null
          return (
            <Card
              key={child.id}
              card={child}
              allCards={allCards}
              dragState={dragState}
              draggingId={draggingId}
              selectedId={selectedId}
              newCardId={newCardId}
              dropTargetId={dropTargetId}
              onDragStart={onDragStart}
              onSelect={onSelect}
              onContentChange={onContentChange}
              onResetSize={onResetSize}
              onAutoFocusConsumed={onAutoFocusConsumed}
              zoom={zoom}
            />
          )
        })}
      </div>

      {/* Visual resize indicator (bottom-right corner). Purely visual --
          resize detection happens in App.tsx via pendingDrag promotion. */}
      {isSelected && (
        <div
          style={{
            position: 'absolute',
            right: 2,
            bottom: 2,
            width: 12,
            height: 12,
            borderRight: '2px solid #999',
            borderBottom: '2px solid #999',
            borderRadius: '0 0 4px 0',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Drop target highlight overlay -- shown for both nest targets and current-parent drop targets */}
      {isDropTarget && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 6,
            backgroundColor: 'rgba(33, 150, 243, 0.08)',
            pointerEvents: 'none',
            zIndex: 999,
          }}
        />
      )}
    </div>
  )
})

Card.displayName = 'Card'
