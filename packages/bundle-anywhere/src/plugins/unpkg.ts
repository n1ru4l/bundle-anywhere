import type { OnLoadResult, Plugin } from "esbuild";
import { fetchPkg } from "./http";

export const UnpkgNamespace = "unpkg";
export const UnpkgHost = "https://unpkg.com/";

export const pluginUnpkg = (): Plugin => {
  const cache: Record<string, OnLoadResult> = {};

  return {
    name: "unpkg",
    setup(build) {
      build.onResolve(
        {
          namespace: UnpkgNamespace,
          filter: /.*/,
        },
        async (args) => {
          const path = new URL(args.path, args.pluginData.parentUrl).toString();
          return {
            namespace: UnpkgNamespace,
            path: path,
            pluginData: args.pluginData,
          };
        }
      );

      build.onLoad(
        {
          namespace: UnpkgNamespace,
          filter: /.*/,
        },
        async (args) => {
          const pathUrl = new URL(
            args.path,
            args.pluginData.parentUrl
          ).toString();

          let value = cache[pathUrl];
          if (!value) {
            const result = await fetchPkg(pathUrl);
            value = {
              contents: result.content,
              loader: "js",
              pluginData: {
                parentUrl: result.url,
              },
            };
            cache[pathUrl] = value;
            cache[result.url] = value;
          }

          return value;
        }
      );
    },
  };
};
