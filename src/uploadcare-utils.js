const urlJoin = require('url-join');
const fetch = require('node-fetch');
const { UploadClient } = require('@uploadcare/upload-client');
const { name: pluginName } = require('./package.json');

const uploadClient = (() => {
  let instance = null;

  return {
    getInstance(pubkey) {
      if (!instance) {
        instance = new UploadClient({
          publicKey: pubkey,
          retryThrottledRequestMaxTimes: 3,
          integration: pluginName,
        });
      }

      return instance;
    },
  };
})();

const fetchProjectFiles = async (pubkey, secretKey) => {
  let files = [];

  const headers = {
    Accept: 'application/vnd.uploadcare-v0.7+json',
    Authorization: `Uploadcare.Simple ${pubkey}:${secretKey}`,
  };

  const fetchFiles = async (
    url = 'https://api.uploadcare.com/files/?limit=1000'
  ) => {
    try {
      const res = await fetch(url, { headers });
      const body = await res.json();

      if (res.status !== 200) {
        throw new Error(body.detail);
      }

      files = files.concat(body.results);

      if (body.next) {
        await fetchFiles(body.next);
      }
    } catch (e) {
      throw new Error(e);
    }
  };

  await fetchFiles();

  return files;
};

const compileUCCDNUrl = ({ src, fileName, options }) => {
  const operations = options
    ? `-/${Object.keys(options)
        .filter((key) => Boolean(options[key]))
        .map((key) => `${key}/${options[key] || ''}`)
        .join('/-/')}`
    : '';

  return urlJoin(src, operations, fileName);
};

module.exports = {
  uploadClient,
  fetchProjectFiles,
  compileUCCDNUrl,
};
