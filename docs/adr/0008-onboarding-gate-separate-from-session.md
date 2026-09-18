# ADR-0008 — Onboarding completion gates Main separately from the session

**Status:** Accepted · **Decided:** ~2026-06 (recorded 2026-09-18)

## Context
Account creation happens at onboarding step 5 of 9, so a Supabase session exists before onboarding is done.

## Decision
`RootNavigator` renders Main only when `session !== null` AND `onboardingStore.isComplete` (AsyncStorage-persisted).

## Consequences
Killing the app mid-onboarding resumes onboarding (TC-AUTH-02). Sign-out must not clear the onboarding flag for existing users.
