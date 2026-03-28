/**
 * Breadcrumbs -- navigation bar showing the current map's path from Home.
 *
 * Fetches the path via db.getBreadcrumbPath on mount and whenever mapId changes.
 * Renders a horizontal trail: Home > Model A > Model B
 * Clicking a crumb (except the current last one) navigates to that map.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { db } from '../ipc'
import type { BreadcrumbItem } from '../ipc/db'

interface BreadcrumbsProps {
  mapId: number
  onNavigateToMap: (mapId: number) => void
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ mapId, onNavigateToMap }) => {
  const [path, setPath] = useState<BreadcrumbItem[]>([])

  useEffect(() => {
    let cancelled = false
    db.getBreadcrumbPath(mapId)
      .then((items) => { if (!cancelled) setPath(items) })
      .catch((err) => {
        if (!cancelled) console.error('[Breadcrumbs] Failed to load path:', err)
      })
    return () => { cancelled = true }
  }, [mapId])

  const handleCrumbClick = useCallback(
    (crumb: BreadcrumbItem, isLast: boolean) => {
      if (isLast) return // current map -- no-op
      onNavigateToMap(crumb.map_id)
    },
    [onNavigateToMap]
  )

  return (
    <div
      style={{
        height: 32,
        backgroundColor: '#fafafa',
        borderBottom: '1px solid #e8e8e8',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 4,
        flexShrink: 0,
        zIndex: 1500,
        userSelect: 'none',
        overflowX: 'auto',
        overflowY: 'hidden',
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
  )
}
