import { validateContract } from "../dist/src/index.js";

try {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const entries = JSON.parse(input);
  console.log(JSON.stringify(entries.map(entry => validateContract(entry.packet, entry.roster))));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
