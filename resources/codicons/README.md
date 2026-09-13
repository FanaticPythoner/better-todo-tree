# Codicon glyph sources

- Glyphs: Microsoft [vscode-codicons](https://github.com/microsoft/vscode-codicons), package version and archive integrity in `provenance.json`.
- Product aliases: Microsoft [Product Icon Reference](https://code.visualstudio.com/api/references/icons-in-labels).
- SVG templates retain upstream geometry. Runtime substitution replaces `currentColor` with the configured gutter color.
- Glyph contents determine generated filenames. Existing letter-badge files cannot satisfy the vector asset lookup.
- Licenses: `LICENSE` for content, `LICENSE-CODE` for code.

```bash
python3 scripts/build-codicon-assets.py --source-dir TODOS_LISTS/qa-pr178/codicon-source
```

The source directory contains `metadata.json`, `package.tgz`, and `product-icons.html`.
The compiler checks package integrity, resolves every alias and rejects missing glyphs.
