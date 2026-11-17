import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the ffmpeg binary (sequence joining) is loaded from node_modules at run time, not bundled
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  outputFileTracingIncludes: {
    "/api/projects/[id]/sequence": ["./node_modules/@ffmpeg-installer/linux-x64/**"],
  },
};

export default nextConfig;
