<div align="center">

# 🎨 Civitai.red 批量下载助手

**A Chrome extension for batch-selecting and downloading images / videos from [civitai.red](https://civitai.red), organized into `作者/id.格式` folders.**

中文 · [English](README.en.md) · [免责声明](#-免责声明disclaimer)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4.svg)](https://developer.chrome.com/docs/extensions/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Platform](https://img.shields.io/badge/Platform-Chrome%20%2F%20Edge%20%2F%20Brave-lightgrey.svg)](#)

</div>

> 在 civitai.red 列表页 / post 页**批量勾选图片和视频，一键下载**，文件按「顶层目录 / 作者 / id.扩展名」自动归类，省去逐个右键另存的麻烦。

---

## ✨ 功能特性

- ✅ **批量勾选下载**：单击切换 / `Shift + 点`区间多选 / 全选 / 仅视频 / 仅图片 / 反选 / 清空
- ✅ **原始画质**：post 页直接读 DOM 原图/原视频地址，不重新转码压缩；列表页自动开详情页取址
- ✅ **智能去重**：已成功下载的媒体自动记录，再次勾选时跳过，避免重复下载
- ✅ **自动归类**：按 `顶层目录 / 作者 / id.ext` 分文件夹保存
- ✅ **右键另存**：在任意图片/视频上点右键即可下载该单张
- ✅ **原生下载**：使用浏览器原生 `chrome.downloads`，无 CORS 限制、自带正确 Referer
- ✅ **SPA 适配**：MutationObserver 自动处理懒加载、路由切换、新增卡片

---

## 📦 安装

由于本扩展未上架 Chrome 应用商店，请以「开发者模式」加载：

1. 下载 / Clone 本仓库到本地。
2. 打开 Chrome，地址栏输入 `chrome://extensions`。
3. 右上角打开 **「开发者模式 / Developer mode」** 开关。
4. 点击 **「加载已解压的扩展程序 / Load unpacked」**，选择本目录 `chrome_extension/`。
5. 扩展图标会出现在工具栏。打开 [civitai.red](https://civitai.red) 并登录后即可使用。

> 💡 **Edge / Brave 等 Chromium 内核浏览器**同样适用，安装方式一致（Edge 在 `edge://extensions`）。
>
> ⚠️ **若每个文件都弹出「另存为」窗口**：请到 `chrome://settings/downloads` 关闭「下载前询问每个文件的保存位置 / Ask where to save each file before downloading」。

---

## 🚀 使用方法

### 方式一：勾选 + 批量下载（列表页 / post 页）

1. 在 civitai.red 列表页或 post 页，**卡片左上角会出现一个复选框**。
2. 单击勾选想要的图片/视频；按住 `Shift` 再点另一张可**区间多选**。
3. 点击工具栏的扩展图标，在弹窗里可以：
   - **全选 / 仅视频 / 仅图片 / 反选 / 清空**
   - 查看「已勾选 N 个」
4. 点击 **「下载所选」**，文件会下载到 `Chrome下载目录 / 顶层目录 / 作者 / id.ext`。

### 方式二：右键另存（任意图片/视频）

在网页上的图片或视频上点 **右键 → 「Civitai：另存此图/视频（原始质量）」**，扩展会读取该元素的原始地址（缺则自动打开详情页获取），下载到与方式一相同的目录结构。

> ⚠️ 必须在**已登录 civitai.red 的标签页**里操作（登录 Cookie 在该页生效）。

---

## 📁 保存路径

```
<Chrome 下载目录> / <顶层目录> / <作者> / <媒体id>.<扩展名>
```

| 字段         | 说明                                                              |
| ------------ | ----------------------------------------------------------------- |
| **顶层目录** | 设置页可改，默认 `civitai`；留空则直接 `下载目录 / 作者 / id.ext` |
| **作者**     | post 页来自页面作者信息；列表页来自详情页的作者信息               |
| **文件名**   | `<媒体id>.<扩展名>`，如 `110915488.jpg`、`48496093.mp4`           |

---

## 🧩 目录结构

```
chrome_extension/
├── manifest.json          # MV3：downloads/storage/scripting/tabs/notifications/contextMenus
├── civitai-core.js        # 纯函数共享（页面识别、id 提取、路径构建）
├── background.js          # service worker：chrome.downloads + contextMenus + 消息转发
├── content.js             # 页面注入：勾选 UI + 区间多选 + 取址（DOM/iframe）+ 右键另存
├── content.css            # 复选框 / 悬浮面板样式
├── popup.html / popup.js  # 工具栏弹窗
├── options.html / options.js  # 设置页
├── gen-icons.js           # 生成图标（node gen-icons.js）
└── icons/                 # 16/32/48/128 PNG
```

### 给后续维护者

- `civitai-core.js`：纯函数（页面识别、id 提取、文件名/扩展名、路径构建），被多页面共享。
- `content.js`：注入复选框 + 悬浮面板，SPA 路由 & 懒加载（MutationObserver）；Shift 区间多选按屏幕视觉位置排序；取址（post 读 DOM / 列表页开 iframe 详情页）；右键另存；把 `{id,url,author}` 发给 background。
- `background.js`：`chrome.downloads.download({url, filename:"civitai/<作者>/<id>.<ext>"})` 原生下载；右键菜单 `contextMenus` 注册与转发；消息转发。

---

## 🤝 贡献

欢迎提 Issue 和 PR！请先在 Issue 中描述问题或建议，便于讨论方向。

1. Fork 本仓库
2. 新建分支 `git checkout -b feature/your-feature`
3. 提交修改 `git commit -m "feat: ..."`
4. 推送 `git push origin feature/your-feature`
5. 发起 Pull Request

---

## 📜 开源协议

本项目基于 [MIT License](LICENSE) 开源，可自由使用、修改、分发。

---

## ⚖️ 免责声明 / Disclaimer

### 🇨🇳 中文

**使用本扩展即视为您已阅读并同意以下条款：**

1. **本项目与 Civitai 无任何关联。** 本扩展是独立开发的第三方工具，Civitai（civitai.red / civitai.com）及其关联公司未参与开发、未提供赞助、未授权或背书本项目。所有商标、Logo、名称版权归原所有者所有。

2. **仅供个人学习与研究使用。** 本扩展仅用于个人合法的、已获得授权的内容的批量整理与下载，方便用户管理自己有权使用的资源。

3. **用户自行承担使用风险与法律责任。** 本扩展不存储、不中转、不上传任何内容，所有下载行为均发生在用户本人的浏览器与 Civitai 服务器之间。用户须对自己下载、使用、传播的内容及其合法性（包括但不限于**版权 / 著作权、肖像权、隐私权、未成年保护、当地法律法规**）负全部责任。作者不对任何因使用或滥用本扩展造成的直接或间接损失负责。

4. **请遵守目标网站条款与 `robots.txt`。** 使用前请阅读并遵守 [civitai.red](https://civitai.red) 的服务条款（Terms of Service）、内容政策与速率限制。请勿用于商业用途、大规模爬取、突破访问控制、规避付费或其他违反网站规则与法律法规的行为。

5. **内容合规提醒。** 您下载的内容如涉及他人受版权保护的素材，请遵守相应许可证（如 Civitai 模型/图片页标注的许可协议），在许可范围内使用。涉及真人肖像的内容请确认已获得相应授权。**严禁**下载、存储或传播任何违法内容，包括但不限于儿童性虐待材料（CSAM）、非自愿的隐私内容等。

6. **不保证可用性。** 本扩展依赖网站页面结构，Civitai 改版可能导致功能失效，作者无义务持续维护，亦不保证任何版本的可用性与正确性。

7. **侵权请联系移除。** 若您是内容权利人，认为本扩展侵害了您的合法权益，请通过 [Issue](../../issues) 或邮件联系作者，核实后将配合处理。**注意：本项目本身不托管任何受版权保护的媒体文件。**

**继续安装或使用本扩展，即表示您已理解并接受上述全部条款。如不同意，请立即卸载并停止使用。**

### 🇬🇧 English

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
