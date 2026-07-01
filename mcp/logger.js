const noop = () => {};

/**
 * @typedef {{
 *   debug: (message: string, context?: Record<string, unknown>) => void,
 *   info: (message: string, context?: Record<string, unknown>) => void,
 *   warn: (message: string, context?: Record<string, unknown>) => void,
 *   error: (message: string, context?: Record<string, unknown>) => void,
 * }} McpLogger
 */

/** @type {McpLogger} */
export const silentMcpLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};
