import type { Plugin } from "esbuild";
import { Compiler } from "../lib/compiler";
import { UnpkgNamespace } from "./unpkg";
import { UnpkgHost } from "./unpkg";
import path from "path";
import { fetchPkg } from "./http";

const createPackageJSONResolver = () => {
  const cache = new Map<string, Record<string, any>>();

  const getCachedPackageJSON = async (
    packageName: string,
    versionRange: string
  ) => {
    const name = packageName + "@" + versionRange;
    let packageJSON = cache.get(name);
    if (!packageJSON) {
      const { content } = await fetchPkg(UnpkgHost + name + "/package.json");
      packageJSON = JSON.parse(content) as Record<string, any>;
      cache.set(name, packageJSON);
    }
    return packageJSON;
  };

  return getCachedPackageJSON;
};

export const pluginBareModule = (context: Compiler): Plugin => {
  const fs = context.options.fileSystem;

  /** List of all resolved dependency versions. */
  let dependencyList: Record<string, string> = {};
  try {
    dependencyList = JSON.parse(
      // TODO: what to do on a normal file-system?
      fs.readFileSync("/package.json", "utf-8")
    ).dependencies;
  } catch (err) {
    console.error(err);
  }

  const resolvePackageJSON = createPackageJSONResolver();

  return {
    name: "bare",
    setup(build) {
      if (context.options.unpkg) {
        build.onResolve({ filter: /.*/ }, async (args) => {
          if (/^(?!\.).*/.test(args.path) && !path.isAbsolute(args.path)) {
            if (args.path === "esbuild") {
              return;
            }

            // If the dependency is already in our dependency list
            // we add the dependencies of our dependency to the to be resolved packages
            // NOTE: Right now we only do FLAT dependencies.
            // The first version of a package that is encountered will be used everywhere.
            if (dependencyList[args.path]) {
              const packageJSON = await resolvePackageJSON(
                args.path,
                dependencyList[args.path]
              );
              // TODO: resolve proper entry file (https://github.com/n1ru4l/bundle-anywhere/issues/4)
              dependencyList = {
                ...packageJSON.dependencies,
                ...dependencyList,
              };
            }

            // If the dependency is not in our dependency list we do not resolve it.
            if (!dependencyList[args.path]) {
              return;
            }

            return {
              path: args.path + "@" + dependencyList[args.path],
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
