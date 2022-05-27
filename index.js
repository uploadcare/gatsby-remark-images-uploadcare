const visitWithParents = require('unist-util-visit-parents');
const getDefinitions = require('mdast-util-definitions');
const path = require('path');
const urlJoin = require('url-join');
const queryString = require('query-string');
const isRelativeUrl = require('is-relative-url');
const { stats, base64 } = require('gatsby-plugin-sharp');
const cheerio = require('cheerio');
const slash = require('slash');

const {
  DEFAULT_OPTIONS,
  EMPTY_ALT,
  imageClass,
  imageBackgroundClass,
  imageWrapperClass,
  UPLOADCARE_CDN,
  UPLOADCARE_CDN_MAX_DIMENSION_DEFAULT,
} = require('./constants');
const { uploadClient, compileUCCDNUrl } = require('./uploadcare-utils');
const {
  CACHE_KEY_UC_FILES,
  getProjectFilesFromCache,
  readFile,
  copyFile,
  sleep,
  escape,
  exists,
  mkdir
} = require('./utils');

const supportedExtensions = {
  jpeg: true,
  jpg: true,
  png: true,
  webp: true,
  tif: true,
  tiff: true,
  gif: true,
  svg: true
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

const uploadingMap = new Map();

// If the image is relative (not hosted elsewhere)
// 1. Find the image file
// 2. Find the image's size
// 3. Filter out any responsive image fluid sizes that are greater than the image's width
// 4. Create the responsive images.
// 5. Set the html w/ aspect ratio helper.
module.exports = async (
  {
    files,
    markdownNode,
    markdownAST,
    getNode,
    reporter,
    cache,
    compiler,
    getCache,
    getRemarkFileDependency,
    pathPrefix
  },
  pluginOptions
) => {
  const options = {
    ...DEFAULT_OPTIONS,
    ...pluginOptions,
  };

  const findParentLinks = ({ children }) =>
    children.some(
      (node) =>
        (node.type === `html` && !!node.value.match(/<a /)) ||
        node.type === `link`
    );

  // Get all the available definitions in the markdown tree
  const definitions = getDefinitions(markdownAST);

  // This will allow the use of html image tags
  // const rawHtmlNodes = select(markdownAST, `html`)
  const rawHtmlNodes = [];
  visitWithParents(markdownAST, [`html`, `jsx`], (node, ancestors) => {
    const inLink = ancestors.some(findParentLinks);

    rawHtmlNodes.push({ node, inLink });
  });

  // This will only work for markdown syntax image tags
  const markdownImageNodes = [];

  visitWithParents(
    markdownAST,
    [`image`, `imageReference`],
    (node, ancestors) => {
      const inLink = ancestors.some(findParentLinks);

      markdownImageNodes.push({ node, inLink });
    }
  );

  const getImageInfo = (uri) => {
    const { url, query } = queryString.parseUrl(uri);
    return {
      ext: path.extname(url).split(`.`).pop(),
      url,
      query,
    };
  };

  const getImageCaption = async (node, overWrites) => {
    const getCaptionString = () => {
      const captionOptions = Array.isArray(options.showCaptions)
        ? options.showCaptions
        : options.showCaptions === true
        ? [`title`, `alt`]
        : false;

      if (captionOptions) {
        for (const option of captionOptions) {
          switch (option) {
            case `title`:
              if (node.title) {
                return node.title;
              }
              break;
            case `alt`:
              if (node.alt === EMPTY_ALT || overWrites.alt === EMPTY_ALT) {
                return ``;
              }
              if (overWrites.alt) {
                return overWrites.alt;
              }
              if (node.alt) {
                return node.alt;
              }
              break;
          }
        }
      }

      return ``;
    };

    const captionString = getCaptionString();

    if (!options.markdownCaptions || !compiler) {
      return escape(captionString);
    }

    return compiler.generateHTML(await compiler.parseString(captionString));
  };

  const ucClient = uploadClient.getInstance(options.pubkey);

  // Takes a node and generates the needed images and then returns
  // the needed HTML replacement for the image
  const generateImagesAndUpdateNode = async function (
    node,
    resolve,
    inLink,
    overWrites = {}
  ) {
    // Check if this markdownNode has a File parent. This plugin
    // won't work if the image isn't hosted locally.
    let parentNode = getNode(markdownNode.parent);
    // check if the parent node is a File node, otherwise go up the chain and
    // search for the closest parent File node. This is necessary in case
    // you have markdown in child nodes.
    if (
      parentNode &&
      parentNode.internal &&
      parentNode.internal.type !== `File`
    ) {
      let tempParentNode = parentNode;
      while (
        tempParentNode &&
        tempParentNode.internal &&
        tempParentNode.internal.type !== `File`
      ) {
        tempParentNode = getNode(tempParentNode.parent);
      }
      if (
        tempParentNode &&
        tempParentNode.internal &&
        tempParentNode.internal.type === `File`
      ) {
        parentNode = tempParentNode;
      }
    }
    let imagePath;
    if (parentNode && parentNode.dir) {
      imagePath = slash(path.join(parentNode.dir, getImageInfo(node.url).url));
    } else {
      return null;
    }

    let imageNode;
    if (getRemarkFileDependency) {
      imageNode = await getRemarkFileDependency({
        absolutePath: {
          eq: imagePath,
        },
      });
    } else {
      // Legacy: no context, slower version of image query
      imageNode = files.find(
        (file) => file && file.absolutePath && file.absolutePath === imagePath
      );
    }

    if (!imageNode || !imageNode.absolutePath) {
      return resolve();
    }

    const imageNodeName = `${imageNode.name}.${imageNode.extension}`;
    const { query: imageOperations } = queryString.parseUrl(node.url);
    const noProcess = Object.prototype.hasOwnProperty.call(imageOperations, 'noProcess');

    if (noProcess) {
      const dir = path.join(process.cwd(), 'public', 'static', imageNode.internal.contentDigest);

      if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
      }
      if (!(await exists(imagePath))) {
        await copyFile(imagePath, path.join(dir, imageNodeName));
      }
    }

    const projectFiles = await getProjectFilesFromCache({ getCache, cache });

    let ucImg = projectFiles.find(
      (item) =>
        item &&
        item.metadata &&
        item.metadata.contentDigest === imageNode.internal.contentDigest
    );

    if (!ucImg) {
      if (uploadingMap.has(imageNode.internal.contentDigest)) {
        // prevent upload same file, it's improve build time and decrease uploads
        ucImg = uploadingMap.get(imageNode.internal.contentDigest);
        if (ucImg === null) {
          await sleep(3000);
          return generateImagesAndUpdateNode(node, resolve, inLink, overWrites);
        }
      } else {
        uploadingMap.set(imageNode.internal.contentDigest, null);
      }

      const uploadFile = async () => {
        const file = await readFile(imageNode.absolutePath);

        try {
          ucImg = await ucClient.uploadFile(file, {
            fileName: imageNodeName,
            metadata: {
              contentDigest: imageNode.internal.contentDigest,
            },
          });
          uploadingMap.set(imageNode.internal.contentDigest, ucImg);
          await cache.set(CACHE_KEY_UC_FILES, [
            ...(await getProjectFilesFromCache({ getCache, cache })),
            ucImg,
          ]);
        } catch (e) {
          // problem in node in localhost, with resolve DNS. Solve - retry after some timeout.
          if (e.code === 'ENOTFOUND') {
            await sleep(5000);
            await uploadFile();
          }

          const isThrottled =
            e &&
            e.response &&
            e.response.error &&
            e.response.error.statusCode === 429;
          if (isThrottled) {
            await sleep(Math.ceil(e.headers['retry-after']) * 1000);
            await uploadFile();
          } else {
            return resolve();
          }
        }

        return ucImg;
      };

      await uploadFile();
    }

    if (!ucImg) {
      resolve();
    }

    // difference response in res-api(/files) and UploadClient(@uploadcare/upload-client)
    const image =
      (ucImg.content_info && ucImg.content_info.image) ||
      (ucImg.contentInfo && ucImg.contentInfo.image);

    const imageName = (ucImg.original_file_url || ucImg.originalFilename)
      .split('/')
      .slice(-1)[0];
    const imageUrl = urlJoin(UPLOADCARE_CDN, ucImg.uuid);

    const optimizedImageUrl = compileUCCDNUrl({
      src: imageUrl,
      fileName: imageName,
      options: {
        ...options.imageOperations,
        ...imageOperations,
        resize: image.width >= options.maxWidth ? `${options.maxWidth}x` : null,
      },
    });

    const { srcSet, sizes } = getOptimizedImageData({
      name: imageName,
      src: imageUrl,
      width: image.width,
      options,
      imageOperations,
    });
    const presentationWidth = Math.min(image.width, options.maxWidth);
    const aspectRatio = image.width / image.height;
    const ratio = `${(1 / aspectRatio) * 100}%`;
    const isEmptyAlt = node.alt === EMPTY_ALT;
    const alt = isEmptyAlt
      ? ``
      : escape(overWrites.alt || node.alt || imageNode.name);
    const title = node.title ? escape(node.title) : alt;

    const { loading } = options;
    if (![`lazy`, `eager`, `auto`].includes(loading)) {
      reporter.warn(
        reporter.stripIndent(`
        ${loading} is an invalid value for the loading option. Please pass one of "lazy", "eager" or "auto".
      `)
      );
    }

    const { decoding } = options;
    if (![`async`, `sync`, `auto`].includes(decoding)) {
      reporter.warn(
        reporter.stripIndent(`
        ${decoding} is an invalid value for the decoding option. Please pass one of "async", "sync" or "auto".
      `)
      );
    }

    const imageStyle = `
      width: 100%;
      height: 100%;
      margin: 0;
      vertical-align: middle;
      position: absolute;
      top: 0;
      left: 0;`.replace(/\s*(\S+:)\s*/g, `$1`);

    // Create our base image tag
    let imageTag = `
      <img
        class="${imageClass}"
        alt="${alt}"
        title="${title}"
        srcset="${srcSet}"
        sizes="${sizes}"
        src="${optimizedImageUrl}"
        style="${imageStyle}"
        loading="${loading}"
        decoding="${decoding}"
      />
    `.trim();

    if (image.sequence) {
      // process gif to video
      imageTag = `
      <video class="${imageClass}" style="${imageStyle}" autoplay loop webkit-playsinline playsinline muted>
        <source src="${urlJoin(
          imageUrl,
          '/gif2video/-/format/webm/'
        )}" type="video/webm"/>
        <source src="${urlJoin(
          imageUrl,
          '/gif2video/-/format/mp4/'
        )}" type="video/mp4"/>
      </video>
    `.trim();
    }

    if (noProcess) {
      const prefixedSrc = `${pathPrefix || ``  }/static/${imageNode.internal.contentDigest}/${imageNodeName}`;

      imageTag = `
      <img
        class="${imageClass}"
        alt="${alt}"
        title="${title}"
        src="${prefixedSrc}"
        style="${imageStyle}"
        loading="${loading}"
        decoding="${decoding}"
      />
    `.trim();
    }

    const base64Image = await base64({
      file: imageNode,
      reporter,
      cache,
    });

    // Construct new image node w/ aspect ratio placeholder
    const imageCaption =
      options.showCaptions && (await getImageCaption(node, overWrites));

    let removeBgImage = false;
    if (options.disableBgImageOnAlpha) {
      const imageStats = await stats({ file: imageNode, reporter });
      if (imageStats && imageStats.isTransparent) removeBgImage = true;
    }
    if (options.disableBgImage) {
      removeBgImage = true;
    }
    // remove bg image for gif
    if (image.sequence) {
      removeBgImage = true;
    }

    const bgImage = removeBgImage
      ? ``
      : ` background-image: url('${base64Image.src}'); background-size: cover;`;

    let rawHTML = `
  <span
    class="${imageBackgroundClass}"
    style="padding-bottom: ${ratio}; position: relative; bottom: 0; left: 0;${bgImage} display: block;"
  ></span>
  ${imageTag}
  `.trim();

    // Make linking to original image optional.
    if (!inLink && options.linkImagesToOriginal) {
      rawHTML = `
  <a
    class="gatsby-resp-image-link"
    href="${urlJoin(imageUrl, imageName)}"
    style="display: block"
    target="_blank"
    rel="noopener"
  >
    ${rawHTML}
  </a>
    `.trim();
    }

    rawHTML = `
    <span
      class="${imageWrapperClass}"
      style="position: relative; display: block; margin-left: auto; margin-right: auto; max-width: ${presentationWidth}px; ${
      imageCaption ? `` : options.wrapperStyle
    }"
    >
      ${rawHTML}
    </span>
    `.trim();

    // Wrap in figure and use title as caption
    if (imageCaption) {
      rawHTML = `
  <figure class="gatsby-resp-image-figure" style="${options.wrapperStyle}">
    ${rawHTML}
    <figcaption class="gatsby-resp-image-figcaption">${imageCaption}</figcaption>
  </figure>
      `.trim();
    }

    return rawHTML;
  };

  return Promise.all(
    // Simple because there is no nesting in markdown
    markdownImageNodes.map(
      ({ node, inLink }) =>
        new Promise((resolve) => {
          const overWrites = {};
          let refNode;
          if (
            !node.hasOwnProperty('url') &&
            node.hasOwnProperty('identifier')
          ) {
            // consider as imageReference node
            refNode = node;
            node = definitions(refNode.identifier);
            // pass original alt from referencing node
            overWrites.alt = refNode.alt;
            if (!node) {
              // no definition found for image reference,
              // so there's nothing for us to do.
              return resolve();
            }
          }
          const fileType = getImageInfo(node.url).ext;

          // Only attempt to convert supported extensions
          if (isRelativeUrl(node.url) && supportedExtensions[fileType]) {
            return generateImagesAndUpdateNode(
              node,
              resolve,
              inLink,
              overWrites
            ).then((rawHTML) => {
              if (rawHTML) {
                // Replace the image or ref node with an inline HTML node.
                if (refNode) {
                  node = refNode;
                }
                node.type = `html`;
                node.value = rawHTML;
              }

              return resolve(node);
            });
          }
          // Image isn't relative so there's nothing for us to do.
          return resolve();
        })
    )
  ).then((markdownImageNodes) =>
    // HTML image node stuff
    Promise.all(
      // Complex because HTML nodes can contain multiple images
      rawHtmlNodes.map(
        ({ node, inLink }) =>
          // eslint-disable-next-line no-async-promise-executor
          new Promise(async (resolve) => {
            if (!node.value) {
              return resolve();
            }

            const $ = cheerio.load(node.value);
            const $imageElements = $(`img`);
            if ($imageElements.length === 0) {
              // No img tags>
              return resolve();
            }

            const imageRefs = [];
            $imageElements.each(function () {
              imageRefs.push($(this));
            });

            for (const thisImg of imageRefs) {
              // Get the details we need.
              const formattedImgTag = {};
              formattedImgTag.url = thisImg.attr(`src`);
              formattedImgTag.title = thisImg.attr(`title`);
              formattedImgTag.alt = thisImg.attr(`alt`);

              if (!formattedImgTag.url) {
                return resolve();
              }

              const fileType = getImageInfo(formattedImgTag.url).ext;

              // Only attempt to convert supported extensions
              if (
                isRelativeUrl(formattedImgTag.url) &&
                supportedExtensions[fileType]
              ) {
                const rawHTML = await generateImagesAndUpdateNode(
                  formattedImgTag,
                  resolve,
                  inLink
                );

                if (rawHTML) {
                  // Replace the image string
                  thisImg.replaceWith(rawHTML);
                } else {
                  return resolve();
                }
              }
            }

            // Replace the image node with an inline HTML node.
            node.type = 'html';
            node.value = $('body').html(); // fix for cheerio v1

            return resolve(node);
          })
      )
    ).then((htmlImageNodes) =>
      markdownImageNodes.concat(htmlImageNodes).filter((node) => !!node)
    )
  );
};
