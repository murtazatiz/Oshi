import OpenAI from 'openai';
import type { ContentMetadata } from './metadataService';

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI GPT-4o-mini Integration — PRD §3.2.1
//
// The system prompt is built dynamically so it contains the user's actual
// category names instead of a hardcoded list. This ensures the AI picks from
// the categories the user has configured rather than always falling back to
// "Other".
//
// Temperature: 0.2 (low randomness for consistent categorisation)
// Max tokens: 200 (response is always small JSON)
// Model: gpt-4o-mini
//
// Retry logic: 3 attempts with exponential backoff: 1s, 2s, 4s
// If confidence_score < 0.5: category is forced to 'Other'
// ─────────────────────────────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// AI response type — PRD §3.2.1 required JSON response format
// ─────────────────────────────────────────────────────────────────────────────
export interface AiClassification {
  category: string;
  content_type: string;
  summary: string;
  tags: string[];
  confidence_score: number;
  estimated_read_time_seconds: number;
}

/**
 * Build the system prompt with the user's actual category names injected.
 * Falls back to the PRD defaults if no categories are provided.
 */
function buildSystemPrompt(categoryNames: string[]): string {
  const DEFAULT_CATEGORIES = [
    'Learning', 'Business', 'Travel', 'Food', 'Fitness',
    'Entertainment', 'Shopping', 'Inspiration', 'Tech', 'People', 'Other',
  ];

  const cats = categoryNames.length > 0 ? categoryNames : DEFAULT_CATEGORIES;
  // Always include "Other" as a fallback option
  if (!cats.some((c) => c.toLowerCase() === 'other')) {
    cats.push('Other');
  }

  return `You are a content categorisation assistant for Oshi, a smart content inbox app. Your job is to analyse content metadata and return a structured JSON classification. You must return ONLY a valid JSON object — no explanation, no markdown, no backticks.

Available categories: ${cats.join(', ')}

Use ALL available signals before deciding: platform/source, title, description, text snippet, creator/channel name, and content type. Infer category from context — e.g. a cooking video from a food creator should go to Food even if the word "food" is not in the title. Be liberal with matching: if content is even loosely related to a category, prefer that category over "Other". Only use "Other" as a last resort when there is genuinely no match with confidence above 0.5.

Examples of good reasoning:
- Recipe video from "Tasty" channel → Food (creator + content type)
- TED talk about startups → Business or Learning (topic + format)
- Fitness influencer's workout clip → Fitness (creator context + content)
- Travel vlog from a travel YouTuber → Travel (creator + title/description)
- Tech review of a laptop → Tech (topic clear from title/description)

Content types: short_video, long_video, article, podcast, post, product, image, other

Return JSON with these exact keys: category, content_type, summary (max 120 chars), tags (max 3), confidence_score (0-1), estimated_read_time_seconds`;
}

/**
 * Build the user message payload from content metadata.
 * PRD §3.2.1 — exact user message template.
 */
function buildUserMessage(meta: ContentMetadata): string {
  const payload = {
    url: '', // URL not sent to OpenAI for privacy — metadata is enough
    platform: meta.platform,
    title: meta.title,
    description: meta.description.slice(0, 300),
    text_snippet: meta.textSnippet.slice(0, 500) || '',
    channel_or_author: meta.channelOrAuthor || '',
    duration_seconds: meta.durationSeconds || 0,
  };
  return JSON.stringify(payload);
}

/**
 * Parse the raw OpenAI response text into a typed AiClassification.
 * Validates against the user's actual category names.
 */
function parseAiResponse(raw: string, validCategoryNames: string[]): AiClassification {
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  const VALID_CONTENT_TYPES = new Set([
    'short_video', 'long_video', 'article', 'podcast',
    'post', 'product', 'image', 'other',
  ]);

  // Build a case-insensitive lookup from the user's categories
  const categoryLookup = new Map<string, string>();
  for (const name of validCategoryNames) {
    categoryLookup.set(name.toLowerCase(), name);
  }
  // Always accept "Other"
  if (!categoryLookup.has('other')) {
    categoryLookup.set('other', 'Other');
  }

  const confidenceScore = Number(parsed['confidence_score'] ?? 0);
  const rawCategory = String(parsed['category'] ?? 'Other');

  // Match the AI's response to the user's category names (case-insensitive)
  let category = categoryLookup.get(rawCategory.toLowerCase()) ?? null;

  // PRD §3.2.1: if confidence_score < 0.5 or category unrecognised, force "Other"
  if (confidenceScore < 0.5 || !category) {
    category = categoryLookup.get('other') ?? 'Other';
  }

  let contentType = String(parsed['content_type'] ?? 'other');
  if (!VALID_CONTENT_TYPES.has(contentType)) {
    contentType = 'other';
  }

  const rawTags = Array.isArray(parsed['tags']) ? parsed['tags'] : [];
  const tags = rawTags
    .filter((t): t is string => typeof t === 'string')
    .slice(0, 3);

  return {
    category,
    content_type: contentType,
    summary: String(parsed['summary'] ?? '').slice(0, 120),
    tags,
    confidence_score: Math.max(0, Math.min(1, confidenceScore)),
    estimated_read_time_seconds: Math.max(0, Number(parsed['estimated_read_time_seconds'] ?? 0)),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Categorise content using OpenAI GPT-4o-mini.
 *
 * @param meta          - Content metadata (title, description, etc.)
 * @param categoryNames - The user's actual category names from the DB.
 *                        When provided the AI picks from this list instead
 *                        of the hardcoded PRD defaults.
 *
 * PRD §3.2.1:
 *   Model: gpt-4o-mini
 *   Temperature: 0.2
 *   Max tokens: 200
 *   Retry: 3 attempts, exponential backoff 1s → 2s → 4s
 *   On all retries failed: returns null (caller sets processing_status='failed')
 */
export async function classifyContent(
  meta: ContentMetadata,
  categoryNames: string[] = [],
): Promise<AiClassification | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('[ai] OPENAI_API_KEY not set — cannot classify content.');
    return null;
  }

  const systemPrompt = buildSystemPrompt(categoryNames);
  const userMessage = buildUserMessage(meta);
  const MAX_ATTEMPTS = 3;
  const BACKOFF_DELAYS = [1_000, 2_000, 4_000];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      return parseAiResponse(content, categoryNames);
    } catch (err) {
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
      console.error(
        `[ai] Attempt ${attempt + 1}/${MAX_ATTEMPTS} failed:`,
        err instanceof Error ? err.message : err,
      );

      if (isLastAttempt) {
        return null;
      }

      const delay = BACKOFF_DELAYS[attempt];
      if (delay !== undefined) {
        await sleep(delay);
      }
    }
  }

  return null;
}
