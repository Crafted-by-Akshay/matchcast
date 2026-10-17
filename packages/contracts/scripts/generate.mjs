import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const schema = JSON.parse(await readFile(new URL("../matchcast_contracts/schemas/v1.json", import.meta.url), "utf8"));
const output = new URL("../src/generated.ts", import.meta.url);
const generated = await compile(schema, schema.title, {
  bannerComment: "/* Generated from matchcast_contracts/schemas/v1.json. Do not edit. Run make contracts-generate. */",
  unreachableDefinitions: true,
});
if (process.argv.includes("--check")) {
  if (await readFile(output, "utf8") !== generated) {
    throw new Error("Generated TypeScript is stale. Run make contracts-generate.");
  }
  console.log("Generated TypeScript matches canonical JSON Schema");
} else {
  await writeFile(output, generated);
}
