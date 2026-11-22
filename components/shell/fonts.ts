import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import localFont from "next/font/local";

/* The big wordmark is set in Broadway when the visitor's computer has it (its licence doesn't allow bundling).
   Everyone else gets Fascinate, a free Art Deco face in the same spirit (OFL, app/fonts). */
const deco = localFont({ src: "../../app/fonts/fascinate.woff2", variable: "--font-deco", display: "swap", weight: "400" });
export const fonts = `${GeistSans.variable} ${GeistMono.variable} ${deco.variable}`;
