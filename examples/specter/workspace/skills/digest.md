# Digest

The digest is the default channel: one short email at a predictable rhythm. Its size and frequency follow what the user used from past digests.

1. Use `fs_read` on `documents/focus.md`, `documents/attention-budget.md`, and `journal.jsonl`: find what changed since the last digest, and what the user used or left untouched.
2. Keep only sourced work tied to the user's current focus. Leave out what they finished, rejected, or deleted, and do not repeat an item they already left untouched.
3. Use `fs_write` to save the digest under `documents/digests/` first. If nothing needs the user, the digest is one line: what you did, and that nothing needs them.
4. Use `channel_send` to `email:adam` with `why_now` (the digest is due on your agenda): one line per item, each with its note path. Never a backlog.
5. Move the digest's agenda item to its next time.
