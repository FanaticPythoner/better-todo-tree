var fs = require( 'fs' );
var path = require( 'path' );

function getWorkflowPaths()
{
    return fs.readdirSync( path.join( __dirname, '..', '.github', 'workflows' ) )
        .filter( function( fileName )
        {
            return fileName.endsWith( '.yml' );
        } )
        .map( function( fileName )
        {
            return path.join( __dirname, '..', '.github', 'workflows', fileName );
        } );
}

QUnit.module( 'GitHub workflows' );

QUnit.test( 'external workflow actions are pinned to full commit SHAs', function( assert )
{
    getWorkflowPaths().forEach( function( workflowPath )
    {
        var contents = fs.readFileSync( workflowPath, 'utf8' );
        contents.split( /\r?\n/ ).forEach( function( line )
        {
            var match = line.match( /^\s*uses:\s*([^\s#]+)\s*$/ );
            if( !match )
            {
                return;
            }

            var reference = match[ 1 ];
            if( reference.indexOf( './' ) === 0 )
            {
                return;
            }

            assert.ok(
                /^[^@]+@[0-9a-f]{40}$/.test( reference ),
                path.basename( workflowPath ) + ' pins ' + reference
            );
        } );
    } );
} );

QUnit.test( 'release workflow requests provenance-related permissions', function( assert )
{
    var contents = fs.readFileSync( path.join( __dirname, '..', '.github', 'workflows', 'release.yml' ), 'utf8' );

    assert.ok( contents.indexOf( 'id-token: write' ) !== -1 );
    assert.ok( contents.indexOf( 'attestations: write' ) !== -1 );
    assert.ok( contents.indexOf( 'contents: write' ) !== -1 );
} );

QUnit.test( 'latest workflow publishes a moving prerelease from master', function( assert )
{
    var latestWorkflow = fs.readFileSync( path.join( __dirname, '..', '.github', 'workflows', 'latest.yml' ), 'utf8' );
    var movingReleaseScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'create-or-update-moving-github-release.sh' ), 'utf8' );

    assert.ok( latestWorkflow.indexOf( 'push:\n    branches:\n      - master' ) !== -1 );
    assert.ok( latestWorkflow.indexOf( 'schedule:' ) !== -1 );
    assert.ok( latestWorkflow.indexOf( 'group: latest-master' ) !== -1 );
    assert.ok( latestWorkflow.indexOf( "RELEASE_TAG: latest" ) !== -1 );
    assert.ok( latestWorkflow.indexOf( 'RELEASE_TARGET_BRANCH: master' ) !== -1 );
    assert.ok( latestWorkflow.indexOf( 'run: bash scripts/release/create-or-update-moving-github-release.sh' ) !== -1 );
    assert.ok( movingReleaseScript.indexOf( 'git push --force origin "refs/tags/$RELEASE_TAG"' ) !== -1 );
    assert.ok( movingReleaseScript.indexOf( 'gh release delete "$RELEASE_TAG" --yes' ) !== -1 );
    assert.ok( movingReleaseScript.indexOf( 'write-release-notes.sh' ) !== -1 );
    assert.ok( movingReleaseScript.indexOf( '--channel latest' ) !== -1 );
    assert.ok( movingReleaseScript.indexOf( '--prerelease' ) !== -1 );
} );

QUnit.test( 'release workflows build and publish from the resolved release ref', function( assert )
{
    var releaseWorkflow = fs.readFileSync( path.join( __dirname, '..', '.github', 'workflows', 'release.yml' ), 'utf8' );
    var reusableBuildWorkflow = fs.readFileSync( path.join( __dirname, '..', '.github', 'workflows', 'reusable-build-vsix.yml' ), 'utf8' );
    var publishVsCodeScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'publish-vscode-marketplace.sh' ), 'utf8' );
    var publishOpenVsxScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'publish-open-vsx.sh' ), 'utf8' );
    var githubReleaseScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'create-github-release.sh' ), 'utf8' );
    var releaseArtifactsScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'release-artifacts.sh' ), 'utf8' );

    assert.ok( releaseWorkflow.indexOf( 'release_ref: ${{ steps.meta.outputs.release_ref }}' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'ref: ${{ needs.preflight.outputs.release_ref }}' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'run: bash scripts/release/resolve-release-metadata.sh' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'publish:' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'run: bash scripts/release/publish-vscode-marketplace.sh' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'run: bash scripts/release/publish-open-vsx.sh' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'continue-on-error: true' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'steps.publish_open_vsx.outcome }}" == \'failure\'' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( '::warning::Open VSX publication failed after VS Code Marketplace publication completed.' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'run: bash scripts/release/create-github-release.sh' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'github-release:\n    needs:\n      - preflight\n      - publish' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'publish-open-vsx:' ) === -1 );
    assert.ok( reusableBuildWorkflow.indexOf( 'ref:' ) !== -1 );
    assert.ok( reusableBuildWorkflow.indexOf( 'ref: ${{ inputs.ref }}' ) !== -1 );
    assert.ok( publishVsCodeScript.indexOf( '@vscode/vsce publish' ) !== -1 );
    assert.ok( publishVsCodeScript.indexOf( '--skip-duplicate' ) !== -1 );
    assert.ok( publishOpenVsxScript.indexOf( 'ovsx publish' ) !== -1 );
    assert.ok( publishOpenVsxScript.indexOf( '--skip-duplicate' ) !== -1 );
    assert.ok( releaseArtifactsScript.indexOf( "No VSIX artifacts were found in '" ) !== -1 );
    assert.ok( githubReleaseScript.indexOf( 'release_artifact_files' ) !== -1 );
    assert.ok( githubReleaseScript.indexOf( "gh release view \"$RELEASE_TAG\"" ) !== -1 );
    assert.ok( githubReleaseScript.indexOf( 'gh release upload "$RELEASE_TAG" "${files[@]}" --clobber' ) !== -1 );
} );

