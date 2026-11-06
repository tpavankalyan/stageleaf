# How the blog is built

Everything in the post, on the canvas and on the web page comes from one file of text, `blog_text.py`. Edit the words there, then rebuild.

```sh
python docs/src/build_canvas.py
```

That writes:

- `docs/stageleaf-blog.excalidraw`: the post as ten Excalidraw frames. Open it at excalidraw.com with Menu, then Open. Every heading, arrow, circle and sticky note is editable, and the screenshots are embedded, so the file works offline.
- `docs/index.html` and `docs/blog.md`: the web edition, with the same text plus the commands to copy.
- `docs/src/figures.excalidraw`: the drawings alone, one frame each, for the web edition's images (not committed).

It needs Python with Pillow and fontTools (with brotli), and the fonts that ship with `@excalidraw/excalidraw` (set `EXCALIDRAW_FONTS` to its `dist/prod/fonts` folder). Text is measured with those fonts, so line breaks match what Excalidraw draws.

`render/` exports frames with Excalidraw's own `exportToBlob`. Run `npm install` there, bundle `render-entry.js` with esbuild into `render/www/render.js`, copy the package's `fonts/` folder into `render/www/`, then:

```sh
node docs/src/render/render.mjs docs/src/figures.excalidraw /tmp/figures --frames --scale=1.25
node docs/src/render/render.mjs docs/stageleaf-blog.excalidraw /tmp/frames --frames --scale=1.5
```

The figures go to `docs/figures/` (`hero`, `thread`, `pieces`, `server`, `agent`, `protocol`, `who`, `checks`, in that order). The PDF is the ten frames, one per page.

The screenshots in `assets/` are stills from the recorded demo run on Switch 0.31.0.
