# Verification-Native Agent Runtime

Verification-native completion means a task is not considered complete just because the final response says it is done. The eval trace must include passed verification evidence that can be replayed or inspected.

## Contract

- `verificationPolicy.completionRequiresEvidence` turns the rule on for a suite.
- `verificationPolicy.minimumEvidenceCount` sets the minimum number of passed evidence records.
- `verificationPolicy.requiredEvidenceKinds` declares the evidence kinds that must be present.
- `expectation.requiredVerificationEvidenceKinds` can tighten a single step.

Supported evidence kinds are:

- `command`: a passed verification command or successful `run_verification` tool event.
- `test`: a named test result.
- `artifact`: a generated file, report, screenshot, or other inspectable artifact.
- `trace`: a persisted trace span or run summary that proves the check happened.

The harness currently derives `command` evidence from a successful `run_verification` tool event and also accepts explicit `verificationEvidence` records on observed runs. A passed `verificationStatus` without evidence fails when the policy is enabled.

## Fixture

`examples/evals/verification-native-runtime.json` is the minimal reproducible fixture. It enables the policy and requires command evidence for `verification.native_completion_evidence`.

Use the default suite scenario `verification.native_completion_evidence` to keep this contract visible in the benchmark matrix without changing unrelated scenarios.
