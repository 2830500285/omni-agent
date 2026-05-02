import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "omni-paper-topconf-"));

mkdirSync(join(root, "data"), { recursive: true });
mkdirSync(join(root, "scripts"), { recursive: true });

write("package.json", `{
  "name": "omni-paper-topconf-fixture",
  "type": "module",
  "scripts": {
    "test": "node scripts/check-paper.js"
  }
}
`);

write("README.md", `# Top Conference Paper Fixture

Complete a computer systems / AI agents conference paper package.

The target paper is **AuditGraph: Claim-Grounded Evaluation for Tool-Using Coding Agents**.

Required deliverable:
- Edit \`paper.md\` into a complete top-conference style paper draft.
- Ground every empirical claim in \`data/benchmark-results.csv\`.
- Ground benchmark scope and task categories in \`data/benchmark-metadata.json\`.
- Use citations from \`references.bib\` with markdown citation keys, e.g. \`[@react2023]\`.
- Do not invent additional experiments, datasets, or citations.
- Keep the paper honest: describe the benchmark as synthetic, discuss external validity, and avoid unsupported "state of the art" claims.
- Use ASCII text only; avoid curly quotes, em dashes, and non-ASCII punctuation.
- The final paper must include Abstract, Introduction, Related Work, Method, Experiments, Ablations, Limitations, Ethics, Reproducibility, Conclusion, and References.

Evaluation:
- Run \`npm test\`.
- The checker validates structure, citation coverage, exact metric reporting, required caveats, and absence of placeholders.
`);

write("paper.md", `# AuditGraph: Claim-Grounded Evaluation for Tool-Using Coding Agents

TODO: complete the paper.

## Abstract

TODO

## Introduction

TODO
`);

write("data/benchmark-results.csv", `system,task_success,hallucination_rate,cost_ratio,trace_replay_score
Baseline-ReAct,42.1,18.7,1.00,0.22
Reflexion+Tools,48.4,15.9,1.18,0.29
AuditGraph,61.8,7.4,0.83,0.91
AuditGraph-no-guardrails,54.2,13.1,0.79,0.63
AuditGraph-no-replay,56.0,8.6,0.81,0.35
`);

write("data/benchmark-metadata.json", `{
  "episodeCount": 120,
  "taskCategories": [
    "file editing",
    "test repair",
    "API debugging",
    "data transformation",
    "multi-file refactor"
  ],
  "split": {
    "developmentEpisodes": 80,
    "heldOutEpisodes": 40
  },
  "setting": "synthetic local coding-agent episodes"
}
`);

write("references.bib", `@inproceedings{react2023,
  title = {ReAct: Synergizing Reasoning and Acting in Language Models},
  author = {Yao, Shunyu and Zhao, Jeffrey and Yu, Dian and Du, Nan and Shafran, Izhak and Narasimhan, Karthik and Cao, Yuan},
  booktitle = {International Conference on Learning Representations},
  year = {2023}
}

@inproceedings{reflexion2023,
  title = {Reflexion: Language Agents with Verbal Reinforcement Learning},
  author = {Shinn, Noah and Cassano, Federico and Gopinath, Ashwin and Narasimhan, Karthik and Yao, Shunyu},
  booktitle = {Advances in Neural Information Processing Systems},
  year = {2023}
}

@inproceedings{toolformer2023,
  title = {Toolformer: Language Models Can Teach Themselves to Use Tools},
  author = {Schick, Timo and Dwivedi-Yu, Jane and Dessi, Roberto and Raileanu, Roberta and Lomeli, Maria and Zettlemoyer, Luke and Cancedda, Nicola and Scialom, Thomas},
  booktitle = {Advances in Neural Information Processing Systems},
  year = {2023}
}

@inproceedings{agentbench2023,
  title = {AgentBench: Evaluating LLMs as Agents},
  author = {Liu, Xiao and Yu, Hao and Zhang, Hanchen and Xu, Yifan and Lei, Xuanyu and Lai, Hanyu and Gu, Yu and Ding, Hangliang and Men, Kai and Yang, Kejuan and Zhang, Shudan and Deng, Xiang and Zeng, Aohan and Du, Zhengxiao and Zhang, Chenhui and Shen, Sheng and Zhang, Tianjun and Su, Yu and Sun, Huan},
  booktitle = {International Conference on Learning Representations},
  year = {2024}
}

@article{swebench2024,
  title = {SWE-bench: Can Language Models Resolve Real-World GitHub Issues?},
  author = {Jimenez, Carlos E. and Yang, John and Wettig, Alexander and Yao, Shunyu and Pei, Kexin and Press, Ofir and Narasimhan, Karthik},
  journal = {International Conference on Learning Representations},
  year = {2024}
}

@inproceedings{weiser1981,
  title = {Program Slicing},
  author = {Weiser, Mark},
  booktitle = {International Conference on Software Engineering},
  year = {1981}
}
`);

