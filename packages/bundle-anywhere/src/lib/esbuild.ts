import type {
  BuildOptions,
  BuildResult,
  TransformOptions,
  TransformResult,
} from "esbuild";
import type * as esbuildType from "esbuild";
import { version } from "esbuild-wasm/package.json";

let initializedPromise: Promise<typeof esbuildType>;
const getService = (): typeof initializedPromise => {
  if (!initializedPromise) {
    initializedPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const esbuild: typeof esbuildType = await import("esbuild-wasm");

      await esbuild.initialize({
        worker: true,
        wasmURL: `https://unpkg.com/esbuild-wasm@${version}/esbuild.wasm`,
      });

      return esbuild;
    })();
  }
  return initializedPromise;
};

const wasmBuild = async (options: BuildOptions): Promise<BuildResult> => {
  const service = await getService();
  return service.build(options);
};

const wasmTransform = async (
  input: string,
  options: TransformOptions
): Promise<TransformResult> => {
  const service = await getService();
  return service.transform(input, options);
};

declare global {
  var __NODE__: boolean | undefined;
}

const build: typeof import("esbuild").build = __NODE__
  ? require("esbuild").build
  : wasmBuild;

const transform: typeof import("esbuild").transform = __NODE__
  ? require("esbuild").transform
  : wasmTransform;

export { build, transform };
