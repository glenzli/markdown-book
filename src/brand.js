import { readFileSync } from "node:fs";
/** Color-neutral master: reader text color; host variants provide contrast. */
export const brandMark = readFileSync(
  new URL("../assets/brand/markdown-book.svg", import.meta.url),
  "utf8",
);
const dataUrl = (svg) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
export const brandDataUrl = dataUrl(
  brandMark.replace(
    "<title>",
    "<style>svg{color:#252525}@media(prefers-color-scheme:dark){svg{color:#f2f2f2}}</style><title>",
  ),
);
export const brandIcons = [
  {
    src: dataUrl(brandMark.replace('fill="currentColor"', 'fill="#252525"')),
    mimeType: "image/svg+xml",
    sizes: ["any"],
    theme: "light",
  },
  {
    src: dataUrl(brandMark.replace('fill="currentColor"', 'fill="#F2F2F2"')),
    mimeType: "image/svg+xml",
    sizes: ["any"],
    theme: "dark",
  },
];
