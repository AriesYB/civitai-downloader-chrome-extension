<div align="center">

# 🎨 Civitai.red Batch Downloader

**A Chrome extension for batch-selecting and downloading images / videos from [civitai.red](https://civitai.red), organized into `author/id.format` folders.**

English · [中文](README.md) · [Disclaimer](#-disclaimer)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4.svg)](https://developer.chrome.com/docs/extensions/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Platform](https://img.shields.io/badge/Platform-Chrome%20%2F%20Edge%20%2F%20Brave-lightgrey.svg)](#)

</div>

> Batch-select images and videos on civitai.red **list pages and post pages, then download them with one click**. Files are auto-organized into `top-level folder / author / id.ext`, saving you from right-clicking "Save As" one by one.

---

## ✨ Features

- ✅ **Batch select & download** — click to toggle / `Shift + click` range select / select all / videos only / images only / invert / clear
- ✅ **Original quality** — reads the original image/video URL directly from the DOM on post pages (no re-encoding); auto-opens detail pages for list pages
- ✅ **Smart deduplication** — successfully downloaded media is recorded and auto-skipped on subsequent selections, preventing duplicate downloads
- ✅ **Auto-organized** — files saved into `top-level folder / author / id.ext`
- ✅ **Right-click save** — right-click any image/video to download just that one
- ✅ **Native downloads** — uses the browser's native `chrome.downloads` API: no CORS restrictions, correct Referer included
- ✅ **SPA-aware** — MutationObserver handles lazy loading, route changes, and dynamically added cards

---

## 📦 Installation

This extension is not on the Chrome Web Store. Load it in developer mode:

1. Download / clone this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Toggle **Developer mode** (top-right) on.
4. Click **Load unpacked** and select the `chrome_extension/` directory.
5. The extension icon appears in the toolbar. Open [civitai.red](https://civitai.red) and log in, then you're ready to go.

> 💡 **Edge / Brave and other Chromium browsers** are also supported — same steps (Edge uses `edge://extensions`).
>
> ⚠️ **If a "Save As" dialog pops up for every file**: go to `chrome://settings/downloads` and turn off **"Ask where to save each file before downloading"**.

---

## 🚀 Usage

### Option 1: Select + Batch Download (list pages / post pages)

1. On civitai.red list or post pages, **a checkbox appears on the top-left of each card**.
2. Click to select images/videos you want; hold `Shift` and click another card for **range selection**.
3. Click the extension icon in the toolbar. In the popup you can:
   - **Select all / Videos only / Images only / Invert / Clear**
   - See "N selected"
4. Click **Download Selected**. Files download to `Chrome Downloads / top-level folder / author / id.ext`.

### Option 2: Right-click Save (any image/video)

Right-click any image or video → **"Civitai: Save this image/video (original quality)"**. The extension reads the element's original URL (auto-opens the detail page if missing) and downloads it to the same folder structure as Option 1.

> ⚠️ You **must operate inside a logged-in civitai.red tab** (the login cookie lives in that page).

---

## 📁 Save Path

```
<Chrome Downloads> / <top-level folder> / <author> / <media id>.<extension>
```

| Field | Description |
|-------|-------------|
| **Top-level folder** | Configurable in settings; defaults to `civitai`. Leave empty for `Downloads / author / id.ext` |
| **Author** | From the page author info on post pages; from the detail page on list pages |
| **Filename** | `<media id>.<extension>`, e.g. `110915488.jpg`, `48496093.mp4` |

---

## ⚙️ Settings

Click the toolbar icon → **Open Settings** to configure:

- **Top-level folder name** — customize the first-level directory; leave empty to skip it.
- **Download history** — view deduplicated count; one-click clear.

---

## 🛠️ How It Works

Downloads use the browser's **native `chrome.downloads`** (same path as right-click "Save As"):

- **No CORS restrictions** — native downloads don't enforce cross-origin checks, so `image.civitai.com` is directly reachable.
- **Correct Referer automatically** — the download request is sent with the origin of the current civitai.red tab, so `Referer: https://civitai.red/` is naturally correct.
- **Subdirectories supported** — passing `civitai/<author>/<id>.<ext>` makes Chrome create the folders automatically.

Getting the original-quality URL has two cases:

- **Post page** (`/posts/<id>`): the gallery already shows `original=true` images/videos → **read the DOM URL directly without reloading** (saves bandwidth).
- **Videos / images list page**: cards are thumbnails → the background **opens `/images/<id>` detail-page tabs one by one**, reads the original URL, then downloads (consistent with the Node project's "open detail pages one by one" approach).
- The `?ids=` API currently returns 500/503 (overloaded) and is unavailable.

---

## ❓ FAQ

<details>
<summary><b>Downloaded images won't open / look like thumbnails?</b></summary>

Cards on list pages are thumbnails by default; the extension automatically opens the detail page to fetch the original URL. If a specific file is still a thumbnail, make sure your network can reach the civitai detail page, then retry that file.
</details>

<details>
<summary><b>"Download Selected" does nothing when clicked?</b></summary>

Make sure: (1) the current tab is civitai.red and you're logged in; (2) at least one item is selected; (3) the browser hasn't blocked multiple file downloads (if there's a block prompt in the top-right, click "Allow").
</details>

<details>
<summary><b>Why does it ask where to save every time?</b></summary>

That's Chrome's global download setting — see the ⚠️ note under "Installation" above. Turn off "Ask where to save each file before downloading".
</details>

<details>
<summary><b>Will it download duplicate files?</b></summary>

No. Successfully downloaded media IDs are recorded in `chrome.storage` and auto-skipped on subsequent selections. You can view or clear the history on the settings page.
</details>

---

## 🧩 Directory Structure

```
chrome_extension/
├── manifest.json          # MV3: downloads/storage/scripting/tabs/notifications/contextMenus
├── civitai-core.js        # shared pure functions (page detection, id parsing, path building)
├── background.js          # service worker: chrome.downloads + contextMenus + message relay
├── content.js             # page injection: selection UI + range select + URL fetch (DOM/iframe) + right-click save
├── content.css            # checkbox / floating panel styles
├── popup.html / popup.js  # toolbar popup
├── options.html / options.js  # settings page
├── gen-icons.js           # generate icons (node gen-icons.js)
└── icons/                 # 16/32/48/128 PNG
```

### For maintainers

- `civitai-core.js`: pure functions (page detection, id extraction, filename/extension, path building), shared across pages.
- `content.js`: injects checkboxes + floating panel; handles SPA routing & lazy loading (MutationObserver); Shift range-select sorts by on-screen visual position; URL fetching (post reads DOM / list pages open iframe detail pages); right-click save; sends `{id,url,author}` to background.
- `background.js`: `chrome.downloads.download({url, filename:"civitai/<author>/<id>.<ext>"})` native download; `contextMenus` registration & relay; message forwarding.

---

## 🤝 Contributing

Issues and PRs are welcome! Please open an Issue first to describe the problem or proposal so we can align on direction.

1. Fork this repository
2. Create a branch `git checkout -b feature/your-feature`
3. Commit your changes `git commit -m "feat: ..."`
4. Push `git push origin feature/your-feature`
5. Open a Pull Request

---

## 📜 License

This project is open-sourced under the [MIT License](../LICENSE). You are free to use, modify, and distribute it.

---

## ⚖️ Disclaimer

**By installing or using this extension, you agree to the following:**

1. **No affiliation with Civitai.** This is an independent, third-party tool. Civitai (civitai.red / civitai.com) and its affiliates did not develop, sponsor, authorize, or endorse this project. All trademarks, logos, and brand names are the property of their respective owners.

2. **For personal, lawful use only.** This extension is intended to help individuals organize and download content they are **authorized** to access.

3. **You assume all risk and responsibility.** This extension does not store, proxy, or re-upload any content — all downloads happen directly between your browser and Civitai's servers. **You are solely responsible** for the legality of the content you download, use, or distribute, including but not limited to **copyright, rights of publicity, privacy, protection of minors, and your local laws**. The author is not liable for any direct or indirect damages arising from the use or misuse of this extension.

4. **Respect the target site's Terms.** Please read and comply with civitai.red's Terms of Service, content policies, and rate limits. Do **not** use this tool for commercial scraping, large-scale automation, access-control circumvention, payment bypass, or any activity that violates the website's rules or applicable law.

5. **Content compliance.** If downloaded content involves copyrighted works, follow the corresponding license (e.g., the license stated on the Civitai model/image page). For content involving real persons, ensure you have proper authorization. **It is strictly prohibited** to download, store, or distribute any illegal content, including but not limited to CSAM and non-consensual intimate content.

6. **No warranty.** This extension depends on the website's page structure; site changes may break functionality. The author is under no obligation to maintain it and provides no guarantee of availability or correctness.

7. **Takedown requests.** If you are a rights holder and believe this project affects your legitimate rights, contact the author via [Issues](../../issues) or email. **Note: this project does not host any copyrighted media files itself.**

**By continuing to install or use this extension, you acknowledge that you have read and accepted all of the above terms. If you do not agree, please uninstall and stop using it immediately.**

---

<div align="center">

<sub>Built with ❤️ for the Civitai community. Use responsibly.</sub>

</div>
