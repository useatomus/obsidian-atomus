# Atomus Flashcards

Flashcards in plain Markdown, rendered in your notes. Write `question == answer` on any line and it shows as a card, with cloze gaps and multiple choice. Phrases you saved with the [Atomus](https://atomus.app) Mac app for learning a language get a play button with their original audio.

![Atomus Flashcards in a note](https://github.com/user-attachments/assets/2bb58fa4-8594-42ac-9319-10e02566e74c)

## What it renders

| You write | You see |
|---|---|
| `¿Me echas una mano? == Can you give me a hand?` | The front and back, with `==` shown as an arrow |
| `word ==> definition`, `word <== definition`, `word <=> definition` | One-way, reverse and two-way cards (`→`, `←`, `↔`) |
| `Question ==` with indented lines below | A multi-line answer |
| `(x) right` / `( ) wrong` under a question | Multiple choice, the right answer marked |
| `Can you {{give}} me a hand?` | A cloze gap as a pill. `{{c1::...}}` and `{{answer\|distractor}}` work too |
| Indented lines under `- [x] done` | Dimmed, so finished items step back |

The separator needs a space on both sides, so `==highlights==` stay highlights. Nothing changes inside code blocks, inline code, math or frontmatter. The plugin never edits your files: put the cursor on a line to see and edit the raw text.

## Learning a language with Atomus

[Atomus](https://atomus.app) is a Mac app that saves phrases from anything you hear on your Mac (videos, podcasts, calls) with their audio and translation, and reviews them in the notch with FSRS. It writes each phrase to your vault as `phrase == translation`.

With this plugin, those notes read like flashcards in Obsidian, and each saved phrase gets a ▶ button that plays the clip you heard. Hover it to see where you heard it. It also works on Obsidian mobile when your vault syncs, so you can listen to your phrases on your phone.

Atomus keeps the audio and source of each phrase in your vault (`Attachments/audio` and the hidden `.threads` folder). The plugin only reads those local files. It makes no network requests.

You don't need Atomus to use the plugin. Any `==` card, cloze or multiple choice renders on its own.

## Install

**Community plugins:** Settings → Community plugins → Browse → search "Atomus" → Install → Enable.

**Manually:** download `main.js`, `manifest.json` and `styles.css` from the latest [release](../../releases) into `<your vault>/.obsidian/plugins/atomus/`, then enable the plugin in Settings → Community plugins.

## Compatibility

- Live Preview and Reading view.
- Desktop and mobile.
- Colors come from your theme's variables (`--text-accent`, `--text-muted`, `--color-yellow`, `--color-green`), so it fits any theme.
- Works alongside wikilinks, headings, lists and tasks. Links and formatting inside a card keep working in Reading view.

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build to main.js
npm run lint   # the same rules the Obsidian review uses
```

Symlink this folder into a test vault, then reload Obsidian after each build:

```bash
ln -sfn "$(pwd)" /path/to/vault/.obsidian/plugins/atomus
```

## License

MIT. See [LICENSE](LICENSE).
