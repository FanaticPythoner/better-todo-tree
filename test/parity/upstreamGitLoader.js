/**
 * Clones the upstream Gruntfuggly/todo-tree repository at the pinned commit
 * into a workspace-local cache directory, builds its webpack bundle (the
 * same artefact that ships in the published VSIX), and exposes module and
 * compiled-bundle loaders for the parity harness.
 *
 * Exports:
 *   loadModule(relativePath, stubs):
 *     Compile a single upstream source file as a CommonJS module with the
 *     supplied stub map. The parity harness uses it to swap stubs for
 *     vscode, ./tree.js, ./ripgrep.js, etc. while still executing real
 *     upstream detection logic.
 *   loadCompiledBundle(stubs):
 *     Load the compiled dist/extension.js bundle (the artefact inside the
 *     VSIX) as a CommonJS module with vscode stubbed. Used by smoke tests
 *     that verify the upstream produces a usable build artefact.
 *   ensureUpstreamCheckout() / ensureUpstreamBuild():
 *     Idempotent bootstrappers callable from test code.
 *
 * No upstream source or attribution is committed to this repository. All
 * upstream artefacts live under .tools/upstream-todo-tree/, which is listed
 * in both .gitignore and .vscodeignore.
 */

var Module = require( 'module' );
var child_process = require( 'child_process' );
var fs = require( 'fs' );
var path = require( 'path' );
var vm = require( 'vm' );

var UPSTREAM_REPO_URL = 'https://github.com/Gruntfuggly/todo-tree.git';
var UPSTREAM_COMMIT = '7761bd02406a5c5f5bc8da944a561eb3c12a48df';
var REPO_ROOT = path.resolve( __dirname, '..', '..' );
var UPSTREAM_DIR = path.join( REPO_ROOT, '.tools', 'upstream-todo-tree' );
var BUILD_HASH_FILE = path.join( UPSTREAM_DIR, '.upstream-build-hash' );
var COMPILED_BUNDLE_RELATIVE = path.join( 'dist', 'extension.js' );

var checkoutEnsured = false;
var buildEnsured = false;
var moduleCache = new Map();
var sourceCache = new Map();
var compiledCache = new Map();
var compiledBundleCache = null;

function runGit( args, options )
{
    var spawnOptions = Object.assign( { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'pipe' ] }, options || {} );
    var result = child_process.spawnSync( 'git', args, spawnOptions );

    if( result.error )
    {
        throw new Error( 'git ' + args.join( ' ' ) + ' failed: ' + result.error.message );
    }
    if( result.status !== 0 )
    {
        throw new Error(
            'git ' + args.join( ' ' ) + ' exited with status ' + result.status + ': ' +
            ( result.stderr ? String( result.stderr ).trim() : '<no stderr>' )
        );
    }

    return String( result.stdout || '' );
}

function runCommand( command, args, cwd, extraEnv )
{
    // Webpack 5.74 (pinned by upstream) ships pre-OpenSSL-3 hashing helpers
    // that throw ERR_OSSL_EVP_UNSUPPORTED on Node 17+; --openssl-legacy-provider
    // is applied locally so it never leaks into the better-todo-tree build.
    var baseEnv = Object.assign( {}, process.env, {
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        NODE_OPTIONS: ( process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : '' ) + '--openssl-legacy-provider'
    } );

    var result = child_process.spawnSync( command, args, {
        cwd: cwd,
        stdio: [ 'ignore', 'inherit', 'inherit' ],
        env: extraEnv ? Object.assign( baseEnv, extraEnv ) : baseEnv
    } );

    if( result.error )
    {
        throw new Error( command + ' ' + args.join( ' ' ) + ' failed: ' + result.error.message );
    }
    if( result.status !== 0 )
    {
        throw new Error( command + ' ' + args.join( ' ' ) + ' (cwd=' + cwd + ') exited with status ' + result.status );
    }
}

function runNpm( args, cwd )
{
    runCommand( 'npm', args, cwd );
}

function commitIsPresent( commit )
{
    var result = child_process.spawnSync( 'git', [ 'cat-file', '-e', commit ], {
        cwd: UPSTREAM_DIR,
        stdio: 'ignore'
    } );
    return result.status === 0;
}

