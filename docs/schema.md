# PKM Database Schema

**File:** `data/pkm.db`
**Engine:** SQLite 3 — WAL mode, FTS5, JSON1, foreign keys enforced
**Author:** Silas, PKM Database Architect
**Created:** 2026-03-23

---

## Overview

This database is the storage layer for a personal knowledge management (PKM) system — a "second brain" for notes, ideas, bookmarks, clippings, and references. The design is deliberately practical: enough structure to be powerful from day one, with clear extension points for growth.

### Design Principles

- **Atomic notes first.** The `notes` table is the center of gravity. Everything else orbits it.
- **Explicit relationships.** Links between notes are first-class records (typed, annotatable), not just wikilink syntax buried in body text.
- **Hierarchical but optional.** Tags and collections both support parent-child nesting, but neither requires it.
- **Full-text search built in.** FTS5 with Porter stemming indexes every note automatically via triggers — no application-side indexing needed.
- **JSON escape hatches.** Every core table has a `metadata TEXT` column (JSON) for extensibility without schema migrations.
- **Timestamps everywhere.** Every table has `created_at` and `updated_at` in ISO 8601 UTC, maintained by triggers.

---

## Entity-Relationship Summary

```
collections (tree)
    |
    | 1:N
    v
  notes  <---M:N---> tags (tree)
    |  \
    |   \---M:N---> sources
    |
    | M:N (self)
  links (note -> note, typed)
```

---

## Tables

### `notes`

The atomic unit of the second brain. One note = one idea (or one bookmark, clipping, journal entry, etc.).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `collection_id` | INTEGER FK | Optional — which collection this belongs to |
| `source_id` | INTEGER FK | Optional — primary source (shortcut; use `note_sources` for multiple) |
| `title` | TEXT | Required |
| `slug` | TEXT UNIQUE | Human-readable URL key (optional, nullable) |
| `body` | TEXT | Markdown body |
| `summary` | TEXT | Short abstract, hand-written or auto-generated |
| `kind` | TEXT | `note`, `idea`, `reference`, `bookmark`, `clipping`, `journal`, `moc` |
| `status` | TEXT | `draft`, `in_progress`, `evergreen`, `archived` |
| `source_url` | TEXT | Direct URL for bookmarks/clippings |
| `clipped_text` | TEXT | Raw quote for `kind = 'clipping'` |
| `clipped_at` | TEXT | ISO 8601 — when the clip was taken |
| `is_pinned` | INTEGER | Boolean 0/1 |
| `metadata` | TEXT | JSON blob for arbitrary extra fields |

**Note kinds:**
- `note` — processed, atomic, evergreen-candidate idea
- `idea` — fleeting/unprocessed thought, needs review
- `reference` — pointer to external knowledge (book chapter, paper, etc.)
- `bookmark` — saved URL with optional annotation
- `clipping` — extracted quote or excerpt from a source
- `journal` — daily or periodic log entry
- `moc` — Map of Content: an index note that links to other notes

**Note statuses** (Zettelkasten maturity ladder):
- `draft` → `in_progress` → `evergreen` → `archived`

---

### `tags`

Hierarchical tags. A tag can have a parent, enabling taxonomy trees.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `parent_id` | INTEGER FK | Self-reference for nesting; NULL = top-level |
| `name` | TEXT | Display name |
| `slug` | TEXT UNIQUE | Lowercase, hyphenated, URL-safe |
| `description` | TEXT | What this tag means |
| `color` | TEXT | Hex color for UI |

**Example hierarchy:**
```
programming (slug: programming)
  ├── python (slug: python)
  │     └── async (slug: python-async)
  └── databases (slug: databases)
```

To fetch a full ancestry path, use a recursive CTE:
```sql
WITH RECURSIVE ancestry(id, name, depth) AS (
    SELECT id, name, 0 FROM tags WHERE id = :tag_id
    UNION ALL
    SELECT t.id, t.name, a.depth + 1
    FROM tags t JOIN ancestry a ON t.id = (SELECT parent_id FROM tags WHERE id = a.id)
)
SELECT * FROM ancestry ORDER BY depth DESC;
```

