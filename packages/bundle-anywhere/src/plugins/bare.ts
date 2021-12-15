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

const getGlobPrefix = (globString: string) => {
  const [prefix] = globString.split("*");
  return prefix;
};

const removeRelativePrefix = (str: string) =>
  str.startsWith("./") ? str.replace("./", "") : str;

const relativeToAbsolutePrefix = (str: string) =>
  str.startsWith("./") ? str.replace("./", "/") : str;

// TODO: make this a separate package, anyone can use
const createEntryPointResolver = (_platform: Platform) => {
  // TODO: better platform respect
  return (
    packageJSON: Record<string, unknown>,
    deepImportPath: string | null
  ) => {
    // TODO: Use something like zod for parsing the exports field.

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
        } else if (typeof rootImport === "object") {
          // TODO: handling when import is missing :(
          return rootImport["import"];
        }
      } else {
        // we need to figure out whether the deep import matches any of the exports in our map
        const exportKeys = Object.entries(exports);
        const importPath = deepImportPath;

        for (let [importPattern, importResolutionPath] of exportKeys) {
          importPattern = removeRelativePrefix(importPattern);
          // in case the thing is an object
          if (typeof importResolutionPath !== "string") {
            // TODO: handling when import is missing :(
            importResolutionPath = importResolutionPath["import"];
          }
          importResolutionPath = removeRelativePrefix(importResolutionPath);

          // the thing is not a glob expression at all, so we can instantly resolve it
          if (importPath === importPattern) {
            return "./" + importResolutionPath;
          }

          // otherwise check if we are dealing with a glob here
          if (micromatch.isMatch(importPath, importPattern)) {
            // if the resolution path is not a glob all files matching this pattern are forwarded to it
            if (importResolutionPath.includes("*") === false) {
              return "./" + importResolutionPath;
            }

            // if the resolution path is a glob pattern we need to resolve the actual file path
            // DANGER: NOT REALLY TESTED SO MIGHT BE BROKEN :)

            const baseImportPath = getGlobPrefix(importPattern);
            // if we dont have a glob we need to rewrite the outside path to the actual internal path.
            const baseInternalPath = getGlobPrefix(importResolutionPath);

            const fullInternalPath =
              baseInternalPath + importPath.replace(baseImportPath, "");

            return "./" + fullInternalPath;
          }
        }
        throw new Error(
          `Could not resolve '${deepImportPath}' in package '${packageJSON.name}'.\nThe path is not specified in the exports map.`
        );
      }
    }

    if ("module" in packageJSON) {
      return "./" + packageJSON["module"];
    }

    // if we have no exports map in the package.json
    // we pray that unpkg resolves the entry-point we desire
    // if not we are fucked :)
    // please maintainers, adopt esm and the entry-points map

    return deepImportPath ? "./" + deepImportPath : "";
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

              entryPoint = relativeToAbsolutePrefix(
                resolveEntryPoint(packageJSON, deepImportPath)
              );

              allowedDependencyList = {
                ...packageJSON.dependencies,
                ...allowedDependencyList,
              };
            }

            // If the dependency is not in our dependency list we do not resolve it and cause an error
            // We should probably add a "unsafe" mode later-on that allows resolving all kinds of dependencies automatically.
            if (!dependencyVersion) {
              throw new Error(
                `Could not resolve package '${packageName}', as it is not listed as a dependency.`
              );
            }

            const resolvedPath =
              packageName + "@" + dependencyVersion + entryPoint;

            return {
              path: resolvedPath,
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
