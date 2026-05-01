# LongTimeGenie Tree

Web-based genealogy research tool for [LongTimeGenie](https://longtimegenie.com).
A static site, all client-side — no backend, no uploads, all data stays in the browser.

Intended user is the genealogist (Sheri), not her clients. Designed to live at
`tree.longtimegenie.com`.

## Roadmap

| Step | Feature | Status |
|------|---------|--------|
| 1 | GEDCOM import → parsed JSON view | ✅ done |
| 2 | Tree view + person detail panel with sources | planned |
| 3 | Timeline overlay | planned |
| 4 | Printable view + PDF research-report export | planned |

## Stack

- Vanilla JS, no framework
- [Vite](https://vitejs.dev) for the build/dev server
- [`parse-gedcom`](https://github.com/tmcw/parse-gedcom) for GEDCOM parsing
- `html2pdf.js` for PDF export (step 4)

## Setup

```bash
npm install
npm run dev      # start dev server (default port 5174)
npm run build    # produce static files in dist/
npm run preview  # serve the built site locally
```

There's a sample GEDCOM file at `public/fixtures/sample.ged` you can use to
exercise the importer.

## Project structure

```
longtimegenie-tree/
├── package.json
├── vite.config.js
├── index.html               app shell
├── public/
│   └── fixtures/sample.ged  test data
└── src/
    ├── main.js              entry — wires modules to the DOM
    ├── style.css            brand palette + base styles
    ├── gedcom/parser.js     normalizes parse-gedcom output
    ├── ui/importer.js       file picker + drag-and-drop
    ├── tree/render.js       tree view              (step 2)
    ├── detail/panel.js      person detail panel    (step 2)
    ├── timeline/render.js   timeline overlay       (step 3)
    └── export/pdf.js        PDF export             (step 4)
```

## Data model

The parser produces:

```js
{
  header: { /* raw HEAD subtree */ },
  persons:  [{ id, name, sex, birth, death, families, childOf }],
  families: [{ id, husbandId, wifeId, childIds, marriage }],
  sources:  [{ id, title, author, publication }]
}
```

Each parsed entity also carries a `raw` property (the underlying parse-gedcom
node) so later modules can reach into less-common GEDCOM tags without re-parsing.

## Privacy

GEDCOM files are read with the FileReader API and held only in memory. Nothing
is sent to a server. Source images, when added in step 2, will follow the same
local-only pattern.

## Deploy

Run `npm run build` and publish the `dist/` folder. Any static host works
(Netlify, Vercel, GitHub Pages). The intended subdomain is
`tree.longtimegenie.com`.

## Install as a Windows app

The site ships as a PWA (web manifest + service worker), so once it's served
over HTTPS or `localhost` it can be installed as a real Windows app — its own
taskbar icon, its own window, no browser chrome.

**From the deployed site (recommended):**

1. Open `https://tree.longtimegenie.com` in **Microsoft Edge** or **Google Chrome**.
2. In the address bar, click the install icon (a monitor with a down-arrow), or
   open the browser menu and choose **Apps → Install this site as an app**
   (Edge) / **Cast, save and share → Install page as app** (Chrome).
3. Confirm the name "LongTimeGenie Tree". Windows adds it to the Start menu.
4. Right-click the running app in the taskbar and choose **Pin to taskbar** to
   keep it there permanently.

**From a local build (for trying it out before deploy):**

```bash
npm run build
npm run preview   # serves dist/ on http://localhost:4173
```

Then open the `localhost` URL in Edge/Chrome and install as above. PWA install
works on `localhost` without HTTPS.

**To uninstall:** open the app, click the `…` menu in its title bar, and choose
**Uninstall**.
