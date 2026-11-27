# 失败模式与修复

按「现象 → 诊断 → 修法」组织。诊断列里的命令都在 `scripts/*.js` 同一上下文执行。

## A. 权限 / 会话

### A1 `permission_denied: This action requires an unused strict observation from cooperate sync`

- **原因**：`evaluate` 需要「一次性的观察」，同一个 `observation_id` 用过就失效。
- **修法**：每次 `evaluate` 前重新 `cooperate sync --session <sid> --json`，取**顶层** `observation_id`：
  ```bash
  OBS=$(bsk cooperate sync --session <sid> --json | python -c "import sys,json;print(json.load(sys.stdin)['observation_id'])")
  bsk evaluate --session <sid> --observation "$OBS" ...
  ```
- **注意**：同一条报错里常带 `observation.observation_id` 的字样，那个是**错误**的取值，别用嵌套字段。

### A2 `timed out waiting for human confirmation`

- **原因**：用了 `tab borrow` 借用户的标签页，需要人点确认。
- **修法**：不借。`session start` + `navigate` 自己开一个 agent 标签页，Cookie 共享，登录态自动带上。

### A3 页面被重定向到登录页

- **诊断**：`location.href` 里出现 `ptlogin` / `login` 字样。
- **修法**：让用户在同一个浏览器里手动打开一次 `user.qzone.qq.com`，确认登录后重跑。不要试图用账号密码自动登录。

### A4 `Page frames cannot be observed: 0 (about:)`

- **现象**：新会话还没导航时，`cooperate sync` 直接报这个，拿不到 `observation_id`，于是 `navigate` 也缺 observation，卡死。
- **原因**：agent 标签页还停在 `about:`，没有可观察的文档。
- **修法**：**不带 `--observation` 直接再跑一次 `navigate`**（导航本身不需要观察，只有确认才需要）：
  ```bash
  bsk navigate "https://user.qzone.qq.com/<UIN>/2" --session <sid> --json   # 这一步通常会成功
  bsk cooperate sync --session <sid> --settle --json                        # 之后才有 observation
  ```
  如果第一次带 `--observation` 就成功，那就不用管这条。

## B. 列表

### B1 找不到 `#tblog`

- **诊断**：`document.querySelectorAll("iframe").length` 为 0 或没有该 id。
- **原因**：未登录 / 空间改版 / 打开的是手机版或他人主页。
- **修法**：确认 URL 是 `https://user.qzone.qq.com/<本人UIN>/2`；改版则按 `references/internals.md` §4 重新定位容器。

### B2 找不到「私密日记」入口

- **原因**：该账号没有私密日志，或侧栏文案改了。
- **诊断**：`[...document.querySelectorAll("#tblog")[0].contentDocument.querySelectorAll("a")].map(a=>a.textContent.trim())`
- **修法**：文案变了就改 `scripts/01-collect-list.js` 里那个 `=== "私密日记"` 的匹配串。

### B3 只收到几十条 / 只翻到第 2 页

- **原因**：用「连点下一页」翻页，第二次之后失效。
- **修法**：改用 `QZBlog.Util.PageIndexManager.goDirectPage(n)`。

### B4 翻页后行数没变 / 抓到重复

- **原因**：页面还没加载完就取 DOM（每页约 10 秒）。
- **修法**：等到 `iframe.location.href` 含 `page=n` **且** 条目数 > 0 再取，之后再给 1.2 秒稳定期；脚本已按这个写，别把等待改短。

### B5 `total != expect`

- **诊断**：对比 `pagesDetail`（形如 `1:15 2:15 3:15 ...`），看哪页少。
- **修法**：单独重跑那一页：`PIM.goDirectPage(3)` → 等 → 收；把结果按 `blogid` 去重合并。私密日记删除后编号会跳，属正常。

## C. 正文

### C0 全部条目 `Failed to fetch`（最坑的一个）

- **现象**：`02-fetch-articles.js` 返回 `empty` == 总条数，`failed` 里清一色 `Failed to fetch`。
- **诊断**：看一眼页面里有没有 `<base>`：
  ```js
  const b = document.querySelector("base"); [location.origin, b && b.href, new URL("/x", document.baseURI).href]
  ```
  正常会看到 `base` 是 `https://qzs.qq.com/`，`resolved` 也跟着变成 `qzs.qq.com`。
- **原因**：页面带 `<base href="https://qzs.qq.com/">`，**相对路径**被解析到另一个域 → 跨域 → 请求被拒。
- **修法**：接口地址一律用 `location.origin + "/proxy/domain/..."` 拼绝对 URL（脚本已这么写）。
  同理，任何在该页面里的 `fetch`／`img.src`／`new URL()` 都要小心 `<base>`。

### C1 正文全是 `ä¸€å®¶...` 这类乱码

- **原因**：用 UTF-8 解了 GBK。
- **修法**：`new TextDecoder("gbk").decode(await r.arrayBuffer())`。注意必须是 `arrayBuffer()`，`text()` 已经按声明编码解过了。

### C2 正文为空 / `noBody`

- **诊断**：打印返回 HTML 的前 300 字符，看是不是「日志中转页面」或权限提示。
- **原因**：
  1. 账号开了「私密日志独立密码」→ 需要 `pwd2sig`，本仓库不支持；
  2. 该篇已被删除；
  3. `blogid` 传错（`a` 的 `blogid` 属性是字符串，别从 href 取——href 是 `javascript:;`）。
- **修法**：逐条列出失败 `blogid`，如实告诉用户哪几篇没导到。

### C3 直链 `/blog/<id>` 报「数据不存在或已删除」

- **正常现象**，私密日志不吃直链。只用正文接口。

### C4 标题是 `var pubtime = g_oBlogData...` 之类的脚本片段

- **原因**：正文页的 `#paperTitle` / `#pubTime` 是脚本占位。
- **修法**：标题、时间一律从**列表页**取（Phase 3 已收），不要从正文页取。

## D. 落盘

### D1 `bsk download` 报错或文件名乱码

- **修法**：`--out` 用 ASCII 临时路径（如 `/tmp/qzone-export.txt`），下载成功后再用 Python 移动：
  ```python
  shutil.move("/tmp/qzone-export.txt", os.path.join(target_dir, "私密日志.txt"))
  ```

### D2 下载得到 0 字节 / 只有几个字节

- **诊断**：`evaluate` 的返回值里 `chars` 是否正常（几万字）。
- **原因**：`03` 脚本先于 `02` 执行，`window.__qzoneData` 为空；或页面在 02 与 03 之间跳转/刷新过（`window` 被清空）。
- **修法**：按 01 → 02 → 03 顺序在**同一次会话、同一个标签页**里连续执行；中途不要 navigate。

### D3 文件打开是乱码

- **原因**：写文件时丢了 BOM 或按本地编码存了。
- **修法**：脚本已加 `\ufeff` 前缀；用 Python 复核时按 `utf-8-sig` 读、按 `utf-8-sig` 写。

## E. 内容质量

### E1 有 `&nbsp;` / `&amp;` 残留

- **原因**：实体没解。
- **修法**：`toText` 里用 `textarea.innerHTML = s; return textarea.value` 解码。别再手写正则替换实体。

### E2 有 `\ufffd` 替换字符

- **原因**：某几篇编码不是 GBK（极少），或解码时截断。
- **修法**：统计出现位置，单独按 UTF-8 重取那几篇对比。

### E3 篇数对但内容错位

- **原因**：并发抓取时把响应和条目的对应关系搞错了。
- **修法**：串行 `for await`，每篇用 `await`，别 `Promise.all` 一把梭（接口对并发也不友好）。
