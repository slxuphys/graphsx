import { GraphDslError } from "./errors.js";
import { EXPRESSION_LITERAL, REF_LITERAL, isExpressionLiteral, isRefLiteral } from "./literals.js";

export function applyPointMaps(points, attrs = {}, label = "series") {
  const xMap = attrs.xMap ?? attrs.xmap;
  const yMap = attrs.yMap ?? attrs.ymap;
  if (!isMathSource(xMap) && !isMathSource(yMap)) return points;

  return points.map((point) => {
    const scope = new Map([
      ["x", point.x],
      ["y", point.y]
    ]);
    return {
      x: isMathSource(xMap)
        ? evaluateMathExpression(String(xMap), scope, `${label} xMap`)
        : point.x,
      y: isMathSource(yMap)
        ? evaluateMathExpression(String(yMap), scope, `${label} yMap`)
        : point.y
    };
  });
}

export function realNumberValue(value, label) {
  const result = mathValue(value, label);
  return finiteRealNumber(result, label);
}

export function mathValue(value, label) {
  if (isExpressionLiteral(value)) {
    return evaluateMathExpression(value[EXPRESSION_LITERAL], new Map(), label);
  }
  if (isRefLiteral(value) && MATH_CONSTANTS.has(value[REF_LITERAL])) {
    return MATH_CONSTANTS.get(value[REF_LITERAL]);
  }
  if (typeof value === "string" && value.trim() !== "" && !isNumericString(value)) {
    return evaluateMathExpression(value, new Map(), label);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new GraphDslError(`${label} must be a finite number`);
  }
  return number;
}

export function assertFiniteMathValue(value, label) {
  if (!isFiniteMathValue(value)) {
    throw new GraphDslError(`${label} must be a finite number`);
  }
}

export function isMathSource(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function evaluateMathExpression(source, scope, label) {
  const parser = new PlotMathParser(source, scope, label);
  return parser.parse();
}

function isNumericString(value) {
  return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value.trim());
}

const MATH_CONSTANTS = new Map([
  ["pi", Math.PI],
  ["PI", Math.PI],
  ["e", Math.E],
  ["E", Math.E]
]);

const MATH_FUNCTIONS = new Map([
  ["abs", complexAbs],
  ["acos", realUnary(Math.acos, "acos")],
  ["asin", realUnary(Math.asin, "asin")],
  ["atan", realUnary(Math.atan, "atan")],
  ["atan2", Math.atan2],
  ["ceil", realUnary(Math.ceil, "ceil")],
  ["conj", complexConj],
  ["cos", complexCos],
  ["cosh", complexCosh],
  ["exp", complexExp],
  ["floor", realUnary(Math.floor, "floor")],
  ["im", complexImag],
  ["imag", complexImag],
  ["log", complexLog],
  ["log10", realUnary(Math.log10, "log10")],
  ["max", realVariadic(Math.max, "max")],
  ["min", realVariadic(Math.min, "min")],
  ["phase", complexArg],
  ["pow", complexPow],
  ["re", complexReal],
  ["real", complexReal],
  ["round", realUnary(Math.round, "round")],
  ["sin", complexSin],
  ["sinh", complexSinh],
  ["sqrt", complexSqrt],
  ["tan", complexTan],
  ["tanh", complexTanh],
  ["arg", complexArg],
  ["angle", complexArg]
]);

const COMPLEX_EPSILON = 1e-12;

function complex(re, im = 0) {
  return normalizeComplex({ re: Number(re), im: Number(im) });
}

function isComplex(value) {
  return value && typeof value === "object" && Object.hasOwn(value, "re") && Object.hasOwn(value, "im");
}

function complexParts(value) {
  if (isComplex(value)) return value;
  return { re: Number(value), im: 0 };
}

function normalizeComplex(value) {
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) return value;
  if (Math.abs(value.im) < COMPLEX_EPSILON) return value.re;
  if (Math.abs(value.re) < COMPLEX_EPSILON) return { re: 0, im: value.im };
  return value;
}

function isFiniteMathValue(value) {
  if (isComplex(value)) return Number.isFinite(value.re) && Number.isFinite(value.im);
  return Number.isFinite(value);
}

function finiteRealNumber(value, label) {
  assertFiniteMathValue(value, label);
  if (isComplex(value)) {
    if (Math.abs(value.im) > COMPLEX_EPSILON) {
      throw new GraphDslError(`${label} must be real`);
    }
    return value.re;
  }
  return value;
}

