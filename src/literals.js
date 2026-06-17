import { GraphDslError } from "./errors.js";

export const REF_LITERAL = "__graphDslRef";
export const ADDRESS_LITERAL = "__graphDslAddress";
export const POINT_LITERAL = "__graphDslPoint";
export const TEMPLATE_LITERAL = "__graphDslTemplate";
export const EXPRESSION_LITERAL = "__graphDslExpression";

export function parseBraceLiteral(source) {
  const value = source.trim();
  if (/^`[\s\S]*`$/.test(value)) {
    return templateLiteral(value.slice(1, -1));
  }
  if (/^\{.*\}$/.test(value)) {
    return parseObjectLiteral(value);
  }
  if (/^\[.*\]$/.test(value)) {
    return parseArrayLiteral(value);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;

  const quoted = value.match(/^(['"])(.*)\1$/);
  if (quoted) return unescapeQuotedString(quoted[2]);

  const pointExpression = parsePointExpression(value);
  if (pointExpression) {
    return pointLiteral(pointExpression);
  }

  if (isAddress(value)) {
    return addressLiteral(value);
  }

  if (looksLikeExpression(value)) {
    return expressionLiteral(value);
  }

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
    return refLiteral(value);
  }

  throw new GraphDslError(`Unsupported braced literal "{${source}}"`);
}

export function parseArrayLiteral(source) {
  const inner = source.slice(1, -1).trim();
  if (!inner) return [];

  return splitTopLevel(inner, ",").map((part) => parseObjectValue(part.trim()));
}

function parseObjectLiteral(source) {
  const inner = source.slice(1, -1).trim();
  if (!inner) return {};

  return Object.fromEntries(splitTopLevel(inner, ",").map((entry) => {
    const [rawKey, ...rawValueParts] = splitTopLevel(entry, ":");
    if (rawValueParts.length === 0) {
      throw new GraphDslError(`Invalid object entry "${entry}"`);
    }
    const key = parseObjectKey(rawKey.trim());
    const value = parseObjectValue(rawValueParts.join(":").trim());
    return [key, value];
  }));
}

function parseObjectKey(source) {
  const quoted = source.match(/^(['"])(.*)\1$/);
  if (quoted) return unescapeQuotedString(quoted[2]);
  if (/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(source)) return source;
  throw new GraphDslError(`Invalid object key "${source}"`);
}

function parseObjectValue(source) {
  if (/^`[\s\S]*`$/.test(source)) return templateLiteral(source.slice(1, -1));
  if (/^-?\d+(\.\d+)?$/.test(source)) return Number(source);
  if (source === "true") return true;
  if (source === "false") return false;
  if (source === "null") return null;
  if (/^\[.*\]$/.test(source)) return parseArrayLiteral(source);
  if (/^\{.*\}$/.test(source)) return parseObjectLiteral(source);

  const quoted = source.match(/^(['"])(.*)\1$/);
  if (quoted) return unescapeQuotedString(quoted[2]);

  const pointExpression = parsePointExpression(source);
  if (pointExpression) {
    return pointLiteral(pointExpression);
  }

  if (isAddress(source)) {
    return addressLiteral(source);
  }

  if (looksLikeExpression(source)) {
    return expressionLiteral(source);
  }

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(source)) {
    return refLiteral(source);
  }

  throw new GraphDslError(`Unsupported object value "${source}"`);
}

export function evaluateExpression(source, scope, options = {}) {
  const parser = new ExpressionParser(source, scope, options);
  return parser.parse();
}

class ExpressionParser {
  constructor(source, scope, options) {
    this.source = source;
    this.scope = scope;
    this.options = options;
    this.index = 0;
    this.complete = true;
  }

  parse() {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (!this.isDone()) {
      throw new GraphDslError(`Unsupported expression "${this.source}"`);
    }
    if (!this.complete) {
      return { resolved: false };
    }
    if (!Number.isFinite(value)) {
      throw new GraphDslError(`Expression "${this.source}" did not evaluate to a finite number`);
    }
    return { resolved: true, value };
  }

  parseExpression() {
    let value = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      if (this.consume("+")) {
        value += this.parseTerm();
      } else if (this.consume("-")) {
        value -= this.parseTerm();
      } else {
        return value;
      }
    }
  }

  parseTerm() {
    let value = this.parseFactor();
    while (true) {
      this.skipWhitespace();
      if (this.consume("*")) {
        value *= this.parseFactor();
      } else if (this.consume("/")) {
        value /= this.parseFactor();
      } else {
        return value;
      }
    }
  }

  parseFactor() {
    this.skipWhitespace();
    if (this.consume("+")) return this.parseFactor();
    if (this.consume("-")) return -this.parseFactor();
    if (this.consume("(")) {
      const value = this.parseExpression();
      this.skipWhitespace();
      if (!this.consume(")")) {
        throw new GraphDslError(`Unclosed expression "${this.source}"`);
      }
      return value;
    }
    if (isDigit(this.peek()) || this.peek() === ".") {
      return this.parseNumber();
    }
    if (isIdentifierStart(this.peek())) {
      return this.parseIdentifier();
    }
    throw new GraphDslError(`Unsupported expression "${this.source}"`);
  }

  parseNumber() {
    const start = this.index;
    while (isDigit(this.peek())) this.index += 1;
    if (this.peek() === ".") {
      this.index += 1;
      while (isDigit(this.peek())) this.index += 1;
    }
    const raw = this.source.slice(start, this.index);
    if (raw === ".") {
      throw new GraphDslError(`Unsupported expression "${this.source}"`);
    }
    return Number(raw);
  }

  parseIdentifier() {
    const start = this.index;
    this.index += 1;
    while (isIdentifierPart(this.peek())) this.index += 1;
    const name = this.source.slice(start, this.index);
    if (!this.scope.has(name)) {
      if (this.options.strict) {
        throw new GraphDslError(`Unknown template variable "${name}"`);
      }
      this.complete = false;
      return 0;
    }
    const value = Number(this.scope.get(name));
    if (!Number.isFinite(value)) {
      if (this.options.strict) {
        throw new GraphDslError(`Expression variable "${name}" must be a number`);
      }
      this.complete = false;
      return 0;
    }
    return value;
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

function refLiteral(name) {
  return { [REF_LITERAL]: name };
}

function addressLiteral(name) {
  return { [ADDRESS_LITERAL]: name };
}

export function pointLiteral(expression) {
  return { [POINT_LITERAL]: expression };
}

export function substitutePointExpression(expression, substitute) {
  return {
    address: expression.address,
    offsets: expression.offsets.map((offset) => ({
      x: substitute(offset.x),
      y: substitute(offset.y)
    }))
  };
}

export function templateLiteral(source) {
  return { [TEMPLATE_LITERAL]: source };
}

function expressionLiteral(source) {
  return { [EXPRESSION_LITERAL]: source };
}

function unescapeQuotedString(source) {
  return source
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\(["'\\])/g, "$1");
}

export function isRefLiteral(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, REF_LITERAL);
}

export function isAddressLiteral(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, ADDRESS_LITERAL);
}

export function isPointLiteral(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, POINT_LITERAL);
}

export function isTemplateLiteral(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, TEMPLATE_LITERAL);
}

export function isExpressionLiteral(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, EXPRESSION_LITERAL);
}

function looksLikeExpression(source) {
  return /[+\-*/()]/.test(source);
}

export function isAddress(source) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(source);
}

function parsePointExpression(source) {
  const parts = splitPointExpression(source.trim());
  if (parts.length < 3) return null;
  const first = parts.shift();
  if (!first || first.type !== "term" || !isAddress(first.value)) return null;

  const offsets = [];
  while (parts.length > 0) {
    const operator = parts.shift();
    const term = parts.shift();
    if (!operator || operator.type !== "operator" || !term || term.type !== "term") {
      throw new GraphDslError(`Invalid point expression "${source}"`);
    }
    const vector = parseVectorLiteral(term.value, source);
    offsets.push({
      x: operator.value === "-" ? negateVectorValue(vector.x) : vector.x,
      y: operator.value === "-" ? negateVectorValue(vector.y) : vector.y
    });
  }

  return { address: first.value, offsets };
}

function negateVectorValue(value) {
  if (typeof value === "number") return -value;
  if (isExpressionLiteral(value)) return expressionLiteral(`-(${value[EXPRESSION_LITERAL]})`);
  return expressionLiteral(`-(${String(value)})`);
}

function splitPointExpression(source) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[") {
      depth += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      continue;
    }
    if ((char === "+" || char === "-") && depth === 0) {
      const term = source.slice(start, index).trim();
      if (term) parts.push({ type: "term", value: term });
      parts.push({ type: "operator", value: char });
      start = index + 1;
    }
  }

  const tail = source.slice(start).trim();
  if (tail) parts.push({ type: "term", value: tail });
  return parts;
}

function parseVectorLiteral(source, expression) {
  if (!/^\[.*\]$/.test(source)) {
    throw new GraphDslError(`Point expression "${expression}" only supports vector offsets like [x, y]`);
  }
  const vector = parseArrayLiteral(source);
  if (vector.length < 2) {
    throw new GraphDslError(`Point expression "${expression}" requires [x, y] vectors`);
  }
  return { x: vector[0], y: vector[1] };
}

export function pointExpressionNumber(value, expression) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new GraphDslError(`Point expression for "${expression.address}" vector values must be numbers`);
  }
  return number;
}

export function splitTopLevel(source, delimiter) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    if (char === "}" || char === "]") depth -= 1;
    if (char === delimiter && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}
