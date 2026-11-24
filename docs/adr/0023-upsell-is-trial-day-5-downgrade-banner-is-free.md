# ADR-0023 — Day-5 upsell targets trial users; the downgrade banner targets the free plan

**Status:** Accepted · **Decided:** 2026-11-24 · **Supersedes:** the audience of FIX-20261123-05

## Context
PRD §8.3 asks for a "Day 5 soft upsell banner on Library home screen for free users", and §3.7.4 asks for "a persistent soft banner on the Library: 'You're on the free plan — some features are limited. Upgrade to Pro.' Dismissible once per session." Every signup starts a 7-day trial (§8.1), so a free-plan user is always someone whose trial has ended. Read literally, the two banners target the same people. And on day 5 nobody is on the free plan, because they're still in their trial.

## Decision
- **Day-5 upsell** (`upsell_banner_due`): trial users whose account is ≥ 5 days old. It's a conversion nudge in the trial's last days. Copy: "Enjoying Oshi Pro? Keep it after your trial". Snoozed 7 days on dismiss.
- **Downgrade banner** (`downgrade_banner_due`): the free plan, after a trial ends or a subscription expires. The PRD's copy, dismissible once per app session (in memory).
- Neither shows alongside the trial-expiry banner.

## Consequences
Every user sees at most one Library monetization banner for their state. If product meant §8.3's "free users" literally, merge the two banners and supersede this ADR. TC-SUB-08, TC-SUB-09.
