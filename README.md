# pix

pix gives the [pi coding agent](https://pi.dev) the look of the OpenDDE Harness
TUI: a kaomoji working indicator that shimmers on its own row above the editor
while a turn runs, a flavour verb picked fresh for each turn, a PIX mark above
the editor at startup, Claude Code's user message band, and tool rows folded to
one line. It ships the `claude-dark` and `claude-light` themes from
[pi-claude-theme](https://github.com/mrzzmrzz/pi-claude-theme), and carries no
palette of its own: every colour it draws is a theme token. Models, providers,
tools and keybindings stay pi's own.

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
  "quietStartup": true
}
```

`quietStartup` is worth setting: without it pi's own startup header sits above
the welcome mark and you get two greetings.

## Try it without installing

```bash
pi -e /absolute/path/to/pix --theme /absolute/path/to/pix/themes --use-theme claude-dark
```

## Tool rows

A collapsed tool call is one line: the tool, what it was asked to do, how long
it took, and the expand key at the right of the row. A successful call's output
is not shown at all, because the row already says which file was read and the
file is one key away. A failure keeps its first line, so a tool that failed is
visible without being expanded first. Press the expand key and pi's own renderer
draws the result, with its highlighting and its diffs. `/quiet-tools off` gives
pi's rows back for the session, and `/quiet-tools on` takes them again.

**pix replaces [pi-fold](https://github.com/mrzzmrzz/pi-fold).** Both override
the same seven built-in tools, and the one that registers last wins, so running
both means the rows are whichever loaded second. Remove pi-fold:

```bash
pi remove git:github.com/mrzzmrzz/pi-fold
```

## What is patched

Three of the four extensions use pi's documented extension API and nothing else.
Tool rows are re-registered tool definitions, which is the supported way to
change how a tool draws. The fourth, `user-band`, is different: pi offers no way
to change how a user message is drawn, so pix replaces a method on pi's own
private message component at runtime. Nothing on disk is modified, and pi's own
file stays exactly as it shipped.

That override is verified against the pi version pinned in `devDependencies`,
and a pi release can break it. If it does, every step of the patch is guarded:
pix skips it, pi keeps drawing its own band, the indicator, welcome mark, tool
rows and themes carry on working, and you get one warning saying so. A scheduled
workflow watches for each pi release and either opens a version bump or files an
issue.

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
