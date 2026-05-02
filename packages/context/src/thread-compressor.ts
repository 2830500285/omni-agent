import { createHash } from "node:crypto";

export interface ThreadMessage {
  readonly role: "assistant" | "system" | "user";
  readonly text: string;
  readonly createdAt: string;
}

export interface StructuredThreadHandoff {
  readonly activeTask: string;
  readonly resolved: string[];
  readonly pending: string[];
  readonly filesChanged: string[];
  readonly verificationStatus: string;
  readonly openRisks: string[];
}

export interface ToolObservationLike {
  readonly toolName: string;
  readonly ok: boolean;
  readonly summary: string;
  readonly details?: string;
}

export interface ThreadSummarySnapshot {
  readonly summary: string;
  readonly summaryVersion: number;
  readonly summaryHash: string;
  readonly handoff: StructuredThreadHandoff | null;
}

interface ThreadSummaryOptions {
  readonly limit?: number;
  readonly maxChars?: number;
  readonly maxCharsPerMessage?: number;
  readonly previousSummary?: string | null;
  readonly previousSummaryMaxChars?: number;
}

interface ToolObservationCompactionOptions {
  readonly triggerCount?: number;
  readonly maxTotalChars?: number;
}

interface HistoricalThreadNote {
  readonly category: "assistant-tool" | "assistant-update" | "system" | "user";
  readonly text: string;
}

const DEFAULT_THREAD_SUMMARY_LIMIT = 6;
const DEFAULT_THREAD_SUMMARY_MAX_CHARS = 2_400;
const DEFAULT_THREAD_SUMMARY_MAX_CHARS_PER_MESSAGE = 320;
const DEFAULT_PREVIOUS_THREAD_SUMMARY_MAX_CHARS = 900;
const DEFAULT_THREAD_COMPRESSION_TRIGGER_MESSAGES = 9;
const DEFAULT_THREAD_COMPRESSION_TRIGGER_CHARS = 1_900;
const DEFAULT_THREAD_HEAD_PROTECTION_COUNT = 2;
const DEFAULT_THREAD_TAIL_MIN_MESSAGES = 3;
const DEFAULT_THREAD_TAIL_BUDGET_RATIO = 0.32;
const DEFAULT_THREAD_TAIL_MIN_CHARS = 560;
const DEFAULT_THREAD_TAIL_MAX_CHARS = 1_200;
const DEFAULT_THREAD_TAIL_SOFT_CEILING_RATIO = 1.25;
const DEFAULT_THREAD_MIDDLE_NOTE_LIMIT = 5;
const DEFAULT_THREAD_MIDDLE_NOTE_MAX_CHARS = 180;
const DEFAULT_THREAD_MIDDLE_NOTE_MAX_LIMIT = 8;
const DEFAULT_THREAD_SUMMARY_VERSION = 1;
const DEFAULT_TOOL_OBSERVATION_TRIGGER_COUNT = 8;
const DEFAULT_TOOL_OBSERVATION_MAX_TOTAL_CHARS = 4_000;
const DEFAULT_TOOL_OBSERVATION_HEAD_PROTECTION_COUNT = 1;
const DEFAULT_TOOL_OBSERVATION_TAIL_PROTECTION_COUNT = 4;
const DEFAULT_TOOL_OBSERVATION_SUMMARY_MAX_CHARS = 220;
const DEFAULT_TOOL_OBSERVATION_AGED_SUMMARY_MAX_CHARS = 140;
const DEFAULT_TOOL_OBSERVATION_DETAIL_MAX_CHARS = 900;
const DEFAULT_TOOL_OBSERVATION_REDUCED_DETAIL_MAX_CHARS = 280;
const STRUCTURED_THREAD_SUMMARY_HEADINGS = [
  "## Active Task",
  "## Resolved",
  "## Pending",
  "## Files Changed",
  "## Verification Status",
  "## Open Risks",
];
const STRUCTURED_THREAD_SUMMARY_SECTION_LIMITS = new Map<string, number>([
  ["## Active Task", 220],
  ["## Resolved", 220],
  ["## Pending", 220],
  ["## Files Changed", 180],
  ["## Verification Status", 180],
  ["## Open Risks", 180],
]);

