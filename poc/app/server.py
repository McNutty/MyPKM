"""
PKM Web Interface — Flask backend
Serves the single-page app and provides a REST API over the SQLite database.
"""

import os
import sys
import sqlite3
import json
from pathlib import Path
from flask import Flask, request, jsonify, render_template, g

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "pkm.db"

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(str(DB_PATH))
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode = WAL")
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def row_to_dict(row):
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows):
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Collections API
# ---------------------------------------------------------------------------
@app.route("/api/collections")
def list_collections():
    db = get_db()
    rows = db.execute(
        "SELECT c.*, (SELECT COUNT(*) FROM notes n WHERE n.collection_id = c.id) AS note_count "
        "FROM collections c ORDER BY sort_order, name"
    ).fetchall()
    return jsonify(rows_to_list(rows))


# ---------------------------------------------------------------------------
# Tags API
# ---------------------------------------------------------------------------
@app.route("/api/tags")
def list_tags():
    db = get_db()
    rows = db.execute(
        "SELECT t.*, (SELECT COUNT(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS note_count "
        "FROM tags t ORDER BY name"
    ).fetchall()
    return jsonify(rows_to_list(rows))


@app.route("/api/tags", methods=["POST"])
def create_tag():
    db = get_db()
    data = request.json
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    slug = data.get("slug") or name.lower().replace(" ", "-")
    parent_id = data.get("parent_id")
    color = data.get("color")
    description = data.get("description")
    try:
        cur = db.execute(
            "INSERT INTO tags (parent_id, name, slug, description, color) VALUES (?, ?, ?, ?, ?)",
            (parent_id, name, slug, description, color),
        )
        db.commit()
        tag = row_to_dict(db.execute("SELECT * FROM tags WHERE id = ?", (cur.lastrowid,)).fetchone())
        return jsonify(tag), 201
    except sqlite3.IntegrityError as e:
        return jsonify({"error": str(e)}), 409


# ---------------------------------------------------------------------------
# Notes API
# ---------------------------------------------------------------------------
@app.route("/api/notes")
def list_notes():
    db = get_db()
    collection_id = request.args.get("collection_id")
    tag_id = request.args.get("tag_id")
    kind = request.args.get("kind")
    status = request.args.get("status")
    q = request.args.get("q")

    if q:
        # FTS search
        rows = db.execute(
            "SELECT n.id, n.title, n.kind, n.status, n.collection_id, n.is_pinned, "
            "n.created_at, n.updated_at, n.summary, "
            "snippet(notes_fts, 1, '<mark>', '</mark>', '...', 40) AS excerpt "
            "FROM notes_fts f JOIN notes n ON n.id = f.rowid "
            "WHERE notes_fts MATCH ? ORDER BY rank",
            (q,),
        ).fetchall()
        return jsonify(rows_to_list(rows))

    params = []
    clauses = []
    if collection_id:
        clauses.append("n.collection_id = ?")
        params.append(int(collection_id))
    if tag_id:
        clauses.append("n.id IN (SELECT note_id FROM note_tags WHERE tag_id = ?)")
        params.append(int(tag_id))
    if kind:
        clauses.append("n.kind = ?")
        params.append(kind)
    if status:
        clauses.append("n.status = ?")
        params.append(status)

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = (
        f"SELECT n.id, n.title, n.kind, n.status, n.collection_id, n.is_pinned, "
        f"n.created_at, n.updated_at, n.summary "
        f"FROM notes n {where} ORDER BY n.is_pinned DESC, n.updated_at DESC"
    )
    rows = db.execute(sql, params).fetchall()
    return jsonify(rows_to_list(rows))


@app.route("/api/notes/<int:note_id>")
def get_note(note_id):
    db = get_db()
    note = row_to_dict(db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone())
    if not note:
        return jsonify({"error": "not found"}), 404

    # Tags
    note["tags"] = rows_to_list(
        db.execute(
            "SELECT t.* FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name",
            (note_id,),
        ).fetchall()
    )

    # Outgoing links
    note["links_out"] = rows_to_list(
        db.execute(
            "SELECT l.id AS link_id, l.kind AS link_kind, l.annotation, "
            "n.id, n.title, n.kind, n.status "
            "FROM links l JOIN notes n ON n.id = l.to_id WHERE l.from_id = ?",
            (note_id,),
        ).fetchall()
    )

    # Backlinks (incoming)
    note["backlinks"] = rows_to_list(
        db.execute(
            "SELECT l.id AS link_id, l.kind AS link_kind, l.annotation, "
            "n.id, n.title, n.kind, n.status "
            "FROM links l JOIN notes n ON n.id = l.from_id WHERE l.to_id = ?",
            (note_id,),
        ).fetchall()
    )

    # Sources
    note["sources"] = rows_to_list(
        db.execute(
            "SELECT s.* FROM sources s JOIN note_sources ns ON ns.source_id = s.id WHERE ns.note_id = ?",
            (note_id,),
        ).fetchall()
    )
    # Also check primary source
    if note.get("source_id"):
        primary = row_to_dict(db.execute("SELECT * FROM sources WHERE id = ?", (note["source_id"],)).fetchone())
        if primary:
            note["primary_source"] = primary

    return jsonify(note)


