# 内部结构速查：接口是怎么找到的

本文件解释「为什么这样抓」，以及**QQ 空间改版后你该怎么重新定位**。执行流程请看 `README.md`，别在这儿找步骤。

## 1. 页面解剖

打开 `https://user.qzone.qq.com/<UIN>/2` 时，实际是三层：

```text
顶层页面 user.qzone.qq.com/<UIN>/2
├── 外壳：导航、皮肤、好友列表……            ← 这里没有日志文字
├── iframe#tblog  (name=app_canvas_frame)   ← 日志全部在这里，同源可读
│   └── 文档 qzonestyle.gtimg.cn/qzone/app/blog/v6/bloglist.html#...&catalog=private&page=N
│         ├── 列表分类：我的日志 / 私密日记 / 草稿箱 / 回收站
│         └── 条目 <a rel="private-detail-link" blogid="...">标题</a>，日期在最近的 <li> 文本里
└── storage_helper.html × 2（无内容）
```

点开某一篇时，`#tblog` 会跳到：

```text
.../blogcanvas.html#...
 └── iframe → /proxy/domain/b.qzone.qq.com/cgi-bin/privateblog/privateblog_output_data?uin=..&blogid=..&pwd2sig=..
      └── 这是个「中转页」：内联脚本再拼一次请求，正文最终落在 #blogDetailDiv
```

**关键认知**：中转页本身没有正文，`fetch` 外壳只能拿到脚本；但**中转页的同款 URL 直接在页面上下文 `fetch`，返回的就是带 `#blogDetailDiv` 的完整正文**。跳转这一步是给浏览器用的，不是给数据用的。

## 2. 三条死路的成因

| 死路 | 原因 |
| --- | --- |
| 直链 `/blog/<blogid>` | 私密日志校验来源，缺 referrer / 分类上下文时返回「数据不存在或已删除」 |
| 抓外壳 HTML | 正文由 JS 二次请求注入，SSR 外壳里没有 |
| 本地 curl + Cookie | 拿到的仍是中转页；且部分请求依赖页面里的 `g_qzonetoken` 等全局变量 |

## 3. 接口清单

### 正文

```text
/proxy/domain/b.qzone.qq.com/cgi-bin/privateblog/privateblog_output_data
  ?uin=<UIN>&blogid=<BLOGID>&pwd2sig=
  &styledm=qzonestyle.gtimg.cn&imgdm=qzs.qq.com&bdm=b.qzone.qq.com&rs=<rand>
```

- 编码：**GBK**
- 正文容器：`#blogDetailDiv`
- `pwd2sig`：账号未开通「私密日志独立密码」时留空即可

### 列表（无独立接口可用，走 DOM）

| 项 | 取法 |
| --- | --- |
| 总数 | `document 文本.match(/有\s*(\d+)\s*篇/)` |
| 条目 | `iframe#tblog` 内 `a[rel="private-detail-link"]`，`blogid` 属性 |
| 标题 | 该 `a` 的 `textContent` |
| 日期 | 最近的 `li`，正则 `\d{4}-\d{2}-\d{2} \d{2}:\d{2}` |
| 每页 | 15 |
| 翻页 | `iframe.contentWindow.QZBlog.Util.PageIndexManager.goDirectPage(n)`，1 基，每页约 10 秒 |

## 4. 改版了怎么办（自查手册）

按顺序试，通常第 1 步就能定位新接口：

1. **顺着 iframe 找请求**
   点开任意一篇私密日记 → 遍历 `document.querySelectorAll("iframe")`，打印每层的 `contentDocument.location.href`。
   凡是命中 `privateblog_output_data` / `blog_output_data` / `blog_get_one` 的，就是正文入口。

2. **看 Network 面板**
   在私密日记列表点开一篇，筛 XHR/Fetch，找返回体含文章正文的请求；复制 URL，把 `uin`、`blogid` 换成参数即可。

3. **找页面全局对象**
   列表 iframe 的 `contentWindow` 上有 `QZBlog`（含 `Util.PageIndexManager`、`CGI_URL`、`Router`）；
   正文页常见 `g_oBlogData`（含 `data.pubtime`、`data.title` 等）。这些能反推接口参数。

4. **验证新接口**
   在顶层页面 `fetch(url, {credentials:"include"})` → `arrayBuffer` → `TextDecoder("gbk")` → 检查结果里有没有正文容器。
   能拿到正文，就把 `scripts/02-fetch-articles.js` 的 `base`/`tail` 换成新参数。

## 5. 已知限制

- **图片不导出**：`#blogDetailDiv` 里的 `<img>` 未处理。需要的话可收集 `img[src]` 另存，但 QQ 空间图片有防盗链，通常要带 referrer 下载。
- **独立密码账号**：`pwd2sig` 非空，本仓库不处理签名。
- **草稿箱 / 回收站**：结构类似（`catalog=draft` / `recycle` 之类），但接口不同，未验证。
- **只取文字**：正文里的表格会被拍平成逐行文本；复杂排版会丢样式，这是 TXT 的固有限制。