QUnit.test( 'ci workflow uploads only the smoke-test linux artifact', function( assert )
{
    var ciWorkflow = fs.readFileSync( path.join( __dirname, '..', '.github', 'workflows', 'ci.yml' ), 'utf8' );

    assert.ok( ciWorkflow.indexOf( 'rm -rf artifacts/vsix' ) !== -1 );
    assert.ok( ciWorkflow.indexOf( 'artifacts/vsix/*-linux-x64.vsix' ) !== -1 );
    assert.ok( ciWorkflow.indexOf( 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02' ) !== -1 );
} );

QUnit.test( 'security workflow keeps dependency review and CodeQL coverage pinned', function( assert )
{
    var securityWorkflow = fs.readFileSync( path.join( __dirname, '..', '.github', 'workflows', 'security.yml' ), 'utf8' );

    assert.ok( securityWorkflow.indexOf( 'actions/dependency-review-action@2031cfc080254a8a887f58cffee85186f0e49e48' ) !== -1 );
    assert.ok( securityWorkflow.indexOf( 'github/codeql-action/init@c10b8064de6f491fea524254123dbe5e09572f13' ) !== -1 );
    assert.ok( securityWorkflow.indexOf( 'github/codeql-action/analyze@c10b8064de6f491fea524254123dbe5e09572f13' ) !== -1 );
} );

QUnit.test( 'justfile exposes GitHub Actions verification recipes', function( assert )
{
    var justfile = fs.readFileSync( path.join( __dirname, '..', 'justfile' ), 'utf8' );
    var releaseWorkflow = fs.readFileSync( path.join( __dirname, '..', '.github', 'workflows', 'release.yml' ), 'utf8' );
    var latestWorkflow = fs.readFileSync( path.join( __dirname, '..', '.github', 'workflows', 'latest.yml' ), 'utf8' );

    assert.ok( justfile.indexOf( 'bootstrap-release-env:' ) !== -1 );
    assert.ok( justfile.indexOf( 'lint-actions:' ) !== -1 );
    assert.ok( justfile.indexOf( 'test-actions-ci:' ) !== -1 );
    assert.ok( justfile.indexOf( 'test-actions-release-build:' ) !== -1 );
    assert.ok( justfile.indexOf( 'test-actions-latest-build:' ) !== -1 );
    assert.ok( justfile.indexOf( 'test-actions:' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0' ) !== -1 );
    assert.ok( latestWorkflow.indexOf( 'actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0' ) !== -1 );
} );
