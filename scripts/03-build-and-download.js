// 03-build-and-download.js
// 依赖：先跑 02-fetch-articles.js（window.__qzoneData）
// 作用：把全部篇目拼成一份 TXT（UTF-8 + BOM），在页面里生成 Blob 并挂一个下载按钮 <a id="qzone-export">
// 下一步：bsk download --selector "#qzone-export" --out <ASCII 临时路径>
// 返回：{ entries, chars, bytesApprox, anchor }
(() => {
  const data = window.__qzoneData;
  const UIN = window.__qzoneUin || location.pathname.split("/").filter(Boolean)[0];
  if (!Array.isArray(data) || !data.length) throw new Error("先执行 scripts/02-fetch-articles.js");

  const pad = n => String(n).padStart(2, "0");
  const d = new Date();
  const stamp = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
              + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  const dates = data.map(x => x.date).filter(Boolean).sort();

  const parts = [[
    "QQ空间 私密日志",
    "账号：" + UIN,
    "导出时间：" + stamp,
    "时间跨度：" + (dates[0] || "?") + " ~ " + (dates[dates.length - 1] || "?"),
    "共 " + data.length + " 篇",
    ""
  ].join("\n")];

  data.forEach((it, i) => {
    parts.push("────────────────────────────────────────");
    parts.push("【" + (i + 1) + "】" + it.title);
    parts.push("时间：" + (it.date || "（无）"));
    parts.push("编号：" + it.id);           // 私密日志直链无效，编号仅作标识
    if (it.content) parts.push("", it.content);
    parts.push("");
  });

  // 带 BOM：Windows 记事本 / 资源管理器预览都能正确识别中文
  const txt = "\ufeff" + parts.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";

  const old = document.getElementById("qzone-export");
  if (old) old.remove();
  const a = document.createElement("a");
  a.id = "qzone-export";
  a.download = "qzone-private-journal.txt";
  a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain;charset=utf-8" }));
  a.textContent = "下载导出文件";
  a.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:10px 16px;"
                  + "background:#0a84ff;color:#fff;font:14px sans-serif;border-radius:6px;"
                  + "cursor:pointer;text-decoration:none";
  document.body.appendChild(a);

  return { entries: data.length, chars: txt.length, bytesApprox: new Blob([txt]).size, anchor: !!a.href };
})()
