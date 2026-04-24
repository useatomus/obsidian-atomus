import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";

const ATOM_QA_REGEX = /^(\s*(?:[-*]\s+)?)(.+?)[\t ]*(==)[\t ]*(.+)$/;
const ATOM_QA_MULTILINE_REGEX = /^(\s*(?:[-*]\s+)?)(.+?)[\t ]*(==)\s*$/;
const CLOZE_REGEX = /\{\{((?:c\d+::)?[^}]+)\}\}/g;
const DONE_TODO_REGEX = /^\s*(?:[-*]\s+)?\[[xX]\]/;
const MC_CHOICE_REGEX = /^(\s*(?:[-*]\s+)?)\(([xX ])\)\s+(.+)$/;

function leadingIndent(line: string): number {
  const m = line.match(/^[\t ]*/);
  return m ? m[0].length : 0;
}

class ArrowWidget extends WidgetType {
  constructor(private readonly glyph: string = "→") {
    super();
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "atomus-arrow-widget";
    span.textContent = this.glyph;
    return span;
  }
  eq(other: WidgetType): boolean {
    return other instanceof ArrowWidget && (other as ArrowWidget).glyph === this.glyph;
  }
}

class ClozePillWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "atomus-cloze-pill";
    span.textContent = this.text;
    return span;
  }
  eq(other: WidgetType): boolean {
    return other instanceof ClozePillWidget && (other as ClozePillWidget).text === this.text;
  }
}

class MCMarkerWidget extends WidgetType {
  constructor(private readonly correct: boolean) {
    super();
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.correct ? "atomus-mc-correct" : "atomus-mc-wrong";
    span.textContent = this.correct ? "●" : "○";
    return span;
  }
  eq(other: WidgetType): boolean {
    return other instanceof MCMarkerWidget && (other as MCMarkerWidget).correct === this.correct;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const selection = view.state.selection.main;

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    const lines = text.split("\n");
    let lineStart = from;
    let multilineParentIndent: number | null = null;
    let inDoneGroup = false;

    for (const line of lines) {
      const trimmed = line.trim();
      const indent = leadingIndent(line);
      const cursorOnLine =
        selection.from >= lineStart && selection.from <= lineStart + line.length;

      if (DONE_TODO_REGEX.test(line)) {
        inDoneGroup = true;
      } else if (trimmed.length === 0) {
        inDoneGroup = false;
        multilineParentIndent = null;
      }

      if (inDoneGroup && line.length > 0 && !DONE_TODO_REGEX.test(line)) {
        builder.add(
          lineStart,
          lineStart + line.length,
          Decoration.mark({ class: "atomus-done-child" })
        );
      }

      const isMultilineChild =
        multilineParentIndent !== null &&
        trimmed.length > 0 &&
        indent > multilineParentIndent;

      if (multilineParentIndent !== null && !isMultilineChild && trimmed.length > 0) {
        multilineParentIndent = null;
      }

      const qaMatch = line.match(ATOM_QA_REGEX);
      const multilineMatch = !qaMatch ? line.match(ATOM_QA_MULTILINE_REGEX) : null;

      if (qaMatch) {
        const [, prefix, question] = qaMatch;
        const sepIdx = line.indexOf("==", prefix.length + question.length);
        const qStart = lineStart + prefix.length;
        const qEnd = qStart + question.length;
        const sepStart = lineStart + sepIdx;
        const sepEnd = sepStart + 2;
        const aLead = line.slice(sepIdx + 2).match(/^[\t ]*/)?.[0].length ?? 0;
        const aStart = sepEnd + aLead;
        const aEnd = lineStart + line.length;

        builder.add(qStart, qEnd, Decoration.mark({ class: "atomus-question" }));
        if (cursorOnLine) {
          builder.add(sepStart, sepEnd, Decoration.mark({ class: "atomus-separator" }));
        } else {
          builder.add(sepStart, sepEnd, Decoration.replace({ widget: new ArrowWidget("→") }));
        }
        builder.add(aStart, aEnd, Decoration.mark({ class: "atomus-answer" }));
        multilineParentIndent = null;
      } else if (multilineMatch) {
        const [, prefix, question] = multilineMatch;
        const sepIdx = line.lastIndexOf("==");
        const qStart = lineStart + prefix.length;
        const qEnd = qStart + question.length;
        const sepStart = lineStart + sepIdx;
        const sepEnd = sepStart + 2;

        builder.add(qStart, qEnd, Decoration.mark({ class: "atomus-question" }));
        if (cursorOnLine) {
          builder.add(sepStart, sepEnd, Decoration.mark({ class: "atomus-separator" }));
        } else {
          builder.add(sepStart, sepEnd, Decoration.replace({ widget: new ArrowWidget("↓") }));
        }
        multilineParentIndent = indent;
      } else if (isMultilineChild) {
        const mcMatch = line.match(MC_CHOICE_REGEX);
        if (mcMatch) {
          const [, prefix, marker, rest] = mcMatch;
          const markerStart = lineStart + prefix.length;
          const markerEnd = markerStart + 3; // `(x)` or `( )`
          const correct = marker.toLowerCase() === "x";
          if (cursorOnLine) {
            builder.add(
              markerStart,
              markerEnd,
              Decoration.mark({ class: correct ? "atomus-mc-correct-raw" : "atomus-mc-wrong-raw" })
            );
          } else {
            builder.add(
              markerStart,
              markerEnd,
              Decoration.replace({ widget: new MCMarkerWidget(correct) })
            );
          }
          const restStart = markerEnd + 1;
          const restEnd = restStart + rest.length;
          builder.add(
            restStart,
            restEnd,
            Decoration.mark({
              class: correct ? "atomus-answer atomus-mc-correct-text" : "atomus-answer",
            })
          );
        } else {
          builder.add(
            lineStart,
            lineStart + line.length,
            Decoration.mark({ class: "atomus-multiline-child" })
          );
        }
      } else {
        const re = new RegExp(CLOZE_REGEX.source, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          const absStart = lineStart + m.index;
          const absEnd = absStart + m[0].length;
          let content = m[1].replace(/^c\d+::/, "").split("|")[0];

          if (cursorOnLine) {
            builder.add(absStart, absEnd, Decoration.mark({ class: "atomus-cloze" }));
          } else {
            builder.add(
              absStart,
              absEnd,
              Decoration.replace({ widget: new ClozePillWidget(content) })
            );
          }
        }
      }

      lineStart += line.length + 1;
    }
  }

