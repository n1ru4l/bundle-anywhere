import type { Plugin } from "rollup";

export const watchPlugin = (): Plugin => {
  return {
    name: "watch-file",
    load(id) {
      this.addWatchFile(id);
      return undefined;
    },
  };
};
