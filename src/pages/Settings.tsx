import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// 🔒 App ID (ok dejarlo por env)
const META_APP_ID = import.meta.env.VITE_META_APP_ID;

// 🔒 Supabase Edge Function (ok así)
const META_OAUTH_FUNCTION =
  "https://oeeyzqqnxvcpibdwuugu.supabase.co/functions/v1/meta-oauth";

// ✅ HARD FIX — redirect EXACTO y NUEVO
const META_REDIRECT_URI =
  "https://gentle-chaja-c50980.netlify.app/settings";

export default function Settings() {
  const location = useLocation();

  // 👇 Maneja el regreso de Meta con ?code=
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");

    if (!code) return;

    console.log("META AUTH CODE:", code);

    fetch(META_OAUTH_FUNCTION, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("META OAUTH RESULT:", data);
      })
      .catch((err) => {
        console.error("META OAUTH ERROR:", err);
      });
  }, [location.search]);

  // 👇 BOTÓN CON REDIRECT CORRECTO
  const connectMeta = () => {
    const authUrl =
      "https://www.facebook.com/v19.0/dialog/oauth" +
      `?client_id=${META_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=pages_show_list,pages_read_engagement,pages_messaging`;

    window.location.href = authUrl;
  };

  return (
    <div style={{ padding: 40 }}>
      <h1>Settings</h1>

      <button
        onClick={connectMeta}
        style={{
          marginTop: 20,
          padding: "12px 20px",
          background: "#1877F2",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        Connect Meta
      </button>
    </div>
  );
}
