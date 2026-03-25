# New issues (these should be moved to handled when taken care of)

(None currently -- add new issues here)

# Handled issues (either solved in code or updated in documentation)

- Multiple Models: Create, switch, rename, delete canvases. Left sidebar model picker. Rust backend with cascade delete. Fixed get_map_relationships to filter by map_id. Added map_id column to relationships with migration + backfill.
  - **Fixed:** 4 new Rust commands (create_map, get_all_maps, rename_map, delete_map). LeftSidebar component with inline rename, hover delete, create with auto-rename. Canvas keyed on mapId for clean reload on switch.

# Requirements testing

1. Left sidebar shows list of models - OK!
2. Click a model to switch -> canvas loads that model's cards - OK!
3. Click "New Model" -> creates model, auto-selects it, enters rename mode - OK!
4. Double-click model name -> inline edit, Enter/blur to save, Escape to cancel - OK!
5. Hover model -> delete "x" appears (not on active model, not when only 1 model) - OK!
6. Delete model -> confirmation dialog, then removes it and all its cards/relationships - OK!
	1. Confirmation dialog appears, but the model is not deleted when I press ok.
	2. Now it is ok!
7. Cards created in Model A do not appear in Model B - OK!
8. Relationships created in Model A do not appear in Model B - OK!
9. Switching models preserves each model's cards and layout across switches - OK!
10. All M3 functionality still works (drag, nest, push mode, relationships, etc.) - OK!