---

### `collections`

Organizational containers following a PARA-inspired structure. Self-referential for sub-collections.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `parent_id` | INTEGER FK | Self-reference for nesting |
| `kind` | TEXT | `project`, `area`, `resource`, `archive`, `inbox` |
| `name` | TEXT | Display name |
| `description` | TEXT | |
| `color` | TEXT | Hex color |
| `icon` | TEXT | Emoji or icon name |
| `is_archived` | INTEGER | Boolean 0/1 |
| `sort_order` | INTEGER | Manual ordering |

**Seeded defaults:**

| ID | Kind | Name |
|---|---|---|
| 1 | inbox | Inbox |
| 2 | area | Personal |
| 3 | area | Work |
| 4 | resource | Library |
| 5 | archive | Archive |

---

### `sources`

Where knowledge comes from. Books, articles, URLs, podcasts, papers, conversations.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `kind` | TEXT | `book`, `article`, `website`, `video`, `podcast`, `paper`, `tweet`, `conversation`, `other` |
| `title` | TEXT | Required |
| `author` | TEXT | |
| `url` | TEXT | |
| `isbn` | TEXT | For books |
| `published_at` | TEXT | ISO 8601 date of original publication |
| `accessed_at` | TEXT | ISO 8601 when retrieved/read |
| `notes` | TEXT | Free-form annotation |
| `metadata` | TEXT | JSON for kind-specific extras (e.g., episode number, DOI) |

---

### `links`

Directed, typed edges between notes. The graph layer.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `from_id` | INTEGER FK | Source note |
| `to_id` | INTEGER FK | Target note |
| `kind` | TEXT | `related`, `supports`, `contradicts`, `extends`, `summarizes`, `inspired_by` |
| `annotation` | TEXT | Optional note about the relationship |

**Bidirectional queries** — to find all notes connected to note X:
```sql
SELECT id, title FROM notes
WHERE id IN (
    SELECT to_id   FROM links WHERE from_id = :x
    UNION
    SELECT from_id FROM links WHERE to_id   = :x
);
```

**Unique constraint:** `(from_id, to_id, kind)` — the same pair can have multiple link types but not duplicate types.

---

### `note_tags` (junction)

Many-to-many relationship between notes and tags.

| Column | Type |
|---|---|
| `note_id` | INTEGER FK (PK part) |
| `tag_id` | INTEGER FK (PK part) |
| `created_at` | TEXT |

---

### `note_sources` (junction)

Many-to-many relationship between notes and sources. Use this when a note draws from multiple sources. The `source_id` on `notes` is a convenience shortcut for the primary/single source.

| Column | Type | Notes |
|---|---|---|
| `note_id` | INTEGER FK (PK part) | |
| `source_id` | INTEGER FK (PK part) | |
| `page_ref` | TEXT | Page number, timestamp, chapter |
| `quote` | TEXT | Specific quote from that source |

---

## Full-Text Search (FTS5)

The `notes_fts` virtual table indexes `title`, `body`, and `summary` from the `notes` table using the Porter stemmer with Unicode normalization and diacritic removal.

Three triggers (`notes_fts_insert`, `notes_fts_update`, `notes_fts_delete`) keep it in sync automatically.

**Basic search:**
```sql
SELECT n.id, n.title, n.kind, n.status
FROM notes_fts f
JOIN notes n ON n.id = f.rowid
WHERE notes_fts MATCH 'zettelkasten atomic'
ORDER BY rank;
```

**Phrase search:**
```sql
WHERE notes_fts MATCH '"second brain"'
```

**Column-scoped search:**
```sql
WHERE notes_fts MATCH 'title: productivity'
```