export function summarizeThread(
  messages: ThreadMessage[],
  options: number | ThreadSummaryOptions = DEFAULT_THREAD_SUMMARY_LIMIT,
): string {
  const settings = typeof options === "number" ? { limit: options } : options;
  const maxChars = Math.max(256, Math.trunc(settings.maxChars ?? DEFAULT_THREAD_SUMMARY_MAX_CHARS));
  const maxCharsPerMessage = Math.max(64, Math.trunc(settings.maxCharsPerMessage ?? DEFAULT_THREAD_SUMMARY_MAX_CHARS_PER_MESSAGE));
  const previousSummary = compactPreviousThreadSummary(
    settings.previousSummary ?? "",
    Math.min(maxChars, Math.max(128, Math.trunc(settings.previousSummaryMaxChars ?? DEFAULT_PREVIOUS_THREAD_SUMMARY_MAX_CHARS))),
  );
  const totalThreadChars = messages.reduce((sum, message) => sum + message.text.length, 0);
  if (
    messages.length > DEFAULT_THREAD_COMPRESSION_TRIGGER_MESSAGES ||
    totalThreadChars > DEFAULT_THREAD_COMPRESSION_TRIGGER_CHARS
  ) {
    return summarizeCompressedThreadHistory(messages, {
      previousSummary,
      maxChars,
      maxCharsPerMessage,
    });
  }

  const limit = Math.max(1, Math.trunc(settings.limit ?? DEFAULT_THREAD_SUMMARY_LIMIT));
  const recent = messages.slice(-limit).map((message) => `[${message.role}] ${trimPreview(message.text, maxCharsPerMessage)}`);
  const selected: string[] = [];
  let omittedCount = Math.max(0, messages.length - recent.length);
  const reservedChars = previousSummary.length > 0 ? previousSummary.length + "Prior thread summary:\n\n".length : 0;
  let remainingChars = Math.max(64, maxChars - reservedChars);

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const candidate = recent[index] ?? "";
    const separatorChars = selected.length === 0 ? 0 : 1;
    if (candidate.length + separatorChars > remainingChars) {
      if (selected.length === 0) {
        selected.unshift(trimPreview(candidate, remainingChars));
        omittedCount += index;
      } else {
        omittedCount += index + 1;
      }
      break;
    }
    selected.unshift(candidate);
    remainingChars -= candidate.length + separatorChars;
  }

  const sections: string[] = [];
  if (previousSummary.length > 0) {
    sections.push(`Structured thread handoff:\n${previousSummary}`);
  }
  if (omittedCount > 0) {
    sections.push(`Earlier thread history compacted: ${omittedCount} older message(s) omitted.`);
  }
  if (selected.length > 0) {
    sections.push(selected.join("\n"));
  }

  if (sections.length === 0) {
    return "No prior thread history.";
  }
  return trimPreview(sections.join("\n\n"), maxChars);
}

export function mergeThreadHandoffSummaries(
  previousSummary: string | null | undefined,
  latestSummary: string,
  maxChars = 1_200,
): string {
  const latest = parseStructuredThreadHandoff(latestSummary);
  if (!latest) {
    return compactPreviousThreadSummary(latestSummary, maxChars);
  }

  const previous = parseStructuredThreadHandoff(previousSummary ?? "");
  if (!previous) {
    return compactPreviousThreadSummary(renderStructuredThreadHandoff(latest), maxChars);
  }

  const merged: StructuredThreadHandoff = {
    activeTask: latest.activeTask || previous.activeTask,
    resolved: mergeThreadHandoffItems(latest.resolved, previous.resolved, 8),
    pending: mergePendingThreadHandoffItems(latest.pending, previous.pending, latest.resolved, 6),
    filesChanged: mergeThreadHandoffItems(latest.filesChanged, previous.filesChanged, 8),
    verificationStatus: latest.verificationStatus || previous.verificationStatus,
    openRisks: mergeOpenRiskThreadHandoffItems(latest.openRisks, previous.openRisks, latest.verificationStatus, 6),
  };
  return compactPreviousThreadSummary(renderStructuredThreadHandoff(merged), maxChars);
}

export function createThreadSummarySnapshot(summary: string): ThreadSummarySnapshot {
  const normalizedSummary = summary.replace(/\r\n/g, "\n").trim();
  return {
    summary: normalizedSummary,
    summaryVersion: DEFAULT_THREAD_SUMMARY_VERSION,
    summaryHash: createHash("sha256").update(normalizedSummary).digest("hex"),
    handoff: parseStructuredThreadHandoff(normalizedSummary),
  };
}

