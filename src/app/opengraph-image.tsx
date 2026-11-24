import { ImageResponse } from "next/og";
import { pricing } from "@/config/pricing";
import { BrandMark } from "@/components/BrandLogo";

export const alt = "Increase Video Quality — online video enhancement";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: "64px 72px", background: "#f8f8f2", color: "#2c3328" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 36, fontWeight: 700 }}><BrandMark size={48} /><div style={{ display: "flex" }}>increase<span style={{ color: "#718752" }}>.</span></div></div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 80, fontWeight: 700, lineHeight: 1.08, letterSpacing: "-3px", maxWidth: 900 }}>Increase Video Quality</div>
        <div style={{ display: "flex", fontSize: 30, marginTop: 28, color: "#626957" }}>A clearer look for the videos worth keeping.</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24 }}>
        <div style={{ display: "flex", background: "#e7edce", padding: "14px 24px", borderRadius: 32 }}>Up to {pricing.enhancement.maxOutputLabel} output · Noise reduction</div>
        <div style={{ display: "flex" }}>increasevideoquality.com</div>
      </div>
    </div>,
    size,
  );
}
