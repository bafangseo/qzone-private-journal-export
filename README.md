# 让 AI 全自动导出 QQ 空间的私密日志

> 一份**写给 AI 读的 SOP**：把「QQ 空间 → 日志 → 私密日记」里的全部文章，用浏览器自动化一次性导出成一份 UTF-8 的 TXT。
>
> 只导出**你自己账号**的日志。所有请求都发生在你自己浏览器的登录态里，不经过任何第三方服务器。

- 适用对象：能操控浏览器（CDP / 扩展）的 AI agent，或愿意照着步骤点几下的人。
- 实测规模：百余篇 / 数万字，单轮约 3 分钟跑完。
- 界面语言：QQ 空间中文版（下文的选择器依赖中文 UI 文案，英文界面需自行替换）。

---

## 0. 给 AI 的执行摘要（TL;DR）

如果你是有浏览器控制权的 AI：

```text
前置：用户的 Chrome 已登录 QQ 空间（user.qzone.qq.com），且 browser-skill(bsk) 扩展已连接。

1. BSK_AUTO_START=0 bsk status --json            # 拿 browser instance_id
2. BSK_AUTO_START=0 bsk session start --browser <id> --json
3. navigate https://user.qzone.qq.com/<UIN>/2    # <UIN> 从用户已打开标签页的 URL 里取
4. evaluate scripts/01-collect-list.js           # → window.__qzoneList（全部篇目的 id/标题/时间）
5. evaluate scripts/02-fetch-articles.js         # → window.__qzoneData（含正文，GBK 已解码）
6. evaluate scripts/03-build-and-download.js     # 页面里挂一个 <a id="qzone-export"> 下载按钮
7. bsk download --selector "#qzone-export" --out <ASCII 临时路径>
8. python 把文件移到目标目录（中文路径别经 shell 传参）+ 校验
9. bsk session stop <id>
```

硬性验收（不满足就不要说“导完了”）：

- `window.__qzoneList.length` == 列表页显示的「有 N 篇」。
- `window.__qzoneData` 里 `content` 为空的条数 == 0（或逐条列出 blogid 说明原因）。
- 最终文本里 `\ufffd` 出现 0 次、`&nbsp;` / `&amp;` 残留 0 次。
- 文件编码 UTF-8（带 BOM 更省事，Windows 记事本直开不乱码）。

---

## 1. 为什么不能“直接抓页面”

先排除三条看起来可行、实际走不通的路，省得你重复踩：

| 做法 | 结果 |
| --- | --- |
| 直接访问 `https://user.qzone.qq.com/<UIN>/blog/<blogid>` | 私密日志返回「**数据不存在或已删除**」。私密日志要靠列表点击带过去的 referrer，直链无效。 |
| `fetch` 列表页/正文页的**外壳** HTML | 拿到的只是壳。正文由内层 iframe + JS 二次请求拼出来，外壳里没有文章文字。 |
| 用登录 Cookie 在本地 `curl` 正文 URL | 拿到的同样是壳，而且多数请求需要页面上下文里的 referrer / 同源条件。 |

**真正有效的一条**：在页面上下文里 `fetch` 私密日志的**正文数据接口**（下文 §4.1），一次循环取完全部篇目。

---

## 2. 环境

### 2.1 必需

1. **Chrome / Edge**，且**已登录你要导出的那个 QQ 空间账号**（能用浏览器正常打开「私密日记」列表）。
2. **browser-skill (bsk) CLI + 浏览器扩展** —— 让 AI 借用你的登录态操作页面。
   - 项目与安装说明：<https://github.com/Tencent/BrowserSkill>
   - CLI 默认在 `~/.local/bin/bsk`（Windows 为 `bsk.exe`）；装完确认 `bsk --version`。
   - 扩展装好后，Chrome 里要能连上（`bsk status --json` 的 `browsers` 非空）。
3. 一个能读文件、能跑 shell 的 AI agent（能读本仓库的 `scripts/*.js` 并把内容喂给浏览器）。

### 2.2 可选替代

没有 bsk 也行，只要满足「在已登录的页面上下文里执行 JS」：

- Playwright：`connect_over_cdp` 连上你自己的 Chrome，`page.evaluate(js)`。
- Puppeteer / 任何 CDP 客户端同理。
- 手工作业：F12 打开「私密日记」列表页 → Console 里粘贴 `scripts/*.js` → 逐个执行。

> 关键点不是工具，而是**在 `user.qzone.qq.com` 的页面上下文里 `fetch`**：这样 Cookie、referrer、同源策略全部天然满足。

---

## 3. 全流程（逐阶段，可断点续跑）

### Phase 1 · 建会话

```bash
BSK_AUTO_START=0 bsk status --json            # 记下 browsers[0].instance_id
BSK_AUTO_START=0 bsk session start --browser <id> --json   # 记下 session_id
```

> **不要用 `tab borrow` 去借用户已经开着的标签页**：它需要用户在弹窗里点确认，超时非常常见（实测 60 秒就 timeout）。
> 自己 `navigate` 一个 agent 标签页即可——同一个浏览器 profile 共享 Cookie，登录态自动带上。

