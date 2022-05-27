# gatsby-remark-images-uploadcare

Processes images in markdown with Uploadcare.

In the processing, it makes images responsive by:

- Uploading local images to Uploadcare CDN and generating multiple versions of images at different widths, format and quality and sets
  the `srcset` and `sizes` of the `img` element so regardless of the width of the device, the correct image is downloaded.
- Adding an elastic container to hold the size of the image while it loads to
  avoid layout jumps.
- Using the "blur up" technique popularized by [Medium][1] and [Facebook][2]
  where a small 20px wide version of the image is shown as a placeholder until
  the actual image is downloaded.
- Allow to set custom image transformation for all images and for each image.

## Install

`npm install gatsby-remark-images-uploadcare`

## How to use

Create account https://app.uploadcare.com/accounts/login/ and generate `secretKey`.
3000 uploads, 30 GB traffic and 3 GB storage - FREE.
Pass pubkey and secretKey to plugin options.
https://uploadcare.com/docs/start/settings/#keys

```javascript
// In your gatsby-config.js
plugins: [
  {
    resolve: `gatsby-transformer-remark`,
    options: {
      plugins: [
        {
          resolve: `gatsby-remark-images-uploadcare`,
          options: {
            // It's important to specify the maxWidth (in pixels) of
            // the content container as this plugin uses this as the
            // base for generating different widths of each image.
            maxWidth: 768,
          },
        },
      ],
    },
  },
]
```

## Usage in Markdown

You can reference an image using the relative path, where that path is relative to the location of the Markdown file you're typing in.

```md
![Alt text here](./image.jpg)
```

By default, the text `Alt text here` will be used as the alt attribute of the generated `img` tag. If an empty alt attribute like `alt=""` is wished,
a reserved keyword `GATSBY_EMPTY_ALT` can be used.

```markdown
![GATSBY_EMPTY_ALT](./image.png)
```

## Options

| Name                    | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxWidth`              | `650`   | The `maxWidth` in pixels of the div where the markdown will be displayed. This value is used when deciding what the width of the various responsive thumbnails should be.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `imageOperations`       | `{ quality: 'smart', format: 'auto' }` | Set the base image operations for all images. https://uploadcare.com/docs/transformations/image/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `linkImagesToOriginal`  | `true`  | Add a link to each image to the original image. Sometimes people want to see a full-sized version of an image e.g. to see extra detail on a part of the image and this is a convenient and common pattern for enabling this. Set this option to `false` to disable this behavior.                                                                                                                                                                                                                                                                                                                                                  |
| `showCaptions`          | `false` | Add a caption to each image with the contents of the title attribute, when this is not empty. If the title attribute is empty but the alt attribute is not, it will be used instead. Set this option to true to enable this behavior. You can also pass an array instead to specify which value should be used for the caption — for example, passing `['alt', 'title']` would use the alt attribute first, and then the title. When this is set to `true` it is the same as passing `['title', 'alt']`. If you just want to use the title (and omit captions for images that have alt attributes but no title), pass `['title']`. |
| `markdownCaptions`      | `false` | Parse the caption as markdown instead of raw text. Ignored if `showCaptions` is `false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `wrapperStyle`          | ``      | Add custom styles to the div wrapping the responsive images. Use the syntax for the style attribute e.g. `margin-bottom:10px; background: red;`.                                                                                                                                                                                                                                                                                                                |
| `backgroundColor`       | `white` | Set the background color of the image to match the background image of your design.<br /><br />**Note:**<br />- set this option to `transparent` for a transparent image background.<br /> - set this option to `none` to completely remove the image background.                                                                                                                                                                                                                                                                                                                                                                  |
| `loading`               | `lazy`  | Set the browser's native lazy loading attribute. One of `lazy`, `eager` or `auto`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `decoding`              | `async` | Set the browser's native decoding attribute. One of `async`, `sync` or `auto`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `disableBgImageOnAlpha` | `false` | Images containing transparent pixels around the edges results in images with blurry edges. As a result, these images do not work well with the "blur up" technique used in this plugin. As a workaround to disable background images with blurry edges on images containing transparent pixels, enable this setting.                                                                                                                                                                                                                                                                                                               |
| `disableBgImage`        | `false` | Remove background image and its' inline style. Useful to prevent `Stylesheet too long` error on AMP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `srcSetBreakpoints`     |         | By default gatsby generates 0.25x, 0.5x, 1x, 1.5x, 2x, and 3x sizes of thumbnails. If you want more control over which sizes are output you can use the `srcSetBreakpoints` parameter. For example, if you want images that are 200, 340, 520, and 890 wide you can add `srcSetBreakpoints: [ 200, 340, 520, 890 ]` as a parameter. You will also get `maxWidth` as a breakpoint (which is 650 by default), so you will actually get `[ 200, 340, 520, 650, 890 ]` as breakpoints.                                                                                                                                                 |

## Image operations for all images

```javascript
{
  resolve: `gatsby-remark-images-uploadcare`,
  options: {
    maxWidth: 800,
    imageOperations: {
      quality: 'lightest',
      progressive: 'yes',
      sharp: '20'
    }
  },
}
```

## Image operations for single image, will be override base imageOperations from plugin options.

```md
    ![Alt text here](./image.jpg?blur=50&contrast=10)
```

## Prevent image processing by Uploadcare plugin, by this option image will not be process Uploadcare and copy as-is to public folder.

```md
    ![Alt text here](./image.jpg?noProcess)
```

## gif2video converts animated image files, such as GIF, WebP and HEIC to video and transforms them on the fly. Video files are much smaller than GIFs. https://uploadcare.com/docs/transformations/gif-to-video/

```md
    ![Alt text here](./image.giff)
```

This plugin will not support GIFs or SVGs. If you would like to render these file types with the image markdown syntax, use the [`gatsby-remark-copy-linked-files`](https://www.gatsbyjs.com/plugins/gatsby-remark-copy-linked-files/) plugin. Do note with this it will load in the images, but won't use the features of [Sharp][5] such as the elastic container or the blur-up enhancements.

[1]: https://uploadcare.com/docs/transformations/image/
[2]: https://uploadcare.com/docs/start/settings/#keys
[3]: https://jmperezperez.com/medium-image-progressive-loading-placeholder/
[4]: https://code.facebook.com/posts/991252547593574/the-technology-behind-preview-photos/
