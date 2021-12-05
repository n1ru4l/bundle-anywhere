/* eslint-disable @typescript-eslint/no-var-requires */
import { Compiler } from "./lib/compiler";
import { yargsBuildOptions } from "./lib/yargsOptions";
import fs from "fs";
import memfs from "memfs";
import { CompilerOptions, FileSystem } from "./types";

export async function run() {
  const yargs: typeof import("yargs") = (
    await import("yargs")
  ).default() as any;
  const argv = yargs
    .scriptName("neo-bundler")
    .usage("$0 <cmd> [args]")
    .command(
      "bundle <input> <output>",
      "output a single Javascript file with all dependencies\n neo-bundler bundle ",
      yargsBuildOptions,
      async (args) => {
        const compiler = new Compiler({
          ...args,
          plugins: [],
          watch: false,
          fileSystem: fs,
        });
        await compiler.build();
      }
    )
    .command(
      "watch <input> <output>",
      "watch build",
      yargsBuildOptions,
      async (args) => {
        const compiler = new Compiler({
          ...args,
          plugins: [],
          watch: true,
          fileSystem: fs,
          hooks: {
            start() {
              console.log("start compile");
            },
            done(result) {
              console.log("finish compile");
            },
          },
        });
        await compiler.build();
      }
    )
    .demandCommand(1, "")
    .recommendCommands()
    .strict()
    .help()
    .parse(process.argv.slice(2));
}

export function compileMemfs(
  json: Record<string, any>,
  options: Pick<CompilerOptions, "input" | "hooks">
) {
  memfs.vol.fromJSON(json, "/");
  return new Compiler({
    memfs: true,
    fileSystem: memfs as any as FileSystem,
    cwd: process.cwd(),
    output: "bundle.js",
    input: options.input,
    hooks: options.hooks,
    unpkg: true,
    http: false,
    plugins: [],
  });
}
export { Compiler, memfs };
