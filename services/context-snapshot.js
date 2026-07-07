import { getDefaultGeminiService } from './gemini-service.js';

const DEFAULT_CONFIDENCE = 'low';
const DEFAULT_COMPLEXITY = 'medium';
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
const VALID_COMPLEXITY = new Set(['low', 'medium', 'high', 'very high']);
const MAX_LABELS = 5;

const SNAPSHOT_SYSTEM_INSTRUCTION = [
  'You are Anchor Context Snapshot, an analyst for confirmed Slack commitments.',
  'Write metadata like a senior engineer preparing a concise GitHub issue after reading a Slack conversation.',
  'Return JSON only. Do not return markdown, code fences, comments, or explanations.',
  'Extract project context from the commitment without replacing the original Slack text.',
  'Preserve and use all lines in multiline commitments. Do not ignore paragraphs, bullet lists, or lines after the first sentence.',
  'Requirements must be actionable work items. Preserve existing bullets when present, and convert actionable sentence fragments into short requirement strings.',
  'Dependencies should include only systems, modules, services, SDKs, providers, schemas, scripts, or workflows that are clearly mentioned or strongly implied by the commitment. Do not invent technologies.',
  'Potential risks should be concise engineering risks implied by the work. If there are no meaningful risks, return an empty array.',
  'Summary must be one to three concise professional sentences suitable for a GitHub issue.',
  'Due date must be populated only when the commitment explicitly mentions timing such as tomorrow morning, next sprint, before release, by end of month, this weekend, next Tuesday, or after standup. Never hallucinate calendar dates.',
  'Labels must be useful GitHub labels, lowercase, hyphenated, and limited to five items.',
  'Set confidence to high only for a clear commitment with clear requirements and a clear deadline; medium for partial ambiguity; low for vague ownership or unclear work.',
  'Set estimatedComplexity to low for simple docs or small updates, medium for contained fixes, high for migrations or broad feature work, and very high for infrastructure rewrites or multi-system changes.',
  'If a field is unknown, return an empty string or an empty array.',
  'Use this exact JSON shape:',
  '{"title":"","summary":"","requirements":[],"dueDate":"","assignee":"","labels":[],"dependencies":[],"potentialRisks":[],"confidence":"","estimatedComplexity":""}',
  'confidence must be high, medium, or low.',
  'estimatedComplexity must be low, medium, high, or very high.',
].join(' ');

/**
 * @typedef {{
 *   title: string,
 *   summary: string,
 *   requirements: string[],
 *   dueDate: string,
 *   assignee: string,
 *   labels: string[],
 *   dependencies: string[],
 *   potentialRisks: string[],
 *   confidence: 'high' | 'medium' | 'low',
 *   estimatedComplexity: 'low' | 'medium' | 'high' | 'very high',
 * }} ContextSnapshot
 */

/**
 * Generate structured context metadata for an already-detected commitment.
 *
 * This service has no Slack, GitHub, SQLite, MCP, or persistence coupling. It
 * returns a normalized object and falls back safely if Gemini cannot produce a
 * valid JSON payload.
 *
 * @param {string} commitmentText
 * @param {{
 *   geminiService?: { generateText: (prompt: string, options?: Record<string, unknown>) => Promise<string> },
 *   logger?: { warn?: (message: string) => void },
 * }} [options]
 * @returns {Promise<ContextSnapshot>}
 */
export async function createContextSnapshot(commitmentText, options = {}) {
  const fallback = createFallbackSnapshot(commitmentText);

  if (typeof commitmentText !== 'string' || commitmentText.trim().length === 0) {
    return fallback;
  }

  try {
    const geminiService = options.geminiService ?? getDefaultGeminiService();
    const response = await geminiService.generateText(buildSnapshotPrompt(commitmentText), {
      maxOutputTokens: 700,
      temperature: 0.2,
      systemInstruction: SNAPSHOT_SYSTEM_INSTRUCTION,
    });

    return normalizeContextSnapshot(parseSnapshotJson(response), fallback);
  } catch (error) {
    options.logger?.warn?.(`Context snapshot generation failed; using fallback metadata: ${error}`);
    return fallback;
  }
}

/**
 * @param {string} commitmentText
 * @returns {string}
 */
function buildSnapshotPrompt(commitmentText) {
  return [
    'Analyze this already-detected Slack commitment and extract reusable project metadata.',
    '',
    'Commitment:',
    commitmentText.trim(),
  ].join('\n');
}