export function compactToolObservationsForModel<T extends ToolObservationLike>(
  observations: readonly T[],
  options: ToolObservationCompactionOptions = {},
): T[] {
  if (observations.length === 0) {
    return [];
  }
  if (observations.some((observation) => shouldBypassCompaction(observation))) {
    return observations.map((observation) => ({ ...observation }));
  }

  const triggerCount = Math.max(1, Math.trunc(options.triggerCount ?? DEFAULT_TOOL_OBSERVATION_TRIGGER_COUNT));
  const maxTotalChars = Math.max(512, Math.trunc(options.maxTotalChars ?? DEFAULT_TOOL_OBSERVATION_MAX_TOTAL_CHARS));
  const totalChars = observations.reduce((sum, observation) => {
    return sum + observation.toolName.length + observation.summary.length + (observation.details?.length ?? 0);
  }, 0);
  if (observations.length <= triggerCount && totalChars <= maxTotalChars) {
    return observations.map((observation) => ({ ...observation }));
  }

  const headLimit = Math.min(DEFAULT_TOOL_OBSERVATION_HEAD_PROTECTION_COUNT, observations.length);
  const tailLimit = Math.min(DEFAULT_TOOL_OBSERVATION_TAIL_PROTECTION_COUNT, Math.max(0, observations.length - headLimit));
  const protectedIndexes = new Set<number>();

  for (let index = 0; index < headLimit; index += 1) {
    protectedIndexes.add(index);
  }
  for (let index = Math.max(headLimit, observations.length - tailLimit); index < observations.length; index += 1) {
    protectedIndexes.add(index);
  }
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const observation = observations[index] as T;
    if (!observation.ok || shouldProtectToolObservation(observation.toolName)) {
      protectedIndexes.add(index);
    }
  }

  const compacted = observations.map((observation, index) =>
    compactSingleToolObservation(observation, {
      preserveDetails: protectedIndexes.has(index),
    }),
  );

  let remainingBudget = maxTotalChars;
  const budgeted = compacted.map((observation, index) => {
    const target = budgetToolObservation(observation, remainingBudget, {
      preserveDetails: protectedIndexes.has(index),
    });
    remainingBudget -= serializedToolObservationChars(target);
    return target;
  });

  if (remainingBudget >= 0) {
    return budgeted;
  }

  return compacted.map((observation, index) =>
    protectedIndexes.has(index)
      ? budgetToolObservation(
          observation,
          DEFAULT_TOOL_OBSERVATION_REDUCED_DETAIL_MAX_CHARS + observation.summary.length + 48,
          { preserveDetails: true },
        )
      : { ...observation, details: undefined },
  );
}

export function parseStructuredThreadHandoff(value: string): StructuredThreadHandoff | null {
  const parsedSections = parseStructuredThreadSummarySections(value.replace(/\r\n/g, "\n").trim());
  if (parsedSections.length === 0) {
    return null;
  }

  const sectionMap = new Map(parsedSections.map((section) => [section.heading, section.content]));
  return {
    activeTask: trimPreview(sectionMap.get("## Active Task") ?? "", 220),
    resolved: parseThreadSummaryList(sectionMap.get("## Resolved") ?? ""),
    pending: parseThreadSummaryList(sectionMap.get("## Pending") ?? ""),
    filesChanged: parseThreadSummaryList(sectionMap.get("## Files Changed") ?? ""),
    verificationStatus: trimPreview(sectionMap.get("## Verification Status") ?? "", 220),
    openRisks: parseThreadSummaryList(sectionMap.get("## Open Risks") ?? ""),
  };
}