**Ranked results with snippet:**
```sql
SELECT n.id, n.title,
       snippet(notes_fts, 1, '<b>', '</b>', '...', 20) AS excerpt
FROM notes_fts f
JOIN notes n ON n.id = f.rowid
WHERE notes_fts MATCH 'knowledge management'
ORDER BY rank;
```

---

## Indexes

| Index | Table | Column(s) | Purpose |
|---|---|---|---|
| `idx_notes_collection` | notes | collection_id | Filter by collection |
| `idx_notes_source` | notes | source_id | Filter by source |
| `idx_notes_kind` | notes | kind | Filter by note type |
| `idx_notes_status` | notes | status | Filter by maturity |
| `idx_notes_pinned` | notes | is_pinned (partial) | Fast pinned-only queries |
| `idx_notes_created` | notes | created_at | Chronological ordering |
| `idx_tags_slug` | tags | slug | Tag lookup by slug |
| `idx_tags_parent` | tags | parent_id | Tag tree traversal |
| `idx_collections_parent` | collections | parent_id | Collection tree traversal |
| `idx_links_from` | links | from_id | Outgoing link lookup |
| `idx_links_to` | links | to_id | Incoming link lookup |
| `idx_note_tags_tag` | note_tags | tag_id | Notes-by-tag lookup |
| `idx_note_sources_source` | note_sources | source_id | Notes-by-source lookup |

---

## Common Query Patterns

### All notes in a collection, newest first
```sql
SELECT id, title, kind, status, created_at
FROM notes
WHERE collection_id = 4
ORDER BY created_at DESC;
```

### Notes tagged with a specific tag (by slug)
```sql
SELECT n.id, n.title
FROM notes n
JOIN note_tags nt ON nt.note_id = n.id
JOIN tags t       ON t.id = nt.tag_id
WHERE t.slug = 'insight';
```

### All tags on a note (with ancestry depth)
```sql
WITH RECURSIVE tag_tree(id, name, parent_id, depth) AS (
    SELECT t.id, t.name, t.parent_id, 0
    FROM tags t
    JOIN note_tags nt ON nt.tag_id = t.id
    WHERE nt.note_id = :note_id
    UNION ALL
    SELECT t.id, t.name, t.parent_id, tt.depth + 1
    FROM tags t
    JOIN tag_tree tt ON t.id = tt.parent_id
)
SELECT DISTINCT id, name, depth FROM tag_tree ORDER BY depth DESC;
```

### Orphan notes (no links in or out)
```sql
SELECT id, title FROM notes
WHERE id NOT IN (SELECT from_id FROM links)
  AND id NOT IN (SELECT to_id   FROM links)
  AND status != 'archived';
```

### Notes referencing a source
```sql
SELECT DISTINCT n.id, n.title
FROM notes n
LEFT JOIN note_sources ns ON ns.note_id = n.id
WHERE n.source_id = :source_id OR ns.source_id = :source_id;
```

---

## PRAGMA Settings

Applied at database initialization:

| PRAGMA | Value | Reason |
|---|---|---|
| `journal_mode` | WAL | Concurrent reads during writes; safer crash recovery |
| `foreign_keys` | ON | Enforce referential integrity |
| `auto_vacuum` | INCREMENTAL | Reclaim space incrementally rather than in full sweeps |

The application must re-apply `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL` on each new connection (SQLite does not persist these across connections).

---

## Extension Points

The schema is designed to grow without disruptive migrations:

- **`metadata` JSON columns** on `notes`, `sources`, and `collections` absorb new fields before they warrant a real column.
- **`links.kind`** CHECK constraint can be expanded via `ALTER TABLE` to add new relationship types.
- **`notes.kind`** and **`notes.status`** are similarly extensible.
- **`collections.parent_id`** already supports unlimited nesting depth.
- A future `embeddings` table (`note_id`, `model`, `vector BLOB`) can be added for semantic search without touching existing tables.
- A `note_versions` table for audit history can be added referencing `notes.id` when needed.
