/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Warn about circular dependencies",
      from: {
        pathNot: "^packages/document/src/commands/",
      },
      to: {
        circular: true,
      },
    },
    {
      name: "contracts-boundary",
      severity: "error",
      comment: "@open-draw/contracts must not depend on any other package",
      from: { path: "^packages/contracts/" },
      to: { path: "^packages/(?!contracts/)|^@open-draw/(?!contracts$)" },
    },
    {
      name: "document-boundary",
      severity: "error",
      comment: "@open-draw/document may only depend on @open-draw/contracts",
      from: { path: "^packages/document/" },
      to: { path: "^packages/(?!document/|contracts/)|^@open-draw/(?!contracts$)" },
    },
    {
      name: "shapes-boundary",
      severity: "error",
      comment: "@open-draw/shapes may only depend on @open-draw/contracts",
      from: { path: "^packages/shapes/" },
      to: { path: "^packages/(?!shapes/|contracts/)|^@open-draw/(?!contracts$)" },
    },
    {
      name: "input-boundary",
      severity: "error",
      comment: "@open-draw/input may only depend on @open-draw/contracts",
      from: { path: "^packages/input/" },
      to: { path: "^packages/(?!input/|contracts/)|^@open-draw/(?!contracts$)" },
    },
    {
      name: "renderer-svg-boundary",
      severity: "error",
      comment: "@open-draw/renderer-svg may only depend on contracts, document",
      from: { path: "^packages/renderer-svg/" },
      to: {
        path: "^packages/(?!renderer-svg/|contracts/|document/)|^@open-draw/(?!contracts$|document$)",
      },
    },
    {
      name: "canvas-boundary",
      severity: "error",
      comment:
        "@open-draw/canvas may only depend on contracts, document, input, shapes, renderer-svg (ADR-0008)",
      from: { path: "^packages/canvas/" },
      to: {
        path: "^packages/(?!canvas/|contracts/|document/|input/|shapes/|renderer-svg/)|^@open-draw/(?!contracts$|document$|input$|shapes$|renderer-svg$)",
      },
    },
    {
      name: "no-deep-cross-package-imports",
      severity: "error",
      comment: "Cross-package imports must use package entrypoint, not internal src/ paths",
      from: { path: "^packages/([^/]+)/" },
      to: {
        path: "^packages/(?!$1/)[^/]+/src/(?!index\\.(ts|js)$)",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