### Phase 2 · 打开列表页

```bash
BSK_AUTO_START=0 bsk navigate "https://user.qzone.qq.com/<UIN>/2" --session <sid>
```

`<UIN>` 就是你 QQ 号，出现在 URL 路径里（`/<UIN>/2` 这种，路径中间那段）。**不要硬编码，从 URL 里取**。

进页面后先确认两个东西存在：

- `document.getElementById("tblog")` 存在（日志内容都在这个 iframe 里）；
- iframe 里能找到 `a[rel=private-detail-link]`（私密日记的条目）。

### Phase 3 · 收清单（`scripts/01-collect-list.js`）

```bash
BSK_AUTO_START=0 bsk evaluate --session <sid> --observation <obs> --json --timeout 300s "$(cat scripts/01-collect-list.js)"
```

这个脚本会：

1. 点侧栏「**私密日记**」切到私密分类（默认进的是「我的日志」）；
2. 从页面文案「有 N 篇」读出总数；
3. 按 `N/15` 算出页数，用 `QZBlog.Util.PageIndexManager.goDirectPage(p)` 逐页翻，收集每条的 `blogid`、标题、时间；
4. 去重后写进 `window.__qzoneList`，返回 `{pages, total, expect}`。

> **翻页是本流程唯一慢的地方**：每页要 10 秒上下。别用「连点下一页」——实测只能翻到第 2 页就卡住；`goDirectPage(n)` 才稳。
> 判定某页到位要**双重校验**：iframe 的 `location.href` 里含 `page=n`，且条目数 > 0。

### Phase 4 · 抓正文（`scripts/02-fetch-articles.js`）

```bash
BSK_AUTO_START=0 bsk evaluate --session <sid> --observation <obs> --json --timeout 300s "$(cat scripts/02-fetch-articles.js)"
```

对 `window.__qzoneList` 里每个 `blogid` 请求正文接口，**必须用 GBK 解码**（见 §4.2），抽出 `#blogDetailDiv` 转纯文本，写进 `window.__qzoneData`。

返回体只报统计（条数 / 空正文数 / 失败列表），**正文一律不回传**——既省 token，也避免私密内容进对话记录。

### Phase 5 · 拼文本（`scripts/03-build-and-download.js`）

```bash
BSK_AUTO_START=0 bsk evaluate --session <sid> --observation <obs> --json --timeout 60s "$(cat scripts/03-build-and-download.js)"
```

在页面里把全部篇目拼成一份 TXT（加 BOM），做成 `Blob`，挂到一个 `<a id="qzone-export" download>` 上。
**正文始终留在浏览器里，不经过 AI 的上下文。**

### Phase 6 · 落盘

```bash
BSK_AUTO_START=0 bsk download --selector "#qzone-export" --out /tmp/qzone-export.txt --session <sid>
```

- `--out` 用**纯 ASCII 临时路径**。中文/非 ASCII 路径经某些 shell 传给 CLI 会变乱码。
- 然后再用 Python（`shutil.move`）挪到目标目录、改成中文文件名——路径处理交给 Python 更安全：

```python
import os, shutil
target_dir = r"D:\我的导出\私密日志"
os.makedirs(target_dir, exist_ok=True)
shutil.move("/tmp/qzone-export.txt", os.path.join(target_dir, "私密日志.txt"))
```

### Phase 7 · 验收 + 收尾

```bash
BSK_AUTO_START=0 bsk session stop <sid>
```

验收清单见 §5。**stop 之后 agent 标签页会被关掉，用户自己原来的标签页不受影响。**

---

## 4. 关键事实（已逆向确认，省得重新试）

### 4.1 正文接口

```text
GET /proxy/domain/b.qzone.qq.com/cgi-bin/privateblog/privateblog_output_data
    ?uin=<UIN>
    &blogid=<BLOGID>
    &pwd2sig=
    &styledm=qzonestyle.gtimg.cn
    &imgdm=qzs.qq.com
    &bdm=b.qzone.qq.com
    &rs=<随机小数>
```

- 相对路径即可（同源），**带 `credentials: "include"`**。
- `pwd2sig` 留空：适用于**没开通「私密日志独立密码」**的账号。开了独立密码的需要该签名，本仓库不处理（会拿不到正文）。
- 返回的是完整正文 HTML，正文容器 `#blogDetailDiv`。

### 4.2 编码

QQ 空间这批 CGI 返回 **GBK**：

```js
const html = new TextDecoder("gbk").decode(await resp.arrayBuffer());
```

用 `resp.text()` 会整篇乱码（`ä¸€å®¶...` 那种），别问我怎么知道的。

### 4.3 列表与分页