write("scripts/check-paper.js", `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const paper = readFileSync("paper.md", "utf8");
const csv = readFileSync("data/benchmark-results.csv", "utf8");
const metadata = JSON.parse(readFileSync("data/benchmark-metadata.json", "utf8"));
const references = readFileSync("references.bib", "utf8");

const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function section(name) {
  const heading = new RegExp(\`^## \${name}\\\\s*$\`, "im");
  const match = heading.exec(paper);
  if (!match) {
    return "";
  }
  const rest = paper.slice(match.index + match[0].length);
  const nextHeadingIndex = rest.search(/^## /m);
  return (nextHeadingIndex >= 0 ? rest.slice(0, nextHeadingIndex) : rest).trim();
}

const requiredSections = [
  "Abstract",
  "Introduction",
  "Related Work",
  "Method",
  "Experiments",
  "Ablations",
  "Limitations",
  "Ethics",
  "Reproducibility",
  "Conclusion",
  "References",
];

for (const name of requiredSections) {
  check(new RegExp(\`^## \${name}\\\\s*$\`, "im").test(paper), \`missing section: \${name}\`);
  check(section(name).split(/\\s+/).filter(Boolean).length >= (name === "Abstract" ? 120 : name === "References" ? 20 : 90), \`section too thin: \${name}\`);
}

const wordCount = paper.split(/\\s+/).filter(Boolean).length;
check(wordCount >= 1600, \`paper is too short: \${wordCount} words\`);
check(!/TODO|TBD|placeholder|lorem ipsum|to be written/i.test(paper), "paper still contains placeholder text");
check(!/state[- ]of[- ]the[- ]art|SOTA/i.test(paper), "paper makes unsupported state-of-the-art claims");
check(!/[^\\x09\\x0A\\x0D\\x20-\\x7E]/.test(paper), "paper contains non-ASCII or corrupted Unicode characters");
check(!/\\b(GPT-?4|Claude|Gemini|Llama)\\b/i.test(paper), "paper invents an unprovided model family");
check(!/\\b500\\s+(coding-agent\\s+)?episodes\\b/i.test(paper), "paper invents an unprovided 500-episode benchmark");

const abstractWords = section("Abstract").split(/\\s+/).filter(Boolean).length;
check(abstractWords >= 120 && abstractWords <= 230, \`abstract length must be 120-230 words, got \${abstractWords}\`);

const requiredCitationKeys = ["react2023", "reflexion2023", "toolformer2023", "agentbench2023", "swebench2024", "weiser1981"];
for (const key of requiredCitationKeys) {
  check(references.includes(\`{\${key},\`), \`reference fixture missing key: \${key}\`);
  check(paper.includes(\`[@\${key}]\`), \`paper missing citation: [@\${key}]\`);
}

for (const value of ["42.1", "18.7", "1.00", "0.22", "48.4", "15.9", "1.18", "0.29", "61.8", "7.4", "0.83", "0.91", "54.2", "13.1", "0.79", "0.63", "56.0", "8.6", "0.81", "0.35"]) {
  check(paper.includes(value), \`missing exact benchmark value: \${value}\`);
}

for (const system of ["Baseline-ReAct", "Reflexion+Tools", "AuditGraph", "AuditGraph-no-guardrails", "AuditGraph-no-replay"]) {
  check(paper.includes(system), \`missing system name: \${system}\`);
}

check(paper.includes(String(metadata.episodeCount)), \`paper must include episode count: \${metadata.episodeCount}\`);
check(paper.includes(String(metadata.split.developmentEpisodes)), "paper must include development split count");
check(paper.includes(String(metadata.split.heldOutEpisodes)), "paper must include held-out split count");
for (const category of metadata.taskCategories) {
  check(paper.toLowerCase().includes(category.toLowerCase()), \`paper missing task category: \${category}\`);
}

const experiments = section("Experiments");
check(/\\|\\s*system\\s*\\|\\s*task success/i.test(experiments), "experiments must include a markdown results table");
check(/AuditGraph\\s*\\|\\s*61\\.8\\s*\\|\\s*7\\.4\\s*\\|\\s*0\\.83\\s*\\|\\s*0\\.91/i.test(experiments), "results table must include the exact AuditGraph row");
check(/claim-grounded/i.test(paper), "paper must describe claim-grounded evaluation");
check(/tool-using coding agents/i.test(paper), "paper must stay on the requested domain");

const method = section("Method");
for (const phrase of ["claim graph", "evidence node", "tool trace", "replay", "guardrail"]) {
  check(method.toLowerCase().includes(phrase), \`method missing concept: \${phrase}\`);
}

const ablations = section("Ablations");
check(/no-guardrails/i.test(ablations) && /54\\.2/.test(ablations) && /13\\.1/.test(ablations), "ablations must discuss no-guardrails metrics");
check(/no-replay/i.test(ablations) && /56\\.0/.test(ablations) && /0\\.35/.test(ablations), "ablations must discuss no-replay metrics");

const limitations = section("Limitations").toLowerCase();
check(limitations.includes("synthetic"), "limitations must mention the synthetic benchmark");
check(limitations.includes("external validity"), "limitations must mention external validity");
check(limitations.includes("not a deployment study"), "limitations must avoid overclaiming deployment readiness");

const ethics = section("Ethics").toLowerCase();
check(ethics.includes("dual-use"), "ethics must mention dual-use risk");
check(ethics.includes("privacy"), "ethics must mention privacy");
check(ethics.includes("human review"), "ethics must mention human review");

const reproducibility = section("Reproducibility");
check(reproducibility.includes("data/benchmark-results.csv"), "reproducibility must cite the benchmark data file");
check(reproducibility.includes("data/benchmark-metadata.json"), "reproducibility must cite the benchmark metadata file");
check(reproducibility.includes("npm test"), "reproducibility must include npm test");
check(reproducibility.includes("scripts/check-paper.js"), "reproducibility must cite the checker");

check(/## References[\\s\\S]*react2023[\\s\\S]*reflexion2023[\\s\\S]*toolformer2023[\\s\\S]*agentbench2023[\\s\\S]*swebench2024[\\s\\S]*weiser1981/i.test(paper), "references section must list all citation keys");

if (failures.length > 0) {
  console.error("Paper quality check failed:");
  for (const failure of failures) {
    console.error(\`- \${failure}\`);
  }
  process.exit(1);
}

console.log(\`Paper quality check passed: \${wordCount} words, \${requiredSections.length} sections, \${requiredCitationKeys.length} citations.\`);
console.log(\`Benchmark fixture rows:\\n\${csv.trim()}\`);
console.log(\`Benchmark metadata: \${metadata.episodeCount} episodes, \${metadata.taskCategories.length} task categories.\`);
`);

console.log(root);

function write(relativePath: string, content: string): void {
  writeFileSync(join(root, relativePath), content, "utf8");
}
