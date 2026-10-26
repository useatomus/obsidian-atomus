// Line parsing shared by the editor and reading view. Mirrors the Atomus app:
// `front == back` (also `==>`, `<==`, `<=>`), a front ending in `==` for a
// multi-line answer, and `{{cloze}}` gaps. The separator needs whitespace on
// both sides, so `==highlights==` stay highlights.

export const SEPARATOR_GLYPH: Record<string, string> = {
  "==": "→",
  "==>": "→",
  "<==": "←",
  "<=>": "↔",
};

const LINE_PREFIX = String.raw`(\s*(?:[-*+]\s+)?(?:\d+[.)]\s+)?(?:\[[ xX]\]\s+)?)`;
const QA_REGEX = new RegExp(`^${LINE_PREFIX}(.+?)\\s+(<=>|<==|==>|==)\\s+(\\S.*?)\\s*$`);
const MULTILINE_REGEX = new RegExp(`^${LINE_PREFIX}(.+?)\\s+(==)\\s*$`);
const CLOZE_REGEX = /\{\{((?:c\d+::)?[^}]+)\}\}/g;
const DONE_TODO_REGEX = /^\s*(?:[-*+]\s+)?\[[xX]\]/;
const MC_CHOICE_REGEX = /^(\s*(?:[-*+]\s+)?)\(([xX ])\)\s+(.+)$/;

export interface QaLine {
  kind: "qa";
  question: [number, number];
  separator: [number, number];
  glyph: string;
  answer: [number, number];
  questionText: string;
}

export interface MultilineLine {
  kind: "multiline";
  question: [number, number];
  separator: [number, number];
  questionText: string;
}

export function parseAtomLine(line: string): QaLine | MultilineLine | null {
  const qa = line.match(QA_REGEX);
  if (qa) {
    const [, prefix, question, sep, answer] = qa;
    const qStart = prefix.length;
    const qEnd = qStart + question.length;
    const sepStart = line.indexOf(sep, qEnd);
    const aStart = line.indexOf(answer, sepStart + sep.length);
    return {
      kind: "qa",
      question: [qStart, qEnd],
      separator: [sepStart, sepStart + sep.length],
      glyph: SEPARATOR_GLYPH[sep],
      answer: [aStart, aStart + answer.length],
      questionText: question,
    };
  }
  const multi = line.match(MULTILINE_REGEX);
  if (multi) {
    const [, prefix, question] = multi;
    const qStart = prefix.length;
    const qEnd = qStart + question.length;
    const sepStart = line.lastIndexOf("==");
    return {
      kind: "multiline",
      question: [qStart, qEnd],
      separator: [sepStart, sepStart + 2],
      questionText: question,
    };
  }
  return null;
}

export interface Cloze {
  from: number;
  to: number;
  text: string;
}

export function findClozes(line: string): Cloze[] {
  const result: Cloze[] = [];
  const re = new RegExp(CLOZE_REGEX.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    result.push({
      from: m.index,
      to: m.index + m[0].length,
      text: m[1].replace(/^c\d+::/, "").split("|")[0],
    });
  }
  return result;
}

export function isDoneTodo(line: string): boolean {
  return DONE_TODO_REGEX.test(line);
}

export function parseChoice(line: string): { from: number; correct: boolean; rest: string } | null {
  const m = line.match(MC_CHOICE_REGEX);
  if (!m) return null;
  return { from: m[1].length, correct: m[2].toLowerCase() === "x", rest: m[3] };
}

export function leadingIndent(line: string): number {
  return line.match(/^[\t ]*/)?.[0].length ?? 0;
}

export function separatorIn(text: string): { index: number; length: number; glyph: string } | null {
  const m = text.match(/(^|\s)(<=>|<==|==>|==)(?=\s|$)/);
  if (!m || m.index === undefined) return null;
  return { index: m.index + m[1].length, length: m[2].length, glyph: SEPARATOR_GLYPH[m[2]] };
}

// The Atomus app keeps what it knows about each saved phrase in
// `.threads/<note name>`, one `## <front>` section per atom. Capture adds an
// `[agent:capture]` entry with `[audio: <vault path> | <sentence>]` and
// `Heard in [title](url)` lines, newlines escaped as `\n`.

export interface PhraseInfo {
  audio?: string;
  source?: string;
}

export function normalizeQuestion(question: string): string {
  return question.toLowerCase().trim();
}

export function parseSidecar(text: string): Map<string, PhraseInfo> {
  const result = new Map<string, PhraseInfo>();
  let current: PhraseInfo | null = null;
  for (const line of text.split("\n")) {
    const header = line.match(/^##\s+(.+?)\s*$/);
    if (header) {
      current = {};
      result.set(normalizeQuestion(header[1]), current);
      continue;
    }
    if (!current) continue;
    const entry = line.match(/^>\s*@\S+\s+(?:\[agent:([A-Za-z0-9_-]+)\]\s*)?(.*)$/);
    if (!entry || (entry[1] && entry[1] !== "capture")) continue;
    for (const part of entry[2].split("\\n")) {
      const audio = part.match(/^\[audio:\s*([^|\]]+?)\s*(?:\|[^\]]*)?\]$/);
      if (audio && !current.audio) {
        current.audio = audio[1];
        continue;
      }
      const source = part.match(/^(?:Heard|Read) in (?:\[([^\]]+)\]\([^)]*\)|(.+))$/);
      if (source && !current.source) current.source = source[1] ?? source[2];
    }
  }
  return result;
}