function summarizeCompressedThreadHistory(
  messages: readonly ThreadMessage[],
  input: {
    readonly previousSummary: string;
    readonly maxChars: number;
    readonly maxCharsPerMessage: number;
  },
): string {
  const headCount = Math.min(messages.length, DEFAULT_THREAD_HEAD_PROTECTION_COUNT);
  const tailStart = findThreadTailStart(messages, headCount, input.maxCharsPerMessage, input.maxChars);
  const head = messages.slice(0, headCount).map((message) => formatThreadMessage(message, input.maxCharsPerMessage));
  const middle = messages.slice(headCount, tailStart);
  const tail = messages.slice(tailStart).map((message) => formatThreadMessage(message, input.maxCharsPerMessage));
  const compactedNotes = summarizeCompactedMiddleMessages(middle);

  const sections: string[] = [];
  const reserveTailChars =
    tail.length > 0
      ? Math.min(
          Math.max(220, Math.trunc(input.maxChars * 0.3)),
          Math.max(220, input.maxChars - 120),
        )
      : 0;
  let remainingChars = input.maxChars;
  const appendSection = (content: string, reserveAfter = 0, trimMode: "head" | "tail" = "head"): void => {
    if (!content.trim()) {
      return;
    }
    const separatorChars = sections.length === 0 ? 0 : 2;
    const budget = remainingChars - separatorChars - Math.max(0, reserveAfter);
    if (budget < 48) {
      return;
    }
    const trimmed = (trimMode === "tail" ? trimTailMultilinePreview : trimMultilinePreview)(content, budget).content;
    sections.push(trimmed);
    remainingChars -= trimmed.length + separatorChars;
  };
  if (input.previousSummary) {
    appendSection(
      `Structured thread handoff:\n${input.previousSummary}`,
      reserveTailChars + (head.length > 0 ? 120 : 0) + (middle.length > 0 ? 140 : 0),
    );
  }
  if (head.length > 0) {
    appendSection(
      `Protected head context:\n${head.join("\n")}`,
      reserveTailChars + (middle.length > 0 ? 120 : 0),
    );
  }
  if (middle.length > 0) {
    const noteBody = compactedNotes.length > 0 ? compactedNotes.join("\n") : "- Earlier turns compacted without additional durable notes.";
    appendSection(
      `Earlier transcript compacted: ${middle.length} message(s) merged.\n${noteBody}`,
      reserveTailChars,
    );
  }
  if (tail.length > 0) {
    appendSection(`Recent tail context:\n${tail.join("\n")}`, 0, "tail");
  }
  const combined = sections.join("\n\n");
  return combined.length <= input.maxChars
    ? combined
    : trimMultilinePreview(combined, input.maxChars).content;
}

function findThreadTailStart(
  messages: readonly ThreadMessage[],
  headCount: number,
  maxCharsPerMessage: number,
  maxChars: number,
): number {
  if (messages.length <= headCount) {
    return messages.length;
  }

  const minimumTail = Math.min(DEFAULT_THREAD_TAIL_MIN_MESSAGES, Math.max(1, messages.length - headCount));
  const tailBudget = resolveThreadTailBudget(maxChars);
  let accumulatedChars = 0;
  let tailStart = messages.length;
  for (let index = messages.length - 1; index >= headCount; index -= 1) {
    const preview = formatThreadMessage(messages[index] as ThreadMessage, maxCharsPerMessage);
    const nextChars = accumulatedChars + preview.length + (tailStart === messages.length ? 0 : 1);
    if ((messages.length - index) > minimumTail && nextChars > tailBudget.softCeiling) {
      break;
    }
    accumulatedChars = nextChars;
    tailStart = index;
    if ((messages.length - index) >= minimumTail && accumulatedChars >= tailBudget.targetChars) {
      break;
    }
  }

  const lastUserIndex = findLastThreadMessageByRole(messages, "user", headCount);
  if (lastUserIndex >= 0 && lastUserIndex < tailStart) {
    tailStart = lastUserIndex;
  }
  return Math.max(headCount, tailStart);
}

function findLastThreadMessageByRole(
  messages: readonly ThreadMessage[],
  role: ThreadMessage["role"],
  startIndex: number,
): number {
  for (let index = messages.length - 1; index >= startIndex; index -= 1) {
    if ((messages[index] as ThreadMessage).role === role) {
      return index;
    }
  }
  return -1;
}

function summarizeCompactedMiddleMessages(messages: readonly ThreadMessage[]): string[] {
  if (messages.length === 0) {
    return [];
  }

  const notes = mergeHistoricalThreadNotes(
    messages
    .map((message) => summarizeHistoricalThreadMessage(message))
    .filter(Boolean) as HistoricalThreadNote[],
  );
  const noteLimit = Math.min(
    DEFAULT_THREAD_MIDDLE_NOTE_MAX_LIMIT,
    DEFAULT_THREAD_MIDDLE_NOTE_LIMIT + Math.floor(messages.length / 6),
  );

  if (notes.length <= noteLimit) {
    return prioritizeHistoricalThreadNotes(notes).map((note) => note.text);
  }

  const importantToolNotes = notes
    .filter((note) => note.category === "assistant-tool")
    .slice(-Math.min(3, noteLimit));
  const userNotes = notes.filter((note) => note.category === "user");
  const prioritizedUserNotes = [
    ...(userNotes.length > 0 ? [userNotes[0] as HistoricalThreadNote] : []),
    ...userNotes.slice(-Math.min(2, noteLimit)),
  ];
  const recentNotes = notes.slice(-noteLimit);
  const kept = new Map<string, HistoricalThreadNote>();
  for (const note of [...importantToolNotes, ...prioritizedUserNotes, ...recentNotes]) {
    kept.set(note.text, note);
  }
  const keptNotes = prioritizeHistoricalThreadNotes(Array.from(kept.values()))
    .slice(0, noteLimit)
    .map((note) => note.text);
  const omittedCount = Math.max(0, notes.length - keptNotes.length);
  return [
    ...keptNotes,
    `- ${omittedCount} earlier compacted note(s) aged out of the rolling transcript notes.`,
  ];
}

