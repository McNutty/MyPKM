#!/bin/bash
# Hook: Reminds Larry to delegate instead of editing project files directly.
# This runs on PreToolUse for Edit/Write tools.
# Subagents (team members) are allowed to edit -- this only catches the main agent.

# Read the tool input from stdin
INPUT=$(cat)

# Extract the file path from the tool input
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | sed 's/"file_path":"//;s/"//')

# Allow edits to team docs (CLAUDE.md, memory, roster, hooks, settings, plans)
if echo "$FILE_PATH" | grep -qiE '(CLAUDE\.md|memory/|roster\.md|\.claude/hooks|\.claude/settings|\.claude/plans|MEMORY\.md)'; then
  exit 0
fi

# Block edits to project code/data files
if echo "$FILE_PATH" | grep -qiE '\.(py|html|css|js|sql|db|json|md)$'; then
  echo "LARRY: You're about to edit a project file directly. Remember your core rule -- delegate this to the right team member (Wren for UI, Silas for database, etc.)."
  exit 2
fi

exit 0
