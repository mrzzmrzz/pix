# Third-party notices

`themes/claude-dark.json` and `themes/claude-light.json` are copies of the
themes in [pi-claude-theme](https://github.com/mrzzmrzz/pi-claude-theme)
(MIT, notice in `MIT-pi-claude-theme.txt`). They are vendored rather than
depended on because npm 12 refuses git dependencies by default, which would
break `pi install` for most users. `npm run sync-themes` refreshes them from
that repository's `main`.
