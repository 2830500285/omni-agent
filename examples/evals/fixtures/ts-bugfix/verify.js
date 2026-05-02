import { parseCount } from "./src/parser.ts";

if (parseCount("42") !== 42) {
  throw new Error("parseCount should parse a base-10 integer.");
}
