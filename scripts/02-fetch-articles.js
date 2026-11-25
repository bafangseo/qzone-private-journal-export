// 02-fetch-articles.js
// 依赖：先跑 01-collect-list.js（window.__qzoneList / window.__qzoneUin）
// 产出：window.__qzoneData = [{ id, title, date, content, length }]
// 返回：{ total, empty, totalChars, min, med, max, failed }   —— 只回统计，不回正文
(async () => {
  const T = ms => new Promise(r => setTimeout(r, ms));
  const list = window.__qzoneList;
  const UIN = window.__qzoneUin || location.pathname.split("/").filter(Boolean)[0];
  if (!Array.isArray(list) || !list.length) throw new Error("先执行 scripts/01-collect-list.js");
  if (!/^\d{5,12}$/.test(UIN || "")) throw new Error("UIN 缺失");

  // QQ 空间这批 CGI 返回 GBK，必须显式解码
  const dec = new TextDecoder("gbk");
  const base = "/proxy/domain/b.qzone.qq.com/cgi-bin/privateblog/privateblog_output_data?uin=" + UIN + "&blogid=";
  const tail = "&pwd2sig=&styledm=qzonestyle.gtimg.cn&imgdm=qzs.qq.com&bdm=b.qzone.qq.com&rs=";

  // HTML → 纯文本：保留段落结构，去掉脚本样式，解实体
  const toText = h => {
    let s = h.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
    s = s.replace(/<br\s*\/?>/gi, "\n")
         .replace(/<\/(p|div|li|h[1-6]|tr|td|blockquote)>/gi, "\n")
         .replace(/<[^>]+>/g, "");
    const ta = document.createElement("textarea");   // 借 textarea 解实体
    ta.innerHTML = s;
    return ta.value
      .replace(/\r/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  const out = [];
  const failed = [];
  let totalChars = 0;

  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    let content = "";
    try {
      const r = await fetch(base + it.id + tail + Math.random(), { credentials: "include" });
      const html = dec.decode(await r.arrayBuffer());
      const box = document.createElement("div");
      box.innerHTML = html;
      const body = box.querySelector("#blogDetailDiv");
      if (body) content = toText(body.innerHTML);
      else failed.push(it.id + ":noBody:status" + r.status);
    } catch (e) {
      failed.push(it.id + ":err:" + ((e && e.message) || e));
    }
    totalChars += content.length;
    out.push({ id: it.id, title: it.title, date: it.date, content: content, length: content.length });
    await T(120);   // 轻节流，别把接口打急
  }

  const lens = out.map(x => x.length).sort((a, b) => a - b);
  window.__qzoneData = out;
  return {
    total: out.length,
    empty: out.filter(x => !x.content).length,
    totalChars: totalChars,
    min: lens[0],
    med: lens[Math.floor(lens.length / 2)],
    max: lens[lens.length - 1],
    failed: failed.slice(0, 20)
  };
})()