function summarizeHistoricalThreadMessage(message: ThreadMessage): HistoricalThreadNote | null {
  const normalized = message.text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  if (message.role === "assistant" && looksLikeAgedToolOutput(normalized)) {
    const lineCount = normalized.split("\n").length;
    const preview = summarizeStructuredToolLog(normalized)
      ?? trimPreview(resolveLeadThreadMessageLine(normalized) ?? normalized, DEFAULT_THREAD_MIDDLE_NOTE_MAX_CHARS);
    const structuredHint =
      /\b(stdout|stderr|exitCode|durationMs|changedFiles)\b/.test(normalized) ? " [structured fields compacted]" : "";
    return {
      category: "assistant-tool",
      text: `- Assistant tool/log output compacted: ${preview}${structuredHint} (${lineCount} lines).`,
    };
  }

  const category: HistoricalThreadNote["category"] =
    message.role === "user"
      ? "user"
      : message.role === "assistant"
        ? "assistant-update"
        : "system";
  const prefix =
    category === "user"
      ? "Prior user ask"
      : category === "assistant-update"
        ? "Assistant update"
        : "System note";
  return {
    category,
    text: `- ${prefix}: ${trimPreview(normalized, DEFAULT_THREAD_MIDDLE_NOTE_MAX_CHARS)}`,
  };
}