| 项 | 值 |
| --- | --- |
| 内容 iframe | `#tblog`（`name="app_canvas_frame"`），`contentDocument` 同源可读 |
| iframe 文档 | `qzonestyle.gtimg.cn/qzone/app/blog/v6/bloglist.html#nojump=1&catalog=private&page=N` |
| 条目选择器 | `a[rel="private-detail-link"]`，`blogid` 是**属性**不是 href |
| 条目链接 | `href="javascript:;"` —— 拿不到 URL，别指望从 href 拼 |
| 标题 | 该 `a` 的 `textContent` |
| 时间 | 最近的 `li` 文本里正则 `(\d{4}-\d{2}-\d{2} \d{2}:\d{2})` |
| 总数 | 页面文案 `有 N 篇` |
| 每页 | 15 条 |
| 翻页 | iframe `contentWindow.QZBlog.Util.PageIndexManager.goDirectPage(n)`（1 基） |

### 4.4 别信正文页里的标题/时间

正文页的 `#paperTitle`、`#pubTime` 里塞的是**脚本占位**（`document.write(...)` 片段），取出来是垃圾。
标题和时间一律**从列表页取**（Phase 3 已经顺手收了）。

---

## 5. 验收清单

- [ ] `window.__qzoneList.length` 等于页面显示的「有 N 篇」。
- [ ] 每页条数为 15，末页可能不足 15（`ceil(N/15)` 页加起来正好 N）。
- [ ] `window.__qzoneData` 中空正文条数为 0；若有，逐条给 `blogid` 和原因。
- [ ] 导出的 TXT：`\ufffd` 0 次，`&nbsp;` / `&amp;` / `&#` 残留 0 次，`<` 只剩正文里本来就有的。
- [ ] 篇目序号连续 `【1】…【N】`，无重号、无跳号。
- [ ] 文件 UTF-8 可正常打开（推荐带 BOM）。

---

## 6. 常见失败与处理

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `permission_denied: requires an unused strict observation from cooperate sync` | 每次 `evaluate` 都要新的观察 ID，用一次即失效 | 每次 evaluate 前先 `cooperate sync`，取**顶层** `observation_id`（不是 `observation.observation_id`） |
| `tab borrow ... timed out waiting for human confirmation` | 借用户标签页要人工确认 | 别借，自己 `session start` + `navigate` |
| 只收到 30 条 / 只翻到第 2 页 | 「下一页」连点法在第 2 页后失效 | 用 `goDirectPage(n)`，并按 `page=n` + 行数双重校验，每页等满 10 秒 |
| 正文全乱码 | 用 UTF-8 解了 GBK | `TextDecoder("gbk")` |
| 正文为空 / `noBody` | 该账号开了「私密日志独立密码」，或缺 `pwd2sig` | 本仓库不支持，需自行处理密码签名 |
| 直链 `/blog/<id>` 报「数据不存在或已删除」 | 私密日志不吃直链 | 只走 §4.1 的接口 |
| `bsk download` 落盘文件名乱码 | 中文路径经 shell 传参 | 先下到 ASCII 临时路径，再 Python 改名移动 |
| 页面里 `#tblog` 不存在 | 空间被重定向到登录页 / 皮肤改版 | 让用户手动打开一次日志页，确认登录态与新版布局，再调整选择器 |

更多排查细节见 [`references/troubleshooting.md`](references/troubleshooting.md)；接口与选择器的推导过程见 [`references/internals.md`](references/internals.md)。

---

## 7. 边界与隐私

- **只对本人账号有效**：整个流程依赖你浏览器里的登录态，导不到别人的私密日志。
- **数据不出本机**：抓取、拼接、落盘全在你自己的浏览器与本机磁盘上完成；本仓库没有任何服务端。
- **AI 不必看到正文**：按本 SOP 走，正文只在浏览器里流转，AI 只拿到条数和统计。
- **导出文件请当隐私资料保管**：默认 `.gitignore` 已排除 `*.txt` 导出物，别误提交到公开仓库。
- **接口非官方**：QQ 空间随时可能改版或调整参数，失效属正常，按 §4 的结构重新定位即可。

---

## 8. 仓库结构

```text
.
├── README.md                       # 本文（人 + AI 都能读的主 SOP）
├── AGENTS.md                       # 给 AI 的精简执行契约（很多 agent 会自动读这个）
├── scripts/
│   ├── 01-collect-list.js          # 收清单：切私密分类 + 翻页 + 存 window.__qzoneList
│   ├── 02-fetch-articles.js        # 抓正文：GBK 解码 + 存 window.__qzoneData
│   └── 03-build-and-download.js    # 拼 TXT + 挂 <a id="qzone-export"> 下载
└── references/
    ├── internals.md                # 接口/选择器速查与推导
    └── troubleshooting.md          # 失败模式与修复
```

三个 `scripts/*.js` 都是**自包含的 evaluate 表达式**（IIFE / async IIFE，最后一句是返回值），可以整段丢给 `bsk evaluate` 或 CDP 的 `Runtime.evaluate`。

---

## 9. 免责

本仓库记录的是「如何把自己账号里的数据导出来」的技术路径，用于数据自持与备份。
请只对自己的账号使用；导出内容涉及个人隐私，请自行妥善保管。接口与页面结构随时可能变化，不保证长期有效。