  return builder.finish();
}

const atomusViewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

function makeArrow(glyph: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "atomus-arrow-widget";
  el.textContent = glyph;
  return el;
}

function renderMultilineChild(container: HTMLElement, raw: string): void {
  const stripped = raw.replace(/^\s*(?:[-*]\s+)?/, "");
  const mc = stripped.match(/^\(([xX ])\)\s+(.+)$/);
  if (mc) {
    const correct = mc[1].toLowerCase() === "x";
    const marker = document.createElement("span");
    marker.className = correct ? "atomus-mc-correct" : "atomus-mc-wrong";
    marker.textContent = correct ? "●" : "○";
    const rest = document.createElement("span");
    rest.className = correct ? "atomus-answer atomus-mc-correct-text" : "atomus-answer";
    rest.textContent = " " + mc[2];
    container.appendChild(marker);
    container.appendChild(rest);
  } else {
    const span = document.createElement("span");
    span.className = "atomus-multiline-child";
    span.textContent = stripped;
    container.appendChild(span);
  }
}

function splitParagraphLines(node: HTMLElement): string[] {
  const html = node.innerHTML;
  // Split by <br> preserving whitespace that Obsidian kept
  const parts = html.split(/<br\s*\/?>/i);
  const decoder = document.createElement("div");
  return parts.map((part) => {
    decoder.innerHTML = part;
    return decoder.textContent ?? "";
  });
}