function looksLikeAgedToolOutput(value: string): boolean {
  const lineCount = value.split("\n").length;
  return (
    (value.length > 360 || lineCount >= 6) &&
    (lineCount >= 8 ||
      /(^|\n)\s*[{[]/.test(value) ||
      /\b(stdout|stderr|exitCode|durationMs|changedFiles|Verification:)\b/.test(value) ||
      /```/.test(value))
  );
}

function resolveLeadThreadMessageLine(value: string): string | null {
  return value
    .split("\n")
    .map((line) => line.trim())
    .find((line) => {
      if (line.length === 0) {
        return false;
      }
      const firstChar = line[0];
      return firstChar !== "{" && firstChar !== "[" && firstChar !== '"' && firstChar !== "}";
    }) ?? null;
}

function summarizeStructuredToolLog(value: string): string | null {
  const command = extractStructuredField(value, "command");
  const path = extractStructuredField(value, "path");
  const exitCode = extractNumericStructuredField(value, "exitCode");
  const stdout = extractStructuredField(value, "stdout");
  const stderr = extractStructuredField(value, "stderr");
  const changedFilesCount = extractStructuredArrayLength(value, "changedFiles");
  const isVerificationLog = /\bverification\b/i.test(value);

  const fragments: string[] = [];
  if (command) {
    fragments.push(`command \`${trimPreview(command, 72)}\``);
  } else if (path) {
    fragments.push(`path ${trimPreview(path, 72)}`);
  }
  if (typeof exitCode === "number") {
    fragments.push(`exit ${exitCode}`);
  }
  if (stderr && stderr.trim()) {
    fragments.push("stderr output");
  } else if (stdout && stdout.trim()) {
    fragments.push("stdout output");
  }
  if (typeof changedFilesCount === "number" && changedFilesCount > 0) {
    fragments.push(`${changedFilesCount} changed file(s)`);
  }
  if (fragments.length === 0 && !isVerificationLog) {
    return null;
  }
  const prefix = isVerificationLog ? "verification log" : "tool result";
  const suffix = fragments.length > 0 ? `: ${fragments.join(", ")}` : "";
  return trimPreview(`${prefix}${suffix}`, DEFAULT_THREAD_MIDDLE_NOTE_MAX_CHARS);
}

function extractStructuredField(value: string, field: string): string | null {
  const match = value.match(new RegExp(`"${escapeRegExp(field)}"\\s*:\\s*"((?:\\\\.|[^"])*)"`, "i"));
  if (!match?.[1]) {
    return null;
  }
  return unescapeStructuredString(match[1]).trim() || null;
}

function extractNumericStructuredField(value: string, field: string): number | null {
  const match = value.match(new RegExp(`"${escapeRegExp(field)}"\\s*:\\s*(-?\\d+)`, "i"));
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractStructuredArrayLength(value: string, field: string): number | null {
  const match = value.match(new RegExp(`"${escapeRegExp(field)}"\\s*:\\s*\\[(.*?)\\]`, "is"));
  if (!match?.[1]) {
    return null;
  }
  const normalized = match[1].trim();
  if (!normalized) {
    return 0;
  }
  return normalized.split(",").filter((entry) => entry.trim().length > 0).length;
}

function unescapeStructuredString(value: string): string {
  return value
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\\\/g, "\\");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergeHistoricalThreadNotes(notes: readonly HistoricalThreadNote[]): HistoricalThreadNote[] {
  if (notes.length <= 1) {
    return [...notes];
  }
  const merged = new Map<string, { note: HistoricalThreadNote; count: number; lastIndex: number }>();
  notes.forEach((note, index) => {
    const key = buildHistoricalThreadNoteKey(note);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { note, count: 1, lastIndex: index });
      return;
    }
    merged.set(key, {
      note: existing.note,
      count: existing.count + 1,
      lastIndex: index,
    });
  });

  return [...merged.values()]
    .sort((left, right) => left.lastIndex - right.lastIndex)
    .map(({ note, count }) =>
      count > 1
        ? {
            ...note,
            text: `${note.text} [repeated ${count}x in compacted span]`,
          }
        : note,
    );
}

function buildHistoricalThreadNoteKey(note: HistoricalThreadNote): string {
  if (note.category !== "assistant-tool") {
    return note.text;
  }
  return note.text
    .replace(/\s+\[structured fields compacted\]/g, "")
    .replace(/\s+\(\d+ lines\)\./g, "")
    .replace(/\s+\[repeated \d+x in compacted span\]/g, "")
    .trim();
}

function prioritizeHistoricalThreadNotes(notes: readonly HistoricalThreadNote[]): HistoricalThreadNote[] {
  const priority = (note: HistoricalThreadNote): number => {
    switch (note.category) {
      case "assistant-tool":
        return 0;
      case "user":
        return 1;
      case "assistant-update":
        return 2;
      case "system":
        return 3;
      default:
        return 4;
    }
  };
  return [...notes].sort((left, right) => priority(left) - priority(right));
}

function resolveThreadTailBudget(maxChars: number): { targetChars: number; softCeiling: number } {
  const targetChars = Math.min(
    DEFAULT_THREAD_TAIL_MAX_CHARS,
    Math.max(DEFAULT_THREAD_TAIL_MIN_CHARS, Math.trunc(maxChars * DEFAULT_THREAD_TAIL_BUDGET_RATIO)),
  );
  return {
    targetChars,
    softCeiling: Math.max(targetChars, Math.trunc(targetChars * DEFAULT_THREAD_TAIL_SOFT_CEILING_RATIO)),
  };
}

function formatThreadMessage(message: ThreadMessage, maxCharsPerMessage: number): string {
  return `[${message.role}] ${trimPreview(message.text, maxCharsPerMessage)}`;
}

function renderStructuredThreadHandoff(handoff: StructuredThreadHandoff): string {
  return [
    "## Active Task",
    handoff.activeTask || "None.",
    "",
    "## Resolved",
    formatStructuredThreadSummaryList(handoff.resolved),
    "",
    "## Pending",
    formatStructuredThreadSummaryList(handoff.pending),
    "",
    "## Files Changed",
    formatStructuredThreadSummaryList(handoff.filesChanged),
    "",
    "## Verification Status",
    handoff.verificationStatus || "not-run: No verification status recorded.",
    "",
    "## Open Risks",
    formatStructuredThreadSummaryList(handoff.openRisks),
  ].join("\n");
}

function parseThreadSummaryList(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized || /^none\.?$/i.test(normalized)) {
    return [];
  }
  return Array.from(
    new Set(
      normalized
        .split("\n")
        .map((line) => line.replace(/^\s*-\s*/, "").trim())
        .filter(Boolean),
    ),
  );
}

