import type { Plugin } from "esbuild";
import { Compiler } from "../lib/compiler";
import { UnpkgNamespace } from "./unpkg";
import { UnpkgHost } from "./unpkg";
import path from "path";

export const pluginBareModule = (context: Compiler): Plugin => {
  return {
    name: "bare",
    setup(build) {
      if (context.options.unpkg) {
        build.onResolve({ filter: /.*/ }, async (args) => {
          if (/^(?!\.).*/.test(args.path) && !path.isAbsolute(args.path)) {
            if (args.path === "esbuild") {
              return;
            }

            let path = args.path;

            return {
              path,
              namespace: UnpkgNamespace,
              pluginData: {
                parentUrl: UnpkgHost,
              },
            };
          }
        });
      }
    },
  };
};