function currentHead()
{
    return runGit( [ 'rev-parse', 'HEAD' ], { cwd: UPSTREAM_DIR } ).trim();
}

function ensureUpstreamCheckout()
{
    if( checkoutEnsured === true )
    {
        return UPSTREAM_DIR;
    }

    if( !fs.existsSync( path.join( UPSTREAM_DIR, '.git' ) ) )
    {
        fs.mkdirSync( path.dirname( UPSTREAM_DIR ), { recursive: true } );
        runGit( [ 'clone', '--quiet', UPSTREAM_REPO_URL, UPSTREAM_DIR ], { stdio: [ 'ignore', 'inherit', 'inherit' ] } );
    }

    if( commitIsPresent( UPSTREAM_COMMIT ) !== true )
    {
        runGit( [ 'fetch', '--quiet', 'origin', UPSTREAM_COMMIT ], { cwd: UPSTREAM_DIR, stdio: [ 'ignore', 'inherit', 'inherit' ] } );
    }

    if( currentHead() !== UPSTREAM_COMMIT )
    {
        runGit( [ '-c', 'advice.detachedHead=false', 'checkout', '--quiet', UPSTREAM_COMMIT ], {
            cwd: UPSTREAM_DIR,
            stdio: [ 'ignore', 'inherit', 'inherit' ]
        } );
    }

    if( currentHead() !== UPSTREAM_COMMIT )
    {
        throw new Error( 'ensureUpstreamCheckout: checkout did not land on ' + UPSTREAM_COMMIT );
    }

    checkoutEnsured = true;
    return UPSTREAM_DIR;
}

function buildHashMatches()
{
    if( !fs.existsSync( BUILD_HASH_FILE ) )
    {
        return false;
    }
    var recorded = fs.readFileSync( BUILD_HASH_FILE, 'utf8' ).trim();
    return recorded === UPSTREAM_COMMIT;
}

function bundleExists()
{
    return fs.existsSync( path.join( UPSTREAM_DIR, COMPILED_BUNDLE_RELATIVE ) );
}

function ensureUpstreamBuild()
{
    if( buildEnsured === true )
    {
        return path.join( UPSTREAM_DIR, COMPILED_BUNDLE_RELATIVE );
    }

    ensureUpstreamCheckout();

    if( buildHashMatches() === true && bundleExists() === true )
    {
        buildEnsured = true;
        return path.join( UPSTREAM_DIR, COMPILED_BUNDLE_RELATIVE );
    }

    if( !fs.existsSync( path.join( UPSTREAM_DIR, 'node_modules' ) ) )
    {
        runNpm( [ 'ci' ], UPSTREAM_DIR );
    }

    // Upstream vscode:prepublish invokes buildCodiconNames.js via a
    // /usr/local/bin/node shebang absent on Linux CI runners; invoke the two
    // build steps explicitly with process.execPath and the local webpack binary.
    runCommand( process.execPath, [ path.join( UPSTREAM_DIR, 'buildCodiconNames.js' ) ], UPSTREAM_DIR );
    runCommand(
        process.execPath,
        [ path.join( UPSTREAM_DIR, 'node_modules', 'webpack', 'bin', 'webpack.js' ), '--mode', 'production' ],
        UPSTREAM_DIR
    );

    if( !bundleExists() )
    {
        throw new Error( 'ensureUpstreamBuild: webpack did not produce ' + COMPILED_BUNDLE_RELATIVE );
    }

    fs.writeFileSync( BUILD_HASH_FILE, UPSTREAM_COMMIT + '\n', 'utf8' );

    buildEnsured = true;
    return path.join( UPSTREAM_DIR, COMPILED_BUNDLE_RELATIVE );
}

function normalizeRelativePath( relativePath )
{
    var normalized = String( relativePath || '' ).replace( /\\/g, '/' );

    if( /\.[a-z0-9]+$/i.test( path.posix.basename( normalized ) ) !== true )
    {
        normalized += '.js';
    }

    return normalized;
}

