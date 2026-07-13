export function normalizeDisplayMeasure(options = {}) {
  const measure = options.measure && typeof options.measure === "object" ? options.measure : {};
  return {
    math: typeof options.measureMath === "function" ? options.measureMath : functionOrNull(measure.math),
    text: typeof options.measureText === "function" ? options.measureText : functionOrNull(measure.text)
  };
}

export function mathLabelBox(source, textStyle = {}, measure = {}, placement = {}) {
  const size = measuredSize(measure.math, source, textStyle, placement)
    ?? estimateMathSize(source, textStyle);
  return placedBox(size, placement);
}

export function textLabelBox(text, textStyle = {}, measure = {}, placement = {}) {
  const size = measuredSize(measure.text, text, textStyle, placement)
    ?? estimateTextSize(text, textStyle);
  return placedBox(size, placement);
}

export function estimateMathSize(source, textStyle = {}) {
  const fontSize = fontSizeNumber(textStyle.fontSize ?? textStyle.fontsize, 16);
  const scale = fontSize / 16;
  return {
    width: Math.max(34, Math.min(260, String(source).length * 12 * scale + 28)),
    height: Math.max(24, fontSize * 2.125)
  };
}

export function estimateTextSize(text, textStyle = {}) {
  const fontSize = fontSizeNumber(textStyle.fontSize ?? textStyle.fontsize, 12);
  return {
    width: Math.max(1, String(text).length * fontSize * 0.58),
    height: Math.max(14, fontSize * 1.25)
  };
}

export function placedBox(size, placement = {}) {
  const width = positiveNumber(size.width, 1);
  const height = positiveNumber(size.height, 1);
  const x = Number(placement.x ?? 0);
  const y = Number(placement.y ?? 0);
  const anchor = placement.anchor ?? "middle";
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  const top = placement.baseline === "hanging"
    ? y - hangingInset(placement.fontSize ?? size.fontSize)
    : y - height / 2;
  return { x: left, y: top, width, height };
}

export function hangingInset(fontSize = 12) {
  const size = fontSizeNumber(fontSize, 12);
  return Math.max(6, size * 0.66);
}

function measuredSize(measure, value, textStyle, placement) {
  if (typeof measure !== "function") return null;
  const result = measure(value, textStyle, placement);
  if (!result || typeof result !== "object") return null;
  const width = Number(result.width);
  const height = Number(result.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return { ...result, width, height };
}

function fontSizeNumber(value, fallback) {
  const size = Number.parseFloat(value ?? fallback);
  return Number.isFinite(size) && size > 0 ? size : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function functionOrNull(value) {
  return typeof value === "function" ? value : null;
}