function processReadingMode(el: HTMLElement, _ctx: MarkdownPostProcessorContext): void {
  // Paragraphs: may contain a multiline atom joined via <br> (soft-wrapped indent without `- `)
  const paragraphs = Array.from(el.querySelectorAll("p")) as HTMLElement[];
  for (const p of paragraphs) {
    if (p.querySelector(".atomus-question")) continue;
    const lines = splitParagraphLines(p);
    if (lines.length === 0) continue;

    const firstLine = lines[0].trim();
    const firstIndent = lines[0].length - lines[0].trimStart().length;
    const multilineMatch = firstLine.match(ATOM_QA_MULTILINE_REGEX);
    const singleMatch = firstLine.match(ATOM_QA_REGEX);

    if (multilineMatch && lines.length > 1) {
      const [, , question] = multilineMatch;
      p.replaceChildren();
      const qSpan = document.createElement("span");
      qSpan.className = "atomus-question";
      qSpan.textContent = question.trim();
      p.appendChild(qSpan);
      p.appendChild(document.createTextNode(" "));
      p.appendChild(makeArrow("↓"));

      const answerBox = document.createElement("div");
      answerBox.className = "atomus-multiline-answer";
      let sawChild = false;
      for (let i = 1; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (trimmed.length === 0) continue;
        const rawIndent = raw.length - raw.trimStart().length;
        if (rawIndent <= firstIndent) break;
        sawChild = true;
        const childEl = document.createElement("div");
        childEl.className = "atomus-multiline-line";
        renderMultilineChild(childEl, trimmed);
        answerBox.appendChild(childEl);
      }
      if (sawChild) {
        p.appendChild(answerBox);
      }
      continue;
    }

    if (singleMatch) {
      const [, , question, , answer] = singleMatch;
      const qSpan = document.createElement("span");
      qSpan.className = "atomus-question";
      qSpan.textContent = question.trim();
      const aSpan = document.createElement("span");
      aSpan.className = "atomus-answer";
      aSpan.textContent = answer.trim();
      p.replaceChildren(
        qSpan,
        document.createTextNode(" "),
        makeArrow("→"),
        document.createTextNode(" "),
        aSpan
      );
    }
  }

  // List items: explicit lists still get transformed (same logic as before)
  const listItems = Array.from(el.querySelectorAll("li")) as HTMLElement[];
  for (const node of listItems) {
    if (node.querySelector(".atomus-question")) continue;
    const text = (node.textContent ?? "").trim();
    const single = text.match(ATOM_QA_REGEX);
    if (single) {
      const [, , question, , answer] = single;
      const qSpan = document.createElement("span");
      qSpan.className = "atomus-question";
      qSpan.textContent = question.trim();
      const aSpan = document.createElement("span");
      aSpan.className = "atomus-answer";
      aSpan.textContent = answer.trim();
      node.replaceChildren(
        qSpan,
        document.createTextNode(" "),
        makeArrow("→"),
        document.createTextNode(" "),
        aSpan
      );
    } else {
      const mc = text.match(/^\(([xX ])\)\s+(.+)$/);
      if (mc) {
        const correct = mc[1].toLowerCase() === "x";
        const marker = document.createElement("span");
        marker.className = correct ? "atomus-mc-correct" : "atomus-mc-wrong";
        marker.textContent = correct ? "●" : "○";
        const rest = document.createElement("span");
        rest.className = correct ? "atomus-answer atomus-mc-correct-text" : "atomus-answer";
        rest.textContent = " " + mc[2];
        node.replaceChildren(marker, rest);
      }
    }
  }

  // Also handle paragraph followed by <ul>/<ol> (explicit `- ` multiline answer)
  for (const p of paragraphs) {
    if (!p.querySelector(".atomus-question")) continue;
    const sibling = p.nextElementSibling as HTMLElement | null;
    if (sibling && (sibling.tagName === "UL" || sibling.tagName === "OL") &&
        !sibling.classList.contains("atomus-multiline-answer")) {
      const arrowEl = p.querySelector(".atomus-arrow-widget");
      if (arrowEl && arrowEl.textContent === "↓") {
        sibling.classList.add("atomus-multiline-answer");
      }
    }
  }

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let cur: Node | null = walker.nextNode();
  while (cur) {
    textNodes.push(cur as Text);
    cur = walker.nextNode();
  }
  for (const tn of textNodes) {
    const value = tn.textContent ?? "";
    if (!value.includes("{{")) continue;
    const parent = tn.parentNode;
    if (!parent) continue;

    const frag = document.createDocumentFragment();
    const re = new RegExp(CLOZE_REGEX.source, "g");
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    let matched = false;

    while ((m = re.exec(value)) !== null) {
      matched = true;
      if (m.index > lastIndex) {
        frag.appendChild(document.createTextNode(value.slice(lastIndex, m.index)));
      }
      const content = m[1].replace(/^c\d+::/, "").split("|")[0];
      const pill = document.createElement("span");
      pill.className = "atomus-cloze-pill";
      pill.textContent = content;
      frag.appendChild(pill);
      lastIndex = m.index + m[0].length;
    }
    if (matched) {
      if (lastIndex < value.length) {
        frag.appendChild(document.createTextNode(value.slice(lastIndex)));
      }
      parent.replaceChild(frag, tn);
    }
  }
}

export default class AtomusPlugin extends Plugin {
  async onload() {
    this.registerEditorExtension(atomusViewPlugin);
    this.registerMarkdownPostProcessor(processReadingMode);
  }
}
