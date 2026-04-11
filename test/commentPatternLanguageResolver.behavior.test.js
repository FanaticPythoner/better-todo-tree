var resolverModule = require( '../src/commentPatternLanguageResolver.js' );

QUnit.module( 'behavioral comment pattern language resolver' );

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
    }, {
        getCommentPattern: function( candidate )
        {
            return [ '.py', '.md', '.cpp', '.sh', '.jsonc' ].indexOf( candidate ) !== -1 ? { candidate: candidate } : undefined;
        }
    } );

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
    }, {
        getCommentPattern: function( candidate )
        {
            calls.push( candidate );
            return candidate === '.ts' ? { candidate: candidate } : undefined;
        }
    } );

    assert.equal( resolver( 'typescriptreact' ), '.ts' );
    assert.deepEqual( calls, [ '.tsx', '.ts' ] );
} );
