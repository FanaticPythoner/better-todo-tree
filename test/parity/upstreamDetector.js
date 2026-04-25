// Re-export of the real-extension harness. Upstream modules load verbatim
// from commit 7761bd02 via test/parity/upstreamGitLoader.js; no upstream
// source is copied in-tree.

module.exports = require( './upstreamExtensionHarness.js' );
