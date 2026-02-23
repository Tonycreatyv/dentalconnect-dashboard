import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function MetaCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");

    if (error) {
      console.error("❌ Meta connection error:", error);
      navigate("/settings");
      return;
    }

    if (!code) {
      console.error("❌ No code returned from Meta");
      navigate("/settings");
      return;
    }

    console.log("✅ Meta connection code:", code);

    // POR AHORA solo redirigimos
    // Luego este code se envía a n8n o backend
    navigate("/settings");
  }, [navigate]);

  return (
    <div style={{ padding: 40 }}>
      <h2>Conectando con Meta…</h2>
      <p>Por favor espera.</p>
    </div>
  );
}
