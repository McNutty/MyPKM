/**
 * TopBar -- unified navigation + zoom controls bar.
 *
 * Renders a single horizontal bar:
 *   Left side:  breadcrumb trail (Home > Model A > Model B)
 *   Right side: error indicator, Fit button, zoom percentage
 *
 * Replaces the separate Breadcrumbs component and the Canvas-internal toolbar.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { db } from '../ipc'
import type { BreadcrumbItem } from '../ipc/db'

interface TopBarProps {
  mapId: number
  onNavigateToMap: (mapId: number) => void
  zoom: number
  onZoomToFit: () => void
  error?: string | null
}

export const TopBar: React.FC<TopBarProps> = ({
  mapId,
  onNavigateToMap,
  zoom,
  onZoomToFit,
  error,
}) => {
  const [path, setPath] = useState<BreadcrumbItem[]>([])

  useEffect(() => {
    let cancelled = false
    db.getBreadcrumbPath(mapId)
      .then((items) => { if (!cancelled) setPath(items) })
      .catch((err) => {
        if (!cancelled) console.error('[TopBar] Failed to load breadcrumb path:', err)
      })
    return () => { cancelled = true }
  }, [mapId])

  const handleCrumbClick = useCallback(
    (crumb: BreadcrumbItem, isLast: boolean) => {
      if (isLast) return
      onNavigateToMap(crumb.map_id)
    },
    [onNavigateToMap]
  )

  return (
    <div
      style={{
        height: 36,
        backgroundColor: '#fafafa',
        borderBottom: '1px solid #e0e0e0',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 4,
        flexShrink: 0,
        zIndex: 1500,
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Breadcrumb trail -- left side */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          overflow: 'hidden',
        }}
      >
        {path.map((crumb, index) => {
          const isLast = index === path.length - 1
          return (
            <React.Fragment key={crumb.map_id}>
              {index > 0 && (
                <span style={{ fontSize: 11, color: '#ccc', flexShrink: 0 }}>{'/'}</span>
              )}
              <span
                onClick={() => handleCrumbClick(crumb, isLast)}
                style={{
                  fontSize: 12,
                  fontWeight: isLast ? 600 : 400,
                  color: isLast ? '#333' : '#666',
                  cursor: isLast ? 'default' : 'pointer',
                  flexShrink: 0,
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  padding: '2px 4px',
                  borderRadius: 3,
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (!isLast) {
                    (e.currentTarget as HTMLSpanElement).style.backgroundColor = '#f0f0f0'
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLSpanElement).style.backgroundColor = 'transparent'
                }}
                title={crumb.name}
              >
                {crumb.name || 'Home'}
              </span>
            </React.Fragment>
          )
        })}
      </div>

      {/* Right side: error + zoom controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {error && (
          <span style={{ fontSize: 12, color: '#c62828' }}>
            {error}
          </span>
        )}
        <button
          onClick={onZoomToFit}
          title="Zoom to fit all cards (Ctrl+0)"
          style={{
            padding: '3px 10px',
            fontSize: 12,
            borderRadius: 4,
            border: '1px solid #bdbdbd',
            background: '#fff',
            cursor: 'pointer',
            color: '#444',
          }}
        >
          Fit
        </button>
        <span style={{ fontSize: 12, color: '#999', minWidth: 38, textAlign: 'right' }}>
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  )
}
