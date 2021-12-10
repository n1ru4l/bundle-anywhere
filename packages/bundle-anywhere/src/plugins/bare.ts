import type { Platform, Plugin } from "esbuild";
import micromatch from "micromatch";
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
  return (
    packageJSON: Record<string, unknown>,
    deepImportPath: string | null
  ) => {
    if (
      "exports" in packageJSON &&
      typeof packageJSON["exports"] === "object" &&
      packageJSON["exports"] != null
    ) {
      const exports: Record<string, any> = packageJSON["exports"];

      if (deepImportPath === null) {
        // if there is no deep import path specified we will try the root import
        const rootImport = exports["."];

        if (typeof rootImport === "string") {
          return rootImport;
        } else if (typeof rootImport === "object" && rootImport["import"]) {
          return rootImport["import"];
        }
      } else {
        // we need to figure out whether the deep import matches any of the exports in our map
        const exportKeys = Object.keys(exports);
        const fullPath = "./" + deepImportPath;

        for (const pattern in exportKeys) {
          if (micromatch.isMatch(fullPath, pattern)) {
            return deepImportPath;
          }
        }
        throw new Error(
          `Could not resolve '${deepImportPath}' in package '${packageJSON.name}'.\nThe path is not specified in the exports map.`
        );
      }
    }

    // if we have no exports map in the package.json
    // we pray that unpkg resolves the entry-point we desire
    // if not we are fucked :)
    // please maintainers, adopt esm and the entry-points map

    return deepImportPath ? "/" + deepImportPath : "";
  };
};

const parsePath = (
  path: string
): { packageName: string; deepImportPath: string | null } => {
  const [
    orgOrFullPackageName,
    maybePackageNameOrPathPartial,
    ...deepPathPartials
  ] = path.split("/");

  if (orgOrFullPackageName.startsWith("@")) {
    return {
      packageName: `${orgOrFullPackageName}/${maybePackageNameOrPathPartial}`,
      deepImportPath:
        deepPathPartials.length === 0 ? null : deepPathPartials.join("/"),
    };
  }

  const pathPartials = [];
  if (maybePackageNameOrPathPartial !== undefined) {
    pathPartials.push(maybePackageNameOrPathPartial, ...deepPathPartials);
  }
  return {
    packageName: orgOrFullPackageName,
    deepImportPath: pathPartials.length === 0 ? null : pathPartials.join("/"),
  };
};

export const pluginBareModule = (context: Compiler): Plugin => {
  /** List of all resolved dependency versions. */
  let allowedDependencyList: Record<string, string> = {};
  try {
    allowedDependencyList = {
      ...JSON.parse(
        // TODO: what to do on a normal file-system?
        context.options.fileSystem.readFileSync("/package.json", "utf-8")
      ).dependencies,
    };
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

            const { packageName, deepImportPath } = parsePath(args.path);
            console.log(args.path, packageName, deepImportPath);

            // the entry-point file
            // by default we use the redirect that unpkg gives us if we dont specify a specific file
            // however, we try to parse the package.json exports field for finding the ESM module entry point!
            let entryPoint = "";

            const dependencyVersion = allowedDependencyList[packageName];

            // If the dependency is already in our dependency list
            // we add the dependencies of our dependency to the to be resolved packages
            // NOTE: Right now we only do FLAT dependencies.
            // The first version of a package that is encountered will be used everywhere.
            if (dependencyVersion !== undefined) {
              const packageJSON = await resolvePackageJSON(
                packageName,
                dependencyVersion
              );

              entryPoint = resolveEntryPoint(packageJSON, deepImportPath);

              // entry points should start with "./", so we omit the dot
              if (entryPoint[0] === ".") {
                entryPoint = entryPoint.substring(1);
              }

              allowedDependencyList = {
                ...packageJSON.dependencies,
                ...allowedDependencyList,
              };
            }

            // If the dependency is not in our dependency list we do not resolve it and cause an error
            // We should probably add a "unsafe" mode later-on that allows resolving all kinds of dependencies automatically.
            if (!dependencyVersion) {
              return;
            }

            return {
              path: packageName + "@" + dependencyVersion + entryPoint,
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
