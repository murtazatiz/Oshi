# ADR-0005 — Explicit platform detection before the generic web fallback

**Status:** Accepted · **Decided:** ~2026-06 (recorded 2026-09-18)

## Context
LinkedIn/Facebook/Twitter URLs fell through to generic web handling with poor thumbnails.

## Decision
Hostname checks for all known platforms (incl. fb.com/fb.watch/fb.me, x.com) run before "web"; LinkedIn/Facebook OG fetches use browser-like headers with platform fallback thumbnails. Scraping Instagram/TikTok/Twitter beyond Open Graph is forbidden (IP-ban risk).

## Consequences
Better cards for social links. Detection now lives in one module — see ADR-0010. TC-SAVE-06.
