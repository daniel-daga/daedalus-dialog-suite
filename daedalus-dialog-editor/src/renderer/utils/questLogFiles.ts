/**
 * Quest log file helpers (issue #114): registering a "Create Topic" quest in
 * the project's external log files — the TOPIC_/MIS_ declarations in the LOG
 * constants file and the B_CloseTopic call inside the B_CloseTopics function.
 */

import type { SemanticModel } from '../types/global';
import type { ParsedFileCache } from '../store/projectStore';
import { sanitizeDaedalusString } from './pathAndIdentifierUtils';

/** `TOPIC_DalvinsSpitzhacken` → `DalvinsSpitzhacken` */
export function topicBaseName(topicName: string): string {
  return topicName.replace(/^TOPIC_/i, '');
}

export function buildTopicDeclarationBlock(topicName: string, title: string): string {
  const base = topicBaseName(topicName);
  const safeTitle = sanitizeDaedalusString(title);
  return `\n// Quest: ${safeTitle}\nconst string TOPIC_${base} = "${safeTitle}";\nvar int MIS_${base};\n`;
}

export function buildCloseTopicLine(topicName: string, chapterStart: number, chapterEnd: number): string {
  const base = topicBaseName(topicName);
  return `\tB_CloseTopic (TOPIC_${base}, MIS_${base}, ${chapterStart}, ${chapterEnd});`;
}

/**
 * Insert `callLine` at the end of the body of the file's B_CloseTopics…
 * function (before its closing brace). Nested blocks are handled by brace
 * matching. Throws when the file contains no such function.
 */
export function insertIntoCloseTopicsFunction(content: string, callLine: string): string {
  const fnMatch = content.match(/func\s+void\s+B_CloseTopics\w*\s*\(\s*\)/i);
  if (!fnMatch || fnMatch.index === undefined) {
    throw new Error('No B_CloseTopics function found in the target file.');
  }

  const bodyStart = content.indexOf('{', fnMatch.index + fnMatch[0].length);
  if (bodyStart < 0) {
    throw new Error('No B_CloseTopics function body found in the target file.');
  }

  let depth = 0;
  for (let i = bodyStart; i < content.length; i++) {
    const char = content[i];
    // Braces inside string literals and comments don't count
    if (char === '"') {
      const close = content.indexOf('"', i + 1);
      if (close < 0) break;
      i = close;
    } else if (char === '/' && content[i + 1] === '/') {
      const eol = content.indexOf('\n', i);
      if (eol < 0) break;
      i = eol;
    } else if (char === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 1;
    } else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        const lineStart = content.lastIndexOf('\n', i) + 1;
        if (/^\s*$/.test(content.slice(lineStart, i))) {
          // Closing brace on its own line: insert the call above it
          return `${content.slice(0, lineStart)}${callLine}\n${content.slice(lineStart)}`;
        }
        // Closing brace shares its line with body content: insert before it
        return `${content.slice(0, i)}\n${callLine}\n${content.slice(i)}`;
      }
    }
  }

  throw new Error('Unbalanced braces in the B_CloseTopics function.');
}

/**
 * Files that declare TOPIC_ constants, most-used first — the natural home
 * for new quest declarations (e.g. LOG_Constants_<project>.d).
 */
export function suggestTopicConstantFiles(model: SemanticModel): string[] {
  const counts = new Map<string, number>();
  for (const constant of Object.values(model.constants || {})) {
    if (constant.name?.toUpperCase().startsWith('TOPIC_') && constant.filePath) {
      counts.set(constant.filePath, (counts.get(constant.filePath) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([filePath]) => filePath);
}

/**
 * Files containing a B_CloseTopics… function (or B_CloseTopic calls) — the
 * target for the chapter-gated close call (e.g. B_CloseTopics<project>.d).
 */
export function suggestCloseTopicsFiles(parsedFiles: Map<string, ParsedFileCache>): string[] {
  const results: string[] = [];
  for (const [filePath, cache] of parsedFiles.entries()) {
    const functions = Object.values(cache.semanticModel?.functions || {});
    const matches = functions.some((fn) =>
      fn.name?.toUpperCase().startsWith('B_CLOSETOPICS') ||
      (fn.calls || []).some((call) => String(call).toUpperCase() === 'B_CLOSETOPIC')
    );
    if (matches) results.push(filePath);
  }
  return results;
}
