exports.DEFAULT_OPTIONS = {
  maxWidth: 650,
  wrapperStyle: '',
  backgroundColor: 'white',
  linkImagesToOriginal: true,
  showCaptions: false,
  markdownCaptions: false,
  loading: 'lazy',
  decoding: 'async',
  disableBgImageOnAlpha: false,
  disableBgImage: false,
  imageOperations: {
    quality: 'smart',
    format: 'auto',
  },
};

exports.EMPTY_ALT = 'GATSBY_EMPTY_ALT';

// see https://uploadcare.com/docs/transformations/#dimensions
exports.UPLOADCARE_CDN_MAX_DIMENSION_DEFAULT = 3000; // px
exports.UPLOADCARE_CDN = 'https://ucarecdn.com';

exports.imageClass = 'gatsby-resp-image-image';
exports.imageWrapperClass = 'gatsby-resp-image-wrapper';
exports.imageBackgroundClass = 'gatsby-resp-image-background-image';