function loadSource( relativePath )
{
    if( sourceCache.has( relativePath ) )
    {
        return sourceCache.get( relativePath );
    }

    ensureUpstreamCheckout();

    var absolutePath = path.join( UPSTREAM_DIR, relativePath );
    if( !fs.existsSync( absolutePath ) )
    {
        throw new Error( 'loadSource: ' + relativePath + ' is missing from upstream checkout at ' + UPSTREAM_DIR );
    }

    var source = fs.readFileSync( absolutePath, 'utf8' );
    sourceCache.set( relativePath, source );
    return source;
}

function compileWrapper( source, syntheticPath )
{
    if( compiledCache.has( syntheticPath ) )
    {
        return compiledCache.get( syntheticPath );
    }

    var compiled = vm.runInThisContext( Module.wrap( source ), { filename: syntheticPath } );
    compiledCache.set( syntheticPath, compiled );
    return compiled;
}

function loadModule( relativePath, stubs )
{
    var normalized = normalizeRelativePath( relativePath );
    var hasStubs = !!stubs && Object.keys( stubs ).length > 0;

    if( hasStubs !== true && moduleCache.has( normalized ) )
    {
        return moduleCache.get( normalized ).exports;
    }

    var source = loadSource( normalized );
    var syntheticPath = path.join( UPSTREAM_DIR, normalized );
    var upstreamModule = new Module( syntheticPath, module.parent );

    upstreamModule.filename = syntheticPath;
    upstreamModule.paths = Module._nodeModulePaths( path.dirname( syntheticPath ) );

    function localRequire( request )
    {
        if( hasStubs === true && Object.prototype.hasOwnProperty.call( stubs, request ) )
        {
            return stubs[ request ];
        }

        if( request.indexOf( './' ) === 0 || request.indexOf( '../' ) === 0 )
        {
            return loadModule( path.posix.join( path.posix.dirname( normalized ), request ) );
        }

        return require( request );
    }

    var compiled = compileWrapper( source, syntheticPath );

    compiled.call( upstreamModule.exports, upstreamModule.exports, localRequire, upstreamModule, syntheticPath, path.dirname( syntheticPath ) );

    if( hasStubs !== true )
    {
        moduleCache.set( normalized, upstreamModule );
    }

    return upstreamModule.exports;
}

function loadCompiledBundle( stubs )
{
    var bundlePath = ensureUpstreamBuild();
    var hasStubs = !!stubs && Object.keys( stubs ).length > 0;

    if( hasStubs !== true && compiledBundleCache !== null )
    {
        return compiledBundleCache.exports;
    }

    var source = fs.readFileSync( bundlePath, 'utf8' );
    var bundleModule = new Module( bundlePath, module.parent );

    bundleModule.filename = bundlePath;
    bundleModule.paths = Module._nodeModulePaths( path.dirname( bundlePath ) );

    function bundleRequire( request )
    {
        if( hasStubs === true && Object.prototype.hasOwnProperty.call( stubs, request ) )
        {
            return stubs[ request ];
        }
        return require( request );
    }

    var compiled = vm.runInThisContext( Module.wrap( source ), { filename: bundlePath } );
    compiled.call( bundleModule.exports, bundleModule.exports, bundleRequire, bundleModule, bundlePath, path.dirname( bundlePath ) );

    if( hasStubs !== true )
    {
        compiledBundleCache = bundleModule;
    }

    return bundleModule.exports;
}

function getLicensePath()
{
    ensureUpstreamCheckout();
    return path.join( UPSTREAM_DIR, 'License.txt' );
}

module.exports.UPSTREAM_COMMIT = UPSTREAM_COMMIT;
module.exports.UPSTREAM_REPO_URL = UPSTREAM_REPO_URL;
module.exports.UPSTREAM_DIR = UPSTREAM_DIR;
module.exports.COMPILED_BUNDLE_RELATIVE = COMPILED_BUNDLE_RELATIVE;
module.exports.ensureUpstreamCheckout = ensureUpstreamCheckout;
module.exports.ensureUpstreamBuild = ensureUpstreamBuild;
module.exports.loadModule = loadModule;
module.exports.loadCompiledBundle = loadCompiledBundle;
module.exports.getLicensePath = getLicensePath;
