// ─────────────────────────────────────────────────────────────────────────────
// The 11 default categories — PRD §3.2.1 (single source of truth).
//
// Seeded for every new user at signup (routes/auth.ts) and used as the AI
// classification fallback list (services/aiService.ts). These two consumers
// previously kept separate hardcoded lists that had drifted from the PRD
// (Finance/Technology/Culture/News/Personal are not PRD categories).
// "Other" must always be last (the AI fallback; cannot be deleted).
// All 11 are isSystemDefault: true (PRD §5 schema: "for the 11 default
// categories") — the free-tier limit counts only categories the user
// created (isSystemDefault: false), so defaults never use up the 3 slots.
// ─────────────────────────────────────────────────────────────────────────────

export interface DefaultCategory {
  name: string;
  emoji: string;
  sortOrder: number;
  isSystemDefault: boolean;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Learning',      emoji: '🎓', sortOrder: 0,  isSystemDefault: true  },
  { name: 'Business',      emoji: '💼', sortOrder: 1,  isSystemDefault: true  },
  { name: 'Travel',        emoji: '✈️', sortOrder: 2,  isSystemDefault: true  },
  { name: 'Food',          emoji: '🍔', sortOrder: 3,  isSystemDefault: true  },
  { name: 'Fitness',       emoji: '💪', sortOrder: 4,  isSystemDefault: true  },
  { name: 'Entertainment', emoji: '🎬', sortOrder: 5,  isSystemDefault: true  },
  { name: 'Shopping',      emoji: '🛍️', sortOrder: 6,  isSystemDefault: true  },
  { name: 'Inspiration',   emoji: '✨', sortOrder: 7,  isSystemDefault: true  },
  { name: 'Tech',          emoji: '💻', sortOrder: 8,  isSystemDefault: true  },
  { name: 'People',        emoji: '👥', sortOrder: 9,  isSystemDefault: true  },
  { name: 'Other',         emoji: '📌', sortOrder: 10, isSystemDefault: true  },
];

export const DEFAULT_CATEGORY_NAMES: string[] = DEFAULT_CATEGORIES.map((c) => c.name);
