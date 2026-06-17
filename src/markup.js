import { GraphDslError } from "./errors.js";
import { parseBraceLiteral } from "./literals.js";

export function parseMarkup(source) {
  const parser = new MarkupParser(source);
  return parser.parseDocument();
}

class MarkupParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parseDocument() {
    const nodes = [];
    while (!this.isDone()) {
      this.skipWhitespace();
      if (this.isDone()) break;
      nodes.push(this.parseElement());
    }
    return nodes;
  }

  parseElement() {
    this.expect("<");
    if (this.peek() === "/") {
      throw new GraphDslError("Unexpected closing tag", this.index);
    }

    const name = this.readName();
    const attrs = this.readAttrs();

    if (this.consume("/>")) {
      return { type: "element", name, attrs, children: [] };
    }

    this.expect(">");
    const children = [];

    while (!this.isDone()) {
      this.skipWhitespace();
      if (this.consume(`</${name}>`)) {
        return { type: "element", name, attrs, children };
      }
      if (this.peek() === "<") {
        children.push(this.parseElement());
      } else {
        const text = this.readText();
        if (text.trim()) {
          children.push({ type: "text", value: text });
        }
      }
    }

    throw new GraphDslError(`Missing closing tag for <${name}>`, this.index);
  }

  readAttrs() {
    const attrs = {};

    while (!this.isDone()) {
      this.skipWhitespace({ comments: false });
      const char = this.peek();
      if (char === ">" || (char === "/" && this.source[this.index + 1] === ">")) {
        return attrs;
      }

      const name = this.readName();
      this.skipWhitespace({ comments: false });

      if (!this.consume("=")) {
        attrs[name] = true;
        continue;
      }

      this.skipWhitespace({ comments: false });
      attrs[name] = this.readAttrValue();
    }

    return attrs;
  }

  readAttrValue() {
    const quote = this.peek();
    if (quote === '"' || quote === "'") {
      this.index += 1;
      const start = this.index;
      while (!this.isDone() && this.peek() !== quote) this.index += 1;
      const value = this.source.slice(start, this.index);
      this.expect(quote);
      return value;
    }

    if (quote === "{") {
      return parseBraceLiteral(this.readBraced());
    }

    throw new GraphDslError("Attribute values must be quoted or braced", this.index);
  }

  readBraced() {
    this.expect("{");
    const start = this.index;
    let depth = 1;

    while (!this.isDone()) {
      const char = this.peek();
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        const value = this.source.slice(start, this.index);
        this.index += 1;
        return value;
      }
      this.index += 1;
    }

    throw new GraphDslError("Unclosed braced value", start);
  }

  readName() {
    const start = this.index;
    while (!this.isDone() && /[A-Za-z0-9_.:-]/.test(this.peek())) {
      this.index += 1;
    }

    if (start === this.index) {
      throw new GraphDslError("Expected name", this.index);
    }

    return this.source.slice(start, this.index);
  }

  readText() {
    const start = this.index;
    while (!this.isDone() && this.peek() !== "<") {
      this.index += 1;
    }
    return this.source.slice(start, this.index);
  }

  skipWhitespace(options = {}) {
    const comments = options.comments !== false;

    while (!this.isDone()) {
      if (/\s/.test(this.peek())) {
        this.index += 1;
        continue;
      }
      if (comments && this.skipComment()) {
        continue;
      }
      break;
    }
  }

  skipComment() {
    if (this.consume("{/*")) {
      const end = this.source.indexOf("*/}", this.index);
      if (end === -1) {
        throw new GraphDslError("Unclosed JSX comment", this.index);
      }
      this.index = end + 3;
      return true;
    }

    if (this.consume("<!--")) {
      const end = this.source.indexOf("-->", this.index);
      if (end === -1) {
        throw new GraphDslError("Unclosed HTML comment", this.index);
      }
      this.index = end + 3;
      return true;
    }

    if (this.consume("{")) {
      this.skipBracedComment();
      return true;
    }

    return false;
  }

  skipBracedComment() {
    const start = this.index;
    let depth = 1;

    while (!this.isDone()) {
      const char = this.peek();
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      this.index += 1;
      if (depth === 0) return;
    }

    throw new GraphDslError("Unclosed braced comment", start);
  }

  consume(value) {
    if (!this.source.startsWith(value, this.index)) return false;
    this.index += value.length;
    return true;
  }

  expect(value) {
    if (!this.consume(value)) {
      throw new GraphDslError(`Expected "${value}"`, this.index);
    }
  }

  peek() {
    return this.source[this.index];
  }

  isDone() {
    return this.index >= this.source.length;
  }
}
