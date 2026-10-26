# kokoro-js 1.2.1 (vendored)

`kokoro.web.js` is the unmodified browser build from the npm package
[`kokoro-js@1.2.1`](https://www.npmjs.com/package/kokoro-js) (Apache-2.0, see LICENSE),
by hexgrad and Xenova. It is served from our own origin so no third-party script
CDN is needed; the Kokoro model and voices are downloaded at runtime from the
official Hugging Face repository `onnx-community/Kokoro-82M-v1.0-ONNX`.

- npm tarball integrity: `sha512-oq0HZJWis3t8lERkMJh84WLU86dpYD0EuBPtqYnLlQzyFP1OkyBRDcweAqCfhNOpltyN9j/azp1H6uuC47gShw==`
- sha256 of kokoro.web.js: `6067712fe4c43cdb36c762f860a5ab8d96ea1d9c8882466438eb9f3d0d20be8f`

To update: `npm pack kokoro-js@<version>`, copy `package/dist/kokoro.web.js` and
`package/LICENSE` into a new `kokoro-js-<version>` folder, update this file and
the import path in `public/voice/kokoro-worker.js`.
