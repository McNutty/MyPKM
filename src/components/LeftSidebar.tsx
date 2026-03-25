/**
 * LeftSidebar -- Model picker panel.
 *
 * Manages its own map list state internally. Calls onSelectMap when the user
 * switches models, and updates the internal list on create/rename/delete
 * without needing to surface those events to App.tsx.
 *
 * Interactions:
 *   - Click a model to activate it
 *   - Double-click a model name to rename inline
 *   - Hover a non-active model to reveal the delete "x" button
 *   - "+" button at the bottom creates a new model and auto-selects it
 *   - Cannot delete the last remaining model
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../ipc'
import type { MapData } from '../ipc/db'

interface Props {
  mapId: number
  onSelectMap: (id: number) => void
}

export const LeftSidebar: React.FC<Props> = ({ mapId, onSelectMap }) => {
  const [maps, setMaps] = useState<MapData[]>([])
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  // editingId: which map row is in rename mode
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  // Load all maps on mount
  useEffect(() => {
    db.getAllMaps().then(setMaps).catch(console.error)
  }, [])

  // Focus the rename input whenever editingId is set
  useEffect(() => {
    if (editingId !== null && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  const handleCreate = useCallback(async () => {
    try {
      const created = await db.createMap('New Model')
      setMaps((prev) => [...prev, created])
      onSelectMap(created.id)
      // Immediately drop into rename mode for the new model
      setEditingId(created.id)
      setEditingValue(created.name)
    } catch (err) {
      console.error('Failed to create map', err)
    }
  }, [onSelectMap])

  const handleDelete = useCallback(
    async (id: number, e: React.MouseEvent) => {
      e.stopPropagation()
      if (maps.length <= 1) return // never delete the last model
      const target = maps.find((m) => m.id === id)
      const label = target?.name ?? 'this model'
      if (!window.confirm(`Delete "${label}" and all its cards? This cannot be undone.`)) return
      try {
        await db.deleteMap(id)
        const next = maps.filter((m) => m.id !== id)
        setMaps(next)
        // If we deleted the active model, switch to the first remaining one
        if (id === mapId && next.length > 0) {
          onSelectMap(next[0].id)
        }
      } catch (err: any) {
        console.error('Failed to delete map', err)
        alert(`Failed to delete model: ${err?.message ?? err}`)
      }
    },
    [maps, mapId, onSelectMap]
  )

  const startRename = useCallback((map: MapData, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(map.id)
    setEditingValue(map.name)
  }, [])

  const commitRename = useCallback(async () => {
    if (editingId === null) return
    const trimmed = editingValue.trim()
    if (trimmed.length === 0) {
      setEditingId(null)
      return
    }
    try {
      await db.renameMap(editingId, trimmed)
      setMaps((prev) =>
        prev.map((m) => (m.id === editingId ? { ...m, name: trimmed } : m))
      )
    } catch (err) {
      console.error('Failed to rename map', err)
    }
    setEditingId(null)
  }, [editingId, editingValue])

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') commitRename()
      if (e.key === 'Escape') setEditingId(null)
    },
    [commitRename]
  )

  return (
    <div
      style={{
        width: 200,
        flexShrink: 0,
        borderRight: '1px solid #e0e0e0',
        backgroundColor: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 12px 8px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#999',
          borderBottom: '1px solid #e8e8e8',
          flexShrink: 0,
        }}
      >
        Models
      </div>

      {/* Map list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {maps.map((map) => {
          const isActive = map.id === mapId
          const isHovered = hoveredId === map.id
          const isEditing = editingId === map.id

          return (
            <div
              key={map.id}
              onClick={() => {
                if (!isEditing) onSelectMap(map.id)
              }}
              onMouseEnter={() => setHoveredId(map.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 10px',
                cursor: isEditing ? 'text' : 'pointer',
                backgroundColor: isActive
                  ? '#e8f0fe'
                  : isHovered
                  ? '#f0f0f0'
                  : 'transparent',
                borderLeft: isActive ? '3px solid #4a80f5' : '3px solid transparent',
                transition: 'background-color 0.1s',
                minHeight: 32,
              }}
            >
              {isEditing ? (
                <input
                  ref={editInputRef}
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={handleRenameKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    flex: 1,
                    fontSize: 13,
                    border: '1px solid #4a80f5',
                    borderRadius: 3,
                    padding: '1px 4px',
                    outline: 'none',
                    backgroundColor: '#fff',
                    minWidth: 0,
                  }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => startRename(map, e)}
                  style={{
                    flex: 1,
                    fontSize: 13,
                    color: isActive ? '#1a3a8f' : '#333',
                    fontWeight: isActive ? 500 : 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    lineHeight: '20px',
                  }}
                  title={map.name}
                >
                  {map.name}
                </span>
              )}

              {/* Delete button -- only shown on hover, never on the active model */}
              {isHovered && !isActive && !isEditing && maps.length > 1 && (
                <button
                  onClick={(e) => handleDelete(map.id, e)}
                  title="Delete model"
                  style={{
                    flexShrink: 0,
                    marginLeft: 4,
                    width: 18,
                    height: 18,
                    border: 'none',
                    borderRadius: 3,
                    backgroundColor: 'transparent',
                    color: '#999',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    lineHeight: 1,
                    padding: 0,
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#fde8e8')
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')
                  }
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer: create button */}
      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid #e8e8e8',
          padding: '6px 10px',
        }}
      >
        <button
          onClick={handleCreate}
          title="Create new model"
          style={{
            width: '100%',
            padding: '5px 0',
            fontSize: 13,
            color: '#4a80f5',
            backgroundColor: 'transparent',
            border: '1px solid #c5d6fc',
            borderRadius: 4,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#eef3fe')
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')
          }
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
          <span>New Model</span>
        </button>
      </div>
    </div>
  )
}
