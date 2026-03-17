import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@brevoca/contracts"],
  serverExternalPackages: ["ffmpeg-static"],
  experimental: {
    middlewareClientMaxBodySize: "110mb",
  },
};

export default nextConfig;
