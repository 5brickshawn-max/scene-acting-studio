/**
 * Higgsfield's login returns to http://localhost:3000/api/higgsfield/callback (it only accepts localhost or
 * trusted redirect addresses). In production nothing listens there and the browser shows "can't reach this
 * site" — the admin copies the address bar into 팀·사용량, as the README says. When the app runs locally,
 * this page shows the same instruction with a copy button instead of an error. The address is read in the
 * browser (location.href), never echoed by the server.
 */
export function GET() {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Higgsfield 연결</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#1d2418}
code{display:block;word-break:break-all;background:#f4f5f1;border:1px solid #d9ddd2;border-radius:8px;padding:12px;margin:12px 0}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #26301f;background:#26301f;color:#fff;cursor:pointer}</style></head>
<body><h1>Higgsfield 로그인 완료</h1>
<p>아래 주소 전체를 복사해, 앱의 <strong>팀·사용량 → Higgsfield 연결</strong>의 붙여넣기 칸에 넣고 ‘연결 완료’를 누르세요.</p>
<code id="u"></code><button id="c" type="button">주소 복사</button>
<script>const u=document.getElementById("u");u.textContent=location.href;
document.getElementById("c").onclick=()=>navigator.clipboard.writeText(location.href).then(()=>{document.getElementById("c").textContent="복사했습니다"});</script>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
