---
name: Receipt presentation boundary
description: Keeps durable runtime receipts useful for trusted services without exposing internal artifact or provider fields in conversational UI.
---

Treat a runtime receipt as an internal durable record, not a user-facing document. Conversation reconciliation and legacy receipt rendering must summarize capability outcomes rather than stringify outputs.

**Why:** Artifact object paths, protected preview paths, signed-link fields, and provider request metadata are needed for trusted server behavior but become a privacy and implementation leak when copied into chat content.

**How to apply:** Persist and owner-scope the full receipt; expose images through protected preview routes and lineage through its dedicated query. For UI text, show outcome counts, source trust labels, and verification status only. Sanitize legacy receipt messages at render time as well as future reconciliation output.