@app.route("/api/notes", methods=["POST"])
def create_note():
    db = get_db()
    data = request.json
    title = data.get("title", "").strip()
    if not title:
        return jsonify({"error": "title is required"}), 400

    cur = db.execute(
        "INSERT INTO notes (collection_id, title, body, summary, kind, status, source_url, is_pinned) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            data.get("collection_id"),
            title,
            data.get("body", ""),
            data.get("summary", ""),
            data.get("kind", "note"),
            data.get("status", "draft"),
            data.get("source_url"),
            1 if data.get("is_pinned") else 0,
        ),
    )
    note_id = cur.lastrowid

    # Tags
    tag_ids = data.get("tag_ids", [])
    for tid in tag_ids:
        db.execute("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)", (note_id, tid))

    db.commit()
    return get_note(note_id)


@app.route("/api/notes/<int:note_id>", methods=["PUT"])
def update_note(note_id):
    db = get_db()
    existing = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not existing:
        return jsonify({"error": "not found"}), 404

    data = request.json
    col_id = data.get("collection_id", existing["collection_id"])
    if col_id is not None:
        col_id = int(col_id)
    db.execute(
        "UPDATE notes SET collection_id=?, title=?, body=?, summary=?, kind=?, status=?, "
        "source_url=?, is_pinned=? WHERE id=?",
        (
            col_id,
            data.get("title", existing["title"]),
            data.get("body", existing["body"]),
            data.get("summary", existing["summary"]),
            data.get("kind", existing["kind"]),
            data.get("status", existing["status"]),
            data.get("source_url", existing["source_url"]),
            1 if data.get("is_pinned", existing["is_pinned"]) else 0,
            note_id,
        ),
    )

    # Update tags if provided
    if "tag_ids" in data:
        db.execute("DELETE FROM note_tags WHERE note_id = ?", (note_id,))
        for tid in data["tag_ids"]:
            db.execute("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)", (note_id, tid))

    db.commit()
    return get_note(note_id)


@app.route("/api/notes/<int:note_id>", methods=["DELETE"])
def delete_note(note_id):
    db = get_db()
    db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Links API
# ---------------------------------------------------------------------------
@app.route("/api/links", methods=["POST"])
def create_link():
    db = get_db()
    data = request.json
    from_id = data.get("from_id")
    to_id = data.get("to_id")
    kind = data.get("kind", "related")
    annotation = data.get("annotation")

    if not from_id or not to_id:
        return jsonify({"error": "from_id and to_id required"}), 400
    if from_id == to_id:
        return jsonify({"error": "cannot link note to itself"}), 400

    try:
        cur = db.execute(
            "INSERT INTO links (from_id, to_id, kind, annotation) VALUES (?, ?, ?, ?)",
            (from_id, to_id, kind, annotation),
        )
        db.commit()
        return jsonify({"id": cur.lastrowid}), 201
    except sqlite3.IntegrityError as e:
        return jsonify({"error": str(e)}), 409


@app.route("/api/links/<int:link_id>", methods=["DELETE"])
def delete_link(link_id):
    db = get_db()
    db.execute("DELETE FROM links WHERE id = ?", (link_id,))
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Search suggestions (for link target autocomplete)
# ---------------------------------------------------------------------------
@app.route("/api/notes/search")
def search_notes():
    db = get_db()
    q = request.args.get("q", "").strip()
    exclude_id = request.args.get("exclude_id")
    if not q:
        return jsonify([])

    # Try FTS first, fall back to LIKE
    try:
        rows = db.execute(
            "SELECT n.id, n.title, n.kind FROM notes_fts f JOIN notes n ON n.id = f.rowid "
            "WHERE notes_fts MATCH ? ORDER BY rank LIMIT 20",
            (q + "*",),
        ).fetchall()
    except Exception:
        rows = db.execute(
            "SELECT id, title, kind FROM notes WHERE title LIKE ? LIMIT 20",
            (f"%{q}%",),
        ).fetchall()

    results = rows_to_list(rows)
    if exclude_id:
        results = [r for r in results if r["id"] != int(exclude_id)]
    return jsonify(results)


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
@app.route("/api/stats")
def stats():
    db = get_db()
    note_count = db.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
    tag_count = db.execute("SELECT COUNT(*) FROM tags").fetchone()[0]
    link_count = db.execute("SELECT COUNT(*) FROM links").fetchone()[0]
    source_count = db.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
    return jsonify({
        "notes": note_count,
        "tags": tag_count,
        "links": link_count,
        "sources": source_count,
    })


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    if not DB_PATH.exists():
        print(f"ERROR: Database not found at {DB_PATH}")
        print("Run the init_schema.sql first to create the database.")
        sys.exit(1)
    print(f"PKM Database: {DB_PATH}")
    print(f"Starting server at http://localhost:5000")
    app.run(debug=True, port=5000)