function formatStructuredThreadSummaryList(values: readonly string[]): string {
  if (values.length === 0) {
    return "None.";
  }
  return values.map((value) => `- ${trimPreview(value, 220)}`).join("\n");
}

function mergeThreadHandoffItems(latest: readonly string[], previous: readonly string[], limit: number): string[] {
  return Array.from(new Set([...latest, ...previous].map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function mergePendingThreadHandoffItems(
  latest: readonly string[],
  previous: readonly string[],
  latestResolved: readonly string[],
  limit: number,
): string[] {
  const resolved = new Set(latestResolved.map((value) => value.trim()));
  const latestTaskBoardItems = new Set(latest.map((value) => value.trim()).filter(isTaskBoardHandoffItem));
  const latestTaskBoardIsAuthoritative =
    latestTaskBoardItems.size > 0 || latestResolved.some((value) => /^Task board has no active items\.?$/i.test(value.trim()));
  return Array.from(
    new Set(
      [
        ...latest.map((value) => value.trim()),
        ...previous
          .map((value) => value.trim())
          .filter((value) => !latestTaskBoardIsAuthoritative || !isTaskBoardHandoffItem(value) || latestTaskBoardItems.has(value)),
      ].filter((value) => value && !resolved.has(value)),
    ),
  ).slice(0, limit);
}

function isTaskBoardHandoffItem(value: string): boolean {
  return /^Task board \[/i.test(value.trim());
}

function mergeOpenRiskThreadHandoffItems(
  latest: readonly string[],
  previous: readonly string[],
  latestVerificationStatus: string,
  limit: number,
): string[] {
  const clearVerificationRisks = /^passed\s*:/i.test(latestVerificationStatus);
  const previousRisks = clearVerificationRisks
    ? previous.filter((value) => !/\b(verification|build|test|failing change)\b/i.test(value))
    : previous;
  return Array.from(new Set([...latest, ...previousRisks].map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function parseStructuredThreadSummarySections(
  value: string,
): Array<{ heading: string; content: string }> {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  const matches = Array.from(normalized.matchAll(/^##\s+[^\n]+$/gm));
  if (matches.length === 0) {
    return [];
  }

  return matches.map((match, index) => {
    const heading = match[0]?.trim() ?? "";
    const start = match.index ?? 0;
    const contentStart = start + heading.length;
    const nextStart = matches[index + 1]?.index ?? normalized.length;
    const content = normalized.slice(contentStart, nextStart).trim();
    return {
      heading,
      content,
    };
  });
}

function compactPreviousThreadSummary(value: string, maxChars: number): string {
  const trimmed = value.replace(/\r\n/g, "\n").trim();
  if (!trimmed) {
    return "";
  }
  if (!/^##\s+/m.test(trimmed)) {
    return trimPreview(trimmed, maxChars);
  }

  const parsedSections = parseStructuredThreadSummarySections(trimmed);
  if (parsedSections.length === 0) {
    return trimPreview(trimmed, maxChars);
  }

  const sectionMap = new Map(parsedSections.map((section) => [section.heading, section.content]));
  const orderedHeadings = [
    ...STRUCTURED_THREAD_SUMMARY_HEADINGS.filter((heading) => sectionMap.has(heading)),
    ...parsedSections.map((section) => section.heading).filter((heading) => !STRUCTURED_THREAD_SUMMARY_HEADINGS.includes(heading)),
  ];

  const selected: string[] = [];
  let remainingChars = maxChars;
  let omittedCount = 0;
  for (const heading of orderedHeadings) {
    if (remainingChars <= 0) {
      omittedCount += 1;
      continue;
    }
    const content = sectionMap.get(heading)?.trim() || "None.";
    const sectionLimit = STRUCTURED_THREAD_SUMMARY_SECTION_LIMITS.get(heading) ?? 180;
    const headingPrefix = `${heading}\n`;
    const budget = Math.max(48, Math.min(sectionLimit, remainingChars - headingPrefix.length));
    if (budget <= 0) {
      omittedCount += 1;
      continue;
    }
    const trimmedContent = trimMultilinePreview(content, budget).content;
    const candidate = `${heading}\n${trimmedContent}`;
    const separatorChars = selected.length === 0 ? 0 : 2;
    if (candidate.length + separatorChars > remainingChars) {
      if (selected.length === 0) {
        selected.push(`${heading}\n${trimMultilinePreview(content, Math.max(32, remainingChars - headingPrefix.length)).content}`);
      } else {
        omittedCount += 1;
      }
      break;
    }
    selected.push(candidate);
    remainingChars -= candidate.length + separatorChars;
  }

  if (omittedCount > 0 && remainingChars > 32) {
    selected.push(`Additional handoff sections compacted: ${omittedCount} omitted.`);
  }
  return selected.join("\n\n");
}

function compactSingleToolObservation<T extends ToolObservationLike>(
  observation: T,
  input: { readonly preserveDetails: boolean },
): T {
  const trimmedSummary = trimPreview(
    observation.summary,
    input.preserveDetails ? DEFAULT_TOOL_OBSERVATION_SUMMARY_MAX_CHARS : DEFAULT_TOOL_OBSERVATION_AGED_SUMMARY_MAX_CHARS,
  );
  const compactedSummary = input.preserveDetails || !observation.details
    ? trimmedSummary
    : trimPreview(`Aged tool output compacted: ${trimmedSummary}`, DEFAULT_TOOL_OBSERVATION_AGED_SUMMARY_MAX_CHARS);
  const details = observation.details
    ? input.preserveDetails
      ? trimMultilinePreview(observation.details, DEFAULT_TOOL_OBSERVATION_DETAIL_MAX_CHARS).content
      : undefined
    : undefined;
  return {
    ...observation,
    summary: compactedSummary,
    details,
  };
}

function budgetToolObservation<T extends ToolObservationLike>(
  observation: T,
  remainingBudget: number,
  input: { readonly preserveDetails: boolean },
): T {
  if (remainingBudget <= 0) {
    return {
      ...observation,
      summary: trimPreview(observation.summary, 96),
      details: undefined,
    };
  }

  const detailsBudget = input.preserveDetails
    ? Math.min(DEFAULT_TOOL_OBSERVATION_DETAIL_MAX_CHARS, Math.max(0, remainingBudget - observation.summary.length - 48))
    : 0;
  return {
    ...observation,
    summary: trimPreview(
      observation.summary,
      input.preserveDetails ? DEFAULT_TOOL_OBSERVATION_SUMMARY_MAX_CHARS : DEFAULT_TOOL_OBSERVATION_AGED_SUMMARY_MAX_CHARS,
    ),
    details: observation.details && detailsBudget > 0 ? trimMultilinePreview(observation.details, detailsBudget).content : undefined,
  };
}

function shouldProtectToolObservation(toolName: string): boolean {
  return /^(ask_user|run_verification|spawn_subagent|wait_subagent|list_subagents|run_swarm|cancel_subagent)$/.test(toolName);
}

function shouldBypassCompaction(observation: ToolObservationLike): boolean {
  return shouldProtectToolObservation(observation.toolName) && typeof observation.details === "string" && observation.details.length > 0;
}

function serializedToolObservationChars(observation: ToolObservationLike): number {
  return observation.toolName.length + observation.summary.length + (observation.details?.length ?? 0) + 32;
}

function trimPreview(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const budget = Math.max(16, maxChars - "...[truncated]".length);
  return `${normalized.slice(0, budget).trimEnd()}...[truncated]`;
}

function trimMultilinePreview(value: string, maxChars: number): { content: string; truncated: boolean } {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) {
    return {
      content: normalized,
      truncated: false,
    };
  }
  const suffix = "\n...[truncated]";
  const budget = Math.max(32, maxChars - suffix.length);
  return {
    content: `${normalized.slice(0, budget).trimEnd()}${suffix}`,
    truncated: true,
  };
}

function trimTailMultilinePreview(value: string, maxChars: number): { content: string; truncated: boolean } {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) {
    return {
      content: normalized,
      truncated: false,
    };
  }
  const newlineIndex = normalized.indexOf("\n");
  const heading = newlineIndex >= 0 ? normalized.slice(0, newlineIndex).trimEnd() : "";
  const body = newlineIndex >= 0 ? normalized.slice(newlineIndex + 1).trim() : normalized;
  const prefix = "[...earlier tail context truncated]\n";
  const headingPrefix = heading ? `${heading}\n` : "";
  const budget = Math.max(32, maxChars - headingPrefix.length - prefix.length);
  return {
    content: `${headingPrefix}${prefix}${body.slice(-budget).trimStart()}`,
    truncated: true,
  };
}
