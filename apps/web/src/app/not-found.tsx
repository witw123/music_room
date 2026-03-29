export default function NotFoundPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: "#09090b",
        color: "#f6f1e8"
      }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: 0, opacity: 0.72, letterSpacing: "0.2em", fontSize: "0.75rem" }}>
          MUSIC ROOM
        </p>
        <h1 style={{ margin: "1rem 0 0.5rem", fontSize: "2.6rem" }}>页面不存在</h1>
        <p style={{ margin: 0, opacity: 0.68 }}>返回首页继续创建或加入房间。</p>
      </div>
    </main>
  );
}
