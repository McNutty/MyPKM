# Canvas Framework Evaluation: M0 Spike Results

**Author:** Wren (Canvas/Whiteboard App Developer)
**Date:** 2026-03-23
**Status:** RECOMMENDATION FOR TEAM REVIEW

---

## 1. What Was Tested

Two approaches were prototyped to evaluate fitness for Plectica 2.0's core mechanic: recursively nested boxes with auto-resize. Both prototypes implement the same scenario (the "Bicycle" system from Maren's user story) with 5 nesting levels and ~50 elements.

### Approach 1: tldraw

- **What it is:** MIT-licensed infinite canvas SDK for React (v2.4+). Full whiteboard framework with shapes, selection, drag, zoom, undo/redo built in.
- **Prototype location:** `src/prototype/tldraw-nested/`
- **Strategy:** Use tldraw's built-in `frame` shape type as containers. Frames support parenting -- shapes inside a frame move with it. Added custom auto-resize logic via store change listeners.

### Approach 2: Custom React + CSS Transforms

- **What it is:** Zero-dependency approach. React components positioned absolutely inside a CSS-transformed container. Pan via translate, zoom via scale. Cards are nested divs.
- **Prototype location:** `src/prototype/custom-react-canvas/`
- **Strategy:** Each card is a `<div>` positioned inside its parent div. The DOM's natural nesting handles coordinate transforms automatically. Auto-resize, drag-to-nest, and drag-to-unnest are implemented from scratch.

### Why Not React Flow?

