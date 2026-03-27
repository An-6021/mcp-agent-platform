import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: false,
  clean: true,
  target: "es2022",
  platform: "node",
  noExternal: [/@mcp-agent-platform\/.*/, /^zod$/],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