function complexReal(value) {
  return complexParts(value).re;
}

function complexImag(value) {
  return complexParts(value).im;
}

function complexAbs(value) {
  const z = complexParts(value);
  return Math.hypot(z.re, z.im);
}

function complexArg(value) {
  const z = complexParts(value);
  return Math.atan2(z.im, z.re);
}

function complexConj(value) {
  const z = complexParts(value);
  return normalizeComplex({ re: z.re, im: -z.im });
}

function complexNeg(value) {
  const z = complexParts(value);
  return normalizeComplex({ re: -z.re, im: -z.im });
}

function complexAdd(a, b) {
  const left = complexParts(a);
  const right = complexParts(b);
  return normalizeComplex({ re: left.re + right.re, im: left.im + right.im });
}

function complexSub(a, b) {
  const left = complexParts(a);
  const right = complexParts(b);
  return normalizeComplex({ re: left.re - right.re, im: left.im - right.im });
}

function complexMul(a, b) {
  const left = complexParts(a);
  const right = complexParts(b);
  return normalizeComplex({
    re: left.re * right.re - left.im * right.im,
    im: left.re * right.im + left.im * right.re
  });
}

function complexDiv(a, b) {
  const left = complexParts(a);
  const right = complexParts(b);
  const denominator = right.re * right.re + right.im * right.im;
  return normalizeComplex({
    re: (left.re * right.re + left.im * right.im) / denominator,
    im: (left.im * right.re - left.re * right.im) / denominator
  });
}

function complexSqrt(value) {
  const z = complexParts(value);
  if (z.im === 0 && z.re >= 0) return Math.sqrt(z.re);
  const radius = Math.hypot(z.re, z.im);
  return normalizeComplex({
    re: Math.sqrt(Math.max(0, (radius + z.re) / 2)),
    im: (z.im < 0 ? -1 : 1) * Math.sqrt(Math.max(0, (radius - z.re) / 2))
  });
}

function complexExp(value) {
  const z = complexParts(value);
  const scale = Math.exp(z.re);
  return normalizeComplex({
    re: scale * Math.cos(z.im),
    im: scale * Math.sin(z.im)
  });
}

function complexLog(value) {
  const z = complexParts(value);
  return normalizeComplex({
    re: Math.log(Math.hypot(z.re, z.im)),
    im: Math.atan2(z.im, z.re)
  });
}

function complexPow(a, b) {
  const exponent = complexParts(b);
  if (!isComplex(a) && exponent.im === 0 && Number.isInteger(exponent.re)) {
    return a ** exponent.re;
  }
  return complexExp(complexMul(b, complexLog(a)));
}

function complexSin(value) {
  const z = complexParts(value);
  return normalizeComplex({
    re: Math.sin(z.re) * Math.cosh(z.im),
    im: Math.cos(z.re) * Math.sinh(z.im)
  });
}

function complexCos(value) {
  const z = complexParts(value);
  return normalizeComplex({
    re: Math.cos(z.re) * Math.cosh(z.im),
    im: -Math.sin(z.re) * Math.sinh(z.im)
  });
}

function complexTan(value) {
  return complexDiv(complexSin(value), complexCos(value));
}

function complexSinh(value) {
  const z = complexParts(value);
  return normalizeComplex({
    re: Math.sinh(z.re) * Math.cos(z.im),
    im: Math.cosh(z.re) * Math.sin(z.im)
  });
}

function complexCosh(value) {
  const z = complexParts(value);
  return normalizeComplex({
    re: Math.cosh(z.re) * Math.cos(z.im),
    im: Math.sinh(z.re) * Math.sin(z.im)
  });
}

function complexTanh(value) {
  const z = complexParts(value);
  const denominator = Math.cosh(2 * z.re) + Math.cos(2 * z.im);
  return normalizeComplex({
    re: Math.sinh(2 * z.re) / denominator,
    im: Math.sin(2 * z.im) / denominator
  });
}

function realUnary(fn, name) {
  return (value) => fn(finiteRealNumber(value, `argument to ${name}`));
}

function realVariadic(fn, name) {
  return (...values) => fn(...values.map((value) => finiteRealNumber(value, `argument to ${name}`)));
}

class PlotMathParser {
  constructor(source, scope, label) {
    this.source = String(source);
    this.scope = scope;
    this.label = label;
    this.index = 0;
  }