React Flow was the original alternative candidate (per Maren's roadmap). I chose custom React instead because React Flow is architecturally wrong for this use case:

- React Flow is designed for **node-graph UIs** (DAGs with edges) -- think data pipelines, flowcharts, state machines. Its layout model assumes flat nodes connected by edges.
- It has **no concept of containment.** Nodes do not contain other nodes. There is a "sub-flow" feature, but it is a separate viewport, not a nested spatial container.
- The "truthful boundary" requirement (a parent's visual boundary must contain all children) would require completely replacing React Flow's layout engine. At that point, you are not using React Flow -- you are fighting it.
- React Flow's strengths (edge routing, connection handles, dagre layout) are irrelevant at MVP and will become relevant in Phase 2 (Relationships), at which point we can evaluate adding edge rendering on top of whatever canvas we build.

---

## 2. Results Per Evaluation Criterion

### 2.1 Can It Render 5 Levels of Nested Boxes?

| Approach | Result | Notes |
|---|---|---|
| **tldraw** | YES, with caveats | Frames can be nested inside frames. However, tldraw's rendering treats deeply nested frames as increasingly opaque -- the frame chrome (header, border) accumulates and becomes visually heavy at depth 4-5. The frame label rendering does not scale down gracefully. At depth 5, the innermost elements are hard to distinguish. |
| **Custom React** | YES, cleanly | Nested divs render at arbitrary depth. The depth-based coloring and scaled font sizes make nesting levels visually distinct even at depth 5. Because we control every pixel, we can tune the visual hierarchy precisely. |

**Verdict:** Both work. Custom React gives us full visual control. tldraw's frame rendering is designed for 1-2 levels of grouping, not 5 levels of semantic containment.

### 2.2 Does Auto-Resize Propagation Work?

| Approach | Result | Notes |
|---|---|---|
| **tldraw** | YES, but it fights the framework | tldraw frames do NOT auto-resize natively. Frames are fixed-size containers that clip children. To implement auto-resize, we must: (1) listen for all shape changes via `store.listen()`, (2) compute child bounding boxes, (3) call `editor.updateShape()` to resize the parent, (4) recurse upward. This triggers more change events, requiring `requestAnimationFrame` batching to avoid infinite loops. The resulting behavior works but feels fragile -- we are patching over the framework's design intent. |
| **Custom React** | YES, naturally | Auto-resize is a pure function: given a parent and its children, compute the minimum bounding box. Applied on every state change via the `autoResizeParent()` function that walks up the parent chain. Because we own the state model, there are no framework-level conflicts. Bidirectional: growing a child expands the parent; removing a child contracts it. |

**Verdict:** This is the decisive criterion. tldraw's frame model was not designed for auto-resize. Making it work requires intercepting and overriding the framework's behavior at a fundamental level. The custom approach implements auto-resize as a first-class concern. Derek's "truthful boundary" requirement is naturally satisfied.

### 2.3 Can You Drag a Box Into Another Box (Drag-to-Nest)?

| Approach | Result | Notes |
|---|---|---|
| **tldraw** | PARTIAL | tldraw has built-in "drop into frame" behavior -- when you drag a shape over a frame, the shape becomes a child of that frame. This works for one level. For recursive nesting (dragging a frame-containing-shapes into another frame), tldraw's behavior becomes unpredictable. The built-in drop detection uses bounding box overlap which can conflict with our custom auto-resize logic. We need to disable tldraw's native frame-drop and replace it entirely. |
| **Custom React** | YES | Our custom hit-test finds the smallest (deepest) card whose bounds contain the dragged card's center. On mouse-up, we reparent the card, convert coordinates to the new parent's local space, and trigger auto-resize. Works at any depth. The "blue highlight" nest target indicator provides clear visual feedback. |

**Verdict:** tldraw's built-in nesting works for simple cases but breaks down with recursive nesting + auto-resize. The custom approach handles nesting as a core operation, not an afterthought.

### 2.4 Can You Drag a Box Out (Drag-to-Unnest)?

| Approach | Result | Notes |
|---|---|---|
| **tldraw** | PARTIAL | tldraw does not have a concept of "unnesting" by dragging outside a frame boundary. Frames clip their children. To unnest, you would need to: (1) detect that the shape is being dragged outside its parent frame's bounds, (2) reparent it to the frame's parent (or the page), (3) convert coordinates. This is entirely custom logic that conflicts with tldraw's frame clipping behavior. |
| **Custom React** | YES | When a dragged card's center crosses its parent's boundary, we detect the unnest condition on mouse-up. The card is reparented to the grandparent (or to the canvas root). Coordinates are converted automatically. Auto-resize contracts the old parent. |

**Verdict:** Unnesting is a critical Plectica interaction (drag-to-unnest = removing a part from a system). tldraw's frame clipping model makes this unnatural. The custom approach implements it as a direct consequence of the drag model.

### 2.5 Pan and Zoom on Infinite Canvas?

| Approach | Result | Notes |
|---|---|---|
| **tldraw** | EXCELLENT (built-in) | Pan/zoom is tldraw's core competency. Smooth, performant, handles edge cases (zoom limits, minimap, zoom-to-fit, zoom-to-selection). This is free. |
| **Custom React** | GOOD (manual but straightforward) | Pan via CSS `translate()`, zoom via CSS `scale()`, both on a single transform container. Mouse wheel for pan, Ctrl+wheel for zoom (centered on cursor). Works well but is basic -- no minimap, no zoom-to-fit, no smooth animations. These are all buildable but represent additional work. |

**Verdict:** tldraw wins on pan/zoom out of the box. But pan/zoom is a solved problem -- implementing it from scratch takes days, not weeks. It should not be the deciding factor.

### 2.6 Performance Feel With ~50 Nested Elements?

| Approach | Result | Notes |
|---|---|---|
| **tldraw** | GOOD | tldraw is optimized for rendering many shapes. 50 elements is trivial for it. However, the auto-resize middleware adds overhead on every shape change (it must recompute parent bounds and potentially trigger cascading updates). With 50 elements, this is imperceptible. At 500+, the `store.listen()` + `requestAnimationFrame` approach may need optimization. |
| **Custom React** | GOOD | 50 DOM elements with CSS containment is trivial for modern browsers. React's reconciliation handles updates efficiently. The auto-resize function is O(depth) per change. With `React.memo` on the Card component, only affected cards re-render. At 500+ elements, we would need viewport culling (skip rendering off-screen cards). This is straightforward to add. |

**Verdict:** Both are fine at 50 elements. Both will need optimization work at 500+. Neither has a fundamental performance advantage at this scale. At 1000+, tldraw's Canvas 2D rendering will outperform DOM, but we can add Canvas 2D rendering for cards below a zoom threshold (level-of-detail) in the custom approach.

### 2.7 How Hard Was It to Implement? How Much Fighting Against the Framework?

| Approach | Difficulty | Framework friction |
|---|---|---|
| **tldraw** | MODERATE | HIGH. tldraw's shape/frame model is designed for flat whiteboards with optional one-level grouping. Every core Plectica requirement (auto-resize, deep nesting, drag-to-unnest) requires overriding or extending tldraw's built-in behavior. We are not using tldraw to build Plectica -- we are *un-building* parts of tldraw so we can rebuild them differently. The tldraw SDK is well-designed and extensible, but extensibility for our use case means replacing core interaction handlers, not just adding shapes. |
| **Custom React** | MODERATE | NONE (by definition). Every behavior is written from scratch, which means more code but zero surprises. The DOM nesting model maps directly to our data model. The implementation is ~400 lines of TypeScript for the core engine (store.ts) + ~250 lines for the card renderer + ~300 lines for the app shell with interactions. This is not trivial, but it is all *our* code that directly expresses *our* requirements. |

**Verdict:** The custom approach requires writing more code, but every line serves Plectica's specific needs. tldraw requires writing custom code AND understanding + working around the framework's existing behavior. Net implementation effort is comparable, but the custom approach produces code that is easier to reason about and modify.

---

## 3. Summary Table

| Criterion | tldraw | Custom React | Winner |
|---|---|---|---|
| 5-level nested rendering | Partial (visual issues) | Clean | Custom |
| Auto-resize propagation | Works (fights framework) | Works (natural) | Custom |
| Drag-to-nest | Partial (breaks at depth) | Works | Custom |
| Drag-to-unnest | Must override framework | Works | Custom |
| Pan and zoom | Excellent (built-in) | Good (manual) | tldraw |
| Performance at 50 elements | Good | Good | Tie |
| Implementation difficulty | Moderate + high friction | Moderate + zero friction | Custom |

---

## 4. Recommendation

### Use the Custom React + CSS Transform approach.

**Reasoning:**

1. **The "truthful boundary" requirement is the deciding factor.** Derek's requirement that a parent's visual boundary must always contain its children, with bidirectional auto-resize, is the single most important property of the canvas. tldraw's frame model actively works against this. The custom approach implements it as a first-class constraint.

2. **We are building something that does not exist.** Recursive nested containers with auto-resize, drag-to-nest, and drag-to-unnest is not a standard whiteboard feature. No existing framework implements it. With tldraw, we would spend significant effort disabling its assumptions before we could build ours. With the custom approach, we build exactly what we need.

3. **Total control over the rendering and interaction model.** Plectica's nesting interaction needs to feel magical -- the "blue highlight, gentle expand, card snaps into place" experience. This requires fine-grained control over every visual detail. The custom approach gives us this. tldraw gives us their visual language, which we would need to override.

4. **Text editing is trivial in DOM.** A huge advantage of the DOM-based approach: card text editing is just `<input>` or `<textarea>` elements. In tldraw, text editing inside custom shapes requires complex overlay management.

5. **tldraw's strengths are not our needs.** tldraw excels at freehand drawing, shape tools, collaborative editing, and one-level grouping. Plectica needs none of these at MVP. tldraw's overhead (bundle size, API surface, conceptual model) buys us nothing we need.

6. **The custom approach is not as much work as it sounds.** The prototype is ~950 lines of TypeScript. The core engine (auto-resize, coordinate transforms, nesting logic) is ~400 lines. For a production implementation, we are looking at perhaps 2,000-3,000 lines for the full canvas engine, plus whatever UI polish we add. This is a manageable codebase that the team fully understands.

### What We Take From tldraw's Architecture

Even though we are not using tldraw as a dependency, we should study and adopt several of its architectural patterns:

- **Shape/record store:** tldraw's normalized store (shapes as records in a flat map, with parentId for hierarchy) is the right data model. Our `Map<string, CardData>` mirrors this.
- **Viewport culling strategy:** tldraw's O(1) culling subscriptions (using spatial indexing) should be our target for the performance optimization pass in M3.
- **Undo/redo via store snapshots:** tldraw's approach of snapping store diffs for undo/redo is clean and we should replicate it.
- **Shape utilities:** tldraw's hit-testing geometry (point-in-polygon, box-box intersection) is well-tested. We can use similar math without the framework dependency.

---

## 5. Electron vs Tauri Decision

### Recommendation: Tauri

**Reasoning:**

1. **SQLite access is cleaner in Tauri.** Tauri's Rust backend can use `rusqlite` (or the `tauri-plugin-sql` plugin) to access SQLite directly, with no Node.js wrapper layer. In Electron, we would use `better-sqlite3` through Node.js, which works but adds a layer. For a local-first app where the database is the source of truth, the shorter path to SQLite matters.

2. **Memory footprint matters for a thinking tool.** Plectica will be open for hours during deep thinking sessions. Tauri's ~30-40MB baseline vs Electron's ~200-300MB means the app does not fight the user's other tools for memory. For a tool that should "disappear so the user can think spatially," being lightweight is an experience requirement, not just a technical one.

3. **Bundle size.** Tauri apps distribute at <10MB. Electron apps start at ~150MB. For a local-first tool that we want people to install without friction, smaller is better.

4. **Our canvas is a web view either way.** Both Tauri and Electron run the canvas in a web view. Our custom React canvas will work identically in both. The choice of shell does not affect the canvas implementation at all.

5. **Rust is only needed for the backend (IPC commands, SQLite, file system).** The frontend is 100% TypeScript/React. The Rust surface area is small: perhaps 10-15 IPC commands for CRUD operations on nodes, maps, and layouts. This is well within "Rust for the plumbing" territory -- no deep Rust expertise needed.

6. **Tauri 2.x is production-ready.** The ecosystem concern from the roadmap ("younger ecosystem, fewer community resources") was valid a year ago but is less so now. Tauri 2.0 is stable, well-documented, and used in production apps.

**The one risk:** If we discover that a critical feature (auto-update, specific native integration, edge case in webview behavior on Windows) is significantly harder in Tauri, we can swap to Electron with minimal pain. The canvas code is identical either way. The only thing that changes is the IPC layer and the SQLite access pattern.

**Mitigation:** Build the IPC layer behind a clean abstraction (an async TypeScript interface). The canvas calls `db.getChildren(nodeId)` -- it does not know or care whether that goes through Tauri IPC or Electron IPC. If we need to switch shells, we swap the implementation behind the interface.

---

## 6. Setup / Run Instructions

### Prerequisites

- Node.js >= 18
- npm >= 9

### Approach 1: tldraw Prototype

```bash
cd src/prototype/tldraw-nested
npm install
npm run dev
```

Opens at http://localhost:5173. The canvas loads with the Bicycle system (5 nesting levels). Use tldraw's built-in controls to pan/zoom. Drag standalone cards (right side) into containers to test nesting.

### Approach 2: Custom React Prototype

```bash
cd src/prototype/custom-react-canvas
npm install
npm run dev
```

Opens at http://localhost:5173. The canvas loads with the Bicycle system (5 nesting levels, ~50 elements). Scroll to pan, Ctrl+scroll to zoom. Drag cards into containers to nest. Drag outside parent boundary to unnest. Double-click on empty space to create new cards. Delete key to remove selected card. Resize handle appears bottom-right when a card is selected.

---

## 7. Next Steps (Wren's View)

With the framework decision made, here is what I need to execute on M0:

1. **Set up the Tauri app shell** with the custom React canvas inside it. This is the M0 "app shell + canvas rendering" deliverable.
2. **Wire SQLite** via Tauri IPC. Define the TypeScript interface for canvas data access. Implement Rust IPC commands for Silas's schema (once it is ready).
3. **Harden the canvas engine.** The prototype is functional but not production-ready. Needs: proper undo/redo, keyboard shortcuts, viewport culling, zoom-to-fit, smoother animations on nest/unnest.
4. **Design the nesting interaction in detail** with Derek. The prototype has the mechanics; we need to nail the visual feedback (expand animation, drop target indicator, depth coloring system, collapse/LOD behavior at low zoom).

Waiting on:
- Larry's go-ahead on the Tauri decision
- Silas's schema (to wire persistence)
- Derek's formal DSRP data model spec (to ensure the canvas data model aligns)

---

*The framework that makes nesting feel invisible is the right framework. For Plectica, that means building our own.*

-- Wren
