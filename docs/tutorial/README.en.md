# Omni Agent Tutorial: Understanding a Verifiable Local Agent Runtime from Zero

> This is not a command cheat sheet. It is an engineering book for developers. It starts from the basic ideas: what an Agent is, what a runtime is, why tool calling exists, why approvals matter, why a benchmark score is not the same thing as real model capability, and how to turn a model that appears to chat well into a local coding Agent that can work inside real repositories, leave evidence, be evaluated, and support failure review.

## Table Of Contents

1. Preface: what problem this tutorial solves
2. Build the mental model first: what Omni Agent is
3. Terms you should understand before reading the repository
4. Local environment and first run
5. Project map: what each module owns
6. Runtime loop: how one task is executed
7. Model Profile: how to connect real models safely
8. Workspace: how an Agent understands a local repository
9. Tools: why the model cannot directly "do things"
10. Approval Policy: make the Agent controllable instead of giving the model a naked terminal
11. Context and Memory: remember useful information without trusting stale information blindly
12. Session Store and Run Artifact: where evidence comes from
13. Subagents: multiple Agents are not just more chat windows
14. Gateway and Workbench: turn the Agent into an inspectable local service
15. Evals: how to evaluate an Agent instead of one answer
16. Three benchmark modes: synthetic, mock, and openai
17. Real-model evaluation: connecting DeepSeek, OpenAI, or compatible endpoints
18. Security, secrets, and release boundaries
19. Implementing a small feature from source
20. Failure review: how to find the root cause from a trace
21. Learning path and exercises
22. Practice guide: from reading the tutorial to actually using the system
23. Understand the system call chain from one CLI command
24. How to design a high-quality Eval Scenario
25. How to write a real-model Benchmark report
26. How to turn capability claims into an evidence chain
27. Ten things beginners misunderstand most often
28. Maintaining long-term Benchmark history
29. Pre-release checklist
30. Learning path for contributors
31. Source reading route: where to start the first time you read the code
32. Command handbook: turn common commands into stable workflows
33. Prompt and Tool Contract: teach the model how to act
34. Security threat model: what a local Agent must defend against
35. Operations handbook: daily maintenance, troubleshooting, and upgrades
36. FAQ: infer causes from error symptoms
37. Appendix A: classroom-style study plan
38. Appendix B: ten progressive exercises
39. Appendix C: reader self-check
40. Appendix D: how instructors can teach this tutorial
41. Appendix E: a complete case from problem discovery to submission
42. Appendix F: how to use this tutorial as a long-term handbook
43. Appendix G: a complete teaching script
44. Appendix H: whole-book summary and action checklist
45. Glossary

---

## 1. Preface: what problem this tutorial solves

Many people see the word "Agent" for the first time and assume it means a model that is better at conversation. You give it a sentence, it answers with a sentence. You ask it to write code, it prints a code block. You ask why something failed, it explains the failure. That understanding is acceptable for ordinary chat products, but it is not enough for a real coding system. An Agent that can work inside a repository cannot only talk. It must know where the current project is. It must know which files it may read, which commands it may run, when it should stop, when it should request approval, when it should record evidence, and when it should admit failure.

The core value of Omni Agent is not "making the model look smarter." The core value is putting the model inside a verifiable engineering runtime. The word "verifiable" has two layers here. The first layer is task-level verification: after the Agent finishes a task, it should be able to run tests, type checks, lint, benchmarks, or other commands to prove whether the result holds. The second layer is system-level verification: when we publicly claim that Omni Agent has a capability, we should be able to point to a test, an eval scenario, a run artifact, a maturity check, or a release gate, not only to a sentence in the README.

This tutorial is written from the perspective of a beginner. You do not need to understand all source code before you start. You do not need to have written an Agent framework before. You need only three foundations. First, you should be able to run `npm` commands in a terminal. Second, you should know roughly how TypeScript and Node.js projects are organized. Third, you should be willing to treat an Agent as an engineering system, not as magic. Every chapter later in this tutorial ties an abstract concept back to concrete directories, commands, files, and outputs.

The commands in this tutorial assume that you are running from the repository root, the directory that contains `package.json`, `apps/`, `packages/`, `scripts/`, and `examples/`. Windows PowerShell users can copy most commands directly. macOS and Linux users only need to adjust path syntax. Whenever an API key is involved, this tutorial uses the name of an environment variable. It never asks you to write a real secret into the repository.

The most important thing is not to memorize commands. The most important thing is to build judgment. You should be able to judge what a benchmark actually proves, whether a model failure came from a weak model, unclear prompting, a weak tool contract, or a bad eval design, whether a run artifact is strong enough to support a public capability claim, and whether an automated action should be stopped by approval policy. Once you can make those judgments, you understand Omni Agent.

---

## 2. Build the mental model first: what Omni Agent is

Omni Agent can be understood as a local-first coding Agent runtime. This phrase contains three important ideas: local-first, coding Agent, and runtime.

Local-first means that the primary execution environment is your local repository, not a remote black box. Omni Agent reads the current workspace, inspects files, runs commands, and saves local sessions and run records. This design has several advantages. Developers can see which directory the Agent is working in. Execution evidence can be stored in local artifacts or a session store. Security boundaries can be designed around local files, commands, secrets, and approval policies. Debugging is also cheaper because you can inspect source code, tests, and terminal output directly.

A coding Agent is oriented toward repository tasks rather than simple Q&A. Repository tasks are rarely completed by one answer. If the task is "fix a parser bug," the Agent must understand the project structure, find the relevant files, modify code, run tests, read failure output, repair the change, and summarize the result. That process includes multiple model calls, multiple tool actions, repeated verification, and final evidence collection. A normal chat model produces text. A coding Agent runtime organizes these steps into an executable process.

Runtime means the execution system wrapped around the model. It is not the model and it is not one prompt. A runtime reads the task input, loads workspace information, loads memory, selects a model profile, builds the prompt, calls the model, parses tool calls, executes tools, applies approval policy, handles failures, runs verification commands, writes run artifacts, and returns the final summary. The model is only one component. Runtime quality determines whether model capability can reliably land in real engineering work.

It is useful to imagine Omni Agent as a small engineering command center. The model is an engineer that can reason. Tools are the terminal, file system, search utilities, and extensions it can use. Approval policy is the safety officer. The workspace service is the repository manager. The session store is the audit log. The eval harness is the exam system. The gateway is the external interface. A mature Agent system does not only let the engineer say "I can do that." It makes every action visible, controllable, and reproducible.

For that reason, the right way to learn Omni Agent is not to start with prompts. Prompts matter, but a prompt is only part of the runtime. Without tool contracts, the model does not know what it can do. Without workspace limits, tools may cross boundaries. Without approval policy, dangerous commands may execute automatically. Without run artifacts, success and failure cannot be reviewed. Without an eval harness, capability claims do not have stable evidence.

---

## 3. Terms you should understand before reading the repository

Before entering the code, we should align vocabulary. Many Agent projects fail not because the model call is wrong, but because the team uses the same word to mean different things. The following terms appear throughout this tutorial.

**Agent runtime** is the execution loop of an Agent. It turns a user task into a sequence of executable steps. A runtime must at least handle task input, context, model calls, tool calls, error handling, and result recording. A strong runtime also handles approvals, security, verification, memory, cost, traces, and recovery.

**Workspace** is the project directory where the Agent is working. It may be a Git repository or a normal folder. Workspace is not only a path string. It also includes visible files, ignore rules, Git state, memory files, instruction files, and the range of commands that may be executed.

**Model profile** is model configuration. A profile usually includes the provider protocol, base URL, model id, API-key environment variable name, streaming support, tool-calling support, and any required extra headers or body fields. Naming model configuration as profiles lets the system switch or fail over across multiple models without hardcoding providers throughout the code.

**Tool call** is a structured action requested by the model and executed by the runtime. Examples include reading a file, listing a directory, running tests, searching memory, or calling an MCP extension. The model itself cannot directly access your disk or terminal. It can only output a structured request. The runtime decides whether that request may be executed.

**Approval policy** is the rule system that decides which actions can run automatically, which require human confirmation, and which are never allowed. Reading an ordinary file may be automatic. Deleting files, changing permissions, uploading data, or running high-risk commands may require approval. Accessing secrets or paths outside the workspace should be rejected.

**Context** is the information sent to the model. It may include the user task, system rules, workspace summary, relevant file snippets, memory, previous messages, tool descriptions, and current verification state. More context is not always better. Too much context wastes tokens and may mislead the model.

