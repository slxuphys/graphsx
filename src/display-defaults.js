export const GRAPHSX_DISPLAY_DEFAULTS = {
  text: {
    fill: "#111111",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    fontSize: 12
  },
  math: {
    fill: "#1e2724",
    fontSize: 12,
    profile: "katex"
  },
  graph: {
    labelFontSize: 13,
    portLabelFontSize: 11
  }
};

export function normalizeDisplayDefaults(defaults = {}) {
  return {
    text: {
      ...GRAPHSX_DISPLAY_DEFAULTS.text,
      ...(defaults.text && typeof defaults.text === "object" ? defaults.text : {})
    },
    math: {
      ...GRAPHSX_DISPLAY_DEFAULTS.math,
      ...(defaults.math && typeof defaults.math === "object" ? defaults.math : {})
    },
    graph: {
      ...GRAPHSX_DISPLAY_DEFAULTS.graph,
      ...(defaults.graph && typeof defaults.graph === "object" ? defaults.graph : {})
    }
  };
}