/**
 * @param {string} response
 * @returns {Record<string, unknown>}
 */
function parseSnapshotJson(response) {
  const parsed = JSON.parse(response);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Context snapshot JSON must be an object.');
  }

  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {Record<string, unknown>} value
 * @param {ContextSnapshot} fallback
 * @returns {ContextSnapshot}
 */
export function normalizeContextSnapshot(value, fallback) {
  const confidence = normalizeEnum(value.confidence, VALID_CONFIDENCE, DEFAULT_CONFIDENCE);
  const estimatedComplexity = normalizeEnum(value.estimatedComplexity, VALID_COMPLEXITY, DEFAULT_COMPLEXITY);
  const title = normalizeString(value.title) || fallback.title;
  const summary = normalizeString(value.summary) || fallback.summary;

  return {
    title,
    summary,
    requirements: withFallbackList(normalizeList(value.requirements), fallback.requirements),
    dueDate: normalizeString(value.dueDate) || fallback.dueDate,
    assignee: normalizeString(value.assignee),
    labels: withFallbackList(normalizeLabels(value.labels), fallback.labels).slice(0, MAX_LABELS),
    dependencies: withFallbackList(normalizeList(value.dependencies), fallback.dependencies),
    potentialRisks: withFallbackList(normalizeList(value.potentialRisks), fallback.potentialRisks),
    confidence: /** @type {'high' | 'medium' | 'low'} */ (confidence),
    estimatedComplexity: /** @type {'low' | 'medium' | 'high' | 'very high'} */ (estimatedComplexity),
  };
}

/**
 * @param {string[]} primary
 * @param {string[]} fallback
 * @returns {string[]}
 */
function withFallbackList(primary, fallback) {
  return primary.length > 0 ? primary : fallback;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }

  return String(value).trim();
}

/**
 * @param {unknown} value
 * @param {{ lowerCase?: boolean }} [options]
 * @returns {string[]}
 */