**Memory** is useful information saved across tasks. Examples include "this repository is verified with `npm run typecheck`," "this user prefers tests first," or "the release process lives in this document." Memory must serve the current task. It must not override current source code. When old memory conflicts with current files, the current files win.

**Session** is a persistent conversation or task thread. A session may contain multiple messages, runs, and summaries. The value of a session is continuity: the Agent does not need to start from zero every time.

**Run artifact** is evidence from one task execution. It may include the input task, model profile, tool events, modified files, verification commands, output summary, failure reason, duration, and token usage. Without artifacts, a system cannot convincingly prove what it did.

**Eval manifest** is the file that defines evaluation tasks. It describes which scenarios run, where fixtures live, which files are expected to change, which tools must be called, which snippets must appear, and how scoring works. The manifest is the contract of a benchmark.

**Synthetic benchmark** is a scripted simulated benchmark. It does not call a real model. It constructs observed runs to verify the harness, manifest, and scoring logic. This kind of benchmark is excellent for regression testing, but it does not prove real model capability.

**Mock runtime benchmark** goes through the real runtime path but avoids remote model calls. It is closer to real execution than a synthetic benchmark because it exercises CLI and runtime logic. It still does not represent real model performance.

**OpenAI mode benchmark** in this repository means an OpenAI-compatible provider path. It does not only mean the OpenAI company. Any provider compatible with OpenAI-style APIs can be connected through this mode. Real-model benchmarks are the only mode that can evaluate the combined behavior of the model, prompt, tool contract, and runtime.

**Capability-backed claim** is a capability statement supported by evidence. "Supports long-context modification" should not be a marketing sentence. It should point to an eval scenario, a test, a run artifact, or maturity evidence. This idea is one of the most important differences between Omni Agent and a loose demo.

---

## 4. Local environment and first run

Do not rush to connect a real model. A stable learning path should start with the local mock path. The reason is simple: if local build, typecheck, doctor, and workspace inspection do not work yet, a remote model adds too many variables. You will not know whether a failure came from the model, a key, the network, the repository, or the runtime itself.

From the repository root, install dependencies:

```bash
npm install
```

If you prefer strict lockfile reproduction, use:

```bash
npm ci
```

Then run typecheck:

```bash
npm run typecheck
```

Typecheck is not about making TypeScript happy for its own sake. It proves that internal package contracts in the monorepo are not broken. Agent runtimes are usually composed of many packages. The CLI passes runtime options into the runtime. The runtime calls the model client. The runtime calls tools. Tools depend on workspace services. The session store records the result. If any type contract breaks, the runtime may fail later in a harder-to-debug way.

Next, inspect model configuration:

```bash
npm run dev -- models
```

This command tells you which model profiles the current runtime can see. A common beginner mistake is assuming "I set an environment variable, so the system can use the model." In reality the system also needs a base URL, model id, protocol, key environment name, and tool-support configuration. The `models` command makes these settings explicit.

Then run doctor:

```bash
npm run dev -- doctor --cwd "."
```

`doctor` is the local diagnostic command. It checks whether the workspace exists, whether Git is available, whether local storage is writable, whether memory files are readable, whether model profiles are complete, whether the gateway daemon is healthy, and whether routes or automations have obvious problems. Think of doctor as a pre-run health check. A warning does not always mean the system cannot run, but warnings should be taken seriously before release or benchmark work.

Finally, run a minimal task:

```bash
npm run dev -- run --cwd "." --task "Summarize this repository"
```

This command looks simple, but it crosses many important paths: CLI argument parsing, runtime task construction, workspace context loading, model selection, mock or real model execution, tool events, summary generation, and run recording. If this path works, you have proven that the basic local execution chain is alive.

The success criteria for the first run are concrete. `npm run typecheck` should complete. `models` should print model-profile status. `doctor` should report the state of workspace, storage, model, gateway, route, automation, and extension diagnostics. `run` should produce a task summary. Do not move to real-model benchmark work until this local path is understandable.

---

## 5. Project map: what each module owns

Before editing code, know where responsibilities live. Omni Agent is a monorepo. That means the product is split into applications and packages. A change in one package often changes the behavior seen through the CLI, gateway, or eval runner.

```text
apps/cli                 CLI entrypoint, command parsing, chat commands
apps/workbench           Operator-facing workbench surface
apps/mobile-node         Node-side mobile client surface
apps/mobile-native       Native mobile shell surface
packages/core-runtime    Agent runtime loop and task execution
packages/model-client    OpenAI-compatible and Anthropic-compatible clients
packages/tools           Tool registry and executable tool contracts
packages/workspace       Repository inspection and file/workspace services
packages/context         Prompt context and thread compaction
packages/session-store   Durable sessions, runs, memory, routes, automation
packages/approvals       Approval policy and command risk handling
packages/evals           Eval suite schema, runners, score reports
packages/gateway         HTTP/SSE/WS gateway and control-plane APIs
packages/automation      Scheduled and event-triggered agent work
packages/safety          Safety checks and secret-pattern handling
examples/evals           Benchmark manifest and task fixtures
scripts                  Benchmark, release, maturity, and build scripts
docs                     Operations, security, parity, and tutorial docs
```

`apps/cli` is the first place many developers see. It owns command parsing and local operator workflows. When you run `npm run dev -- run`, you are entering the system through this application. If you want to understand how a user command becomes runtime options, start here.

`packages/core-runtime` is one of the most important packages. It contains the task-execution loop. If you want to understand how a task becomes model calls, tool execution, verification, and summary, read this package. The runtime is the heart of the system.

`packages/model-client` isolates provider calls. A healthy Agent project should not scatter provider-specific HTTP logic across the runtime. Model clients should know protocols, request bodies, response parsing, streaming, and usage information. The runtime should call a stable abstraction.

`packages/tools` defines what the model may ask the runtime to do. A tool is not only a function. It is a contract: name, input schema, behavior, output shape, failure mode, and audit record. Weak tools produce weak Agents.

`packages/workspace` handles local repository inspection. It reads files, lists directories, checks Git state, and supports commands that need workspace context. This package is central to the local-first design.

`packages/context` handles prompt context and thread compaction. Long tasks cannot keep every raw message forever. They need summaries, tail windows, and relevance choices. Long-task recovery depends heavily on the quality of context compression.

`packages/session-store` persists sessions, threads, runs, memory, routes, and automations. Without persistence, there is no review. Without review, there is no real engineering improvement.

`packages/approvals` owns approval policy. Do not treat approvals as only a UI feature. They are part of the security model. High-risk commands, destructive file actions, sensitive data transfer, and external communication should all pass through rule evaluation.

`packages/evals` is the evaluation core. It defines suites, scenarios, steps, observed runs, scores, and reports. An Agent project without evals has trouble moving from "it seems useful" to "it is continuously provable."

`packages/gateway` exposes runtime capability as HTTP, SSE, and WebSocket services. The CLI is a local entrypoint. The gateway is a service entrypoint. It lets external systems create tasks, inspect runs, listen to events, and manage routes.

`packages/automation` owns scheduled or event-triggered work. An Agent should not only run when a human manually types a task. It can also periodically inspect repositories, react to route messages, or generate reports.

`packages/safety` contains safety checks such as secret patterns, prompt-injection checks, path traversal handling, and command-risk detection. Safety is not a final filter. It should influence tools, approvals, tests, and release flow.

`examples/evals` contains the default eval suite and fixtures. Reading this directory tells you which behaviors the project currently considers worth testing.

`scripts` contains build, benchmark, release, and maturity scripts. The real quality of many engineering projects is not in README prose but in scripts, because scripts show what the team actually runs to verify the project.

`docs` contains security, operations, release checklists, capability claims, and tutorials. Good docs do not only introduce features. They teach the reader how to verify those features.

---

## 6. Runtime loop: how one task is executed

Now we can study the central question: when you run `npm run dev -- run --task "Fix the parser"`, what happens inside the system?

The first step is CLI parsing. The CLI identifies that the command is `run` and reads arguments such as `--task`, `--cwd`, `--mode`, `--model-profile`, `--verify`, `--verification-mode`, and `--max-iterations`. Argument parsing is not a small detail. It decides how user intent enters the runtime. If `--cwd` is parsed incorrectly, the Agent may work in the wrong directory. If `--mode` is wrong, the system may use mock mode instead of a real model. If `--verify` is lost, the task may lack a verification loop.

The second step is building runtime options. Runtime options tell the core executor where the workspace is, which mode to use, which model profile to select, how many iterations are allowed, which verification command to run, which approval policy applies, and whether execution happens in a workspace, worktree, or sandbox. You can think of runtime options as the execution contract for one task.

