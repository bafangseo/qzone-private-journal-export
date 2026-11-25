# AGENTS.md · 执行契约

本文件是给 AI agent 的**最短可执行路径**。细节、推导、坑，都在 `README.md` 与 `references/` 里；
本文件只写「必须怎么做」和「什么情况算失败」。

## 任务

用户要求「导出 QQ 空间私密日志」。你要产出：一份包含该账号**全部私密日记**的 UTF-8 TXT，放在用户指定目录。

## 前置自检（任一不满足 → 停下问用户，不要猜）

1. 用户的 Chrome / Edge **已登录** QQ 空间，且能打开「日志 → 私密日记」列表。
2. 浏览器自动化可用：
   ```bash
   BSK_AUTO_START=0 bsk status --json     # browsers 数组非空
   ```
   没有 bsk 就用任意 CDP 客户端（Playwright `connect_over_cdp` 等），把下面所有 `evaluate` 换成 `page.evaluate`。

## 执行序列

```bash
# 1 会话（不要用 tab borrow，会卡人工确认）
BSK_AUTO_START=0 bsk session start --browser <instance_id> --json        # → <sid>

# 2 打开日志列表；<UIN> 取用户标签页 URL 的路径段，禁止硬编码
BSK_AUTO_START=0 bsk navigate "https://user.qzone.qq.com/<UIN>/2" --session <sid>

# 3/4/5 三段脚本；每次 evaluate 前都必须重新 sync 拿顶层 observation_id
BSK_AUTO_START=0 bsk cooperate sync --session <sid> --json               # → <obs>
BSK_AUTO_START=0 bsk evaluate --session <sid> --observation <obs> --json --timeout 300s "$(cat scripts/01-collect-list.js)"
#   重复 sync，再跑 02、03

# 6 落盘：--out 用 ASCII 临时路径
BSK_AUTO_START=0 bsk download --selector "#qzone-export" --out /tmp/qzone-export.txt --session <sid>

# 7 用 Python 移到目标目录并校验（中文路径不要经 shell 传参）
# 8 收尾
BSK_AUTO_START=0 bsk session stop <sid>
```

## 三条铁律

1. **正文不许进对话**。02/03 脚本只返回统计，正文留在浏览器 `window` 里；如果脚本返回了正文字段，说明你改错了。
2. **编码只认 GBK**。`new TextDecoder("gbk").decode(await resp.arrayBuffer())`；用 `.text()` 必乱码。
3. **每次 evaluate 都要新 observation**。旧 ID 会 `permission_denied`，且提示语会误导你去查页面状态。

## 完成判据（必须逐条核对后才向用户报告“已导出”）

- 清单条数 == 页面「有 N 篇」文案里的 N。
- 空正文条数 == 0；若非 0，逐条报 `blogid` 与原因，并说明导出不完整。
- 输出文件：`\ufffd` 0 次、HTML 实体残留 0 次、序号 `【1】…【N】` 连续。
- 文件能在 Windows 记事本里正常显示中文（UTF-8，建议带 BOM）。

## 已知不可为

- 开启了「私密日志独立密码」的账号：正文接口需要 `pwd2sig` 签名，本仓库不处理。
- 图片不导出（本流程只取文字）。若用户要求配图，需另行抓 `#blogDetailDiv img[src]`。
- 直链 `user.qzone.qq.com/<UIN>/blog/<blogid>` 对私密日志无效，别试。

## 报告格式建议

给用户的总结只要：文件路径、篇数、字数、时间跨度、未导出项（图片/空正文）。**不要复述任何一篇日记的内容。**
