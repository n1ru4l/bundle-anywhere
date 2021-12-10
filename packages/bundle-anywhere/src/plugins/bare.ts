import type { Platform, Plugin } from "esbuild";
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

const createEntryPointResolver = (_platform: Platform) => {
  // TODO: better platform respect
  return (packageJSON: Record<string, unknown>) => {
    if (
      "exports" in packageJSON &&
      typeof packageJSON["exports"] === "object" &&
      packageJSON["exports"] != null
    ) {
      const exports: Record<string, any> = packageJSON["exports"];
      const rootImport = exports["."];

      if (typeof rootImport === "string") {
        return rootImport;
      } else if (typeof rootImport === "object") {
        if (rootImport["import"]) {
          return rootImport["import"];
        }
      }
    }

    return "";
  };
};

export const pluginBareModule = (context: Compiler): Plugin => {
  /** List of all resolved dependency versions. */
  let dependencyList: Record<string, string> = {};
  try {
    dependencyList = JSON.parse(
      // TODO: what to do on a normal file-system?
      context.options.fileSystem.readFileSync("/package.json", "utf-8")
    ).dependencies;
  } catch (err) {}

  const resolvePackageJSON = createPackageJSONResolver();
  const resolveEntryPoint = createEntryPointResolver(context.options.platform);

  return {
    name: "bare",
    setup(build) {
      if (context.options.unpkg) {
        build.onResolve({ filter: /.*/ }, async (args) => {
          if (/^(?!\.).*/.test(args.path) && !path.isAbsolute(args.path)) {
            if (args.path === "esbuild") {
              return;
            }

            // the entry-point file
            // by default we use the redirect that unpkg gives us if we dont specify a specific file
            // however, we try to parse the package.json exports field for finding the ESM module entry point!
            let entryPoint = "";

            // If the dependency is already in our dependency list
            // we add the dependencies of our dependency to the to be resolved packages
            // NOTE: Right now we only do FLAT dependencies.
            // The first version of a package that is encountered will be used everywhere.
            if (dependencyList[args.path]) {
              const packageJSON = await resolvePackageJSON(
                args.path,
                dependencyList[args.path]
              );

              entryPoint = resolveEntryPoint(packageJSON);
              if (entryPoint[0] === ".") {
                entryPoint = entryPoint.substring(1);
              }

              dependencyList = {
                ...packageJSON.dependencies,
                ...dependencyList,
              };
            }

            // If the dependency is not in our dependency list we do not resolve it and cause an error
            // We should probably add a "unsafe" mode later-on that allows resolving all kinds of dependencies automatically.
            if (!dependencyList[args.path]) {
              return;
            }

            return {
              path: args.path + "@" + dependencyList[args.path] + entryPoint,
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
