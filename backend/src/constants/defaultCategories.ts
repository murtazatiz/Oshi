// ─────────────────────────────────────────────────────────────────────────────
// The 11 default categories — PRD §3.2.1 (single source of truth).
//
// Seeded for every new user at signup (routes/auth.ts) and used as the AI
// classification fallback list (services/aiService.ts). These two consumers
// previously kept separate hardcoded lists that had drifted from the PRD
// (Finance/Technology/Culture/News/Personal are not PRD categories).
// "Other" must always be last and is the system fallback (isSystemDefault).
// ─────────────────────────────────────────────────────────────────────────────

export interface DefaultCategory {
  name: string;
  emoji: string;
  sortOrder: number;
  isSystemDefault: boolean;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Learning',      emoji: '🎓', sortOrder: 0,  isSystemDefault: false },
  { name: 'Business',      emoji: '💼', sortOrder: 1,  isSystemDefault: false },
  { name: 'Travel',        emoji: '✈️', sortOrder: 2,  isSystemDefault: false },
  { name: 'Food',          emoji: '🍔', sortOrder: 3,  isSystemDefault: false },
  { name: 'Fitness',       emoji: '💪', sortOrder: 4,  isSystemDefault: false },
  { name: 'Entertainment', emoji: '🎬', sortOrder: 5,  isSystemDefault: false },
  { name: 'Shopping',      emoji: '🛍️', sortOrder: 6,  isSystemDefault: false },
  { name: 'Inspiration',   emoji: '✨', sortOrder: 7,  isSystemDefault: false },
  { name: 'Tech',          emoji: '💻', sortOrder: 8,  isSystemDefault: false },
  { name: 'People',        emoji: '👥', sortOrder: 9,  isSystemDefault: false },
  { name: 'Other',         emoji: '📌', sortOrder: 10, isSystemDefault: true  },
];

export const DEFAULT_CATEGORY_NAMES: string[] = DEFAULT_CATEGORIES.map((c) => c.name);
