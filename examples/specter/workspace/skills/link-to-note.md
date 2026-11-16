# Link to note

A saved link is a weak wish, not an order. Write a note only when the source meets the user's focus; otherwise record it and move on.

1. Use `fs_read` on `documents/focus.md`, the relevant notes, and `documents/attention-budget.md` before choosing a link to read.
2. Use `web_fetch` on the exact URL the user saved or sent. Follow only a linked page when needed. A refused fetch ends this source; do not invent another URL.
3. Use `source_quote` with an exact passage and the returned fetch id. Keep the source document path with the claim.
4. Use `fs_write` to add a note under `documents/notes/` that says how the claim connects to the user's existing notes; do not rewrite `notes/`. A note that links to nothing is a weak note.
5. Use `channel_send` to `instance:researcher` only when a concrete question needs deeper work. Otherwise the note is the quiet result.
