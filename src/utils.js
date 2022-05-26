const fs = require('fs');
const util = require('util');
const { name: pluginName } = require('./package.json');

const CACHE_KEY_UC_FILES = 'cache-key-uploadcare-project-files';

const getProjectFilesFromCache = async ({ getCache, cache }) => {
  const pluginRemarkUCImagesCache = getCache(pluginName);
  const remarkUCImagesCachedFiles = await pluginRemarkUCImagesCache.get(
    CACHE_KEY_UC_FILES
  );
  const mdxCachedFiles = (await cache.get(CACHE_KEY_UC_FILES)) || [];
  return [...remarkUCImagesCachedFiles, ...mdxCachedFiles];
};

const sleep = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

// Convert fs.readFile into Promise version of same
const readFile = util.promisify(fs.readFile);
const copyFile = util.promisify(fs.copyFile);
const exists = util.promisify(fs.exists);
const mkdir = util.promisify(fs.mkdir);

const escape = (string) => {
  const reUnescapedHtml = /[&<>"']/g;
  const htmlEscapes = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  if (string && reUnescapedHtml.test(string)) {
    return string.replace(reUnescapedHtml, (key) => {
      return htmlEscapes[key];
    });
  }

  return string;
};

module.exports = {
  escape,
  sleep,
  getProjectFilesFromCache,
  CACHE_KEY_UC_FILES,
  readFile,
  copyFile,
  exists,
  mkdir
};