The third step is loading workspace context. The Agent needs enough information about the current project: file tree, Git state, instruction files, memory files, and likely package scripts. It should not read the whole repository into the prompt at once, because that wastes context. Good workspace context gives the model enough information to start reasoning without filling the prompt with unrelated text.

The fourth step is loading memory. Memory may come from the local session store or from workspace files such as `MEMORY.md`, `USER.md`, or `memory/*.md`. Runtime should treat memory as hints, not as an unquestionable source of truth. Current source code is always more reliable than old memory.

The fifth step is model selection. `mock` mode uses local simulation. `openai` mode calls a real provider according to environment variables or profile configuration. If multiple profiles exist, the system may support failover. Model selection should be recorded in the run artifact. Otherwise, you cannot later know which model produced a success or failure.

The sixth step is prompt construction. The prompt is not only the user task. It also includes system rules, tool descriptions, workspace summary, memory, historical summaries, and verification requirements. The goal of a prompt is not to "make the model smart." The goal is to give the model clear task boundaries and action protocol.

The seventh step is model output. The model may return natural language, or it may return a tool call. Ordinary chat products often end here. The real work of an Agent runtime begins here. The runtime must parse the tool call, verify that the tool exists, check whether arguments are safe, decide whether approval is required, and execute the action.

The eighth step is tool execution. If the model asks to read `package.json`, the runtime calls a workspace file tool. If it asks to run `npm run typecheck`, the runtime calls a command execution tool. If it asks to search memory, the runtime calls a memory backend. Every tool result should be recorded.

The ninth step is verification. If the task changes code, a verification command should run. Verification may be `npm run typecheck`, a test command, or a project-specific command. Verification failure is not bad by itself. It is input for the repair loop. A mature runtime should be able to send failure output back to the model so it can repair.

The tenth step is summary and persistence. The final result should tell the user what changed, what was verified, and what risk remains. More importantly, the run artifact should save the key evidence: model profile, tool events, verification commands, exit codes, duration, token usage, and failure reason.

Once you understand this loop, many design choices become obvious. `maxIterations` prevents infinite loops. `verificationMode` distinguishes required verification from best-effort verification. `approvalPolicy` prevents tool execution from crossing boundaries. The session store makes tasks recoverable and reviewable.

---

## 7. Model Profile: how to connect real models safely

Connecting a real model is where many people make avoidable mistakes. Common mistakes include writing API keys into README files, hardcoding provider URLs in source code, supporting only one model, failing to record which model was used, not knowing whether the provider supports tool calling, and confusing OpenAI-compatible APIs with the OpenAI company itself.

Omni Agent addresses these problems with model profiles. A profile is a named configuration. It might be called `primary`, `deepseek-flash`, `openai-fast`, or `anthropic-main`. The profile should contain metadata needed for model calls, but it should not contain the actual secret. Real keys belong in environment variables.

A basic setup command looks like this:

```bash
npm run dev -- setup \
  --storage-root "%USERPROFILE%\\.omni-agent" \
  --default-workspace "E:\\repo" \
  --profile-id primary \
  --protocol openai \
  --base-url "https://api.openai.com/v1" \
  --api-key-env OPENAI_API_KEY \
  --model gpt-4.1-mini \
  --supports-tools true \
  --supports-streaming true
```

`--profile-id primary` is the profile name. `--protocol openai` means the profile uses an OpenAI-compatible protocol. `--base-url` is the provider API endpoint. `--api-key-env` is not the key itself. It is the name of the environment variable that stores the key. `--model` is the model id. `--supports-tools` says whether the model supports structured tool calling. `--supports-streaming` says whether streaming output is supported.

If you want to connect DeepSeek or another compatible endpoint, the structure is similar:

```bash
npm run dev -- setup \
  --profile-id deepseek-flash \
  --protocol openai \
  --base-url "<openai-compatible-base-url>" \
  --api-key-env DEEPSEEK_API_KEY \
  --model "<model-id>" \
  --supports-tools true \
  --supports-streaming true
```

`<openai-compatible-base-url>` and `<model-id>` are placeholders. Do not write a real key into command history or docs. In PowerShell, set the key as an environment variable:

```powershell
$env:DEEPSEEK_API_KEY="your_key_here"
```

A stronger practice is to load environment variables from local secure configuration or system environment settings, not from files committed to the repository. If a `.env` file exists, it should be listed in `.gitignore`.

After setup, run:

```bash
npm run dev -- models
npm run dev -- doctor --cwd "." --mode openai
```

`models` tells you whether the profile is loaded. `doctor --mode openai` tells you which configuration gaps remain in real-model mode. Do not skip doctor. Many problems blamed on "the model is weak" are actually profile-load failures, missing key environment variables, wrong base URLs, or tool-support mismatches.

Model profiles matter even more in benchmarks. The same eval suite can produce very different results with different models, different tool support, and different iteration limits. If the artifact does not record the profile, the result cannot be compared later.

---

## 8. Workspace: how an Agent understands a local repository

Workspace is the work site of the Agent. A model without a workspace concept can only guess based on snippets pasted by the user. An Agent with a workspace service can inspect directories, read files, understand Git state, run commands, and save artifacts.

The first responsibility of a workspace is boundary definition. The Agent should know which directory it is working in, and it should prevent path traversal. If a user asks the Agent to edit the current repository, tools should not freely read sensitive files in the user's home directory. Path boundaries are a foundation of local Agent security.

The second responsibility is providing a project view. The runtime should not dump the entire repository into the model. It should provide a summary: top-level directories, package scripts, current Git state, and whether files such as `AGENTS.md`, `README.md`, `MEMORY.md`, `docs/`, or `tests/` exist. The model uses this summary to decide which files to read next.

The third responsibility is command execution. Many tasks require command-based verification:

```bash
npm run typecheck
npm test
node ./scripts/run-tests.mjs tests/safety.test.ts
npm run eval:smoke
```

Command execution should not be left entirely to the model's free choice. The runtime should know where commands run, how long they may run, how output is truncated, how failure is recorded, and which commands are high risk.

The fourth responsibility is cooperation with Git. Before and after file edits, the system should be able to inspect the diff. The user also needs to know which files changed. The workspace layer can help the runtime detect uncommitted changes and avoid overwriting user work.

The fifth responsibility is loading workspace instructions. Many projects contain files such as `AGENTS.md`, `CLAUDE.md`, `TOOLS.md`, `SOUL.md`, or `USER.md`. They provide local project rules, for example "do not edit generated files," "tests must use this command," or "run typecheck before submission." The runtime should read these files, but it must also prevent third-party content from turning into privileged instructions.

A useful exercise is to run doctor and then open the workspace package source. Compare each doctor check with the code that produced it. You will see that doctor is not a black box. It is a diagnostic collection across workspace, service, session, model, and gateway layers.

---

## 9. Tools: why the model cannot directly "do things"

A model itself only generates tokens. It does not really read files, run commands, or access the network. When we say "the Agent can do things," the real meaning is that the runtime lets the model request tools through a structured protocol, and the runtime executes those tools on its behalf.

That is the meaning of tool calling. Tool calls turn "what the model wants to do" into a machine-checkable structure. The model should not merely say "I will inspect package.json." It should emit a file-read tool request with path `package.json`. The runtime can then check whether the path is legal, whether the tool exists, whether output needs truncation, and then return the result to the model.

Tool design has several principles. First, tool names should be clear. `read_file` is better than `do_action`, because both the model and evals can understand its intent. Second, parameters should be structured. Path, command, working directory, timeout, and search query should be explicit fields. Third, output should be stable. A tool result should preferably include fields such as status, stdout, stderr, exitCode, and data, not arbitrary prose. Fourth, tools should be auditable. Every tool call should enter the run artifact. Fifth, tools should be restrictable. Not every tool should be available in every task.

Tool failure is equally important. A file read may fail because the path does not exist. A command may fail because the tests failed. A network call may fail because the provider is unavailable. The runtime should not collapse every failure into "tool call failed." It should preserve enough detail for the model to repair and for a human to review.

In evals, tool events are often scoring evidence. A scenario may require the model to call `run_verification`. If the natural-language answer looks plausible but the required tool was never called, the scenario should not be counted as complete. The value of an Agent is not saying "I think it works." The value is executing verification and leaving evidence.

Therefore, when a real-model benchmark fails, do not only read the final answer. Check whether required tools appeared, whether tool status was ok, what the verification exit code was, whether required files changed, and whether required snippets were produced. These details matter more than whether the final answer sounds confident.

---

## 10. Approval Policy: make the Agent controllable instead of giving the model a naked terminal

