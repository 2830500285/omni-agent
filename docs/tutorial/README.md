# Omni Agent Tutorials

This directory contains the book-style tutorial for learning Omni Agent from the
repository itself. The goal is to teach both the ideas and the operational
methods: what each term means, where the implementation lives, which command to
run, what output to expect, and how to decide whether a result is real evidence
or only a local smoke check.

- [English tutorial](README.en.md)
- [Chinese tutorial](README.zh.md)

The two tutorials follow the same structure so readers can switch languages
without losing their place.

Recommended path:

1. Quickstart: install dependencies, run the CLI, and learn the basic command
   surface.
2. Project map: connect every major concept to a directory in the repository.
3. Runtime loop: trace a task through context, model selection, tools,
   approvals, verification, and storage.
4. Model profiles: configure real providers without committing secrets.
5. Tools and approvals: understand what the model can ask for and what the
   system must gate.
6. Context and memory: learn how useful memory is loaded, compressed, and
   prevented from overriding current source.
7. Subagents: treat delegation as governed work with ownership, budget, and
   evidence.
8. Gateway and workbench: expose the runtime as an inspectable local service.
9. Eval harness: distinguish synthetic harness regression from real model
   performance.
10. Real-model benchmarks: save traces, cost, duration, failures, and
    verification output.
11. Security and operations: keep claims, releases, and public artifacts tied
    to reproducible evidence.
