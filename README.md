# Atomus for Obsidian

Spaced-repetition atoms inline — renders Atomus syntax right in your Obsidian notes.

![Atomus for Obsidian](https://github.com/user-attachments/assets/2bb58fa4-8594-42ac-9319-10e02566e74c)

## What it does

Atomus uses a simple markdown-first syntax for spaced-repetition "atoms". This plugin makes that syntax render beautifully inside Obsidian, so you can write and review from the same app you already use for notes.

| Syntax | What you get |
|---|---|
| `Question == Answer` | Single-line atom. `==` becomes a `→` arrow; question/answer color-coded. |
| `Question ==`<br>`  child lines` | Multi-line atom. `==` becomes `↓`, indented children show as the answer. |
| `  (x) correct`<br>`  ( ) wrong` | Multiple choice. `(x)` turns into a filled dot, `( )` into an empty one. |
| `  1. first`<br>`  2. second` | Numbered list answer. |
| `Text with {{gap}}` | Cloze deletion — renders as a pill. |
| `Text {{c1::first}} and {{c2::second}}` | Numbered cloze for multiple gaps. |
| `- [x] done` followed by indented lines | Atoms under a done todo are dimmed + strikethrough. |

The plugin is **visual only** — your markdown stays plain text. Compatible with [Atomus desktop](https://atomus.app) so the same files work in both.

## Install

### From Community Plugins (recommended, once approved)

In Obsidian: **Settings → Community plugins → Browse → search "Atomus" → Install → Enable**.

### Manual install

Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](../../releases), then drop them into `<your-vault>/.obsidian/plugins/atomus/`. Restart Obsidian and enable the plugin in settings.

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build → main.js
```

Symlink this folder into your test vault:

```bash
ln -sfn "$(pwd)" /path/to/your/vault/.obsidian/plugins/atomus
```

Then Cmd+R inside Obsidian to reload the plugin after each build.

## Theme support

Colors come from Obsidian's native theme variables (`--text-accent`, `--text-muted`, `--color-yellow`, `--color-green`, etc), so the plugin adapts to any theme you're using — Minimal, Things, Atom, California Coast, Shimmering Focus, custom — without extra configuration.

## Compatibility

- Works in both Live Preview and Reading Mode.
- Plays nicely with wikilinks `[[...]]`, headings, standard lists, and todos — we only touch Atomus-specific syntax.
- When the cursor is on an atom's line, the raw source is shown so you can edit; move away and the pretty render returns.

## License

MIT — see [LICENSE](LICENSE).
