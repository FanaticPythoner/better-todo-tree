'use strict';

const path = require( 'path' );

/**@type {import('webpack').Configuration}*/
const config = {
    target: 'node',

    entry: './src/extension.js',
    output: {
        path: path.resolve( __dirname, 'dist' ),
        filename: 'extension.js',
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../[resource-path]'
    },
    devtool: 'source-map',
    externals: {
        vscode: 'commonjs vscode'
    }
};
module.exports = config;
