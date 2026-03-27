# DSRP Design Log

A record of design discussions where DSRP theory directly shaped architectural decisions in Ambit. These entries document how the app's design is grounded in the DSRP framework — useful for future reference, onboarding, and communicating the tool's theoretical foundation.

---

## Entry 1: Per-Perspective Notes — No "View from Nowhere"

**Date:** 2026-03-27
**Participants:** User, Derek, Larry, Silas
**Decision:** Notes are stored per-perspective (per card-view), not per-card. There is no universal "identity note."

**Context:** The Note Panel needed a data model for notes. The initial proposal (Derek) was to have both a universal identity note on the card itself and per-perspective notes on each view. The user challenged this.

**The user's argument:**
> "I would say that it is impossible *not* to take a perspective when examining anything. In our architecture, that is correctly represented by a card being deleted when not on any canvas. An Identity Note is actually just confusing from a DSRP perspective."

**DSRP principle at work:** Perspective (P) is not optional — it is not a layer added on top of "objective" knowledge. Every distinction, every system, every relationship is made from a perspective. There is no view from nowhere. A universal identity note would implicitly claim to describe something from outside all perspectives — which is exactly what DSRP says is impossible.

**Derek's concession:**
> "When I recommended an 'identity note,' I was implicitly assuming there is a base layer of meaning that exists prior to any perspective. That is exactly what DSRP denies. An identity note is not perspective-free. It is a perspective that presents itself as universal — arguably worse because it smuggles in a hidden point of view while claiming objectivity."

**Architectural outcome:**
- **Universal (perspective-independent):** Card ID + title only. The title is the Distinction boundary — *what* the thing is.
- **Per-perspective:** Notes, position, parent, relationships. These describe *how* the thing is understood from a given point.
- A card with no views (no perspectives) is deleted — existence in the knowledge system is always perspectival.
- The Note Panel shows one note per model the card appears in, with the current model's note visually prominent.

**Schema:** `note TEXT` column on the `layout` table (already keyed on node_id + map_id).

---

## Entry 2: Models as Cards — One Paradigm, Not Two

**Date:** 2026-03-27
**Participants:** User, Derek, Larry
**Decision:** Models (canvases) are a card type on the canvas, not a sidebar list. The Home canvas is a meta-map.

**Context:** The app had a left sidebar for switching between models. The user proposed making models into cards instead, organized on the canvas like any other card.

**The user's argument:**
> "Why introduce another paradigm when we have worked so hard on exactly these things in the canvas context? Let's reuse that work and let the user organize their models through the canvas as well!"

**DSRP principle at work:** A Model is simultaneously a System (it has parts and a boundary) and a Perspective (it represents a viewpoint on some domain). The sidebar was a flat file-browser — it didn't encode part-whole structure, didn't support relationships between models, and didn't treat models as first-class elements of the knowledge system. It was a non-DSRP metaphor grafted onto a DSRP tool.

**Derek's analysis:**
- Nesting models inside models is not just allowed — **DSRP requires it.** Every whole can be a part. A depth limit of one is artificially flat.
- Zooming into a Model card is **scalar perspective-taking** — moving down the abstraction hierarchy into greater detail.
- The Home canvas becomes a **meta-map** — a systems map of your systems maps.

**Architectural outcome:**
- `node_type = 'model'` for Model cards
- `maps.node_id` links a map to its backing card; Home map has `node_id IS NULL`
- Breadcrumbs show navigation path (Home > Project Alpha > Research Phase)
- Same canvas interactions (drag, nest, push-mode, relationships) work for organizing models

---

## Entry 3: Card Views — Perspective as a First-Class Experience

**Date:** 2026-03-27
**Participants:** User, Derek, Larry, Silas
**Decision:** A card can appear in multiple models as "Card Views." Named after the DSRP concept: Perspective = Point + View.

**Context:** With models as cards, the question arose: what if the same concept needs to appear in multiple models? The user proposed "Card Views" — inspired by Workflowy's "mirroring" but renamed for DSRP alignment.

**The user's DSRP reasoning:**
> "Each model can then be seen to represent a different perspective on the same thing. The perfect name in DSRP context would be 'Card Views' instead of 'Card Mirrors', since a perspective in DSRP consists of a point and a view."

**DSRP principle at work:** A Perspective consists of a **point** (the position from which something is observed) and a **view** (what is seen from that position). The model is the point. The card's appearance in that model — with its own position, parent, relationships, and notes — is the view. Same card, different views, different points.

**Derek's analysis:**
> "Card Views makes Perspective a lived experience in the tool rather than an abstract concept. When a user puts the same card into two models and sees it in different relational contexts, they are directly experiencing what DSRP means when it says that a perspective determines what you see."

**Architectural outcome:**
- `layout` table already supports this: `UNIQUE(node_id, map_id)` — one row per (card, model)
- Same card, multiple layout rows = multiple views
- Content (title) is universal; context (notes, position, parent, relationships) is per-view
- Removing the last view deletes the card — existence is perspectival (see Entry 1)
