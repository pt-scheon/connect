import type { MetadataRoute } from "next";

/* Lets students add Connect to their phone's home screen and open it like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Connect",
    short_name: "Connect",
    description: "Build with people from your college. Credit comes only from what ships.",
    start_url: "/",
    display: "standalone",
    background_color: "#0A0B14",
    theme_color: "#0A0B14",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/app-icon/192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
