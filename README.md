# pix

pix gives the [pi coding agent](https://pi.dev) the look of the OpenDDE Harness
TUI: a kaomoji working indicator that shimmers on its own row above the editor
while a turn runs, a flavour verb picked fresh for each turn, Claude Code's user
message band, Claude Code's tool rows and thinking blocks, and a line at the end
of each turn saying what it did. It ships the `claude-dark` and `claude-light`
themes from [pi-claude-theme](https://github.com/mrzzmrzz/pi-claude-theme), and
carries no palette of its own: every colour it draws is a theme token. Models,
providers, tools and keybindings stay pi's own.

```
(◔_◔) reading the diff… (12s · esc to interrupt)
```

## Install

```bash
pi install git:github.com/mrzzmrzz/pix
```

Or from a checkout:

```bash
pi install /absolute/path/to/pix
```

## Configure

Pick a theme in `/settings`, or set it in `settings.json`:

```json
{
  "theme": "claude-dark",
  "hideThinkingBlock": true
}
```

## Try it without installing

```bash
pi -e /absolute/path/to/pix --theme /absolute/path/to/pix/themes --use-theme claude-dark
```

## Tool rows

A tool call is drawn the way Claude Code draws it: a dot, a verb, what the call
was pointed at, and one line under it saying what came back.

```
 ● Read src/providers/compat.py
 └ 412 lines loaded • ctrl+o to toggle

 ● Bash pytest -q tests/                             37 lines · 12s
 └ Done (37 lines) • ctrl+o to toggle
   tests/test_stream.py ..........
   tests/test_wire.py ....

 ● Edit src/tui/row.ts
 └ +14 -6 [━━━━━━━━━━] at line 88 • ctrl+o to toggle
```

The dot is a braille spinner while the call is in flight, dim while the model is
still writing the arguments, and green or red once it is done. Long paths lose
their middle, never their filename. A running command shows the last few lines
it printed, and keeps them after it finishes until the assistant answers or
another tool starts. Bash alone gets its line count and elapsed time on the
right edge.

Press the expand key and the row becomes a filled card showing what the tool was
asked and what pi's own renderer makes of the answer, so `edit` still shows pi's
diff and `read` still shows pi's highlighting:

```
 ● Read src/tui/row.ts
 ├ Input
 │ path: src/tui/row.ts
 │ offset: 12
 └ Output
   …
```

`/tool-rows off` gives pi's own renderers back for the session, and
`/tool-rows on` takes them again. A tool another extension has already claimed
is left alone.

When a turn ran more than one tool, it closes with one muted line saying what it
did:

```
 ✻ Ran 4 commands, read 7 files, edited 2 files · 1m 12s
```

**pix replaces [pi-fold](https://github.com/mrzzmrzz/pi-fold).** Both override
the same seven built-in tools, and the one that registers last wins, so running
both means the rows are whichever loaded second. Remove pi-fold:

```bash
pi remove git:github.com/mrzzmrzz/pi-fold
```

## Thinking

While the model is thinking, the heading shimmers over the last three lines of
what it is saying:

```
 Thinking… · 4s
 I need to check how the wire format handles a missing field, because
 the provider table says one thing and the compat notes say another, so
 the safe reading is the stricter of the two.
```

When it stops, the whole thought becomes one line:

```
 ∴ Thought for 4s
```

A model that streams a reasoning summary title uses that instead of "Thinking",
and consecutive thoughts with nothing between them add up into one.

This rides pi's own switch: thinking hidden is pix's collapsed view, thinking
shown is pi's full text, and pi's toggle (`ctrl+t` by default) moves between
them. If you never set `hideThinkingBlock`, pix sets it to `true` in your
settings the first time it runs and tells you; press `ctrl+t` once in that
session, and every later start opens collapsed. A value you set yourself is
never touched.

## What is patched

Three of the five extensions use pi's documented extension API and nothing else:
the working indicator, the turn summary, and tool rows, which are re-registered
tool definitions. Two are different, because pi offers no way to change how a
message is drawn. `user-band` replaces a method on pi's user message component,
and `thinking` replaces one on its assistant message component. Nothing on disk
is modified, and pi's own files stay exactly as they shipped.

Both overrides are verified against the pi version pinned in `devDependencies`,
and a pi release can break them. If it does, every step of each patch is
guarded: pix skips it, pi keeps drawing its own rows, the rest of pix carries on
working, and you get one warning saying so. A scheduled workflow watches for each
pi release and either opens a version bump or files an issue.

## Related

- [pi-claude-theme](https://github.com/mrzzmrzz/pi-claude-theme) — Claude Code's
  palette for pi. pix vendors its two themes (`npm run sync-themes` refreshes
  them; a daily workflow opens a PR when they change upstream). Install it on
  its own instead if you want the themes without the rest of pix, not both:
  pi rejects two themes with the same name.
- [pi-codex-compact](https://github.com/mrzzmrzz/pi-codex-compact) — Codex-style
  server-side compaction for pi.

## Development

```bash
npm install
npm test
npm run type-check
```

pi loads `.ts` directly, so there is no build step; `type-check` is a check, not
a compile.

## License

MIT. The vendored themes are pi-claude-theme's, also MIT; see `LICENSES/`.
