import {
  MarkdownPostProcessorContext,
  Plugin,
  editorInfoField,
  normalizePath,
  setIcon,
} from "obsidian";
import { syntaxTree } from "@codemirror/language";
import { Range, StateEffect } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  PhraseInfo,
  findClozes,
  isDoneTodo,
  leadingIndent,
  normalizeQuestion,
  parseAtomLine,
  parseChoice,
  parseSidecar,
  separatorIn,
} from "./parse";

// Saved phrases from the Atomus app: audio and source per note, read from the
// hidden `.threads` folder and refreshed when its modified time changes.
class PhraseIndex {
  private cache = new Map<string, { mtime: number; phrases: Map<string, PhraseInfo> }>();

  constructor(private readonly plugin: AtomusPlugin) {}

  get(notePath: string): Map<string, PhraseInfo> | undefined {
    return this.cache.get(notePath)?.phrases;
  }

  async refresh(notePath: string): Promise<boolean> {
    const adapter = this.plugin.app.vault.adapter;
    const name = notePath.split("/").pop() ?? notePath;
    const path = normalizePath(`.threads/${name}`);
    const cached = this.cache.get(notePath);
    const stat = await adapter.stat(path).catch(() => null);
    if (!stat) {
      if (!cached) return false;
      this.cache.delete(notePath);
      return true;
    }
    if (cached && cached.mtime === stat.mtime) return false;
    const text = await adapter.read(path);
    this.cache.set(notePath, { mtime: stat.mtime, phrases: parseSidecar(text) });
    return true;
  }
}

function playButton(plugin: AtomusPlugin, info: PhraseInfo): HTMLElement {
  const button = createEl("button", {
    cls: "atomus-play clickable-icon",
    attr: { type: "button", "aria-label": info.source ? `Play · ${info.source}` : "Play" },
  });
  setIcon(button, "volume-2");
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (info.audio) plugin.play(info.audio);
  });
  return button;
}

class ArrowWidget extends WidgetType {
  constructor(private readonly glyph: string) {
    super();
  }
  toDOM(): HTMLElement {
    return createSpan({ cls: "atomus-arrow-widget", text: this.glyph });
  }
  eq(other: WidgetType): boolean {
    return other instanceof ArrowWidget && other.glyph === this.glyph;
  }
}

class ClozePillWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }
  toDOM(): HTMLElement {
    return createSpan({ cls: "atomus-cloze-pill", text: this.text });
  }
  eq(other: WidgetType): boolean {
    return other instanceof ClozePillWidget && other.text === this.text;
  }
}

class ChoiceWidget extends WidgetType {
  constructor(private readonly correct: boolean) {
    super();
  }
  toDOM(): HTMLElement {
    return createSpan({
      cls: this.correct ? "atomus-mc-correct" : "atomus-mc-wrong",
      text: this.correct ? "●" : "○",
    });
  }
  eq(other: WidgetType): boolean {
    return other instanceof ChoiceWidget && other.correct === this.correct;
  }
}

class PlayWidget extends WidgetType {
  constructor(private readonly plugin: AtomusPlugin, private readonly info: PhraseInfo) {
    super();
  }
  toDOM(): HTMLElement {
    return playButton(this.plugin, this.info);
  }
  eq(other: WidgetType): boolean {
    return other instanceof PlayWidget && other.info.audio === this.info.audio;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const SKIPPED_NODE = /codeblock|inline-code|frontmatter|math|comment/i;

function skippedRanges(view: EditorView): [number, number][] {
  const ranges: [number, number][] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (!SKIPPED_NODE.test(node.name)) return;
        ranges.push([node.from, node.to]);
        return false;
      },
    });
  }
  return ranges;
}

function overlaps(ranges: [number, number][], from: number, to: number): boolean {
  return ranges.some(([a, b]) => from < b && to > a);
}

function covers(ranges: [number, number][], from: number, to: number): boolean {
  return ranges.some(([a, b]) => a <= from && b >= to);
}

