var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );
var events = require( 'events' );
var childProcess = require( 'child_process' );

var ripgrep = require( '../src/ripgrep.js' );
var utils = require( '../src/utils.js' );
var stubs = require( './stubs.js' );

function createFakeProcess()
{
    var process = new events.EventEmitter();
    process.stdout = new events.EventEmitter();
    process.stderr = new events.EventEmitter();
    process.kill = function( signal )
    {
        this.emit( 'close', null, signal );
    };
    return process;
}

QUnit.module( "ripgrep streaming search", function( hooks )
{
    var originalSpawn;
    var fakeRgPath;

    hooks.beforeEach( function()
    {
        var testConfig = stubs.getTestConfig();
        utils.init( testConfig );

        originalSpawn = childProcess.spawn;
        fakeRgPath = path.join( os.tmpdir(), 'todo-tree-rg-test' );
        fs.writeFileSync( fakeRgPath, '' );
    } );

    hooks.afterEach( function()
    {
        childProcess.spawn = originalSpawn;
        ripgrep.kill();

        if( fs.existsSync( fakeRgPath ) )
        {
            fs.unlinkSync( fakeRgPath );
        }
    } );

    QUnit.test( "parseArgumentString keeps quoted sections intact", function( assert )
    {
        assert.deepEqual(
            ripgrep.parseArgumentString( '--max-columns=1000 --glob "src/**/*.js" --type-add=foo:*.foo' ),
            [ '--max-columns=1000', '--glob', 'src/**/*.js', '--type-add=foo:*.foo' ]
        );
    } );

    QUnit.test( "search parses streamed output across chunk boundaries", function( assert )
    {
        childProcess.spawn = function()
        {
            var fakeProcess = createFakeProcess();

            process.nextTick( function()
            {
                fakeProcess.stdout.emit( 'data', Buffer.from( '/tmp/file.js:1:1:TODO first\n/tmp/file.js:2:3:FIX' ) );
                fakeProcess.stdout.emit( 'data', Buffer.from( 'ME second\n' ) );
                fakeProcess.emit( 'close', 0, null );
            } );

            return fakeProcess;
        };

        return ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: '(TODO|FIXME)',
            unquotedRegex: '(TODO|FIXME)',
            additional: '',
            globs: [],
            multiline: false
        } ).then( function( matches )
        {
            assert.equal( matches.length, 2 );
            assert.equal( matches[ 0 ].fsPath, '/tmp/file.js' );
            assert.equal( matches[ 0 ].line, 1 );
            assert.equal( matches[ 1 ].match, 'FIXME second' );
        } );
    } );

    QUnit.test( "kill cancels the active search", function( assert )
    {
        childProcess.spawn = function()
        {
            return createFakeProcess();
        };

        var promise = ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: '(TODO)',
            unquotedRegex: '(TODO)',
            additional: '',
            globs: [],
            multiline: false
        } ).then( function()
        {
            assert.ok( false, 'expected search cancellation' );
        }, function( error )
        {
            assert.equal( error.cancelled, true );
        } );

        ripgrep.kill();

        return promise;
    } );

    QUnit.test( "search passes filenames with spaces and parentheses as a single spawn argument", function( assert )
    {
        var seenArgs;
        childProcess.spawn = function( executable, args )
        {
            seenArgs = args;

            var fakeProcess = createFakeProcess();
            process.nextTick( function()
            {
                fakeProcess.emit( 'close', 1, null );
            } );
            return fakeProcess;
        };

        return ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: '(TODO)',
            unquotedRegex: '(TODO)',
            additional: '',
            globs: [],
            multiline: false,
            filename: '/tmp/project (feature branch)/file name.js'
        } ).then( function()
        {
            assert.equal( seenArgs[ seenArgs.length - 1 ], '/tmp/project (feature branch)/file name.js' );
        } );
    } );
} );
