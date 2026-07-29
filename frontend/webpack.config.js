const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const Dotenv = require('dotenv-webpack');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: './src/main.jsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'assets/[name].[contenthash].js',
      clean: true, // wipes dist/ before each build, same as Vite's default
    },
    resolve: {
      extensions: ['.js', '.jsx'],
    },
    module: {
      rules: [
        {
          test: /\.jsx?$/,
          exclude: /node_modules/,
          use: 'babel-loader',
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({ template: './public/index.html' }),
      // Loads .env into process.env.* at build time — the replacement for
      // Vite's import.meta.env, since plain Webpack has no env handling
      // built in.
      new Dotenv(),
    ],
    devServer: {
      port: 5173, // same port Vite defaulted to, so habits/bookmarks carry over
      open: true,
      historyApiFallback: true, // needed for React Router's client-side routes
    },
    devtool: isProduction ? 'source-map' : 'eval-source-map',
    mode: isProduction ? 'production' : 'development',
  };
};