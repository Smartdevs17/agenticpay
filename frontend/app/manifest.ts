import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AgenticPay",
    short_name: "AgenticPay",
    description:
      "Secure, fast, and transparent payments for freelancers powered by blockchain technology.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/image-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/image-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],

    screenshots: [
      {
        src: "/screenshots/desktop.png",
        sizes: "1280x800",
        type: "image/png",
        form_factor: "wide"
      },
      {
        src: "/screenshots/mobile.png",
        sizes: "390x844",
        type: "image/png"
      }
    ],
  };
}