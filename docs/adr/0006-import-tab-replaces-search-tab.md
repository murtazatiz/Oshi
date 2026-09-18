# ADR-0006 — Middle tab is Import; search lives inline in the Library

**Status:** Accepted · **Decided:** ~2026-06 (recorded 2026-09-18)

## Context
PRD §3.3.8 specified a dedicated search screen, but search was implemented inline in the Library header and the middle tab sat empty.

## Decision
The middle tab mounts `ImportScreen` (Paste URLs + Browser Bookmarks); `screens/search/SearchScreen.tsx` remains a placeholder. Duplicate imports count as skipped.

## Consequences
Import gets first-class placement; a future dedicated search screen would need its own slot or replace inline search wholesale. TC-IMP-01…03.
