const { fetchProjectFiles } = require('./uploadcare-utils');
const { CACHE_KEY_UC_FILES } = require('./utils');

// Now pluginOptionsSchema not working, because it's sub-plugin of gatsby-plugin-mdx
// TODO: make validation work
exports.pluginOptionsSchema = ({ Joi }) => {
  Joi.object({
    maxWidth: Joi.number()
      .default(650)
      .description(
        `The maxWidth in pixels of the div where the markdown will be displayed. This value is used when deciding what the width of the various responsive thumbnails should be.`
      ),
    linkImagesToOriginal: Joi.boolean()
      .default(true)
      .description(
        `Add a link to each image to the original image. Sometimes people want to see a full-sized version of an image e.g. to see extra detail on a part of the image and this is a convenient and common pattern for enabling this. Set this option to false to disable this behavior.`
      ),
    showCaptions: Joi.alternatives()
      .try(
        Joi.boolean(),
        Joi.array().items(
          Joi.string().valid(`title`),
          Joi.string().valid(`alt`)
        )
      )
      .default(false)
      .description(
        `Add a caption to each image with the contents of the title attribute, when this is not empty. If the title attribute is empty but the alt attribute is not, it will be used instead. Set this option to true to enable this behavior. You can also pass an array instead to specify which value should be used for the caption — for example, passing ['alt', 'title'] would use the alt attribute first, and then the title. When this is set to true it is the same as passing ['title', 'alt']. If you just want to use the title (and omit captions for images that have alt attributes but no title), pass ['title'].`
      ),
    markdownCaptions: Joi.boolean()
      .default(false)
      .description(
        `Parse the caption as markdown instead of raw text. Ignored if showCaptions is false.`
      ),
    wrapperStyle: Joi.alternatives().try(
      Joi.object({}).unknown(true),
      Joi.string()
    ),
    backgroundColor: Joi.string().default(`white`)
      .description(`Set the background color of the image to match the background image of your design.

      Note:
      - set this option to transparent for a transparent image background.
      - set this option to none to completely remove the image background.`),
    loading: Joi.string()
      .valid(`lazy`, `eager`, `auto`)
      .default(`lazy`)
      .description(
        `Set the browser’s native lazy loading attribute. One of lazy, eager or auto.`
      ),
    decoding: Joi.string()
      .valid(`async`, `sync`, `auto`)
      .default(`async`)
      .description(
        `Set the browser’s native decoding attribute. One of async, sync or auto.`
      ),
    disableBgImage: Joi.boolean()
      .default(false)
      .description(
        `Remove background image and its’ inline style. Useful to prevent Stylesheet too long error on AMP.`
      ),
    srcSetBreakpoints: Joi.array()
      .items(Joi.number())
      .description(
        `By default gatsby generates 0.25x, 0.5x, 1x, 1.5x, 2x, and 3x sizes of thumbnails. If you want more control over which sizes are output you can use the srcSetBreakpoints parameter. For example, if you want images that are 200, 340, 520, and 890 wide you can add srcSetBreakpoints: [ 200, 340, 520, 890 ] as a parameter. You will also get maxWidth as a breakpoint (which is 650 by default), so you will actually get [ 200, 340, 520, 650, 890 ] as breakpoints.`
      ),
    pubkey: Joi.string()
      .required()
      .description(
        `The main use of a pubkey is to identify a target project for your uploads. It is required when using Upload API. 3000 uploads, 30 GB traffic and 3 GB storage - FREE. https://uploadcare.com/docs/start/settings/#keys-public`
      ),
    secretKey: Joi.string()
      .required()
      .description(
        `A secretKey is required when using our REST API to manage files. 3000 uploads, 30 GB traffic and 3 GB storage - FREE. https://uploadcare.com/docs/start/settings/#keys-secret`
      ),
    imageOperations: Joi.object({})
      .default({
        quality: 'smart',
        format: 'auto',
      })
      .required()
      .description(
        `With Uploadcare, you can easily build custom image transformation workflows and automate most of image manipulation and optimization tasks. https://uploadcare.com/docs/transformations/image/`
      ),
  });
};

let pubkey;
let secretKey;

exports.onPreInit = (_, pluginOptions) => {
  ({ pubkey, secretKey } = pluginOptions);
  // Do not leak secretKey to public bundle.
  delete pluginOptions.secretKey; // eslint-disable-line no-param-reassign
};

exports.onPreBootstrap = async ({ cache }) => {
  if (!pubkey || !secretKey) {
    throw new Error('pubkey and secretKey are required options.');
  }

  const files = await fetchProjectFiles(pubkey, secretKey);
  await cache.set(CACHE_KEY_UC_FILES, files);
};