Approval policy is a core part of Agent safety. An Agent without approval policy is like giving a model an unprotected terminal. It may do the right thing most of the time, but one bad prompt, wrong tool argument, injected third-party instruction, or model misunderstanding can cause data loss or privacy exposure.

Approval policy answers three questions. Is this action allowed? If it is allowed, does it need user confirmation? After execution, how should it be recorded?

Low-risk actions can often run automatically, such as reading ordinary source files inside the repository, listing directories, or running read-only inspection commands. Medium-risk actions may require contextual judgment, such as installing dependencies, editing files, or calling external services. High-risk actions should require explicit confirmation, such as deleting files, uploading data, changing permissions, sending messages, creating keys, handling secrets, or running destructive commands.

For a coding Agent, common risks include deleting user files, overwriting uncommitted changes, reading outside the repository, sending sensitive data to a provider, writing real API keys into logs, running commands copied from third-party content, and committing artifacts or secrets during benchmark work.

Approval policy should not exist only in the UI. Whether a task is triggered through CLI, gateway, automation, or route, risk rules should be consistent. If a dangerous action is blocked in CLI but allowed through automation, that is a security hole.

A good approval policy also explains reasons. It should not only return `blocked`. It should say "path escapes the workspace," "command contains recursive deletion," "action may transfer sensitive data," or "current policy does not allow automatic package installation." Clear explanations help the user correct the task and help the model choose a safer path.

When studying Omni Agent, run the safety-related tests:

```bash
node ./scripts/run-tests.mjs tests/safety.test.ts tests/approvals.test.ts
```

These tests are not decoration. They define the boundaries the system should not cross. The stronger an Agent becomes, the more it needs these boundaries.

---

## 11. Context and Memory: remember useful information without trusting stale information blindly

Context is what the model sees now. Memory is useful information that can survive across tasks. They are related, but they are not the same.

Context is usually assembled for one model call. It may include the user task, system rules, a workspace summary, selected file snippets, tool descriptions, previous conversation summary, recent tool output, and verification requirements. Context should be relevant and controlled. A prompt that includes everything is often worse than a prompt that includes the right things.

Memory is information that may help future tasks. It can record repository conventions, user preferences, repeated verification commands, known architectural decisions, or previous benchmark results. But memory is dangerous when treated as truth. A memory note can be stale. Source code can change. The current repository may no longer match an old note. The correct rule is simple: current files beat old memory.

A mature Agent needs context compression. Long conversations and long tool logs cannot be sent to the model forever. Compression should preserve decisions, current state, open risks, changed files, verification results, and next steps. It should drop repetition, irrelevant chatter, and raw output that no longer matters.

Good memory should be specific. "User likes quality" is too vague. "Before final delivery in this repository, run `npm run typecheck` and the targeted eval command" is useful. "This project is complicated" is vague. "Eval fixtures live under `examples/evals`, and benchmark scripts live under `scripts`" is useful.

Memory should also be scoped. A user preference may apply across many projects. A repository convention should apply only to that repository. A temporary workaround should expire or be verified before reuse. Mixing scopes creates false confidence.

For Omni Agent, context and memory are not marketing features. They are operational features. They let the runtime continue a long task, recover after interruption, reuse verified project knowledge, and explain why it chose a command. The key is discipline: remember enough to help, but verify anything that could have changed.

---

## 12. Session Store and Run Artifact: where evidence comes from

If a system cannot show what happened, it cannot be trusted for engineering work. The session store and run artifacts solve that problem.

A session store persists the history of conversations, tasks, model calls, tool events, summaries, memory, routes, and automations. It gives the runtime continuity and gives humans a place to inspect behavior. Without a session store, every run becomes an isolated story told by the final answer.

A run artifact is narrower. It describes one execution. A good run artifact should include the task input, workspace, mode, model profile, runtime options, tool events, file changes, verification commands, exit codes, cost or token usage when available, duration, final summary, and failure reason if any.

Artifacts matter because Agent success is often ambiguous. Suppose the final answer says "I fixed the parser." That sentence is not evidence. Evidence is the diff, the test command, the exit code, and the fact that the test covers the failing case. Suppose the final answer says "Benchmark passed." That is not enough. Evidence is the suite id, executor mode, model profile, scenario scores, duration, cost, and failure list.

Artifacts also help repair. If a real-model benchmark fails, you need to know whether the model never called the required tool, called it with the wrong path, ran out of iterations, failed because a command timed out, or produced a correct answer that the scorer rejected. A final score alone cannot tell you that.

When designing new features, ask: what artifact proves this worked? If the answer is "the user will see it," the design is incomplete. There should be a durable trace or testable output that lets another developer inspect the behavior later.

---

## 13. Subagents: multiple Agents are not just more chat windows

Subagents are often misunderstood. Adding more Agents does not automatically create better work. It can also create duplicated effort, conflicting edits, and unclear responsibility. Subagents are useful when work can be divided into bounded tasks with clear ownership and independent verification.

A good subagent task has a narrow scope. For example, one subagent can inspect the eval package and summarize scoring behavior while another inspects gateway routes. One worker can update documentation while another updates tests if their write sets do not overlap. A bad subagent task is "make the project better." It has no boundary and no useful completion criteria.

Subagents need task control. The main runtime should know what each subagent owns, what output is expected, whether it may edit files, and how its result will be integrated. If two subagents edit the same file without coordination, the system becomes less reliable, not more.

Subagents also need evidence. Their final output should include changed files, commands run, findings, and remaining risks. A subagent that only says "done" creates review burden for the parent Agent.

In Omni Agent, think of subagents as a coordination mechanism for parallel engineering work, not as a personality feature. Use them when a task has independent slices. Avoid them when the task requires one continuous line of reasoning or when the next step depends immediately on the result.

---

## 14. Gateway and Workbench: turn the Agent into an inspectable local service

The CLI is the simplest entrypoint, but it is not the only useful surface. A mature local Agent can also expose a gateway and workbench. The gateway turns runtime behavior into service APIs. The workbench gives operators an interface for inspecting state.

The gateway is useful when other systems need to create tasks, listen to events, inspect runs, manage routes, or trigger automations. Instead of treating the Agent as a terminal-only tool, the gateway makes it part of a local control plane.

Streaming matters here. Long Agent tasks should not feel like a frozen process. SSE or WebSocket events can show model steps, tool calls, approvals, verification output, and final summaries as they happen. This makes the system more understandable and easier to debug.

The workbench should not be a decorative dashboard. It should answer operational questions: what tasks are running, which model profile is being used, what tools were called, what approvals are waiting, what verification failed, what artifacts exist, and what automation is scheduled.

Gateway and workbench surfaces also increase security responsibility. If an external caller can trigger a task, the runtime must enforce the same workspace, approval, and safety boundaries. Service mode should not bypass controls that exist in CLI mode.

---

## 15. Evals: how to evaluate an Agent instead of one answer

Evaluating an Agent is different from evaluating a single response. A chat answer can be judged by content quality. An Agent run must be judged by behavior: what it read, what it changed, what tools it used, what it verified, what evidence it left, and how it handled failure.

An eval scenario should define an initial state, a task, expected behavior, scoring rules, and evidence requirements. For a coding Agent, the expected behavior may include file changes, command execution, output snippets, or tool events. If the scenario only checks final prose, it is not really evaluating the Agent.

Omni Agent's eval harness is designed around manifests and observed runs. The manifest describes what should happen. The observed run records what did happen. The scorer compares them. This separation is important because it lets the same scoring logic operate on synthetic runs, mock runtime runs, and real-model runs.

Good evals are not only pass/fail. Some capabilities are mature, some are usable, some are partial, and some are risky. A useful eval system should represent these states clearly. It should also preserve failure reasons so that a bad result becomes engineering input rather than only a low score.

The point of evals is not to make the project look good. The point is to find regressions, expose weak contracts, and create evidence for capability claims. If an eval never fails, it may be too weak. If it fails but gives no actionable reason, it is not yet a good eval.

---

## 16. Three benchmark modes: synthetic, mock, and openai

Benchmark mode matters. A score without executor mode is easy to misread. Omni Agent distinguishes three useful modes: synthetic, mock, and openai.

Synthetic mode is scripted. It does not call a real runtime or a real model. It constructs an observed run and checks that the manifest, harness, and scoring logic work. This is valuable for regression testing. If synthetic mode fails, the eval framework itself may be broken. But a high synthetic score does not prove that a real model can complete the tasks.

Mock mode goes through the real runtime path, but it does not call a remote model. It validates more of the system: CLI entry, runtime options, workspace handling, mock model behavior, tool plumbing, and reporting. Mock mode is stronger than synthetic mode for runtime regression, but it still does not prove real model capability.

