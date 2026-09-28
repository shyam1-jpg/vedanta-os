import type { NextConfig } from "next";
const config: NextConfig = { output: "export", trailingSlash: true, images: { unoptimized: true }, basePath: "/book", allowedDevOrigins: ["127.0.0.1"] };
export default config;