function buildDecorations(view: EditorView, plugin: AtomusPlugin): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const doc = view.state.doc;
  const head = view.state.selection.main.head;
  const skipped = skippedRanges(view);
  const file = view.state.field(editorInfoField, false)?.file;
  const phrases = file ? plugin.phrases.get(file.path) : undefined;

  const addClozes = (text: string, start: number, reveal: boolean, within?: [number, number]) => {
    for (const cloze of findClozes(text)) {
      if (within && (cloze.from < within[0] || cloze.to > within[1])) continue;
      const from = start + cloze.from;
      const to = start + cloze.to;
      if (overlaps(skipped, from, to)) continue;
      decos.push(
        reveal
          ? Decoration.mark({ class: "atomus-cloze" }).range(from, to)
          : Decoration.replace({ widget: new ClozePillWidget(cloze.text) }).range(from, to)
      );
    }
  };

  for (const { from, to } of view.visibleRanges) {
    let multilineIndent: number | null = null;
    let doneIndent: number | null = null;

    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
      const line = doc.line(n);
      const text = line.text;
      const start = line.from;
      const trimmed = text.trim();
      const indent = leadingIndent(text);
      const reveal = head >= line.from && head <= line.to;

      if (!trimmed) {
        multilineIndent = null;
        doneIndent = null;
        continue;
      }
      if (covers(skipped, line.from, line.to)) continue;

      if (isDoneTodo(text)) {
        doneIndent = indent;
      } else if (doneIndent !== null) {
        if (indent > doneIndent) {
          decos.push(Decoration.mark({ class: "atomus-done-child" }).range(line.from, line.to));
        } else {
          doneIndent = null;
        }
      }

      if (multilineIndent !== null && indent <= multilineIndent) multilineIndent = null;

      const atom = parseAtomLine(text);
      if (atom && !overlaps(skipped, start + atom.separator[0], start + atom.separator[1])) {
        const [qFrom, qTo] = atom.question;
        const [sFrom, sTo] = atom.separator;
        decos.push(Decoration.mark({ class: "atomus-question" }).range(start + qFrom, start + qTo));
        decos.push(
          reveal
            ? Decoration.mark({ class: "atomus-separator" }).range(start + sFrom, start + sTo)
            : Decoration.replace({
                widget: new ArrowWidget(atom.kind === "qa" ? atom.glyph : "↓"),
              }).range(start + sFrom, start + sTo)
        );
        addClozes(text, start, reveal, atom.question);
        if (atom.kind === "qa") {
          decos.push(Decoration.mark({ class: "atomus-answer" }).range(start + atom.answer[0], start + atom.answer[1]));
          const info = phrases?.get(normalizeQuestion(atom.questionText));
          if (info?.audio) {
            decos.push(Decoration.widget({ widget: new PlayWidget(plugin, info), side: 1 }).range(line.to));
          }
          multilineIndent = null;
        } else {
          multilineIndent = indent;
        }
        continue;
      }

      if (multilineIndent !== null) {
        const choice = parseChoice(text);
        if (choice) {
          const markerFrom = start + choice.from;
          const markerTo = markerFrom + 3;
          decos.push(
            reveal
              ? Decoration.mark({ class: choice.correct ? "atomus-mc-correct-raw" : "atomus-mc-wrong-raw" }).range(markerFrom, markerTo)
              : Decoration.replace({ widget: new ChoiceWidget(choice.correct) }).range(markerFrom, markerTo)
          );
          decos.push(
            Decoration.mark({
              class: choice.correct ? "atomus-answer atomus-mc-correct-text" : "atomus-answer",
            }).range(markerTo + 1, line.to)
          );
        } else {
          decos.push(Decoration.mark({ class: "atomus-multiline-child" }).range(line.from, line.to));
        }
        continue;
      }

      addClozes(text, start, reveal);
    }
  }

  return Decoration.set(decos, true);
}

const refreshPhrases = StateEffect.define<null>();