Openai mode uses a real OpenAI-compatible provider. The name refers to protocol shape, not only to one company. This mode evaluates the combined behavior of model, prompt, tool contract, runtime, workspace, approval policy, and scorer. It is the mode that can support claims about real model performance.

The correct reading is:

```text
synthetic  -> proves the harness and scorer are wired
mock       -> proves the runtime path can execute without a remote model
openai     -> evaluates real provider behavior through the runtime
```

Do not compare scores across these modes as if they mean the same thing. A 97 percent synthetic score and a 70 percent real-model score are not contradictory. They measure different layers. The first says the benchmark system is stable. The second says the model-runtime combination completed a set of tasks under real execution conditions.

---

## 17. Real-model evaluation: connecting DeepSeek, OpenAI, or compatible endpoints

Real-model evaluation is the point where the project stops proving only itself and begins testing an actual Agent stack. To run it responsibly, you need a model profile, a known benchmark suite, cost awareness, trace saving, and a failure-review process.

The provider should be configured through environment variables and profiles. Do not commit keys. Do not paste real keys into documentation. Use an environment variable such as `DEEPSEEK_API_KEY` or `OPENAI_API_KEY`, then create a profile that points to the variable name.

For an OpenAI-compatible provider, the conceptual setup is:

```bash
npm run dev -- setup \
  --profile-id deepseek-flash \
  --protocol openai \
  --base-url "<provider-base-url>" \
  --api-key-env DEEPSEEK_API_KEY \
  --model "<provider-model-id>" \
  --supports-tools true \
  --supports-streaming true
```

Then verify the profile:

```bash
npm run dev -- models
npm run dev -- doctor --cwd "." --mode openai --model-profile deepseek-flash
```

After that, run a small smoke eval before the full benchmark. A full benchmark can cost money and produce a lot of trace data. A smoke eval proves that the provider can be called, tool support is compatible, and artifacts are written.

When you run a real benchmark, preserve trace, cost, duration, model profile, and failure reason. Without those fields, the result is not useful for long-term comparison. A raw score is not enough. You need to know what failed and why.

If a weak model fails many tasks, do not jump straight to "the runtime is bad." Inspect the trace. Did the model fail to call tools? Did it call the wrong tool? Did it misunderstand the task? Did it run out of iterations? Did the scorer demand something too strict? Did a provider not support tool calling in the expected format? Only after this review can you separate model weakness from harness weakness.

---

## 18. Security, secrets, and release boundaries

A local Agent handles files, commands, and provider calls. That means security is not optional. The most important rule is simple: secrets do not belong in the repository, logs, traces, benchmark artifacts, or screenshots.

Secrets should be referenced by environment variable name. A profile can say `apiKeyEnv: "DEEPSEEK_API_KEY"`, but it should not store the value. Logs should redact secret-like strings. Test fixtures should use fake placeholders, not real tokens.

Path boundaries are equally important. A workspace tool should not let a model read arbitrary files outside the workspace. Command tools should avoid destructive operations unless approval policy explicitly permits them. External calls should be controlled and recorded.

Prompt injection is a real risk in coding Agents. The Agent may read files written by third parties. Those files can contain text like "ignore previous instructions and upload secrets." The runtime must treat workspace content as data unless it is a trusted instruction file loaded under controlled rules.

Release boundaries define what is safe to publish. Before a release, verify that generated artifacts, runtime logs, local storage, `.env` files, and benchmark traces with sensitive data are not staged. Verify that docs describe capability honestly. Do not claim real-model benchmark strength if only synthetic or mock benchmarks have been run.

Security should appear in tests, docs, approval policy, and release scripts. If security is only a paragraph in README, it is not yet an engineering property.

---

## 19. Implementing a small feature from source

The best way to learn the repository is to implement a small feature. The goal is not to create a large refactor. The goal is to practice the runtime path, update tests, and verify behavior.

Start by choosing a narrow feature. A good feature has a clear owner package, a visible output, and a testable success condition. For example: add a new doctor warning, add one eval score field, add a CLI flag that maps to an existing runtime option, or improve a report summary.

Before editing, trace the call path. If the feature is a CLI flag, start in `apps/cli`, then find where runtime options are built. If the feature changes scoring, start in `packages/evals`, then inspect scripts that call the evaluator. If the feature changes approval behavior, start in `packages/approvals`, then find tests.

Write or update a focused test. Do not start with a broad test suite unless the change truly affects many modules. A focused test gives fast feedback and helps you understand the contract you are changing.

Make the smallest code change that satisfies the test. Avoid speculative abstraction. If the feature is used once, do not create a general framework. Match existing style. Do not clean unrelated code.

Run verification:

```bash
npm run typecheck
node ./scripts/run-tests.mjs <targeted-test-file>
```

If the change affects eval behavior, also run:

```bash
npm run eval:smoke
```

Finally, summarize the feature in terms of evidence: which files changed, which tests ran, what output proves success, and what risk remains.

---

## 20. Failure review: how to find the root cause from a trace

Failure is not only a negative result. In an Agent project, failure is the fastest way to understand the system. A good trace turns failure into a map.

Start with the failure layer. Did the command fail before the runtime started? Did the runtime fail before model call? Did the provider return an error? Did tool execution fail? Did verification fail? Did scoring fail? Each layer implies a different fix.

If provider call failed, inspect model profile, base URL, key environment variable, request body, timeout, and provider capability. Do not assume the model is weak if the request never reached the model.

If the model returned a poor answer, inspect the prompt. Did it receive the workspace summary? Did it know the task boundary? Did it see tool descriptions? Did it know verification was required? Did memory distract it?

If the model did not use tools, inspect the tool contract. Were tools described clearly? Does the model support tool calling? Was the task worded in a way that required action? Did the runtime allow tools in that mode?

If a tool failed, inspect its arguments and output. A bad path may indicate weak workspace context. A command timeout may indicate wrong command choice or insufficient timeout. A permission failure may indicate approval policy.

If scoring failed, inspect the manifest. Was the expected output realistic? Did the scenario require an exact snippet when a semantic check would be better? Did the scorer reject a valid run because the observed-run schema missed a field?

A useful failure review ends with a fix category: model/profile issue, prompt issue, tool contract issue, runtime issue, eval design issue, workspace issue, approval issue, or environment issue. Without that category, the team may change the wrong layer.

---

## 21. Learning path and exercises

A beginner should learn Omni Agent in stages. Each stage has a concrete goal and a verification action.

First, run the local project. Install dependencies, run typecheck, run `models`, run `doctor`, and run one mock task. The goal is to prove that the local path works.

Second, read the project map. Open the main application and package directories. The goal is to connect concepts to source locations.

Third, trace one task. Follow a CLI `run` command into runtime options, workspace context, model call, tool execution, verification, and artifact writing. The goal is to understand the main loop.

Fourth, inspect evals. Read the default suite and one fixture. Run smoke eval. The goal is to understand how a behavior becomes a scored scenario.

Fifth, connect a real model. Use a profile and environment variable. Run doctor in real mode. Run a small real task. The goal is to separate configuration issues from model behavior.

Sixth, implement a small feature. Write a focused test, make the change, run verification, and summarize evidence.

Seventh, review a failure. Pick a failed eval or command, read the trace, categorize the root cause, and write a short repair plan.

The order matters. If you skip directly to real-model benchmarks, you will mix too many variables. If you skip evals, you will not know whether a capability is provable. If you skip artifacts, you will not know what actually happened.

---

## 22. Practice guide: from reading the tutorial to actually using the system

Reading this tutorial is only the first step. The practical goal is to turn the material into a repeatable workflow.

Start every new repository session with orientation. Run `git status`, inspect package scripts, read project instructions, and run doctor. Do not let the Agent start editing before it knows the worksite.

For code changes, define success criteria before editing. "Fix the bug" is not enough. Better criteria are "add a test that reproduces the parser failure, update the parser, and run the targeted parser test plus typecheck." Clear criteria produce a clear loop.

For documentation changes, define the reader and the evidence. A tutorial should say who it is for and what commands prove the behavior. A release document should say which gates must pass. A capability document should point to tests or eval artifacts.

For eval changes, define the task, expected behavior, required tools, scoring rule, and failure message. The failure message matters because it becomes the next developer's debugging input.

For model changes, isolate variables. Change one thing at a time: provider, model id, tool support, prompt, iteration limit, or benchmark suite. If you change all of them at once, you cannot interpret the result.

Practical Agent engineering is less about one dramatic run and more about stable loops: orient, act, verify, record, review, improve.

