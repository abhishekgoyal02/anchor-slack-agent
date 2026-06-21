const COMMITMENT_PATTERNS = [
    /\bi'll\b/i,
    /\bi will\b/i,
    /\blet me\b/i,
    /\bi can handle\b/i,
    /\bi can take\b/i,
    /\bi'll handle\b/i,
    /\bi'll fix\b/i,
    /\bi'll finish\b/i,
    /\bi'll complete\b/i,
    /\bi'll submit\b/i,
    /\bi'll review\b/i,
    /\bi'll create\b/i,
    /\bi'll push\b/i,
    /\bi'll deploy\b/i,
    /\bi'll update\b/i,
  ];
  
  /**
   * Detect whether a message likely contains a commitment.
   * @param {string} text
   * @returns {boolean}
   */
  export function detectCommitment(text) {
    if (!text || typeof text !== 'string') {
      return false;
    }
  
    return COMMITMENT_PATTERNS.some((pattern) => pattern.test(text));
  }