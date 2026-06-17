export class GraphDslError extends Error {
  constructor(message, position = null) {
    super(position == null ? message : `${message} at ${position}`);
    this.name = "GraphDslError";
    this.position = position;
  }
}
