import type { ToolLogEntry } from '@protolab/schema';

export const MAX_SAVED_REVIEW_BYTES = 8000;
type Issue = { message: string; suggestion?: string; instanceIds?: string[] };

function compact(value: string, limit: number) {
  let out = '', count = 0;
  for (const character of value.trim()) {
    if (count++ === limit) return out + '…';
    out += character;
  }
  return out;
}

/** Historical repair hints only. A later pass, unavailable review or malformed record supersedes an older failure. */
export function savedFailedReviewContext(log: readonly ToolLogEntry[]): string | undefined {
  let entry: ToolLogEntry | undefined;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].tool === 'review_design') { entry = log[i]; break; }
  }
  if (!entry || entry.ok !== false || !entry.args || typeof entry.args !== 'object' || Array.isArray(entry.args)) return;
  const review = entry.args as Record<string, unknown>;
  if (review.passed !== false || review.retryable !== false || typeof review.summary !== 'string' || !review.summary.trim()
    || !Array.isArray(review.issues) || !review.issues.length) return;
  const issues: Issue[] = [];
  for (const value of review.issues.slice(0, 8)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const issue = value as Record<string, unknown>;
    if (typeof issue.message !== 'string' || !issue.message.trim()
      || issue.suggestion !== undefined && (typeof issue.suggestion !== 'string' || !issue.suggestion.trim())
      || issue.instanceIds !== undefined && (!Array.isArray(issue.instanceIds)
        || issue.instanceIds.some((id) => typeof id !== 'string' || !id.length || id.length > 128))) return;
    issues.push({ message: issue.message, ...(issue.suggestion ? { suggestion: issue.suggestion as string } : {}),
      ...(issue.instanceIds ? { instanceIds: issue.instanceIds as string[] } : {}) });
  }
  // Compact fields before serialization, including Unicode/JSON escaping in the byte limit.
  // Never slice serialized JSON or truncate an instance ID into a different identifier.
  for (const [summaryLimit, messageLimit, suggestionLimit, idLimit] of [
    [800, 800, 500, 32], [500, 500, 250, 8], [250, 250, 100, 4], [100, 80, 0, 0],
  ]) {
    let truncated = review.issues.length > issues.length;
    const summary = compact(review.summary, summaryLimit);
    truncated ||= summary !== review.summary.trim();
    const compactIssues = issues.map((issue) => {
      const message = compact(issue.message, messageLimit);
      const suggestion = suggestionLimit && issue.suggestion ? compact(issue.suggestion, suggestionLimit) : undefined;
      const instanceIds = issue.instanceIds?.slice(0, idLimit);
      truncated ||= message !== issue.message.trim() || suggestion !== issue.suggestion?.trim()
        || (instanceIds?.length ?? 0) !== (issue.instanceIds?.length ?? 0);
      return { message, ...(suggestion ? { suggestion } : {}), ...(instanceIds?.length ? { instanceIds } : {}) };
    });
    const json = JSON.stringify({ summary, issues: compactIssues, truncated });
    if (Buffer.byteLength(json, 'utf8') <= MAX_SAVED_REVIEW_BYTES) return json;
  }
}
