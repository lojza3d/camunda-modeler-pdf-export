'use strict';

const path = require('path');
const webpack = require('webpack');

module.exports = (env, argv) => {
  const isDev = argv.mode === 'development';

  return {
    entry: './client/index.js',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'client.js'
    },

    // The Modeler runs with CSP "script-src 'self'" -> no eval-based source maps.
    devtool: isDev ? 'cheap-module-source-map' : false,

    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {

              // classic runtime -> JSX compiles to React.createElement,
              // React itself comes from the Modeler (see camunda-modeler-plugin-helpers)
              presets: [ [ '@babel/preset-react', { runtime: 'classic' } ] ]
            }
          }
        },
        {

          // embedded TTF fonts -> plain base64 string (what jsPDF's VFS expects)
          test: /\.ttf$/,
          type: 'asset/inline',
          generator: {
            dataUrl: content => content.toString('base64')
          }
        }
      ]
    },

    resolve: {
      alias: {

        // optional jsPDF dependencies (html(), addSvgAsImage()) are not used
        html2canvas: false,
        dompurify: false,
        canvg: false
      }
    },

    plugins: [

      // the Modeler loads exactly one script per plugin -> no lazy chunks
      new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })
    ],

    performance: {
      hints: false
    }
  };
};