function editorExtension(plugin: AtomusPlugin) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private notePath: string | undefined;
      private timer: number | undefined;
      private destroyed = false;

      constructor(private readonly view: EditorView) {
        this.decorations = buildDecorations(view, plugin);
        this.syncPhrases();
      }

      update(update: ViewUpdate) {
        const path = update.state.field(editorInfoField, false)?.file?.path;
        if (path !== this.notePath) {
          this.syncPhrases();
        } else if (update.docChanged) {
          window.clearTimeout(this.timer);
          this.timer = window.setTimeout(() => this.syncPhrases(), 800);
        }
        const refreshed = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshPhrases)));
        if (update.docChanged || update.viewportChanged || update.selectionSet || refreshed || path !== this.notePath) {
          this.decorations = buildDecorations(update.view, plugin);
        }
        this.notePath = path;
      }

      destroy() {
        this.destroyed = true;
        window.clearTimeout(this.timer);
      }

      private syncPhrases() {
        const path = this.view.state.field(editorInfoField, false)?.file?.path;
        if (!path) return;
        plugin.phrases
          .refresh(path)
          .then((changed) => {
            if (changed && !this.destroyed) this.view.dispatch({ effects: refreshPhrases.of(null) });
          })
          .catch(() => {});
      }
    },
    { decorations: (v) => v.decorations }
  );
}

// Reading view

function isListElement(node: Node): boolean {
  return node.instanceOf(HTMLElement) && (node.tagName === "UL" || node.tagName === "OL");
}

function decorateAtom(container: HTMLElement): boolean {
  const children = Array.from(container.childNodes);
  let sepIndex = -1;
  let sep: ReturnType<typeof separatorIn> = null;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (isListElement(node)) break;
    if (node.nodeType !== Node.TEXT_NODE) continue;
    sep = separatorIn(node.textContent ?? "");
    if (sep) {
      sepIndex = i;
      break;
    }
  }
  if (!sep) return false;

  const sepNode = children[sepIndex];
  const text = sepNode.textContent ?? "";
  const before = text.slice(0, sep.index).trimEnd();
  const after = text.slice(sep.index + sep.length).trimStart();
  const questionText =
    children.slice(0, sepIndex).map((n) => n.textContent ?? "").join("") + before;
  if (!questionText.trim()) return false;

  const question = createSpan({ cls: "atomus-question" });
  children.slice(0, sepIndex).forEach((n) => question.appendChild(n));
  if (before) question.appendText(before);

  const answer = createSpan({ cls: "atomus-answer" });
  if (after) answer.appendText(after);
  let i = sepIndex + 1;
  for (; i < children.length && !isListElement(children[i]); i++) answer.appendChild(children[i]);
  const hasAnswer = (answer.textContent ?? "").trim().length > 0;

  const arrow = createSpan({ cls: "atomus-arrow-widget", text: hasAnswer ? sep.glyph : "↓" });
  container.insertBefore(question, sepNode);
  container.insertBefore(container.doc.createTextNode(" "), sepNode);
  container.insertBefore(arrow, sepNode);
  if (hasAnswer) {
    container.insertBefore(container.doc.createTextNode(" "), sepNode);
    container.insertBefore(answer, sepNode);
  } else if (i < children.length) {
    (children[i] as HTMLElement).addClass("atomus-multiline-answer");
  }
  sepNode.remove();
  container.dataset.atomusQuestion = questionText.trim();
  return true;
}

function splitLines(p: HTMLElement): Node[][] {
  const lines: Node[][] = [[]];
  for (const node of Array.from(p.childNodes)) {
    if (node.instanceOf(HTMLElement) && node.tagName === "BR") lines.push([]);
    else lines[lines.length - 1].push(node);
  }
  return lines;
}

