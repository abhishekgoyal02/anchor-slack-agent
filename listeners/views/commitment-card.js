import { getRandomRealityCheckMicrocopy, REALITY_CHECK_MICROCOPY } from '../../services/reality-check-service.js';

/**
 * Build a commitment confirmation card.
 * @param {string} messageText
 * @param {import('../../services/reality-check-service.js').RealityCheckAnalysis} realityCheck
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildCommitmentCard(_messageText, realityCheck) {
  const safeRealityCheck = normalizeRealityCheck(realityCheck);
  const text = [
    '🧠 *Reality Check found a commitment.*',
    `>${safeRealityCheck.originalText}`,
    `Due: ${safeRealityCheck.dueDateLabel} • ${safeRealityCheck.analysisText}`,
    safeRealityCheck.recommendationText,
    safeRealityCheck.microcopy,
  ].join('\n');

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: safeRealityCheck.primaryButtonLabel,
          },
          style: 'primary',
          action_id: 'commitment_confirm',
          value: safeRealityCheck.primaryValue,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: safeRealityCheck.secondaryButtonLabel,
          },
          action_id: 'commitment_confirm_recommended',
          value: safeRealityCheck.secondaryValue,
        },
      ],
    },
  ];
}

/**
 * Keep Slack block construction total even if Reality Check returns malformed data.
 * @param {Partial<import('../../services/reality-check-service.js').RealityCheckAnalysis> | null | undefined} realityCheck
 * @returns {import('../../services/reality-check-service.js').RealityCheckAnalysis}
 */
function normalizeRealityCheck(realityCheck) {
  return {
    title: normalizeCardText(realityCheck?.title, 'Commitment detected.'),
    originalText: normalizeCardText(realityCheck?.originalText, realityCheck?.primaryValue || 'Commitment detected.'),
    dueDateLabel: normalizeCardText(realityCheck?.dueDateLabel, 'the stated date'),
    predictedCompletionLabel: normalizeCardText(realityCheck?.predictedCompletionLabel, 'the stated date'),
    similarCount: Number.isFinite(realityCheck?.similarCount) ? Number(realityCheck?.similarCount) : 0,
    analysisText: normalizeCardText(
      realityCheck?.analysisText,
      'Based on similar task patterns, this looks reasonable.',
    ),
    recommendationText: normalizeCardText(realityCheck?.recommendationText, 'This looks very realistic.'),
    microcopy: normalizeMicrocopy(realityCheck?.microcopy),
    primaryButtonLabel: normalizeButtonText(realityCheck?.primaryButtonLabel, 'Keep Date'),
    secondaryButtonLabel: normalizeButtonText(realityCheck?.secondaryButtonLabel, 'Proceed Anyway'),
    primaryValue: normalizeButtonValue(realityCheck?.primaryValue),
    secondaryValue: normalizeButtonValue(realityCheck?.secondaryValue || realityCheck?.primaryValue),
  };
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeCardText(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || String(fallback || '');
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeButtonText(value, fallback) {
  return normalizeCardText(value, fallback).slice(0, 75);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeMicrocopy(value) {
  const text = normalizeCardText(value, '');
  if (REALITY_CHECK_MICROCOPY.includes(text) && countEmoji(text) === 1) {
    return text;
  }

  return getRandomRealityCheckMicrocopy();
}

/**
 * @param {string} text
 * @returns {number}
 */
function countEmoji(text) {
  return [...text.matchAll(/\p{Emoji_Presentation}/gu)].length;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeButtonValue(value) {
  return normalizeCardText(value, 'Commitment detected.').slice(0, 2000);
}

/**
 * Build a final commitment confirmation card.
 * @param {string} messageText
 * @param {{ issueNumber?: number, issueUrl?: string, githubError?: boolean }} [options]
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildCommitmentConfirmedCard(messageText, options = {}) {
  const details = ['*Status:* Tracked'];

  if (options.issueNumber && options.issueUrl) {
    details.push(`*GitHub Issue:* <${options.issueUrl}|#${options.issueNumber}>`);
  } else if (options.githubError) {
    details.push('GitHub issue could not be created.');
    details.push('Commitment remains stored locally.');
  }

  return buildCommitmentResultCard('⚓ *Commitment Confirmed*', messageText, details.join('\n'));
}

/**
 * Build a duplicate commitment card.
 * @param {string} messageText
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildCommitmentAlreadyTrackedCard(messageText) {
  return buildCommitmentResultCard(
    '⚠️ *Commitment Already Tracked*',
    messageText,
    'This commitment is already being tracked and does not need to be confirmed again.',
  );
}

/**
 * Build an ignored commitment card.
 * @param {string} messageText
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildCommitmentIgnoredCard(messageText) {
  return buildCommitmentResultCard('⚓ *Commitment Ignored*', messageText, 'No tracking record was created.');
}

/**
 * Build a completed commitment card.
 * @param {string} messageText
 * @param {{ issueNumber?: number, issueUrl?: string }} [options]
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildCommitmentCompletedCard(messageText, options = {}) {
  const details = ['*Status:* Completed ✅', '', 'Anchor detected that this commitment has been completed.'];

  if (options.issueNumber && options.issueUrl) {
    details.push('');
    details.push(`*GitHub Issue:* <${options.issueUrl}|#${options.issueNumber}> (Closed)`);
  }

  return buildCommitmentResultCard('✅ *Commitment Completed*', messageText, details.join('\n'));
}

/**
 * Build final-state blocks for commitment interactions.
 * @param {string} title
 * @param {string} messageText
 * @param {string} detail
 * @returns {import('@slack/types').KnownBlock[]}
 */
function buildCommitmentResultCard(title, messageText, detail) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${title}\n\n>${messageText}\n\n${detail}`,
      },
    },
  ];
}