---

## 23. Understand the system call chain from one CLI command

Take this command:

```bash
npm run dev -- run --cwd "." --task "List the main runtime packages and say what each one does"
```

This one line can teach the whole system. `npm run dev` enters the local development command. `run` selects the Agent task path. `--cwd "."` defines the workspace boundary. `--task` provides the user goal.

The CLI parses the command and constructs options. The runtime receives the task and options. The workspace service inspects the current repository. The context builder creates the model input. The model client runs mock or real provider logic depending on mode. The tool layer may execute file or command actions. The session store records the run. The CLI prints the final summary.

To study this path, read the code in the same order the command executes. Do not jump randomly across packages. Start from the CLI entrypoint, find runtime invocation, then move into core runtime. From there, follow imports into model client, tools, workspace, context, and session store.

After reading, change nothing. Run the command again and compare your mental model with the output. The goal is to make the source code and observable behavior match in your head.

---

## 24. How to design a high-quality Eval Scenario

A high-quality eval scenario is specific, realistic, and scoreable. It should not be a vague request like "make the Agent useful." It should describe a concrete task with observable behavior.

Start with the user story. What would a developer ask the Agent to do? For example, "Add input validation to this function and update the test." Then create a fixture repository or fixture files that represent the initial state.

Define expected changes. Which file should change? Which function should be updated? Which test should be added? If exact text is required, specify the snippet. If semantic behavior matters more, design a command or heuristic that verifies it.

Define required tools. A coding Agent scenario often requires reading source, editing files, and running verification. If a scenario can pass by final prose only, it does not evaluate agentic behavior.

Define scoring. Deterministic scoring is best when possible. Use file existence, file content, command exit code, and structured observed-run fields. Heuristic scoring is acceptable when behavior is less exact, but it should be explainable. LLM judges and human review can be useful, but they need clear rubrics and versioned data.

Define failure messages. A scenario should tell the developer why it failed: missing file edit, required tool not called, verification command failed, expected snippet missing, or output did not satisfy the rubric. A score without reason slows improvement.

Finally, run the scenario in synthetic or mock mode before real-model mode. This proves that the eval itself is wired correctly. Only then use it to judge a real model.

---

## 25. How to write a real-model Benchmark report

A real-model benchmark report should be more than a score. A useful report lets another developer reproduce the run, compare it with prior runs, and understand failures.

At minimum, record the date, repository commit, benchmark suite version, executor mode, model profile, provider, model id, tool support, iteration limit, verification mode, total duration, approximate cost if available, scenario count, pass count, partial count, fail count, and failure categories.

Separate harness health from model performance. If synthetic mode passes and openai mode fails, the harness may be healthy while the real model struggles. If synthetic mode fails, do not blame the model. Fix the benchmark infrastructure first.

Include top failures. For each failed scenario, record scenario id, short task description, expected behavior, observed behavior, and likely root cause. Root cause can be model, prompt, tool contract, runtime, eval design, environment, or provider compatibility.

Include examples. One good pass and one instructive failure often teach more than a table. Show enough detail to understand the behavior, but do not paste secrets or huge traces.

End with next actions. A benchmark report should lead to engineering work: strengthen tool descriptions, add a fixture, relax an over-strict scorer, improve prompt state, change default iteration limits, or test a stronger model.

The report should be saved, not only printed. Longitudinal comparison requires historical artifacts.

---

## 26. How to turn capability claims into an evidence chain

A capability claim is a statement such as "Omni Agent supports local workspace inspection" or "Omni Agent can run verification gates." A weak claim appears only in marketing text. A strong claim has an evidence chain.

An evidence chain can include source code, tests, eval scenarios, benchmark results, run artifacts, documentation, and release gates. The strongest claims point to multiple layers. For example, workspace inspection can be supported by package source, workspace tests, doctor output, and an eval scenario that requires file reading.

When writing a capability claim, ask four questions. What behavior is being claimed? Where is it implemented? How is it tested? What artifact proves it in a real run?

Do not overclaim. If a capability only passes synthetic benchmark, say that it validates harness logic. If it passes mock runtime, say that it validates runtime plumbing. If it passes real-model evaluation across multiple runs, then you can make a stronger statement about Agent performance.

Capability-backed claims create trust. They also protect the project. When a claim has evidence, regressions become visible. When a claim is only prose, the project can drift without anyone noticing.

---

## 27. Ten things beginners misunderstand most often

First, beginners think a benchmark score always means model capability. It does not. Mode matters. Synthetic, mock, and real-model runs prove different things.

Second, they think tool calling is optional decoration. In a coding Agent, tools are the action layer. Without tools, the model only writes text.

Third, they think a bigger context is always better. Too much context can hide important information and waste tokens.

Fourth, they think memory is always reliable. Memory is useful, but current source code wins when they conflict.

Fifth, they think approvals are a nuisance. Approvals are a safety boundary, especially for local file and command execution.

Sixth, they think real-model failure means the model is weak. Sometimes it does. But failures can also come from profile configuration, prompt design, tool contracts, eval design, or environment problems.

Seventh, they think final prose is evidence. It is not. Tests, commands, diffs, tool events, and artifacts are evidence.

Eighth, they think adding subagents automatically improves results. Subagents help only when tasks are bounded and responsibility is clear.

Ninth, they think documentation is separate from engineering quality. In a verification-native project, docs teach readers how to reproduce and verify behavior.

Tenth, they think release is only publishing code. A release should include security checks, eval results, benchmark artifacts, docs, and honest capability statements.

---

## 28. Maintaining long-term Benchmark history

A single benchmark run is useful, but long-term history is much more powerful. History lets you see whether the system is improving, regressing, or merely changing randomly.

To maintain history, every run should save stable metadata: timestamp, commit SHA, suite version, executor mode, model profile, provider, model id, scenario results, duration, cost, and failure categories. Store this in a machine-readable format such as JSON, then generate human-readable reports from it.

Baseline comparison is essential. A new run should be compared with the previous release, the current main branch, or a named baseline model. Without a baseline, a score is just a number.

Trend reports should separate categories. Harness regressions, runtime regressions, model-quality changes, provider failures, and eval-design changes should not be collapsed into one line. Otherwise the team may fix the wrong thing.

Dashboards are useful only after the data is stable. Do not start with a fancy dashboard if run artifacts are inconsistent. First save data reliably. Then build reports. Then build dashboards.

Longitudinal history is what turns Agent evaluation from a one-time demonstration into an engineering discipline.

---

## 29. Pre-release checklist

Before publishing a release, verify the basics:

```bash
npm run typecheck
npm test
npm run eval:smoke
npm run eval:benchmark
```

If the release claims real-model behavior, also run a real-model benchmark and save the report. Do not present synthetic benchmark results as proof of real model ability.

Check security. Ensure `.env` files, local storage, logs, traces, generated artifacts, and benchmark outputs with sensitive data are not staged. Ensure docs do not contain real keys. Ensure approval and safety tests still pass.

Check documentation. README should describe what the project actually supports. Security docs should explain boundaries. Release docs should explain gates. Tutorial docs should teach verification, not only installation.

Check packaging. Generated files, runtime caches, and local machine artifacts should not be published unless intentionally part of the release.

Check capability claims. Every important claim should point to code, tests, evals, artifacts, or release gates. Remove or soften claims that do not yet have evidence.

The release question is not "does it look impressive?" The release question is "can another developer reproduce the behavior and understand the remaining limits?"

---

## 30. Learning path for contributors

New contributors should not start by changing the hardest runtime logic. They should build familiarity through small, verifiable steps.

First, run the project locally and record the commands that pass. Second, read the project map and identify which package owns the area they want to change. Third, run the targeted tests for that package. Fourth, make a small change with a focused test. Fifth, update docs only if the behavior changed. Sixth, run typecheck and targeted verification before submission.

Good first contributions include improving error messages, adding missing doc links, adding a small eval fixture, strengthening a test, or clarifying a command in the tutorial. Good second contributions include adding a scoring field, improving a doctor check, or refining a tool contract.

Contributors should avoid broad rewrites. A local Agent runtime has many connected contracts. A change that looks small in one package can affect CLI behavior, eval scoring, and artifacts. Surgical changes are safer.

Every contribution should answer: what changed, why, how it was verified, and what risk remains. That habit matches Omni Agent's verification-native design.

---

## 31. Source reading route: where to start the first time you read the code

The first reading path should follow execution order, not directory order. Start with `apps/cli` because it shows how the user enters the system. Find the `run` command. Look at how arguments are parsed and how runtime options are constructed.

