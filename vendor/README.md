# Browser vendor files

## Grid++Report grhtml5

`grhtml5-6.8-min.js` is copied verbatim from the locally supplied Grid++Report WebSamples source:

```text
/home/ubuntu/gridpp/_gr6/WebSamples/vue/src/utils/grhtml5-6.8-min.js
```

SHA-256: `b4cc243e5cc3a4c55c98f9cb363c3fd4614b67e41b741df73b6c246bbb2dd4bc`

It is not an npm dependency. Distribution and production use remain subject to the Grid++Report/grhtml5 license; see the repository README.

## SheetJS CE

`xlsx.mini.min.js` is the unmodified SheetJS Community Edition 0.20.3 browser mini build. It is a pure JavaScript, standalone distribution and is loaded directly by `public/index.html`; there is no npm install or runtime package dependency.

- Artifact source: <https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mini.min.js>
- Artifact SHA-256: `0cb353f830d7288385492c83d277b058ddeac664ca51cf1393aa1fd3e2b70939`
- License source: <https://cdn.sheetjs.com/xlsx-0.20.3/package/LICENSE>
- License file: `LICENSE.sheetjs.txt`
- License: Apache License 2.0
- License file SHA-256: `4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64`

Only the first worksheet is converted to row arrays for the offline preview import path. This vendored file must be re-verified against the recorded SHA-256 before replacement.
