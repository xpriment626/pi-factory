type ExtensionAPI = {
  registerCommand: (
    name: string,
    command: {
      description: string;
      handler: (args: string, ctx: { ui: { notify: (message: string, level: "info") => void } }) => Promise<void>;
    }
  ) => void;
};

export default function factorySmokeExtension(pi: ExtensionAPI) {
  pi.registerCommand("factory-smoke", {
    description: "Proves a local pi-factory extension was loaded",
    handler: async (_args, ctx) => {
      ctx.ui.notify("pi-factory extension loaded", "info");
    }
  });
}