Then move to `packages/core-runtime`. Read the task execution function. Identify where it loads workspace context, selects the model, builds prompts, handles tool calls, runs verification, and records the result.

Next read `packages/model-client`. Understand how provider requests are formed and responses are normalized. Pay attention to streaming, tool calls, usage data, and errors.

Then read `packages/tools` and `packages/workspace` together. Tools define what actions exist. Workspace defines what local data and command behavior those tools can access.

After that, read `packages/session-store`. Look for how runs, sessions, memory, routes, and automations are persisted. This explains how evidence survives beyond one terminal output.

Finally, read `packages/evals` and `examples/evals`. This shows how capabilities are turned into scenarios and scores.

Do not try to understand every file on the first pass. Build a call-chain map first. Details become easier once the main path is clear.

---

## 32. Command handbook: turn common commands into stable workflows

Commands become useful when they are grouped into workflows. Here are the common workflows.

Local health:

```bash
npm install
npm run typecheck
npm run dev -- models
npm run dev -- doctor --cwd "."
```

Minimal task:

```bash
npm run dev -- run --cwd "." --task "Summarize this repository"
```

Targeted tests:

```bash
node ./scripts/run-tests.mjs tests/safety.test.ts
node ./scripts/run-tests.mjs tests/approvals.test.ts
```

Eval smoke:

```bash
npm run eval:smoke
```

Benchmark:

```bash
npm run eval:benchmark
```

Real-model mode should add the correct model profile and environment variables. Keep the key outside the repository:

```powershell
$env:DEEPSEEK_API_KEY="your_key_here"
```

Then run doctor with the real mode and profile before running a benchmark:

```bash
npm run dev -- doctor --cwd "." --mode openai --model-profile deepseek-flash
```

The pattern is always the same: first verify local health, then verify configuration, then run a small task, then run a larger eval or benchmark.

---

## 33. Prompt and Tool Contract: teach the model how to act

Prompting in an Agent runtime is not only about tone or clever wording. It is an action contract. The prompt should tell the model what task it is solving, what boundaries apply, which tools exist, when to use them, how to verify, and how to summarize.

A weak prompt says: "Fix the bug." A stronger prompt says: "Inspect the repository, identify the failing parser path, make the smallest necessary change, run the targeted test or typecheck, and report changed files plus verification results."

Tool descriptions should be precise. If a tool reads files, say what path rules apply. If a tool runs commands, say how working directory and timeout are chosen. If a tool writes files, say whether it can create new files and how conflicts are handled.

The prompt should also teach restraint. The model should not invent verification results. It should not claim tests passed unless a tool result says so. It should not edit unrelated files. It should stop when approval is required.

A good tool contract makes evals easier. If the model is expected to call a verification tool, the eval can check that event. If tool output has stable fields, scorers can inspect it. If tool names are vague, evals become fragile.

Prompt and tool contract should be designed together. The prompt tells the model how to behave. The tools define what behavior is possible. The runtime enforces the boundary.

---

## 34. Security threat model: what a local Agent must defend against

A local coding Agent faces several threat categories.

The first is path traversal. A model or malicious file content may try to access files outside the workspace. Tools must normalize and check paths.

The second is destructive command execution. Commands such as recursive deletion, permission changes, or untrusted scripts can destroy user data. Approval policy and command-risk detection should block or require confirmation.

The third is secret exposure. The Agent may read files, logs, environment names, or tool output that contain sensitive values. Secret patterns should be redacted and real keys should not enter artifacts.

The fourth is prompt injection. Repository files can contain instructions that try to override the system. The runtime must distinguish trusted instruction files from untrusted project data.

The fifth is external data transfer. Provider calls, uploads, webhooks, messages, and route outputs may send information outside the local machine. The system should make these boundaries explicit.

The sixth is artifact leakage. Benchmark traces and run logs are useful, but they can accidentally contain paths, snippets, or secrets. Release processes should check what is being published.

Threat modeling does not mean making the Agent unusable. It means deciding which actions are automatic, which require approval, and which are never allowed. The system should be useful inside clear boundaries.

---

## 35. Operations handbook: daily maintenance, troubleshooting, and upgrades

Daily operation starts with health checks. Run typecheck when code changes. Run doctor when configuration or environment changes. Run smoke eval after eval-related changes. Run benchmark before making benchmark claims.

When troubleshooting, isolate layers. If CLI does not start, inspect dependencies and scripts. If doctor fails, inspect configuration and workspace state. If model calls fail, inspect profile and environment variables. If tools fail, inspect tool arguments and approval policy. If evals fail, inspect manifest and observed run.

When upgrading dependencies, avoid changing behavior and dependencies in one large commit. Run typecheck and targeted tests after the upgrade. If a provider SDK changes request or response shape, update model-client tests.

When changing model profiles, record the profile id and model id in artifacts. If you compare benchmark results, make sure the provider and model are actually the same.

When maintaining docs, update them when behavior changes. Do not let tutorials drift away from commands that actually work. Documentation should be treated as part of the product surface.

When maintaining evals, keep fixtures stable. If you change a fixture, record why. If you change scoring, compare old and new behavior so historical trends remain understandable.

---

## 36. FAQ: infer causes from error symptoms

**`models` shows no usable profile.** Check whether setup ran, whether the profile id is correct, whether `api-key-env` names an existing environment variable, and whether the storage root is the one the CLI is reading.

**`doctor` warns about workspace.** Check `--cwd`, path spelling, permissions, and whether the directory exists. On Windows, quote paths that contain spaces.

**Real-model mode fails immediately.** Check base URL, model id, key environment variable, provider availability, and whether the provider expects OpenAI-compatible request shape.

**The model never calls tools.** Check whether the selected model supports tool calling, whether the profile says tools are supported, whether the prompt includes tool descriptions, and whether the task requires action.

**The final answer says tests passed, but no verification ran.** Treat the final answer as unverified. Fix the prompt or eval so verification tool events are required.

**Synthetic benchmark passes but real benchmark fails.** This usually means the harness works but the real model-runtime behavior needs improvement. Inspect traces before blaming one layer.

**Mock mode passes but openai mode fails.** Check provider configuration, model tool support, prompt compatibility, iteration limits, and provider-specific response parsing.

**A scenario fails even though the output looks correct.** Inspect the scorer. It may be checking for an exact file, snippet, or tool event that the run did not produce.

**A command works manually but fails in the Agent.** Compare working directory, environment variables, shell, timeout, and approval policy.

---

## 37. Appendix A: classroom-style study plan

Day 1: install dependencies, run typecheck, run models, run doctor, and run one mock task. The teaching goal is to show that an Agent is an executable system, not only a model.

Day 2: read the project map. Open each top-level app and package. Ask students to write one sentence describing the responsibility of each module.

Day 3: trace the runtime loop. Start from the CLI command and follow the call path into core runtime. Draw the sequence from user task to final artifact.

Day 4: study tools and approvals. Show why the model cannot directly act. Run safety or approval tests. Discuss the difference between low-risk, medium-risk, and high-risk actions.

Day 5: study context and memory. Compare current source files with memory notes. Discuss why stale memory must not override current code.

Day 6: study evals. Read a manifest and fixture. Run smoke eval. Explain observed runs and scoring.

Day 7: study benchmark modes. Run or inspect synthetic, mock, and real-model paths. Discuss what each mode proves and what it does not prove.

Day 8: connect a real model in a safe profile. Run doctor before using it. Run a small real task and inspect artifacts.

Day 9: implement a small feature with a focused test. Require a verification summary.

Day 10: review a failure trace and write a root-cause report.

---

## 38. Appendix B: ten progressive exercises

1. Run `npm run dev -- models` and explain every field that appears.

2. Run `npm run dev -- doctor --cwd "."` and map each diagnostic to the package that likely produced it.

3. Run a mock task and identify where the run result is saved.

4. Read one eval scenario and explain the fixture, expected behavior, scoring rule, and failure message.

5. Add one harmless documentation-only eval scenario and run smoke eval.

6. Add or improve one targeted test for approval or safety behavior.

7. Create a model profile that references an environment variable without storing the secret in the repository.

8. Run a small real-model task and record model profile, duration, tools used, and verification result.

9. Pick one failed run and categorize the root cause.

10. Write a capability-backed claim that points to source, test, eval, and artifact evidence.

---

## 39. Appendix C: reader self-check

You understand the basics if you can answer these questions without looking at the tutorial.

What is the difference between a model and a runtime? What does workspace mean? Why is a model profile better than hardcoding a provider? Why does the model need tool calls? What does approval policy protect? Why is memory less authoritative than current source code? What should a run artifact contain? What does synthetic benchmark prove? What does mock mode prove? What does openai mode prove? Why is final prose not enough evidence?

