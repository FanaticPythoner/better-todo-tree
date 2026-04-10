# Better Todo Tree Change Log

Stable release notes published to GitHub are mirrored here for Marketplace version history.

## v0.0.228 - 2026-04-10

- release tag: `v0.0.228`
- target commit: [`e62866370de980fc3ab71d65fa13ae4a725a5fd9`](https://github.com/FanaticPythoner/better-todo-tree/commit/e62866370de980fc3ab71d65fa13ae4a725a5fd9)
- previous release: `v0.0.227`

## Included commits

- [`000f49b`](https://github.com/FanaticPythoner/better-todo-tree/commit/000f49b62504be625270b650f01fb9525b994a2a) feat: reposition Better Todo Tree as an active successor
  > Accurately describe / differentiate Better Todo Tree from the abandoned upstream listing
  > 
  > README and marketplace copy:
  > - accurately describe Better Todo Tree as a drop-in successor to Todo Tree rather than a
  >   passive mirror of the original project
  > - add clearer website, marketplace, and GitHub links
  > - align the package description with the new README description
  > 
- [`6088b69`](https://github.com/FanaticPythoner/better-todo-tree/commit/6088b6971ee81e7accecce15c14955229184b458) release: v0.0.228

## v0.0.227 - 2026-04-10

- release tag: `v0.0.227`
- target commit: [`dbd040d14e1fc418c3a20bb64c268449fadee0ce`](https://github.com/FanaticPythoner/better-todo-tree/commit/dbd040d14e1fc418c3a20bb64c268449fadee0ce)
- previous release: `v0.0.226`

## Included commits

- [`5d741df`](https://github.com/FanaticPythoner/better-todo-tree/commit/5d741df9370a13f4f691dab3d0fb6878a4e58a41) feat: clarify Better Todo Tree fork identity across metadata
  > Make the Marketplace card, Marketplace details page, and GitHub landing page read as an independent maintained fork instead of inheriting the abandoned Todo Tree copy.
  > 
  > Metadata and docs:
  > - rewrite the package description around Better Todo Tree as the maintained Todo Tree fork
  > - point the extension homepage at bettertodotree.com
  > - add a fork-status section under the Better Todo Tree heading in README.md
  > - link the website, Marketplace listing, source, issues, and upstream project base from the README header
  > 
- [`2c1a4cb`](https://github.com/FanaticPythoner/better-todo-tree/commit/2c1a4cb972c0b7b4863ff314c9559bff8145d6de) release: v0.0.227

## v0.0.226 - 2026-04-10

- release tag: `v0.0.226`
- target commit: [`598746a576d7d3e8ec4a4ee55f6e017093e4af26`](https://github.com/FanaticPythoner/better-todo-tree/commit/598746a576d7d3e8ec4a4ee55f6e017093e4af26)
- previous release: `v0.0.225`

## Included commits

- [`6b1d97f`](https://github.com/FanaticPythoner/better-todo-tree/commit/6b1d97f1e4ddc439289f9db4cebd4d72b45e2d23) feat: automate stable and latest GitHub releases with ordered notes
  > Add a complete release-automation layer for both stable semver tags and the
  > moving latest/nightly prerelease.
  > 
  > Stable release automation:
  > - add scripts/release/release-versioning.sh for semver tag discovery,
  >   previous-release lookup, and patch/minor/major version increments
  > - add scripts/release/write-release-notes.sh to generate deterministic release
  >   notes from git history with commits listed in chronological order
  > - add scripts/release/create-next-release.sh to:
  >   - read the latest stable tag
  >   - increment the version
  >   - update package.json and package-lock.json
  >   - create the release commit and annotated tag
  >   - write the release notes artifact
  >   - optionally push master and the new tag
  > - update scripts/release/create-github-release.sh so GitHub releases are
  >   recreated or updated from generated notes instead of relying on whatever
  >   body happened to exist before, including the case where the release was
  >   manually deleted
  > - pass the resolved target SHA into the GitHub release step so the release
  >   notes and attached assets are anchored to the correct ref
  > 
  > Moving latest/nightly release automation:
  > - add .github/workflows/latest.yml to publish a moving prerelease on every
  >   push to master, on a nightly schedule, and by manual dispatch
  > - add scripts/release/create-or-update-moving-github-release.sh to:
  >   - regenerate ordered release notes for the moving latest channel
  >   - force-update the latest tag to the target commit
  >   - delete and recreate the prerelease with the current VSIX artifacts
  > - keep latest/nightly GitHub prereleases separate from the official stable
  >   tag-driven release workflow
  > 
  > Local tooling and verification:
  > - add just next-release as the local entrypoint for creating the next stable
  >   release
  > - add just test-actions-latest-build and fold the latest-release verification
  >   into just test-actions
  > - extend release-script and workflow tests to cover:
  >   - ordered release note generation
  >   - next-release version bump, commit, tag, and notes creation
  >   - moving latest prerelease creation and recreation
  >   - release workflow wiring for regenerated GitHub release bodies
  > 
- [`57e62f4`](https://github.com/FanaticPythoner/better-todo-tree/commit/57e62f4534fdc7ebb5173baf398899a20f8abd6e) fix: bound release notes to fork history
  > Use the upstream merge-base as the lower bound for generated release notes
  > when no prior stable Better Todo Tree release exists so nightly/latest notes
  > do not replay the full upstream Todo Tree commit history.
  > 
  > Release note boundaries:
  > - add upstream ref resolution and fork-point detection to
  >   scripts/release/release-versioning.sh
  > - use the fork point as the history base in scripts/release/write-release-notes.sh
  >   whenever no previous stable fork tag exists
  > - include the fork point in generated notes for no-stable-tag cases so the
  >   release body shows the actual history boundary being used
  > 
  > Regression coverage:
  > - add a fork-history fixture to test/release.workflow-scripts.test.js
  > - assert that upstream commits are excluded when no stable fork release exists
  > - keep fork-local commits ordered chronologically in generated notes
  > 
- [`74ef1e7`](https://github.com/FanaticPythoner/better-todo-tree/commit/74ef1e76556ac57ba478abeafd06c61562cad596) fix: render linked multiline commit notes in release bodies
  > Use repository-aware commit URLs and NUL-delimited git log records so
  > generated release notes keep full commit bodies intact and link every
  > commit boundary to the corresponding GitHub page.
  > 
  > Release note rendering:
  > - derive the repository web URL from the origin remote with an explicit
  >   override for release automation and local fixture repos
  > - switch commit collection in scripts/release/write-release-notes.sh to
  >   NUL-delimited records so multiline bodies do not split into synthetic
  >   entries
  > - render target commits, fork points, and included commit SHAs as markdown
  >   links to their GitHub commit pages
  > - emit commit body lines beneath each included commit instead of truncating
  >   notes to the subject line
  > 
  > Regression coverage:
  > - seed the release-note fixtures with multiline commit bodies
  > - cover repository URL overrides in fixture environments
  > - assert linked SHAs, preserved body lines, and the absence of synthetic
  >   empty commit entries in generated release notes
  > 
- [`1297e91`](https://github.com/FanaticPythoner/better-todo-tree/commit/1297e9140fa7380948e1fd6b4c67419089a43edc) fix: accept just release args and report dirty worktrees
  > Treat the \ separator from just as a no-op in create-next-release.sh so just next-release -- --bump patch --push reaches the release logic instead of failing argument parsing.
  > 
  > Release creation safety:
  > - require a clean worktree before version bumps and tag creation
  > - print the pending changes when the tree is dirty
  > - keep the successful path clean by moving bare remote fixtures outside the test repo root
  > 
  > Regression coverage:
  > - cover the exact just separator invocation in test/release.workflow-scripts.test.js
  > - cover the explicit dirty-worktree failure mode
  > 
- [`b002637`](https://github.com/FanaticPythoner/better-todo-tree/commit/b002637db9ceb5b937304cf5f4ce1feb86d80e72) release: v0.0.226

## v0.0.225 - 2026-04-10

- release tag: `v0.0.225`
- target commit: [`bc3a538c9430d8079b2882e3969acde5ebe81225`](https://github.com/FanaticPythoner/better-todo-tree/commit/bc3a538c9430d8079b2882e3969acde5ebe81225)
- previous release: none
- fork point: [`a6f60e0ce830c4649ac34fc05e5a1799ec91d151`](https://github.com/FanaticPythoner/better-todo-tree/commit/a6f60e0ce830c4649ac34fc05e5a1799ec91d151)

## Included commits since fork point

- [`4e35370`](https://github.com/FanaticPythoner/better-todo-tree/commit/4e353703e8ec547ebde2624a3a3a81f08c2f09ac) fix: eliminate overlapping scans and incremental refresh regressions
  > Rework the Linux performance hot path to stop overlapping workspace scans,
  > duplicate post-processing, and repeated whole-tree recount/filter/sort work.
  > 
  > - split tree refresh scheduling from rescan scheduling
  > - add generation-gated single-flight scan state and coalesced pending rescans
  > - debounce open-file refreshes per document/version instead of using one global timer
  > - stop reparsing workspace-covered open files after workspace scans
  > - remove startup open-file refresh amplification
  > - switch automatic git refresh to single-flight execFile polling per workspace
  > - replace flat search result storage with URI-indexed results and dirty-entry draining
  > - replace whole-corpus tree rebuilds with incremental per-document replacement
  > - cache status bar and activity bar tag counts in the tree provider
  > - keep branch-local filter/sort work for incremental edits instead of rewalking the full tree
  > - switch ripgrep execution from shell exec to streamed spawn-based parsing
  > - make stop-scan cancel the real active ripgrep process
  > - bound ripgrep debug output instead of retaining full stdout copies
  > - suppress stale highlight passes when the editor document version changes
  > - update legacy searchResults tests for URI-backed entries
  > - add regression tests for indexed search result draining and ripgrep streaming/cancellation
  > - add a performance remediation audit and scope-completion map
  > 
  > Refs: Gruntfuggly/todo-tree#887
  > Refs: Gruntfuggly/todo-tree#733
  > Refs: Gruntfuggly/todo-tree#689
  > Refs: Gruntfuggly/todo-tree#643
  > Refs: Gruntfuggly/todo-tree#621
  > 
- [`efcf972`](https://github.com/FanaticPythoner/better-todo-tree/commit/efcf97243292d5b6839e2616cd76404b521048a3) fix: unify detection, harden scan behavior, and lock coverage with exhaustive matrices
  > Introduce a canonical detection pipeline and route editor/workspace
  > ingestion, highlighting, and tree rendering through the same normalized
  > match model.
  > 
  > Core remediation:
  > - add src/detection.js as the authoritative scanner/normalizer for:
  >   - built-in comment-aware scanning
  >   - custom-regex normalization
  >   - resource-aware URI/file-specific regex and subtag handling
  >   - canonical offsets for tags, subtags, comments, and full matches
  > - make src/config.js URI-aware for regex/subtag resolution so per-resource
  >   overrides are honored consistently
  > - tighten the manifest default regex in package.json so default matching is
  >   token-bounded and no longer treats arbitrary identifiers as todos
  > - fix the package.json showTreeView menu clause so it is scoped correctly to
  >   Todo Tree views only
  > 
  > Extension scan and interaction fixes:
  > - integrate the canonical detector into src/extension.js for open-file,
  >   current-file, and workspace ingestion
  > - split workspace scanning into:
  >   - candidate-file scanning for default built-in detection
  >   - normalized ripgrep match ingestion for custom regex mode
  > - keep workspace/open/current scan behavior aligned through one result model
  > - preserve passive active-editor tracking without force-selecting tree nodes
  >   while keeping explicit reveal commands selecting nodes
  > - keep the staged scan-path changes aligned with the performance remediation
  >   audit already included in this patch set
  > 
  > Highlight and icon fixes:
  > - rework src/highlights.js to decorate from canonical offsets instead of
  >   line-end heuristics
  > - clip text/text-and-comment/tag-and-comment/line highlight ranges correctly
  > - expose highlight() for direct subsystem tests
  > - split src/icons.js into tree vs gutter icon APIs
  > - force gutter icons through file-backed assets so codicon/product-icon
  >   based settings render reliably in editor gutters
  > 
  > Tree and rendering fixes:
  > - make src/tree.js use deterministic workspace/path/todo ids
  > - render multiline todos as one logical node instead of synthetic child
  >   todo chains
  > - preserve full multiline text in tooltips/exports
  > - sort tag-bearing siblings by configured tag order instead of incidental
  >   path order
  > - tighten todo identity matching to fsPath + line + column + actualTag
  > - remove build-counter/node-counter id churn from the tree model
  > 
  > Comment-pattern and utility fixes:
  > - make src/utils.js resolve comment-pattern languages from basenames when
  >   extensions are insufficient, including Makefile/Cakefile-style inputs
  > - keep explicit alias normalization for .jsonc -> .js and .vue -> .html
  > - centralize the shipped default regex source
  > - expose resource-aware config/regex helpers used by the detector matrix
  > - fix overlapping single-line comment token handling exposed by the matrix
  >   suite, including Jade // vs //- precedence
  > 
  > Verification and regression coverage:
  > - add behavioral tests for canonical detection, markdown headings/task items,
  >   Python triple-quoted blocks, multiline comment continuations, highlight
  >   clipping, gutter icons, tree multiline rendering, stable ids, and tag order
  > - add exhaustive language and regex matrix suites covering the vendored
  >   comment-pattern corpus, manifest default tags, custom-regex axes, and
  >   highlight modes
  > - add extension scan parity coverage for open/current/workspace ingestion
  >   and workspace-plus-external-open-document merge behavior
  > - add manifest verification for the scoped showTreeView when-clause
  > - add ripgrep regression coverage for paths containing spaces and parentheses
  > - expand test stubs/helpers to support URI-scoped config overrides and
  >   deterministic module loading
  > - add audit artifacts documenting behavioral remediation, performance
  >   remediation, and the exhaustive test matrix
  > 
  > Refs: Gruntfuggly/todo-tree#887
  > Refs: Gruntfuggly/todo-tree#875
  > Refs: Gruntfuggly/todo-tree#840
  > Refs: Gruntfuggly/todo-tree#839
  > Refs: Gruntfuggly/todo-tree#820
  > Refs: Gruntfuggly/todo-tree#812
  > Refs: Gruntfuggly/todo-tree#710
  > Refs: Gruntfuggly/todo-tree#899
  > Refs: Gruntfuggly/todo-tree#898
  > Refs: Gruntfuggly/todo-tree#879
  > Refs: Gruntfuggly/todo-tree#734
  > Refs: Gruntfuggly/todo-tree#733
  > Refs: Gruntfuggly/todo-tree#697
  > Refs: Gruntfuggly/todo-tree#689
  > Refs: Gruntfuggly/todo-tree#675
  > Refs: Gruntfuggly/todo-tree#663
  > Refs: Gruntfuggly/todo-tree#654
  > Refs: Gruntfuggly/todo-tree#644
  > Refs: Gruntfuggly/todo-tree#643
  > Refs: Gruntfuggly/todo-tree#621
  > Refs: Gruntfuggly/todo-tree#918
  > 
- [`62d0a8e`](https://github.com/FanaticPythoner/better-todo-tree/commit/62d0a8e815d2c98bf4eedad16206a9955bb23490) Add TODOS_LISTS/ to .gitignore
- [`de77c0f`](https://github.com/FanaticPythoner/better-todo-tree/commit/de77c0fae1cfffc9a3208700aeadad8955dcb727) Update vscodeignore to exclude TODOS_LISTS/
- [`5b9e671`](https://github.com/FanaticPythoner/better-todo-tree/commit/5b9e6719a84cd0db563ba0ee1a1927cf664dcbdd) feat: ship Better Todo Tree with compatibility-first rebrand and automated releases
  > Rebrand the forked extension as FanaticPythoner.better-todo-tree
  > v0.0.225 and carry existing Todo Tree users forward instead of forcing a
  > hard break.
  > 
  > Compatibility-first fork surface:
  > - rename the published extension identity, display strings, localized
  >   metadata, docs, links, changelog, and packaged assets to Better Todo Tree /
  >   FanaticPythoner
  > - keep todo-tree-container and todo-tree-view stable so existing activity-bar
  >   placement and persisted view layout survive the fork
  > - add src/extensionIdentity.js as the single source of truth for:
  >   - current and legacy namespaces
  >   - command ids and legacy aliases
  >   - context keys
  >   - export schemes
  >   - settings lookup and update targets
  >   - stable hidden internal ids
  > - ship both better-todo-tree.* and deprecated todo-tree.* settings in the
  >   manifest and localized metadata
  > - resolve configuration in current -> legacy -> current-default order so old
  >   settings keep working immediately after the rebrand
  > - add same-scope legacy settings import plus the
  >   Better Todo Tree: Import Legacy Settings command
  > - keep legacy todo-tree.* commands registered as hidden aliases and accept
  >   both better-todo-tree-export: and todotree-export:
  > - route config, colours, icons, highlights, tree behavior, export handling,
  >   and command wiring through the compatibility layer
  > 
  > Release and distribution automation:
  > - replace the abandoned Travis path with pinned GitHub Actions workflows for
  >   CI, security scanning, reusable VSIX builds, and tag-driven releases
  > - build the full 10-target VSIX matrix, publish to VS Code Marketplace,
  >   publish to Open VSX when reachable, attest build provenance, and create
  >   GitHub Releases from annotated tags
  > - isolate Open VSX publication so a registry outage no longer blocks VS Code
  >   Marketplace publication or GitHub Release creation
  > - add checked-in release scripts for:
  >   - release metadata validation
  >   - artifact discovery
  >   - VS Code Marketplace publishing
  >   - Open VSX publishing
  >   - GitHub Release creation
  >   - one-time GitHub release-environment bootstrap
  > - add justfile entrypoints for setup, release-environment bootstrap,
  >   workflow linting, CI simulation, release-build verification, and VSIX builds
  > - add Dependabot, CODEOWNERS, release-note categories, and .nvmrc
  > 
  > Repository, licensing, and packaging hardening:
  > - standardize on LICENSE and remove the old License.txt path
  > - distribute the fork as GPL-3.0-only while preserving the upstream Todo Tree
  >   Expat/MIT notice in UPSTREAM-NOTICE.md
  > - align package metadata and docs with the GPL-3.0-only fork license
  > - document migration behavior, compatibility boundaries, release setup, and
  >   licensing in MIGRATION.md
  > - exclude workflow-only files, release tooling, and migration docs from
  >   packaged VSIX artifacts
  > - add and pin maintained release/build dependencies including @vscode/vsce,
  >   ovsx, webpack 5, webpack-cli 7, qunit 2.25, micromatch 4.0.8,
  >   @primer/octicons 17.12, and the lodash override
  > 
  > Verification and regression coverage:
  > - extend manifest tests to verify:
  >   - stable hidden view/container ids
  >   - rebranded commands and menu contributions
  >   - dual current/legacy settings surfaces
  >   - deprecated legacy settings metadata
  > - add compatibility tests for current-vs-legacy settings resolution and
  >   manifest parity
  > - add workflow and release-script tests covering:
  >   - pinned action SHAs
  >   - release permissions
  >   - split Marketplace/Open VSX publication
  >   - continue-on-error Open VSX behavior
  >   - release artifact filtering
  >   - release-environment bootstrap
  > - update scan-parity coverage to exercise the dual-namespace configuration
  >   path used by the forked runtime
  > 
  > Refs: Gruntfuggly/todo-tree#423
  > Refs: Gruntfuggly/todo-tree#841
  > Refs: Gruntfuggly/todo-tree#842
  > Refs: Gruntfuggly/todo-tree#890
  > 
- [`e9b9088`](https://github.com/FanaticPythoner/better-todo-tree/commit/e9b9088f5face083a21d026a56ac1dfeddbc7c42) fix: escape tag literals in one pass for regex construction
  > Replace the two-step tag escaping logic in src/utils.js with a single regex-literal escaping helper so backslashes and regex metacharacters are sanitized consistently when building the tag regex source.
  > 
  > This removes the incomplete escaping pattern flagged by CodeQL without changing the intended matching behavior, and updates the exact-output tests to assert the corrected escaped form.
  > 
  > Verification:
  > - npm test -- --filter "utils.getRegexSource"
  > - just test
  > - just test-actions
  > 

## Upstream Todo Tree history

The entries below are preserved from the upstream Todo Tree changelog.


## v0.0.224 - 2023-02-09

- Remove filewatcher functionality
- Add a simple mechanism to watch for git repo changes instead of using the file watcher
- Add a simple periodic refresh

## v0.0.223 - 2023-02-01

- Flash the line containing the TODO when clicking on items in the tree view
- Fix go to next/previous TODO commands when regex matches the starts of the line
- Deprecate file watcher settings and remove from the README.md

## v0.0.222 - 2023-01-23

- Add commands to move to next and previous TODO in a file

## v0.0.221 - 2023-01-22

- Add default octicons for custom highlights (thanks to [Andrew Hlynskyi](https://github.com/ahlinc))
- Always show total in the activity bar regardless of other settings
- Add support for hiding counts from the activity bar badge
- Fix auto refresh when closing file (thanks to [yw662](https://github.com/yw662))
- Fix scopes documentation (thanks to [kjo-sdds](https://github.com/kjo-sdds))
- Update node_modules exclude to match VSCode (thanks to [Benas Svipas](https://github.com/svipas))

## v0.0.220 - 2022-11-07

- Fix missing 'new' keywords (thanks to [Elias](https://github.com/Elias-Graf))
- Fix duplicate entries when refreshing and files have unsaved changes (thanks to [Chris Bain](https://github.com/baincd))
- Fix issue with duplicate items (thanks to [Matt Toigo](https://github.com/mtoigo))
- Update octicons and fix todo tree icons (thanks to [Morgan](https://github.com/morgansliman))

## v0.0.219 - 2022-10-14

- Add activity bar badge support, but default to off and only for versions 172+ of vscode

## v0.0.218 - 2022-10-14

- Back out activity bar badge option for older versions of VSCode

## v0.0.217 - 2022-10-13

- Update minimum VSCode version to 1.172

## v0.0.216 - 2022-10-13

- Add support for activity bar badge

## v0.0.215 - 2022-01-04

- Update default regex in README.md
- Add "none" as a valid value for highlight type
- Add default icons for default tags
- Add markdown tags to default tag list
- Update screenshot in README.md
- Look for new location of VSCode's packaged ripgrep when the default setting is used

## v0.0.214 - 2021-09-07

- Build codicon list automatically
- Support highlighting from capture groups in the regex
- Fix default regex to not greedily match newlines
- Update default regex
- Fix group by tag
- When grouping by tag, don't add group node for single item
- Ensure markdown update popup is hidden for current session too
- Use entire URI for editor ID when highlighting
- Only show reveal button when not in tags only view
- use subtag match correctly
- Only show total count in title if tree counts are enabled

## v0.0.213 - 2021-04-27

- Remove some old migration code (before version 168)
- Fix colour validation
- Improve status bar layout
- Fix missing URI in multi line TODOs
- Add icon validation

## v0.0.212 - 2021-04-26

- Use the window icon for workspaces in the tree
- Move 'schemes' setting from highlights to general (and include "ssh" by default)
- Use URIs instead of file paths to improve support for remote file systems
- Fix group by tag in flat mode
- Show icons on status bar for each tag count
- Use tag order in status bar, unless showing top three
- Use tag order when grouping by tag

## v0.0.211 - 2021-04-09

- Fix file opening on Windows

## v0.0.210 - 2021-04-08

- Indicate current scope selection when changing
- Make reveal behaviour more consistent with VSCode

## v0.0.209 - 2021-03-28

- Add support for scopes, allowing predefined sets of globs to be selected, (thanks to [kkckkc](https://github.com/kkckkc))
- Add support for manually enabling multiline TODO support
- Improve multi-line todo handling
- Fix broken file icons in tree
- Fix missing filename when using compact folders

## v0.0.208 - 2021-03-20

- Revert commit which removed trailing text from multiline TODOs

## v0.0.207 - 2021-03-19

- Improve colour validation for icons
- Fix theme colours for ruler colour
- Remove trailing block comments when adding multiline todo to tree
- Support multi-line haskell comments
- Don't include trailing text to the end of multiline TODOs

## v0.0.206 - 2021-03-17

- Sort tags only view on tags order by default
- Ignore case when validating HTML colour names
- Allow highlights to be enabled/disabled by clicking the status bar
- Add ruler opacity setting
- Improve view title

## v0.0.205 - 2021-03-13

- Add support for VSCode issue reporter
- Fix highlights in split editors

## v0.0.204 - 2021-03-11

- Add improved markdown support dialog and settings update
- Fix expanded node storage after resetting cache

## v0.0.203 - 2021-03-10

- Fix highlighting of markdown TODOs
- Fix reversed sort order

## v0.0.202 - 2021-03-08

- Improve tag extraction when regex doesn't contain $TAGS
- Fix sorting (again)

## v0.0.201 - 2021-03-04

- Fix 'afterOfBefore' substitution

## v0.0.200 - 2021-03-04

- Add VS Code theme color reference link (thanks to [tksh164](https://github.com/tksh164))
- Add support for label (and tooltip) transformations (thanks to [TomFreudenberg](https://github.com/TomFreudenberg))
- Sort tags only view be label, not tag

## v0.0.199 - 2021-02-28

- Use storageUri instead of deprecated storagePath (v2)
- Add `**/node_modules` to default exclude globs
- Add support for removing trailing comment marker from .vue files (treated as HTML)
- Add context menu details to README.md

## v0.0.198 - 2021-02-25

- revert commit which replaced deprecated storage path

## v0.0.197 - 2021-02-24

- Add filter icon to filters active info node
- Fix missing context flag for show export button
- Implement a sub tag regex (based on work by[calw20](https://github.com/calw20))
- Support opening a URL by clicking on the sub tag in the tree
- Wait for startup to finish before starting extension
- Re-enable hideTreeWhenEmpty option
- Add delay before hiding tree when empty to prevent view disappearing on refresh
- Allow use of alternative "iconColor" in highlights configuration
- Add support for grouping by sub tag
- Add more commands to tree view context menu
- Add support for highlighting sub tags
- Use storageUri instead of deprecated storagePath
- Don't override rgba alpha value if opacity is unset

## v0.0.196 - 2021-01-21

- Fix compact folders when grouping by tag
- Fix description of 'hide tree when empty' option
- Add support for total todo count in view title
- Temporarily disable hideTreeWhenEmpty (Will be re-enabled after January release of VSCode)

## v0.0.195 - 2021-01-20

- Fix icon colour check
- Fix coloured octicons

## v0.0.194 - 2021-01-18

- Make storage folder creation (if required) more robust
- Improve icon colouring under error conditions
- Add localization support for zh-cn (thanks to [loniceras](https://github.com/loniceras))
- Add context menu option to toggle compact folders

## v0.0.193 - 2020-12-31

- Add support for a simple colour scheme to apply to the highlights
- Default to 'TODO' if all tags are removed
- Add some icons to the scan mode and nothing found messages
- Extend information about `($TAGS)`
- Fix icons in README.md

## v0.0.192 - 2020-12-10

- Use unique filenames for pattern files
- Fix disappearing icon

## v0.0.191 - 2020-12-09

- Fix showing tree view when clicking status bar
- Change default setting of hideTreeWhenEmpty to false

## v0.0.190 - 2020-12-08

- Fix showInExplorer setting migration

## v0.0.189 - 2020-12-07

- Remove showInExplorer setting and associated view (thanks to [tristan957](https://github.com/tristan957))
- Change activation event to onStartupFinished
- Add option to disable use of pattern file

## v0.0.188 - 2020-11-10

- revert "Add word boundary after tags in default regex"

## v0.0.187 - 2020-11-09

- Fix hide tree when empty setting
- Improve filter removal dialog
- Update to latest octicons
- Allow theme colours to be used for codicons (octicons are not supported)
- Add word boundary after tags in default regex

## v0.0.186 - 2020-10-25

- Fix badly published version

## v0.0.185 - 2020-10-25

- Add support for hiding individual files
- Add dialog for removing folder filters
- Add timestamps to debug logging

## v0.0.184 - 2020-10-25

- Update theme colour names
- Fix case sensitivity on tag matching
- Use pattern file to avoid extra escaping of the regex
- Add option to disable sorting the tree to allow ripgrep sorting arguments to be used instead
- Add note to README.md about lack of codicon support for gutter icons
- Fix debug logging in ripgrep.js
- Add option to show scan mode in tree view
- Add option to scan workspace only
- Override Markdown comment detection with HTML comments

## v0.0.183 - 2020-10-06

- fix ripgrep link in README.md (thanks to [pke](https://github.com/pke))
- Remove extension.js.map from bundle
- Add context menu options to toggle badges and item counts
- Fix counts in tree when hideFromStatusBar is enabled
- kill ripgrep on deactivate
- Allow rgb and rgba colour definitions

## v0.0.182 - 2020-10-03

- Fix hidden file test
- Bundle the extension
- Fix colour validation

## v0.0.181 - 2020-10-01

- Revert change to remove node modules

## v0.0.180 - 2020-10-01

- Grey out expand/collapse buttons instead of hiding them
- Don't export status node in tree
- Fix tags extraction
- Fix hidden file test

## v0.0.179 - 2020-07-22

- Fix case sensitivity issue with root folder in Windows (thanks to [cobey](https://github.com/cobey))
- Add validation of colours in settings

## v0.0.178 - 2020-07-08

- Fix octicons link in README.md (thanks to [VictorHAS](https://github.com/VictorHAS))
- Fix tooltipFormat always displaying default (thanks to [jasonericdavis](https://github.com/jasonericdavis))
- Add missing 'default' in README.md (thanks to [rhynodesigns](https://github.com/rhynodesigns))
- Simplify export function

## v0.0.177 - 2020-06-16

- Allow buttons in tree view title to be configured
- Add export button to tree view title
- Use Code's codicons for title bar instead of custom icons
- Don't include files without extensions as hidden files
- Fix line numbers in export
- Add file path in tags only view export
- Don't include filtered nodes in tree counters
- Support configurable export path

## v0.0.176 - 2020-05-20

- Only scan workspaces with "file" scheme
- Add option to include hidden files
- Order configuration settings alphabetically in package.json
- Remove leading comments from multiline TODOs
- Update README.md with 'current file' status bar details

## v0.0.175 - 2020-05-13

- Remove migration code for version 0.0.161
- Add spaces and commas to status bar item
- Update to latest version of micromatch

## v0.0.174 - 2020-04-29

- Fix "Nothing found" indicator
- Remove colon from status bar when single counts are shown

## v0.0.173 - 2020-04-24

- Improve handling of tree view status item (showing active filters)
- Fix link to codicons in README.md
- Don't show 'None Found', just use '0' to keep the status bar item short
- Support removal of block comments in .jsonc files

## v0.0.172 - 2020-04-13

- Add "current file" option to status bar
- Add popup to show current status bar mode
- Add support for codicons
- Fix block comment extraction

## v0.0.171 - 2020-03-29

- Refresh files after a timeout
- Fix tag counts in tags only view
- Add support for hiding tags from the status bar counts
- Fix cycling of status bar

## v0.0.170 - 2020-03-22

- Add option to manually start the scan
- Add configuration for tooltip
- Don't refresh when regex is being changed
- Add more information about globs to README.md
- Allow file watcher glob to be configured
- Fix error on deactivate (thanks to [hacke2](https://github.com/hacke2))

## v0.0.169 - 2020-02-25

- Turn off file watcher by default

## v0.0.168 - 2020-02-25

- Support showing TODOs from current file only
- Show scan mode indication in status bar item
- Add HACK and XXX to default tags
- Add support for using built in search excludes
- Add button icons for README.md
- Allow array settings to be modified in the settings GUI
- Detect external file changes and update tree

## v0.0.167 - 2020-01-30

- Skip leading whitespace when highlighting
- Fix hide tree when empty option
- Count markdown TODOs as "TODO" when showing totals in the status bar
- Use a default colour for ruler highlights
- Add better explanation of useBuiltInExcludes setting
- Add support for compact folders in tree
- Fix path searches

## v0.0.166 - 2020-01-22

- Improve fix for case where $TAGS is not used in regex
- Support tag groups

## v0.0.165 - 2020-01-21

- Fix case where $TAGS is not used in regex

## v0.0.164 - 2020-01-20

- Fix missing background colours

## v0.0.163 - 2020-01-20

- Add some default icons and the BUG tag
- Fix reveal tree from status bar
- Remove files from tree when files are closed
- Add option to show icons in gutter

## v0.0.162 - 2019-11-04

- Add support for manually revealing the current file in the tree

## v0.0.161 - 2019-10-30

- Add support for theme colours in highlights
- Turn on highlighting by default (inverted editor background/foreground)

## v0.0.160 - 2019-10-11

- Fix submodule detection to look for .git file not folder

## v0.0.159 - 2019-10-11

- Add option to ignore git submodules
- Reorder icons to be consistent with the Explorer view
- Fix white icons in tree
- Remove cached icons when resetting cache
- Sort tags in reverse order to allow more specific tags to be found first
- Add link to wiki in README.md

## v0.0.158 - 2019-10-03

- Allow --no-config to be removed
- Simplify regex escape regexes
- Show active folder filters in tree

## v0.0.157 - 2019-10-01

- Further improvements to regex chars in tags

## v0.0.156 - 2019-09-29

- Fix top level folder globs
- Add support for including the built in files.exclude setting

## v0.0.155 - 2019-09-27

- Handle regex characters in tags properly

## v0.0.154 - 2019-09-25

- Add setting to control which editor URI schemes should be highlighted
- Add --no-config to ripgrep command to prevent parsing of user rg.conf files
- Fix object migration bug
- Improve folder globs for windows
- Replace all instances of tags in regex (thanks to [tylerbrockett](https://github.com/tylerbrockett))

## v0.0.153 - 2019-09-12

- Update README.md with new settings (thanks to [abelmatser](https://github.com/abelmatser))
- Fix ripgrep arguments
- Add "Reset Cache" command

## v0.0.152 - 2019-09-12

- Fix migration of 'tags' setting
- Open settings in a better way

## v0.0.151 - 2019-09-11

- Use global state (not workspace state) for "Don't Show This Again"

## v0.0.150 - 2019-09-11

- Make "Open Settings" work for Insiders too

## v0.0.149 - 2019-09-11

- Fix "Ignore" option for settings migration warning

## v0.0.148 - 2019-09-11

- Move settings into groups
- Make settings in README.md easier to read

## v0.0.147 - 2019-09-10

- Fix broken match extraction
- Fix 'os' library import for export function (thanks to [thalesfsp](https://github.com/thalesfsp))
- Fix settings table in README.md

## v0.0.146 - 2019-09-09

- Simplify regex for decoding results and fall back to old method on failure

## v0.0.145 - 2019-09-07

- Allow use of the todo-tree icon in the tree

## v0.0.144 - 2019-09-07

- Improve decoding of ripgrep results (thanks to [Quacky2200](https://github.com/Quacky2200))

## v0.0.143 - 2019-08-27

- Remove use of deprecated rootPath when exporting tree
- Add option to configure border radius on highlights
- Check file path when looking for existing todo nodes

## v0.0.142 - 2019-08-21

- Fix magenta icon
- Handle tags at the end of lines better

## v0.0.141 - 2019-08-13

- Fix custom coloured icons
- Sort folders before files

## v0.0.140 - 2019-08-12

- Update icons to match the 1.37.0 GUI (great work by [johnletey](https://github.com/johnletey) - many thanks!)
- Add option to hide ruler markers
- Add option to reveal tree when clicking the status bar

## v0.0.139 - 2019-07-15

- Add option to hide icons when grouping by tag
- Add support for fontStyle, fontWeight and textDecoration to highlights

## v0.0.138 - 2019-07-01

- Fix multiline highlight

## v0.0.137 - 2019-06-30

- Fix error in isHex function
- Add folder filtering context menu
- Make multiline TODO highlights work properly
- Add option to disable hiding the tree when it is empty

## v0.0.136 - 2019-06-28

- Add option to highlight line to full width of the editor

## v0.0.135 - 2019-06-13

- Add tree export feature

## v0.0.134 - 2019-06-02

- Add license

## v0.0.133 - 2019-06-02

- Add option to prevent globs being passed to ripgrep

## v0.0.132 - 2019-05-14

- Add option to highlight the comment characters in front of the tag
- Add option to highlight the comment characters in front of the tag and text (thanks to [sidpagariya](https://github.com/sidpagariya))
- Improve glob handling (thanks to [somewhatabstract](https://github.com/somewhatabstract))
- Prevent finding TODOs in output windows, etc.
- Fix clearing of filter
- Add missing icons in README.md

## v0.0.131 - 2019-05-10

- Add configuration for reveal behaviour (thanks to [pd93](https://github.com/pd93))
- Fixed install instructions in README.md (thanks to [patros](https://github.com/patros))

## v0.0.130 - 2019-04-25

- Improve experience for contributors (thanks to [true0r](https://github.com/true0r))
- Remove colon in format strings (thanks to [true0r](https://github.com/true0r))
- Fix hideFromTree for complex tags
- Fix detection of multiline highlights in open files

## v0.0.129 - 2019-04-17

- Add "scan open files only"/"scan workspace" toggle button
- Fix previous fix (sigh)

## v0.0.128 - 2019-04-16

- Use old highlight mechanism if no tag is extracted from the match

## v0.0.127 - 2019-04-14

- Support multiline TODOs
- Save filter state

## v0.0.126 - 2019-03-27

- Add option to hide tags from tree, but still highlight in files
- Add link to octicons to README.md

## v0.0.125 - 2019-03-11

- Revert adding word boundary from default regex

## v0.0.124 - 2019-03-07

- Fix ripgrep argument combination (sorry again!)

## v0.0.123 - 2019-03-07

- Fix default regex (sorry!)

## v0.0.122 - 2019-03-06

- Set default ripgrepArgs to include "--max-columns=1000"
- Add word boundary to default regex

## v0.0.121 - 2019-03-04

- Add support for ${filename} in label format
- Remove redundant dependency on minimatch

## v0.0.120 - 2019-02-27

- Fix error when creating resources

## v0.0.119 - 2019-02-19

- Use globalStoragePath instead of storagePath

## v0.0.118 - 2019-02-10

- Fix isNaN error (thanks to [JakubKoralewski](https://github.com/JakubKoralewski))

## v0.0.117 - 2019-02-08

- Add support for overview ruler configuration

## v0.0.116 - 2019-01-28

- Update to the latest octicons

## v0.0.115 - 2019-01-18

- Don't set default background colours unless a background is specified

## v0.0.114 - 2019-01-11

- Fix crash when highlight colour is not defined

## v0.0.113 - 2019-01-10

- Add opacity option to highlights
- Removed settings migration code

## v0.0.112 - 2019-01-01

- Fix line number in label format
- Add black and white colours

## v0.0.111 - 2018-12-21

- Add support for showing counts in the tree
- Add top three counts option to status bar
- Add configuration of TODO item labels
- Remove deprecated settings
- Fix root folder configuration

## v0.0.110 - 2018-12-17

- Fix bug in tag counting

## v0.0.109 - 2018-12-11

- Add support for showing counts of tags in the status bar
- Fix showTagsFromOpenFilesOnly

## v0.0.108 - 2018-12-09

- Add option to sort tags only view alphabetically

## v0.0.107 - 2018-11-28

- Add line number to tooltip
- Add new minimal view (tags only)
- Fix context.storagePath creation error
- Start adding unit tests
- Fix tag extraction function (properly)

## v0.0.106 - 2018-11-22

- Fix tag extraction function

## v0.0.105 - 2018-11-21

- Don't add entries for open files if already found by search
- Don't remove items from tree when file is closed and showTagsFromOpenFilesOnly is false

## v0.0.104 - 2018-11-21

- Don't use case sensitive group nodes if regexCaseSensitive if false
- Remove items from tree when file is closed and showTagsFromOpenFilesOnly is true

## v0.0.103 - 2018-11-19

- Fix globs migration error

## v0.0.102 - 2018-11-17

- Make globs work properly (at last!)
- Fix showTagsFromOpenFilesOnly option
- Expand ${workspaceFolder} in rootFolder for all workspaces

## v0.0.101 - 2018-11-06

- Provide configuration for included/excluded workspace folders

## v0.0.100 - 2018-11-05

- Handle situation where there are no workspace folders better

## v0.0.99 - 2018-11-04

- Trap errors when there are no workspaces

## v0.0.98 - 2018-11-02

- Allow debug channel to be enabled/disabled without reloading the window

## v0.0.97 - 2018-10-30

- Fix trailing slash on windows paths
- Remove leading newlines from matches in files
- Show `line <n>` for tags with no content when grouping by tag

## v0.0.96 - 2018-10-23

- Don't sort tags within files

## v0.0.95 - 2018-10-22

- Fix workspace paths
- Replace backslashes in the tags list with \\x5c

## v0.0.94 - 2018-10-22

- Set workspaces when first TODO is added

## v0.0.93 - 2018-10-21

- Major refactor to simplify and remove unused code
- Stop using ripgrep for single file updates
- Add configuration setting for badges and SCM state
- Fix configuration example and rust regex link ([#82](https://github.com/Gruntfuggly/todo-tree/issues/82) and [#79](https://github.com/Gruntfuggly/todo-tree/issues/79))
- Support multiple workspaces properly
- Preserve expansion state when changing view and reloading the window

## v0.0.92 - 2018-10-02

- Add support for case insensitive tag matching

## v0.0.91 - 2018-10-02

- Sort tree alphabetically when grouping by tag

## v0.0.90 - 2018-09-28

- Allow proper highlighting without using tags setting
- Reveal items in the middle of the window ([#76](https://github.com/Gruntfuggly/todo-tree/issues/76)

## v0.0.89 - 2018-09-26

- Fix stupid label trimming error

## v0.0.88 - 2018-09-22

- Allow customHighlight match by regex

## v0.0.87 - 2018-09-22

- Support multiple tags on the same line

## v0.0.86 - 2018-09-10

- Allow the icon colour to be explicit set in the custom and default highlight settings.

## v0.0.85 - 2018-09-07

- Restore 'expanded', 'flat' and 'grouped' default configuration settings  (fixes [#68](https://github.com/Gruntfuggly/todo-tree/issues/68))

## v0.0.84 - 2018-09-06

- Fix tree elements not appearing when there is no workspace (fixes [#67](https://github.com/Gruntfuggly/todo-tree/issues/67))
- Use workspaceState for view state instead of workspace settings
- Remove redundant settings from README.md
- Fix a bunch of typos in various files

## v0.0.83 - 2018-09-04

- If foreground is not specified, use black or white depending on background colour
- If foreground is not specified, use background for icon colour if specified, else deprecated colours

## v0.0.82 - 2018-09-02

- Fix settings for unknown tags (e.g. markdown TODOs)

## v0.0.81 - 2018-09-02

- Fix spelling mistake in package.json

## v0.0.80 - 2018-09-02

- Extend configurability of highlights

## v0.0.79 - 2018-08-22

- Add support for highlight tag only, tag and text, or entire line
- Inhibit tracking document when selecting from tree

## v0.0.78 - 2018-08-06

- Prevent tracking file when grouping enabled

## v0.0.77 - 2018-08-03

- Track open file in the tree views

## v0.0.76 - 2018-07-31

- Add information about header buttons to README.md

## v0.0.75 - 2018-07-31

- Add commands for adding and removing tags
- Add note to README.md about reloading the window after installation
- Add note to README.md about excluding files and folders

## v0.0.74 - 2018-07-31

- Fix showing highlights properly

## v0.0.73 - 2018-07-30

- Show highlights in all editors (not just the active editor) (fixes [#61](https://github.com/Gruntfuggly/todo-tree/issues/61))

## v0.0.72 - 2018-07-16

- Treat process as a stream to avoid buffer size problems

## v0.0.71 - 2018-07-13

- Inhibit failure messages when there is nothing found

## v0.0.70 - 2018-07-13

- Allow configuration of buffer size to cope with large amounts of TODOs (thanks to [somewhatabstract](https://github.com/somewhatabstract))

## v0.0.69 - 2018-07-12

- Support custom icons from the octicon set

## v0.0.68 - 2018-07-12

- Fix trailing slash in rootFolder (Windows)

## v0.0.67 - 2018-07-12

- Add support for interrupt/restart of scan

## v0.0.66 - 2018-07-06

- Allow delay before highlighting to be configured

## v0.0.65 - 2018-07-02

- Fix icons for folders
- Add start of line as start of tag marker

## v0.0.64 - 2018-06-29

- Add support for grouping by tags

## v0.0.63 - 2018-06-14

- Cope with languages that don't have block comments

## v0.0.62 - 2018-06-14

- Handle missing languages when checking block comments

## v0.0.61 - 2018-06-14

- Tidy up trailing block comments
- Fix error when checking for changed editors (thanks to [md2perpe](https://github.com/md2perpe))

## v0.0.60 - 2018-06-11

- Improve tag matching icon colours

## v0.0.59 - 2018-06-10

- Add option to disable scanning of workspace

## v0.0.58 - 2018-06-05

- Add in file highlighting
- Remove leading comments from tree

## v0.0.57 - 2018-05-28

- Apply globs to files out of workspace

## v0.0.56 - 2018-05-28

- Add configuration to disable auto refresh

## v0.0.55 - 2018-05-25

- Add filter function
- Refresh or rebuild (as appropriate) the tree on config changes

## v0.0.54 - 2018-05-23

- Add expand/collapse buttons
- Fix link to rust regex docs
- Change example glob pattern in config

## v0.0.53 - 2018-05-17

- Restore icons to the explorer tree view

## v0.0.52 - 2018-05-12

- Inhibit warning if version of vscode is earlier than 1.23

## v0.0.51 - 2018-05-11

- Add tree view to activity bar

## v0.0.50 - 2018-05-09

- Fix bad display of README.md in marketplace

## v0.0.34 - 2018-05-09

- Add support for additional ripgrep arguments
- Add support for diagnostic logging (to Output window)
- Improve configuration section of README.md

## v0.0.33 - 2018-04-27

- Allow variable substitution (including ${workspaceFolder}) in todo-tree.rootFolder

## v0.0.32 - 2018-04-25

- Show TODOs from open files which are not within the workspace. Note: Due to a limitation of VSCode, they will only appear as the files are loaded.
- Split tags out of regex to simplify configuration. Note: existing configurations should still work.
- Removed autoUpdate flag as it seems a but irrelevant now
- Improve stability of tree

## v0.0.31 - 2018-03-19

- Fix executable name for Windows

## v0.0.30 - 2018-03-17

- Inhibit error when no root folder is initially available

## v0.0.29 - 2018-03-16

- Add support for multiple workspaces
- Refresh view when configuration is modified

## v0.0.28 - 2018-03-15

- Fix sort function

## v0.0.27 - 2018-03-14

- Locate ripgrep dynamically (thanks to [ericmoritz](https://github.com/ericmoritz))

## v0.0.26 - 2018-03-08

- Try resetting the ripgrep path if the current path is not found

## v0.0.25 - 2018-03-08

- Support new location of vscode-ripgrep for 1.21.0

## v0.0.24 - 2018-03-06

- Inhibit error messages from ripgrep (stops error when current folder is empty)
- Refresh current file when editor is closed

## v0.0.23 - 2018-02-22

- Allow hex codes to be used to specify icon colours

## v0.0.22 - 2018-02-21

- Add keywords to package.json
- Update description

## v0.0.21 - 2018-02-20

- Added list of available icon colours to configuration description

## v0.0.20 - 2018-02-19

- Added a screenshot to the README.md

## v0.0.19 - 2018-02-19

- Allow icon colour customization based on type of tag

## v0.0.18 - 2018-02-16

- Fixed default regex for HTML (thanks to [kcmr](https://github.com/kcmr))

## v0.0.17 - 2018-02-16

- Add support for file icons from theme
- Add customizable icon colour for todo icon

## v0.0.16 - 2018-02-16

- Fix single file update in flat view

## v0.0.15 - 2018-02-02

- Fix globs in Windows

## v0.0.14 - 2018-01-17

- If vscode-ripgrep is not found in the standard location, try finding it using the application installation path.

## v0.0.13 - 2018-01-16

- Hide the viewlet by default - instead of when detecting there is nothing in the tree.
- Use the version of vscode-ripgrep and comes with vscode itself. This is a lot simpler and makes startup quicker too. The downside is that if vscode is installed somewhere other than the default location, it won't be found.

## v0.0.12 - 2018-01-05

- Force the use of an older version of vscode-ripgrep. The latest version seems to fail to install.

## v0.0.11 - 2017-12-16

- Remove command logging

## v0.0.10 - 2017-12-16

- Add flat list view

## v0.0.9 - 2017-12-13

- Only show the tree view if it's not empty

## v0.0.8 - 2017-12-12

- Fix scanning message
- sort results to keep tree consistent
- remove empty parent nodes from the tree
- ignore files outside the root folder
- handle filenames containing spaces

## v0.0.7 - 2017-11-30

- Add auto update when saving files
- Add preference to show tree expanded by default

## v0.0.6 - 2017-11-28

- Only attempt install if todo-tree.ripgrep is not defined and show some info if the install fails

## v0.0.5 - 2017-11-28

- Attempt to install vscode-ripgrep directly from the extension

## v0.0.4 - 2017-11-28

- Attempt to reinstall vscode-ripgrep automatically

## v0.0.3 - 2017-11-28

- Removed redundant dependencies
- Add some info for fixing the windows version of vscode-ripgrep

## v0.0.2 - 2017-11-27

- Made it work on Windows
- Add configuration for ripgrep executable path
- Improved error handling

## v0.0.1 - 2017-11-23

- Initial release
