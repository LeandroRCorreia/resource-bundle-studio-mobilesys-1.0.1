//@ts-check
'use strict';

const path = require('node:path');
const CopyPlugin = require('copy-webpack-plugin');

/** @type {import('webpack').Configuration[]} */
module.exports = [
  // -- Extension host bundle ------------------------------------------------
  {
    name: 'extension',
    target: 'node',
    mode: 'none',
    entry: './src/extension.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'extension.js',
      libraryTarget: 'commonjs2',
    },
    externals: { vscode: 'commonjs vscode' },
    resolve: { extensions: ['.ts', '.js'] },
    module: {
      rules: [{ test: /\.ts$/, loader: 'ts-loader', exclude: /node_modules/ }],
    },
    devtool: 'source-map',
    infrastructureLogging: { level: 'log' },
  },

  // -- Webview bundle -------------------------------------------------------
  {
    name: 'webview',
    target: 'web',
    mode: 'none',
    entry: './src/webview/main.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'webview.js',
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    },
    resolve: { extensions: ['.ts', '.js'] },
    module: {
      rules: [{ test: /\.ts$/, loader: 'ts-loader', exclude: /node_modules/ }],
    },
    plugins: [
      new CopyPlugin({
        patterns: [{ from: 'src/webview/styles.css', to: 'styles.css' }],
      }),
    ],
    devtool: 'source-map',
  },
];
