import { parseGraph } from "../src/index.js";

const graph = parseGraph(`
<Graph>
  <Rect id="A" at={[100, 100]} size={[100, 60]} label="$\\alpha$">
    <Port id="out" right label="xy" />
  </Rect>

  <Circle id="B" at={[300, 100]} r={40} label="B">
    <Port id="in" left />
  </Circle>

  <Arrow from="A.out" to="B.in" />
</Graph>
`);

console.log(JSON.stringify(graph, null, 2));