function renderChoice(container: HTMLElement, text: string): boolean {
  const choice = parseChoice(text);
  if (!choice) return false;
  container.empty();
  container.createSpan({
    cls: choice.correct ? "atomus-mc-correct" : "atomus-mc-wrong",
    text: choice.correct ? "●" : "○",
  });
  container.createSpan({
    cls: choice.correct ? "atomus-answer atomus-mc-correct-text" : "atomus-answer",
    text: " " + choice.rest,
  });
  return true;
}

function processParagraph(p: HTMLElement) {
  const lines = splitLines(p);
  const first = lines[0].map((n) => n.textContent ?? "").join("");
  const multiline = parseAtomLine(first.trim());

  if (multiline?.kind === "multiline" && lines.length > 1) {
    const wrapper = createSpan();
    lines[0].forEach((n) => wrapper.appendChild(n));
    p.empty();
    p.appendChild(wrapper);
    decorateAtom(wrapper);
    const box = p.createDiv({ cls: "atomus-multiline-answer" });
    for (const line of lines.slice(1)) {
      const text = line.map((n) => n.textContent ?? "").join("").trim();
      if (!text) continue;
      const row = box.createDiv({ cls: "atomus-multiline-line" });
      if (!renderChoice(row, text)) row.createSpan({ cls: "atomus-multiline-child", text });
    }
    return;
  }

  if (lines.length === 1) {
    decorateAtom(p);
    return;
  }

  p.empty();
  lines.forEach((line, index) => {
    const row = p.createSpan({ cls: "atomus-line" });
    line.forEach((n) => row.appendChild(n));
    decorateAtom(row);
    if (index < lines.length - 1) p.createEl("br");
  });
}

function processClozes(el: HTMLElement) {
  const walker = el.doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("code, pre")) continue;
    if ((node.textContent ?? "").includes("{{")) textNodes.push(node as Text);
  }
  for (const node of textNodes) {
    const value = node.textContent ?? "";
    const clozes = findClozes(value);
    if (!clozes.length) continue;
    const frag = createFragment();
    let last = 0;
    for (const cloze of clozes) {
      if (cloze.from > last) frag.appendText(value.slice(last, cloze.from));
      frag.appendChild(createSpan({ cls: "atomus-cloze-pill", text: cloze.text }));
      last = cloze.to;
    }
    if (last < value.length) frag.appendText(value.slice(last));
    node.replaceWith(frag);
  }
}

function processReadingView(el: HTMLElement) {
  for (const p of Array.from(el.querySelectorAll("p"))) {
    if (p.closest("pre, code")) continue;
    processParagraph(p);
  }
  for (const li of Array.from(el.querySelectorAll("li"))) {
    if (li.dataset.atomusQuestion) continue;
    if (decorateAtom(li)) continue;
    const text = (li.textContent ?? "").trim();
    if (!li.querySelector("ul, ol, p")) renderChoice(li, text);
  }
  processClozes(el);
}

export default class AtomusPlugin extends Plugin {
  phrases = new PhraseIndex(this);
  private audio: HTMLAudioElement | null = null;

  onload() {
    this.registerEditorExtension(editorExtension(this));
    this.registerMarkdownPostProcessor((el, ctx) => this.renderReadingView(el, ctx));
  }

  onunload() {
    this.audio?.pause();
  }

  play(path: string) {
    this.audio?.pause();
    this.audio = new Audio(this.app.vault.adapter.getResourcePath(normalizePath(path)));
    this.audio.play().catch(() => {});
  }

  private async renderReadingView(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    processReadingView(el);
    const atoms = Array.from(el.querySelectorAll<HTMLElement>("[data-atomus-question]"));
    if (!atoms.length) return;
    await this.phrases.refresh(ctx.sourcePath).catch(() => false);
    const phrases = this.phrases.get(ctx.sourcePath);
    if (!phrases) return;
    for (const atom of atoms) {
      const info = phrases.get(normalizeQuestion(atom.dataset.atomusQuestion ?? ""));
      if (info?.audio && !atom.querySelector(".atomus-play")) atom.appendChild(playButton(this, info));
    }
  }
}
