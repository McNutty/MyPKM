-- =============================================================================
-- PKM Database Schema
-- Engine: SQLite 3 (FTS5, JSON1, WAL mode)
-- Author: Silas, PKM Database Architect
-- Created: 2026-03-23
-- =============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA auto_vacuum = INCREMENTAL;

-- =============================================================================
-- SOURCES
-- Where knowledge comes from: books, articles, URLs, podcasts, etc.
-- A note can optionally reference one or more sources.
-- =============================================================================
CREATE TABLE IF NOT EXISTS sources (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN (
                    'book', 'article', 'website', 'video', 'podcast',
                    'paper', 'tweet', 'conversation', 'other'
                )),
    title       TEXT NOT NULL,
    author      TEXT,
    url         TEXT,
    isbn        TEXT,
    published_at TEXT,              -- ISO 8601, date of original publication
    accessed_at  TEXT,              -- ISO 8601, when we retrieved/read it
    notes       TEXT,               -- free-form annotation about this source
    metadata    TEXT DEFAULT '{}',  -- JSON blob for kind-specific extras
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sources_kind      ON sources (kind);
CREATE INDEX IF NOT EXISTS idx_sources_title     ON sources (title);

-- =============================================================================
-- COLLECTIONS
-- Top-level organizational containers: projects, areas, resources, archives.
-- Follows PARA naming but is not restricted to it.
-- Self-referential for nesting (e.g., sub-projects).
-- =============================================================================
CREATE TABLE IF NOT EXISTS collections (
    id          INTEGER PRIMARY KEY,
    parent_id   INTEGER REFERENCES collections (id) ON DELETE SET NULL,
    kind        TEXT NOT NULL DEFAULT 'area' CHECK (kind IN (
                    'project', 'area', 'resource', 'archive', 'inbox'
                )),
    name        TEXT NOT NULL,
    description TEXT,
    color       TEXT,               -- hex color for UI, e.g. '#4A90D9'
    icon        TEXT,               -- emoji or icon name
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections (parent_id);
CREATE INDEX IF NOT EXISTS idx_collections_kind   ON collections (kind);

-- =============================================================================
-- TAGS
-- Hierarchical tagging system.
-- A tag can have a parent, enabling trees like: programming > python > async
-- =============================================================================
CREATE TABLE IF NOT EXISTS tags (
    id          INTEGER PRIMARY KEY,
    parent_id   INTEGER REFERENCES tags (id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,   -- lowercase, hyphenated, URL-safe
    description TEXT,
    color       TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags (parent_id);
CREATE INDEX IF NOT EXISTS idx_tags_slug   ON tags (slug);

-- =============================================================================
-- NOTES
-- The atomic unit of the second brain.
-- Each note is a discrete idea, clipping, bookmark, or reference.
-- =============================================================================
CREATE TABLE IF NOT EXISTS notes (
    id              INTEGER PRIMARY KEY,
    collection_id   INTEGER REFERENCES collections (id) ON DELETE SET NULL,
    source_id       INTEGER REFERENCES sources (id) ON DELETE SET NULL,

    -- Identity
    title           TEXT NOT NULL,
    slug            TEXT UNIQUE,            -- human-readable URL key

    -- Content
    body            TEXT,                   -- Markdown body
    summary         TEXT,                   -- short auto or hand-written abstract
    kind            TEXT NOT NULL DEFAULT 'note' CHECK (kind IN (
                        'note',             -- atomic/evergreen note
                        'idea',             -- fleeting / unprocessed thought
                        'reference',        -- pointer to external knowledge
                        'bookmark',         -- saved URL
                        'clipping',         -- extracted quote or excerpt
                        'journal',          -- daily/periodic log entry
                        'moc'               -- Map of Content (index note)
                    )),

    -- Status
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                        'draft',            -- rough / unfinished
                        'in_progress',      -- actively being developed
                        'evergreen',        -- mature, stable note
                        'archived'          -- no longer active
                    )),

    -- Provenance & clipping metadata
    source_url      TEXT,                   -- direct URL (for bookmarks/clippings)
    clipped_text    TEXT,                   -- raw quote if kind = 'clipping'
    clipped_at      TEXT,                   -- ISO 8601

    -- Extras
    is_pinned       INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
    metadata        TEXT NOT NULL DEFAULT '{}',  -- JSON blob for future fields

    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_collection  ON notes (collection_id);
CREATE INDEX IF NOT EXISTS idx_notes_source      ON notes (source_id);
CREATE INDEX IF NOT EXISTS idx_notes_kind        ON notes (kind);
CREATE INDEX IF NOT EXISTS idx_notes_status      ON notes (status);
CREATE INDEX IF NOT EXISTS idx_notes_pinned      ON notes (is_pinned) WHERE is_pinned = 1;
CREATE INDEX IF NOT EXISTS idx_notes_created     ON notes (created_at);

-- =============================================================================
-- NOTE_TAGS  (junction: many notes <-> many tags)
-- =============================================================================
CREATE TABLE IF NOT EXISTS note_tags (
    note_id     INTEGER NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags  (id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags (tag_id);

-- =============================================================================
-- LINKS
-- Directed edges between notes.
-- Bidirectionality is achieved by querying both directions (from_id & to_id).
-- =============================================================================
CREATE TABLE IF NOT EXISTS links (
    id          INTEGER PRIMARY KEY,
    from_id     INTEGER NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    to_id       INTEGER NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'related' CHECK (kind IN (
                    'related',      -- loose association
                    'supports',     -- from_id supports/argues for to_id
                    'contradicts',  -- from_id contradicts to_id
                    'extends',      -- from_id builds on to_id
                    'summarizes',   -- from_id is a summary of to_id
                    'inspired_by'   -- creative lineage
                )),
    annotation  TEXT,               -- optional note about the relationship
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (from_id, to_id, kind)   -- prevent duplicate typed edges
);

CREATE INDEX IF NOT EXISTS idx_links_from ON links (from_id);
CREATE INDEX IF NOT EXISTS idx_links_to   ON links (to_id);

-- =============================================================================
-- NOTE_SOURCES  (junction: many notes <-> many sources)
-- A note can draw from multiple sources beyond its primary source_id.
-- =============================================================================
CREATE TABLE IF NOT EXISTS note_sources (
    note_id     INTEGER NOT NULL REFERENCES notes   (id) ON DELETE CASCADE,
    source_id   INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    page_ref    TEXT,               -- page number, timestamp, chapter, etc.
    quote       TEXT,               -- specific quote from that source
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (note_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_note_sources_source ON note_sources (source_id);

-- =============================================================================
-- FTS5 VIRTUAL TABLE
-- Full-text search across note title, body, and summary.
-- Uses content= to avoid data duplication (content table = notes).
-- =============================================================================
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title,
    body,
    summary,
    content     = 'notes',
    content_rowid = 'id',
    tokenize    = 'porter unicode61 remove_diacritics 1'
);

-- Triggers to keep FTS index in sync with the notes table
CREATE TRIGGER IF NOT EXISTS notes_fts_insert
    AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts (rowid, title, body, summary)
        VALUES (new.id, new.title, new.body, new.summary);
    END;

CREATE TRIGGER IF NOT EXISTS notes_fts_delete
    AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts (notes_fts, rowid, title, body, summary)
        VALUES ('delete', old.id, old.title, old.body, old.summary);
    END;

CREATE TRIGGER IF NOT EXISTS notes_fts_update
    AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts (notes_fts, rowid, title, body, summary)
        VALUES ('delete', old.id, old.title, old.body, old.summary);
        INSERT INTO notes_fts (rowid, title, body, summary)
        VALUES (new.id, new.title, new.body, new.summary);
    END;

-- =============================================================================
-- updated_at TRIGGERS
-- Keep updated_at current on every row mutation.
-- =============================================================================
CREATE TRIGGER IF NOT EXISTS sources_updated_at
    AFTER UPDATE ON sources BEGIN
        UPDATE sources SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = old.id;
    END;

CREATE TRIGGER IF NOT EXISTS collections_updated_at
    AFTER UPDATE ON collections BEGIN
        UPDATE collections SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = old.id;
    END;

CREATE TRIGGER IF NOT EXISTS tags_updated_at
    AFTER UPDATE ON tags BEGIN
        UPDATE tags SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = old.id;
    END;

CREATE TRIGGER IF NOT EXISTS notes_updated_at
    AFTER UPDATE ON notes BEGIN
        UPDATE notes SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = old.id;
    END;

CREATE TRIGGER IF NOT EXISTS links_updated_at
    AFTER UPDATE ON links BEGIN
        UPDATE links SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = old.id;
    END;

-- =============================================================================
-- SEED DATA  -- minimal defaults to make the system immediately usable
-- =============================================================================

-- Default collections (PARA skeleton)
INSERT OR IGNORE INTO collections (id, kind, name, description, sort_order) VALUES
    (1, 'inbox',    'Inbox',    'Unprocessed captures and fleeting notes', 0),
    (2, 'area',     'Personal', 'Personal knowledge and life areas',       1),
    (3, 'area',     'Work',     'Professional projects and knowledge',     2),
    (4, 'resource', 'Library',  'Reference material and evergreen notes',  3),
    (5, 'archive',  'Archive',  'Completed or inactive items',             4);

-- Default top-level tags
INSERT OR IGNORE INTO tags (id, parent_id, name, slug, description) VALUES
    (1, NULL, 'Concept',    'concept',    'Abstract ideas and mental models'),
    (2, NULL, 'Person',     'person',     'Notes about specific people'),
    (3, NULL, 'Place',      'place',      'Geographic or conceptual places'),
    (4, NULL, 'Tool',       'tool',       'Software, hardware, and methods'),
    (5, NULL, 'Question',   'question',   'Open questions to explore'),
    (6, NULL, 'Insight',    'insight',    'Aha moments and realizations'),
    (7, NULL, 'Template',   'template',   'Reusable note structures');
