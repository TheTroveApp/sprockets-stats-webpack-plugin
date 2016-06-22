/* eslint no-unused-vars: [2, { "args": "none" }], func-names: 0, no-underscore-dangle: 0 */

'use strict';

var walk = require('walk');
var path = require('path');
var CustomStats = require('webpack-custom-stats-patch');
var fs = require('fs');
var _merge = require('lodash.merge');

var getDigestAndSizeForAssets = require('./lib/getDigestAndSizeForAssets');
var getLogicalPathForAssets = require('./lib/getLogicalPathForAssets');

var DEFAULT_PARAMS = {
  customStatsKey: 'sprockets',
  ignore: (/\.(gz|html)$/i),
  outputAssetsPath: path.join(process.cwd(), 'build', 'assets'),
  sourceAssetsPath: path.join(process.cwd(), 'src', 'assets'),
  saveAs: path.join(process.cwd(), 'build', 'sprockets-manifest.json'),
  write: true,
  resultsKey: '__RESULTS_SPROCKETS'
};

function SprocketsStatsWebpackPlugin(options) {
  var params = options || {};

  this._customStatsKey = options.customStatsKey || DEFAULT_PARAMS.customStatsKey;
  this._ignore = params.ignore || DEFAULT_PARAMS.ignore;
  this._outputAssetsPath = params.outputAssetsPath || DEFAULT_PARAMS.outputAssetsPath;
  this._sourceAssetsPath = params.sourceAssetsPath || DEFAULT_PARAMS.sourceAssetsPath;
  this._saveAs = params.saveAs || DEFAULT_PARAMS.saveAs;
  this._write = ((params.write === undefined) ? DEFAULT_PARAMS.write : params.write);
  this._resultsKey = params.resultsKey || DEFAULT_PARAMS.resultsKey;
}

SprocketsStatsWebpackPlugin.prototype.apply = function(compiler) {
  var outputAssetsPath = this._outputAssetsPath;
  var sourceAssetsPath = this._sourceAssetsPath;
  var customStatsKey = this._customStatsKey;
  var blacklistRegex = this._ignore;
  var savePath = this._saveAs;
  var writeEnabled = this._write;
  var resultsKey = this._resultsKey;
  var sprockets = {};

  compiler.plugin('this-compilation', function(compilation) {
    compilation.plugin('optimize-assets', function(assets, callback) {
      var digestAndSizeMap = getDigestAndSizeForAssets(assets, blacklistRegex);

      sprockets = _merge({}, sprockets, digestAndSizeMap);

      callback();
    });

    compilation.plugin('module-asset', function(mod, filename) {
      var logicalPathMap = getLogicalPathForAssets(sourceAssetsPath, mod.userRequest, mod.assets);

      sprockets = _merge({}, sprockets, logicalPathMap);
    });
  });

  compiler.plugin('after-emit', function(compilation, callback) {
    var outputPath = compilation.getPath(compilation.outputOptions.path);
    var stats = new CustomStats(compilation);
    var walker = walk.walk(outputAssetsPath);
    var assets = stats.toJson().assets;

    assets.forEach(function(asset) {
      var hashedAssetName = asset.name;
      var assetName;
      var assetExt;
      var filename;

      if ((asset.chunks && asset.chunks.length > 0) &&
          (asset.chunkNames && asset.chunkNames.length > 0)
      ) {
        assetName = asset.chunkNames.slice(-1)[0];
        assetExt = hashedAssetName.split('.').pop();

        filename = assetName + '.' + assetExt;

        sprockets[hashedAssetName].logical_path = filename;
      }
    });

    walker.on('file', function(rootPath, fileStat, next) {
      var fullPath = path.join(rootPath, fileStat.name);
      var filename = (path.relative(outputPath, fullPath));

      if (!filename.match(blacklistRegex) && sprockets[filename]) {
        sprockets[filename].mtime = fileStat.mtime;
      }

      next();
    });

    walker.on('end', function() {
      var data = stats.toJson();
      var assetData = data[customStatsKey] || {};
      var output;

      Object.keys(assetData).forEach(function(assetKey) {
        sprockets[assetKey] = _merge({}, assetData[assetKey], sprockets[assetKey]);
      });

      output = {
        assets: {},
        files: sprockets,
        hash: data.hash,
        publicPath: data.publicPath
      };

      Object.keys(output.files).forEach(function(filename) {
        var asset = output.files[filename];
        output.assets[asset.logical_path] = filename;
      });

      stats.addCustomStat(customStatsKey, sprockets);
      stats.addCustomStat(resultsKey, output);

      compilation[resultsKey] = output; // eslint-disable-line no-param-reassign

      callback();
    });
  });

  compiler.plugin('done', function(stats) {
    var output;

    if (writeEnabled) {
      output = stats.compilation[resultsKey];

      fs.writeFile(savePath, JSON.stringify(output, null, '  '), function(err) {
        if (err) {
          console.error('Failed to write stats.', err); // eslint-disable-line no-console
          throw err;
        }
      });
    }
  });
};

module.exports = SprocketsStatsWebpackPlugin;
