// 01-collect-list.js
// 在 QQ 空间日志列表页（https://user.qzone.qq.com/<UIN>/2）的【顶层页面上下文】执行。
// 产出：window.__qzoneList = [{ id, title, date }]   （按页面顺序 = 从新到旧）
// 返回：{ expect, pages, total, pagesDetail }
// 依赖：已登录；#tblog iframe 同源可读；未开启「私密日志独立密码」也能读列表。
(async () => {
  const T = ms => new Promise(r => setTimeout(r, ms));
  const doc = () => document.getElementById("tblog").contentDocument;

  // UIN 从路径取，禁止硬编码
  const UIN = location.pathname.split("/").filter(Boolean)[0];
  if (!/^\d{5,12}$/.test(UIN || "")) throw new Error("无法从 URL 取到 UIN，请确认在 /<UIN>/2 页面");

  const rowsOf = d => [...d.querySelectorAll('a[rel="private-detail-link"]')].map(a => {
    const li = a.closest("li");
    const m = li ? li.textContent.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/) : null;
    return { id: a.getAttribute("blogid"), title: (a.textContent || "").trim(), date: m ? m[1] : "" };
  });

  // 1) 切到「私密日记」分类
  let d = doc();
  if (!d) throw new Error("找不到 #tblog，可能未登录或空间改版");
  if (!d.querySelector('a[rel="private-detail-link"]')) {
    const tab = [...d.querySelectorAll("a")].find(x => (x.textContent || "").trim() === "私密日记");
    if (!tab) throw new Error("找不到「私密日记」入口：确认已登录、且该账号存在私密日记");
    tab.click();
    await T(3500);
    d = doc();
  }

  // 2) 读总数「有 N 篇」
  const expect = parseInt((d.body.innerText.match(/有\s*(\d+)\s*篇/) || [])[1] || "0", 10);
  const PIM = d.defaultView.QZBlog && d.defaultView.QZBlog.Util && d.defaultView.QZBlog.Util.PageIndexManager;
  if (!PIM) throw new Error("找不到分页器 QZBlog.Util.PageIndexManager，页面可能改版");

  const PER_PAGE = 15;
  const pages = expect > 0 ? Math.ceil(expect / PER_PAGE) : 50; // 无总数时兜底，最多试 50 页
  const items = [];
  const pagesDetail = [];

  // 3) 逐页收（每页约 10 秒，必须等到位）
  for (let p = 1; p <= pages; p++) {
    try { PIM.goDirectPage(p); } catch (e) { /* 有的版本对当前页会抛，忽略 */ }
    let ok = false;
    for (let i = 0; i < 60; i++) {           // 最多等 30 秒
      await T(500);
      const c = doc();
      if (c && (c.location.href || "").indexOf("page=" + p) >= 0
            && c.querySelectorAll('a[rel="private-detail-link"]').length > 0) { ok = true; d = c; break; }
    }
    await T(1200);                            // 到位后再给 1.2 秒让 DOM 稳定
    d = doc();
    const rows = d ? rowsOf(d) : [];
    items.push(...rows);
    pagesDetail.push(p + ":" + rows.length + (ok ? "" : "!"));
    if (!rows.length && expect > 0) break;    // 取不到就停，别空转
  }

  // 4) 去重（翻页偶尔会重复返回同一页）
  const seen = new Set();
  const uniq = [];
  for (const it of items) if (it.id && !seen.has(it.id)) { seen.add(it.id); uniq.push(it); }

  window.__qzoneList = uniq;
  window.__qzoneUin = UIN;
  return {
    uin: UIN,
    expect: expect,
    pages: pagesDetail.length,
    total: uniq.length,
    match: expect === 0 ? null : uniq.length === expect,
    pagesDetail: pagesDetail.join(" ")
  };
})()