function normalizeList(value, options = {}) {
  const rawValues = Array.isArray(value) ? value : splitListString(value);
  const seen = new Set();
  const normalized = [];

  for (const rawValue of rawValues) {
    const item = stripListMarker(normalizeString(rawValue));
    if (!item) {
      continue;
    }

    const finalItem = options.lowerCase ? item.toLowerCase() : item;
    const key = finalItem.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(finalItem);
  }

  return normalized;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeLabels(value) {
  return normalizeList(value, { lowerCase: true })
    .map((label) =>
      label
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-'),
    )
    .filter(Boolean)
    .slice(0, MAX_LABELS);
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripListMarker(value) {
  return value.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function splitListString(value) {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @param {unknown} value
 * @param {Set<string>} allowed
 * @param {string} fallback
 * @returns {string}
 */
function normalizeEnum(value, allowed, fallback) {
  const normalized = normalizeString(value).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

/**
 * @param {string} commitmentText
 * @returns {ContextSnapshot}
 */
export function createFallbackSnapshot(commitmentText) {
  const text = typeof commitmentText === 'string' ? commitmentText.trim() : '';
  const dependencies = inferDependencies(text);

  return {
    title: formatFallbackTitle(text),
    summary: formatFallbackSummary(text),
    requirements: extractBulletRequirements(text),
    dueDate: extractDueDate(text),
    assignee: '',
    labels: inferLabels(text),
    dependencies,
    potentialRisks: inferPotentialRisks(text, dependencies),
    confidence: DEFAULT_CONFIDENCE,
    estimatedComplexity: inferComplexity(text),
  };
}

/**
 * @param {string} text
 * @returns {string}
 */
function formatFallbackSummary(text) {
  if (!text) {
    return 'Anchor commitment';
  }

  return text
    .split(/\r?\n/)
    .map((line) => stripListMarker(line).trim())
    .filter((line) => line && !/^need to:?$/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractBulletRequirements(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))
    .map((line) => stripListMarker(line))
    .map(capitalizeSentence)
    .filter(Boolean);
}

/**
 * @param {string} text
 * @returns {string}
 */
function extractDueDate(text) {
  const match = text.match(
    /\b(?:tomorrow(?:\s+(?:morning|afternoon|evening|night))?|next\s+sprint|before\s+release|by\s+end\s+of\s+month|this\s+weekend|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|after\s+standup|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|before\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
  );

  return match?.[0] ?? '';
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function inferLabels(text) {
  const lowerText = text.toLowerCase();
  /** @type {string[]} */
  const labels = [];

  addLabel(labels, 'backend', /\b(api|backend|server|auth|authentication|oauth|jwt)\b/.test(lowerText));
  addLabel(labels, 'authentication', /\b(auth|authentication|login)\b/.test(lowerText));
  addLabel(labels, 'oauth', /\boauth\b/.test(lowerText));
  addLabel(labels, 'security', /\b(auth|authentication|oauth|jwt|token|credentials?)\b/.test(lowerText));
  addLabel(labels, 'documentation', /\b(documentation|docs|readme)\b/.test(lowerText));
  addLabel(labels, 'testing', /\b(test|tests|unit tests|verify)\b/.test(lowerText));
  addLabel(labels, 'database', /\b(database|schema|migration)\b/.test(lowerText));
  addLabel(labels, 'payments', /\b(payment|stripe|billing)\b/.test(lowerText));
  addLabel(labels, 'bug', /\b(fix|bug|timeout|issue|regression)\b/.test(lowerText));

  return labels.slice(0, MAX_LABELS);
}

/**
 * @param {string[]} labels
 * @param {string} label
 * @param {boolean} condition
 * @returns {void}
 */
function addLabel(labels, label, condition) {
  if (condition && !labels.includes(label)) {
    labels.push(label);
  }
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function inferDependencies(text) {
  const lowerText = text.toLowerCase();
  /** @type {string[]} */
  const dependencies = [];

  addDependency(dependencies, 'OAuth Provider', /\boauth\b/.test(lowerText));
  addDependency(dependencies, 'JWT Module', /\bjwt\b/.test(lowerText));
  addDependency(dependencies, 'Authentication Service', /\b(auth|authentication|login)\b/.test(lowerText));
  addDependency(dependencies, 'Payment Gateway', /\bpayment gateway\b/.test(lowerText));
  addDependency(dependencies, 'Stripe SDK', /\bstripe\b/.test(lowerText));
  addDependency(dependencies, 'Database Schema', /\b(database|schema)\b/.test(lowerText));
  addDependency(dependencies, 'Migration Scripts', /\bmigration\b/.test(lowerText));

  return dependencies;
}

/**
 * @param {string[]} dependencies
 * @param {string} dependency
 * @param {boolean} condition
 * @returns {void}
 */
function addDependency(dependencies, dependency, condition) {
  if (condition && !dependencies.includes(dependency)) {
    dependencies.push(dependency);
  }
}

/**
 * @param {string} text
 * @param {string[]} dependencies
 * @returns {string[]}
 */
function inferPotentialRisks(text, dependencies) {
  const lowerText = text.toLowerCase();

  if (/\b(database|schema|migration)\b/.test(lowerText)) {
    return ['Database migration may require rollback planning.'];
  }

  if (dependencies.includes('Authentication Service')) {
    return ['Authentication changes may affect login flow.'];
  }

  if (/\b(payment|stripe|billing)\b/.test(lowerText)) {
    return ['Payment changes may affect checkout or billing flows.'];
  }

  return [];
}

/**
 * @param {string} text
 * @returns {'low' | 'medium' | 'high' | 'very high'}
 */
function inferComplexity(text) {
  const lowerText = text.toLowerCase();

  if (/\b(rewrite|infrastructure)\b/.test(lowerText)) {
    return 'very high';
  }

  if (/\b(migrate|migration|oauth|multi-system)\b/.test(lowerText)) {
    return 'high';
  }

  if (/\b(readme|docs|documentation)\b/.test(lowerText) && extractBulletRequirements(text).length <= 1) {
    return 'low';
  }

  return DEFAULT_COMPLEXITY;
}

/**
 * @param {string} value
 * @returns {string}
 */
function capitalizeSentence(value) {
  if (!value) {
    return '';
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * @param {string} text
 * @returns {string}
 */
function formatFallbackTitle(text) {
  const firstLine =
    text
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? '';
  const title = text
    ? firstLine
        .replace(/^\s*["']?/, '')
        .replace(/\b(?:i'll|i will|we'll|we will|let's|let me|i can)\s+/i, '')
        .replace(/[.!?]+$/g, '')
        .trim()
    : '';

  if (!title) {
    return 'Anchor commitment';
  }

  return title.charAt(0).toUpperCase() + title.slice(1);
}
