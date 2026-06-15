var resolverModule = require( '../src/commentPatternLanguageResolver.js' );
var commentPatternCatalog = require( '../src/commentPatternCatalog.js' );

QUnit.module( 'behavioral comment pattern language resolver' );

function createResolverUtils( getCommentPattern, signature )
{
    var catalog = commentPatternCatalog.createCommentPatternCatalog();

    return {
        getCommentPattern: getCommentPattern,
        resolveCommentPatternFileName: function( languageId )
        {
            return catalog.resolvePatternFileName( languageId );
        },
        getLanguageConfigurationSignature: function()
        {
            return signature || '';
        }
    };
}

QUnit.test( 'resolver derives notebook cell pattern filenames from VS Code language contributions', function( assert )
{
    var resolver = resolverModule.createCommentPatternLanguageResolver( {
        extensions: {
            all: [ {
                packageJSON: {
                    contributes: {
                        languages: [
                            { id: 'python', extensions: [ '.py' ] },
                            { id: 'markdown', extensions: [ '.md' ] },
                            { id: 'cpp', extensions: [ '.cpp', '.cc' ] },
                            { id: 'shellscript', extensions: [ '.sh' ] },
                            { id: 'jsonc', extensions: [ '.jsonc' ] }
                        ]
                    }
                }
            } ]
        }
    }, createResolverUtils( function( candidate )
    {
        return [ '.py', '.md', '.cpp', '.sh', '.jsonc' ].indexOf( candidate ) !== -1 ? { candidate: candidate } : undefined;
    } ) );

    assert.equal( resolver( 'python' ), '.py' );
    assert.equal( resolver( 'markdown' ), '.md' );
    assert.equal( resolver( 'cpp' ), '.cpp' );
    assert.equal( resolver( 'shellscript' ), '.sh' );
    assert.equal( resolver( 'jsonc' ), '.jsonc' );
} );

QUnit.test( 'resolver ignores unsupported candidates and keeps the first comment-pattern match per language id', function( assert )
{
    var calls = [];
    var resolver = resolverModule.createCommentPatternLanguageResolver( {
        extensions: {
            all: [ {
                packageJSON: {
                    contributes: {
                        languages: [
                            { id: 'typescriptreact', extensions: [ '.tsx', '.ts' ], filenames: [ 'ignored' ] }
                        ]
                    }
                }
            } ]
        }
    }, createResolverUtils( function( candidate )
    {
        calls.push( candidate );
        return candidate === '.ts' ? { candidate: candidate } : undefined;
    } ) );

    assert.equal( resolver( 'typescriptreact' ), '.ts' );
    assert.deepEqual( calls, [ '.tsx', '.ts' ] );
} );

QUnit.test( 'resolver normalizes contributed language tokens through catalog semantics', function( assert )
{
    var resolver = resolverModule.createCommentPatternLanguageResolver( {
        extensions: {
            all: [ {
                packageJSON: {
                    contributes: {
                        languages: [
                            {
                                id: 'typescriptreact',
                                aliases: [ 'TypeScript React', 'TSX' ],
                                extensions: [ '.tsx', '.ts' ]
                            }
                        ]
                    }
                }
            } ]
        }
    }, createResolverUtils( function( candidate )
    {
        return candidate === '.ts' ? { candidate: candidate } : undefined;
    } ) );

    assert.equal( resolver( 'typescriptreact' ), '.ts' );
    assert.equal( resolver( 'TypeScript React' ), '.ts' );
    assert.equal( resolver( 'typescript react' ), '.ts' );
    assert.equal( resolver( 'TSX' ), '.ts' );
    assert.equal( resolver( 'tsx' ), '.ts' );
} );

QUnit.test( 'resolver checks language ids and aliases after unsupported extension candidates', function( assert )
{
    var calls = [];
    var resolver = resolverModule.createCommentPatternLanguageResolver( {
        extensions: {
            all: [ {
                packageJSON: {
                    contributes: {
                        languages: [
                            {
                                id: 'fixturevue',
                                aliases: [ 'Fixture Vue' ],
                                extensions: [ '.fixturevue' ]
                            }
                        ]
                    }
                }
            } ]
        }
    }, createResolverUtils( function( candidate )
    {
        calls.push( candidate );
        return candidate === 'Fixture Vue' ? { candidate: candidate } : undefined;
    } ) );

    assert.equal( resolver( 'fixturevue' ), 'Fixture Vue' );
    assert.equal( resolver( 'fixture vue' ), 'Fixture Vue' );
    assert.deepEqual( calls, [ '.fixturevue', 'fixturevue', 'Fixture Vue' ] );
} );

QUnit.test( 'resolver rejects missing comment-pattern dependency at construction', function( assert )
{
    var error;

    try
    {
        resolverModule.createCommentPatternLanguageResolver( { extensions: { all: [] } }, {} );
    }
    catch( caught )
    {
        error = caught;
    }

    assert.ok( error instanceof Error );
    assert.equal( error.message, 'commentPatternLanguageResolver: utils.getCommentPattern is required.' );
} );

QUnit.test( 'resolver uses comment-pattern metadata without VS Code contributions', function( assert )
{
    var resolver = resolverModule.createCommentPatternLanguageResolver( {
        extensions: {
            all: []
        }
    }, createResolverUtils( function()
    {
        return undefined;
    } ) );

    assert.equal( resolver( 'vue' ), '.html' );
    assert.equal( resolver( 'javascript' ), '.js' );
    assert.equal( resolver( 'ts' ), '.ts' );
    assert.equal( resolver( 'scss' ), '.scss' );
    assert.equal( resolver( 'jsx' ), '.js' );
    assert.equal( resolver( 'tsx' ), '.ts' );
} );

QUnit.test( 'resolver refreshes cached mappings when language settings change', function( assert )
{
    var signature = 'before';
    var enabled = false;
    var resolver = resolverModule.createCommentPatternLanguageResolver( {
        extensions: {
            all: [ {
                packageJSON: {
                    contributes: {
                        languages: [
                            { id: 'fixturelang', extensions: [ '.fixturelang' ] }
                        ]
                    }
                }
            } ]
        }
    }, {
        getCommentPattern: function( candidate )
        {
            return enabled === true && candidate === '.fixturelang' ? { candidate: candidate } : undefined;
        },
        resolveCommentPatternFileName: function()
        {
            return undefined;
        },
        getLanguageConfigurationSignature: function()
        {
            return signature;
        }
    } );

    assert.equal( resolver( 'fixturelang' ), undefined );

    enabled = true;
    signature = 'after';

    assert.equal( resolver( 'fixturelang' ), '.fixturelang' );
} );