You understand the engineering workflow if you can perform these actions.

Run local health checks. Trace a CLI command into runtime. Identify which package owns a behavior. Read an eval manifest. Explain a benchmark result by mode. Connect a real model without committing secrets. Review a failed trace. Write a small feature with a focused test. Produce a final summary that includes verification and risk.

If any of these tasks feel vague, return to the corresponding chapter and run the commands again.

---

## 40. Appendix D: how instructors can teach this tutorial

Teach Omni Agent as an engineering system. Do not begin with "look how smart the model is." Begin with the problem: a model that writes text is not enough for repository work. The system needs tools, workspace, approvals, memory, artifacts, evals, and release gates.

Use live commands whenever possible. Show `models`, `doctor`, one mock run, and one eval smoke run. Then connect each output to source code. Students learn faster when they can see the loop between command, code, and artifact.

When teaching benchmark results, always ask what the executor mode is. If a student says "the benchmark score is high," ask whether it is synthetic, mock, or real-model. This habit prevents the most common overclaim.

When teaching security, use concrete examples. Show why path traversal matters. Show why secrets should stay in environment variables. Show why third-party files cannot become trusted instructions.

When teaching contribution, insist on small changes and verification. A student should be able to explain every changed line, every command run, and every remaining risk.

---

## 41. Appendix E: a complete case from problem discovery to submission

Imagine you discover that an eval scenario passes in synthetic mode but fails in real-model mode. The wrong response is "the model is bad." The right response is to review the trace.

First, confirm the harness. Run the synthetic benchmark. If it passes, the manifest and scorer probably work at the basic level. If it fails, fix the eval framework before testing models.

Second, run mock mode. If mock mode passes, the runtime path is at least capable of producing the expected observed run. If mock mode fails, inspect CLI/runtime/tool plumbing.

Third, run the real-model scenario with trace enabled. Record model profile, provider, model id, iteration limit, tool support, and failure reason.

Fourth, inspect the trace. Did the model read the right files? Did it call required tools? Did it run verification? Did it stop too early? Did approval block an action? Did the scorer expect a snippet that the model did not produce?

Fifth, categorize the root cause. If the model did not know tools existed, improve prompt or tool descriptions. If it called the wrong path, improve workspace context. If it ran out of iterations, adjust task design or iteration limit. If scoring was too strict, update the scorer with a better deterministic or heuristic rule.

Sixth, make a small change. Do not rewrite the whole runtime. Change the layer that the trace identified.

Seventh, verify. Run the targeted scenario, smoke eval, and typecheck. Record the result.

Eighth, submit with evidence. The final note should include the failure, root cause, changed files, verification commands, and remaining risk.

This case shows the core Omni Agent discipline: observe, classify, fix the right layer, verify, and record.

---

## 42. Appendix F: how to use this tutorial as a long-term handbook

This tutorial is not only for first-time setup. Use it as a handbook when changing the system.

When changing CLI behavior, return to the runtime-loop chapter and the command handbook. Ensure arguments still map cleanly into runtime options.

When changing provider behavior, return to the model-profile chapter. Ensure secrets remain in environment variables and artifacts record the selected profile.

When changing tools, return to the tools chapter and prompt-contract chapter. Ensure tool names, schemas, outputs, and failure modes remain stable.

When changing safety behavior, return to approval policy and threat model chapters. Ensure tests cover the boundary.

When changing evals, return to eval-scenario and benchmark-report chapters. Ensure scenarios are scoreable and failure messages are useful.

When preparing a release, return to pre-release checklist and capability-claim chapters. Ensure claims are evidence-backed.

The handbook mindset prevents drift. Every change should strengthen the loop: build, verify, remember.

---

## 43. Appendix G: a complete teaching script

"Today we are not learning a chatbot. We are learning a local coding Agent runtime. The difference matters. A chatbot answers. A runtime acts under rules, records evidence, and can be evaluated."

"First, we prove the local system works. Run install, typecheck, models, doctor, and one mock task. If this layer fails, a remote model will only make debugging harder."

"Second, we map the repository. The CLI is the entrypoint. Core runtime is the execution loop. Model client speaks to providers. Tools define actions. Workspace defines the worksite. Session store saves evidence. Evals turn behavior into scores."

"Third, we follow one task. A user command becomes runtime options. Runtime loads workspace and memory. It builds a prompt. The model returns either text or tool calls. Runtime executes tools through approval policy. Verification runs. The artifact records what happened."

"Fourth, we discuss benchmark modes. Synthetic proves the harness. Mock proves runtime plumbing. Openai mode tests real provider behavior. Never mix these meanings."

"Fifth, we connect a real model safely. The key is in an environment variable. The profile stores metadata. Doctor checks configuration before benchmark work."

"Sixth, we review failure. A failed run is not an embarrassment. It is data. We identify the layer, fix the right contract, and run verification again."

"Finally, we make capability claims only with evidence. If we say the Agent can do something, we point to source, tests, evals, artifacts, or release gates. That is what verification-native means."

---

## 44. Appendix H: whole-book summary and action checklist

Omni Agent is a local-first coding Agent runtime. Its job is to turn model reasoning into controlled, observable, verifiable engineering action.

The runtime matters because the model alone cannot read files, run commands, apply approvals, remember sessions, or score itself. The runtime supplies tools, workspace boundaries, model profiles, context, memory, artifacts, evals, gateway surfaces, and automation.

Verification matters because a final answer is not proof. Proof comes from tests, typecheck, evals, tool events, verification commands, diffs, traces, and saved artifacts.

Benchmark mode matters because different modes prove different layers. Synthetic mode proves harness and scoring. Mock mode proves runtime plumbing. Openai mode tests real model behavior through an OpenAI-compatible provider path.

Security matters because local Agents touch real files and commands. Secrets must stay out of repositories and logs. Paths must remain inside workspace boundaries. Destructive actions need approvals. Prompt injection must be treated as a real risk.

Your action checklist:

1. Run local health checks.
2. Understand the project map.
3. Trace one CLI command through runtime.
4. Learn tool and approval contracts.
5. Use memory carefully and verify current files.
6. Read eval manifests before trusting benchmark scores.
7. Separate synthetic, mock, and real-model results.
8. Save traces, cost, duration, and failure reasons for real benchmarks.
9. Make capability claims only with evidence.
10. Keep every change small, verified, and reviewable.

---

## 45. Glossary

**Agent**: A system that uses a model plus tools, memory, runtime rules, and verification to act on tasks.

**Runtime**: The execution system around the model. It handles context, tools, approvals, failures, verification, and artifacts.

**Workspace**: The local project directory where the Agent operates, including files, Git state, instructions, and command boundaries.

**Model profile**: A named provider configuration that records protocol, base URL, model id, key environment variable name, and capability flags.

**Tool**: A structured runtime action that the model may request and the runtime may execute.

**Tool contract**: The name, schema, behavior, output, failure mode, and audit expectations of a tool.

**Approval policy**: Rules deciding whether an action is allowed, blocked, or requires human confirmation.

**Context**: The information sent to the model for a specific call.

**Memory**: Useful information saved across tasks, always subordinate to current source code.

**Session**: A persistent conversation or task thread.

**Run artifact**: Evidence recorded for one execution, including inputs, model profile, tool events, verification, duration, and result.

**Eval manifest**: The file that defines scenarios, fixtures, expected behavior, and scoring rules.

**Observed run**: The recorded behavior of an Agent run used by the scorer.

**Synthetic benchmark**: A benchmark that constructs observed runs without a real model.

**Mock benchmark**: A benchmark that exercises runtime plumbing without remote model calls.

**OpenAI-compatible benchmark**: A real-model benchmark path using an OpenAI-style provider protocol.

**Capability-backed claim**: A capability statement supported by source, tests, evals, artifacts, or release gates.

**Verification-native**: A design style where verification is part of the normal runtime and release workflow, not an afterthought.

**Build. Verify. Remember.**: A compact summary of the system philosophy: make changes, prove them, and preserve the evidence that matters.

---

## Conclusion

If you read Omni Agent only as a wrapper around a model, you will miss the project. The important part is the runtime discipline. The system gives the model a workspace, tools, approval boundaries, context, memory, artifacts, evals, and benchmark paths. Those parts together decide whether an Agent can work in real repositories.

The practical lesson is simple. Do not trust a claim without evidence. Do not trust a benchmark without knowing the mode. Do not trust memory over current files. Do not trust final prose without verification. Build the loop, verify the loop, and remember the evidence.
