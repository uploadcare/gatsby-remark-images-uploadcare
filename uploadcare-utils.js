const urlJoin = require('url-join');
const fetch = require('node-fetch');
const { UploadClient } = require('@uploadcare/upload-client');
const { name: pluginName } = require('./package.json');
const {
  UPLOADCARE_CDN_MAX_DIMENSION_DEFAULT,
  BASE_64_WIDTH_IN_PX,
} = require('./constants');

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

const compileUCCDNUrl = ({ src, fileName = '', options }) => {
  const operations = options
    ? `-/${Object.keys(options)
      .filter((key) => Boolean(options[key]))
      .map((key) => `${key}/${options[key] || ''}`)
      .join('/-/')}`
    : '';

  return urlJoin(src, operations, fileName);
};

const getOptimizedImageData = ({
                                 src,
                                 name,
                                 width,
                                 options,
                                 imageOperations,
                               }) => {
  const { maxWidth } = options;

  if (maxWidth < 1) {
    throw new Error(
      `${maxWidth} has to be a positive int larger than zero (> 0), now it's ${maxWidth}`
    );
  } // Create sizes (in width) for the image if no custom breakpoints are
  // provided. If the max width of the container for the rendered markdown file
  // is 800px, the sizes would then be: 200, 400, 800, 1200, 1600.
  //
  // This is enough sizes to provide close to the optimal image size for every
  // device size / screen resolution while (hopefully) not requiring too much
  // image processing time (Sharp has optimizations thankfully for creating
  // multiple sizes of the same input file)

  const fluidSizes = [maxWidth]; // use standard breakpoints if no custom breakpoints are specified

  if (!options.srcSetBreakpoints || !options.srcSetBreakpoints.length) {
    fluidSizes.push(maxWidth / 4, maxWidth / 2, maxWidth * 1.5, maxWidth * 2);
  } else {
    options.srcSetBreakpoints.forEach((breakpoint) => {
      if (breakpoint < 1) {
        throw new Error(
          `All ints in srcSetBreakpoints should be positive ints larger than zero (> 0), found ${breakpoint}`
        );
      } // ensure no duplicates are added

      if (fluidSizes.includes(breakpoint)) {
        return;
      }

      fluidSizes.push(breakpoint);
    });
  }

  let filteredSizes = [
    ...fluidSizes.filter((size) => size < width),
    width,
  ].sort((a, b) => a - b);
  // Add the original image to ensure the largest image possible
  // is available for small images. Also so we can link to
  // the original image.
  // Queue sizes for processing.

  const hasSizeLargerThenLimit =
    filteredSizes[filteredSizes.length - 1] >
    UPLOADCARE_CDN_MAX_DIMENSION_DEFAULT;
  if (hasSizeLargerThenLimit) {
    filteredSizes = [
      ...filteredSizes.filter(
        (size) => size <= UPLOADCARE_CDN_MAX_DIMENSION_DEFAULT
      ),
      UPLOADCARE_CDN_MAX_DIMENSION_DEFAULT,
    ];
  }

  const presentationWidth = Math.min(width, maxWidth);
  const sizes =
    options.sizes ||
    `(max-width: ${presentationWidth}px) 100vw, ${presentationWidth}px`;
  const srcSet = filteredSizes
    .map(
      (size) =>
        `${compileUCCDNUrl({
          src,
          fileName: name,
          options: {
            ...options.imageOperations,
            ...imageOperations,
            resize: `${size}x`,
          },
        })} ${Math.round(size)}w`
    )
    .join(`,\n`);

  return {
    sizes,
    srcSet,
  };
};

const generateBase64 = async ({ imageUrl, imageName }) => {
  if (!imageUrl) return;
  const resizedUcImg = compileUCCDNUrl({
    src: imageUrl,
    fileName: imageName,
    options: {
      resize: `${BASE_64_WIDTH_IN_PX}x`,
      quality: 'lightest',
    },
  });
  const res = await fetch(resizedUcImg);
  if (!res.ok) {
    throw new Error('Error in generateBase64 function.', res);
  }

  const buffer = await res.buffer();
  return `data:${res.headers.get('content-type')};base64,${buffer.toString(
    'base64'
  )}`;
};

module.exports = {
  uploadClient,
  fetchProjectFiles,
  compileUCCDNUrl,
  getOptimizedImageData,
  generateBase64
};
