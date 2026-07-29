import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  experimental: {
    useTypeScriptCli: true,
  },
  output: "standalone",
  poweredByHeader: false,
};

export default withEve(nextConfig);