  parse() {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (!this.isDone()) {
      throw new GraphDslError(`Unsupported expression "${this.source}" in ${this.label}`);
    }
    if (!isFiniteMathValue(value)) {
      throw new GraphDslError(`Expression "${this.source}" in ${this.label} did not evaluate to a finite number`);
    }
    return value;
  }

  parseExpression() {
    let value = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      if (this.consume("+")) {
        value = complexAdd(value, this.parseTerm());
      } else if (this.consume("-")) {
        value = complexSub(value, this.parseTerm());
      } else {
        return value;
      }
    }
  }

  parseTerm() {
    let value = this.parsePower();
    while (true) {
      this.skipWhitespace();
      if (this.consume("*")) {
        value = complexMul(value, this.parsePower());
      } else if (this.consume("/")) {
        value = complexDiv(value, this.parsePower());
      } else {
        return value;
      }
    }
  }

  parsePower() {
    let value = this.parseFactor();
    this.skipWhitespace();
    if (this.consume("^")) {
      value = complexPow(value, this.parsePower());
    }
    return value;
  }

  parseFactor() {
    this.skipWhitespace();
    if (this.consume("+")) return this.parseFactor();
    if (this.consume("-")) return complexNeg(this.parseFactor());
    if (this.consume("(")) {
      const value = this.parseExpression();
      this.skipWhitespace();
      if (!this.consume(")")) {
        throw new GraphDslError(`Unclosed expression "${this.source}" in ${this.label}`);
      }
      return value;
    }
    if (isDigit(this.peek()) || this.peek() === ".") {
      return this.parseNumber();
    }
    if (isIdentifierStart(this.peek())) {
      return this.parseIdentifierOrCall();
    }
    throw new GraphDslError(`Unsupported expression "${this.source}" in ${this.label}`);
  }

  parseNumber() {
    const start = this.index;
    while (isDigit(this.peek())) this.index += 1;
    if (this.peek() === ".") {
      this.index += 1;
      while (isDigit(this.peek())) this.index += 1;
    }
    if (this.peek() === "e" || this.peek() === "E") {
      this.index += 1;
      if (this.peek() === "+" || this.peek() === "-") this.index += 1;
      while (isDigit(this.peek())) this.index += 1;
    }
    const raw = this.source.slice(start, this.index);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new GraphDslError(`Invalid number "${raw}" in ${this.label}`);
    }
    if (this.peek() === "j") {
      this.index += 1;
      return complex(0, value);
    }
    return value;
  }

  parseIdentifierOrCall() {
    const name = this.parseIdentifier();
    this.skipWhitespace();
    if (this.consume("(")) {
      const fn = MATH_FUNCTIONS.get(name);
      if (!fn) {
        throw new GraphDslError(`Unknown math function "${name}" in ${this.label}`);
      }
      const args = this.parseArguments();
      return fn(...args);
    }
    if (this.scope.has(name)) return this.scope.get(name);
    if (MATH_CONSTANTS.has(name)) return MATH_CONSTANTS.get(name);
    throw new GraphDslError(`Unknown variable "${name}" in ${this.label}`);
  }

  parseIdentifier() {
    const start = this.index;
    this.index += 1;
    while (isIdentifierPart(this.peek())) this.index += 1;
    return this.source.slice(start, this.index);
  }

  parseArguments() {
    const args = [];
    this.skipWhitespace();
    if (this.consume(")")) return args;
    while (!this.isDone()) {
      args.push(this.parseExpression());
      this.skipWhitespace();
      if (this.consume(")")) return args;
      if (!this.consume(",")) {
        throw new GraphDslError(`Expected "," in function call "${this.source}"`);
      }
    }
    throw new GraphDslError(`Unclosed function call "${this.source}"`);
  }

  skipWhitespace() {
    while (/\s/.test(this.peek() ?? "")) this.index += 1;
  }

  consume(value) {
    if (!this.source.startsWith(value, this.index)) return false;
    this.index += value.length;
    return true;
  }

  peek() {
    return this.source[this.index];
  }

  isDone() {
    return this.index >= this.source.length;
  }
}

function isDigit(char) {
  return char != null && /[0-9]/.test(char);
}

function isIdentifierStart(char) {
  return char != null && /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char) {
  return char != null && /[A-Za-z0-9_]/.test(char);
}
