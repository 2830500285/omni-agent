export type CommandRiskKind = "readonly" | "mutating" | "destructive" | "privileged" | "network_exec" | "unknown";

export interface CommandRiskAssessment {
  readonly kind: CommandRiskKind;
  readonly riskTier: 0 | 1 | 2 | 3;
  readonly mutating: boolean;
  readonly prefix: string | null;
  readonly ruleId: string;
  readonly reasons: readonly string[];
}

const DANGEROUS_COMMAND_RULES: Array<{ readonly id: string; readonly pattern: RegExp; readonly reason: string; readonly kind: CommandRiskKind }> = [
  {
    id: "git.reset_hard",
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "Command would discard local repository changes.",
    kind: "destructive",
  },
  {
    id: "git.checkout_path",
    pattern: /\bgit\s+checkout\s+--\b/i,
    reason: "Command would overwrite tracked files from git.",
    kind: "destructive",
  },
  {
    id: "git.clean_force",
    pattern: /\bgit\s+clean\b[^|;&\n\r]*\s-f/i,
    reason: "Command would delete untracked files from the repository.",
    kind: "destructive",
  },
  {
    id: "fs.rm_recursive_force",
    pattern: /\brm\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|(?=[^|;&\n\r]*-r\b)(?=[^|;&\n\r]*-f\b)[^|;&\n\r]*)/i,
    reason: "Command would recursively force-delete files.",
    kind: "destructive",
  },
  {
    id: "powershell.alias_remove_item_recurse",
    pattern: /\b(?:rm|ri|del|erase|rd|rmdir)\b[^|;&\n\r]*(?:^|\s)-(?:r|re|rec|recu|recur|recurs|recurse)\b/i,
    reason: "Command would recursively delete files through a PowerShell Remove-Item alias.",
    kind: "destructive",
  },
  {
    id: "powershell.remove_item_recurse",
    pattern: /\bremove-item\b[^|;&\n\r]*(?:^|\s)-(?:r|re|rec|recu|recur|recurs|recurse)\b/i,
    reason: "Command would recursively delete files through PowerShell.",
    kind: "destructive",
  },
  {
    id: "cmd.del_force",
    pattern: /\b(?:del|erase)\b[^|;&\n\r]*\/[a-z]*f[a-z]*\b/i,
    reason: "Command would force-delete files through cmd.exe.",
    kind: "destructive",
  },
  {
    id: "cmd.del_recursive",
    pattern: /\b(?:del|erase)\b[^|;&\n\r]*\/[a-z]*s[a-z]*\b/i,
    reason: "Command would recursively delete files through cmd.exe.",
    kind: "destructive",
  },
  {
    id: "cmd.rmdir_recursive",
    pattern: /\b(?:rd|rmdir)\b[^|;&\n\r]*\/s\b/i,
    reason: "Command would recursively delete a directory through cmd.exe.",
    kind: "destructive",
  },
  {
    id: "system.format_disk",
    pattern: /\bformat\b/i,
    reason: "Command appears to target disk formatting.",
    kind: "destructive",
  },
  {
    id: "system.shutdown",
    pattern: /\bshutdown\b|\breboot\b/i,
    reason: "Command would stop or restart the machine.",
    kind: "destructive",
  },
  {
    id: "process.elevated_privileges",
    pattern: /\b(?:sudo|runas|Start-Process\b[^|;&\n\r]*\b-Verb\s+RunAs|set-executionpolicy)\b/i,
    reason: "Command requests elevated privileges.",
    kind: "privileged",
  },
  {
    id: "permissions.broad_chmod",
    pattern: /\bchmod\b[^|;&\n\r]*\b(?:777|a\+w|ugo\+w)\b/i,
    reason: "Command broadly relaxes file permissions.",
    kind: "privileged",
  },
  {
    id: "permissions.broad_windows_acl",
    pattern: /\bicacls\b[^|;&\n\r]*\bgrant\b[^|;&\n\r]*(?:everyone|users):/i,
    reason: "Command broadly grants Windows file permissions.",
    kind: "privileged",
  },
  {
    id: "powershell.pipeline_remove_item",
    pattern: /\|[\s\S]*\b(?:remove-item|rm|ri|del|erase|rd|rmdir)\b/i,
    reason: "Command pipes paths into PowerShell Remove-Item.",
    kind: "destructive",
  },
  {
    id: "network.download_execute",
    pattern: /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[\s\S]*\|\s*(?:sh|bash|zsh|pwsh|powershell|iex|invoke-expression)\b/i,
    reason: "Command downloads content from the network and executes it.",
    kind: "network_exec",
  },
  {
    id: "powershell.encoded_command",
    pattern: /\b(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b[\s\S]*\s-(?:e|ec|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)\b/i,
    reason: "PowerShell EncodedCommand is opaque and requires elevated review.",
    kind: "destructive",
  },
];

const MUTATING_COMMAND_RULES: Array<{ readonly id: string; readonly pattern: RegExp; readonly reason: string }> = [
  { id: "deps.npm_mutation", pattern: /\bnpm\s+(?:install|i|add|remove|uninstall|update)\b/i, reason: "npm command can change dependencies or lockfiles." },
  { id: "deps.pnpm_mutation", pattern: /\bpnpm\s+(?:install|add|remove|update)\b/i, reason: "pnpm command can change dependencies or lockfiles." },
  { id: "deps.yarn_mutation", pattern: /\byarn\s+(?:add|remove|install|upgrade)\b/i, reason: "yarn command can change dependencies or lockfiles." },
  { id: "deps.pip_install", pattern: /\bpip\s+install\b/i, reason: "pip install can change the Python environment." },
  { id: "git.state_mutation", pattern: /\bgit\s+(?:add|commit|merge|rebase|checkout|switch|restore|apply|am|stash|pull|push)\b/i, reason: "git command can change repository state." },
  { id: "fs.write_or_move", pattern: /\b(?:mkdir|touch|cp|mv|copy|move|ren|rename|new-item|set-content|add-content)\b/i, reason: "Command can write or move files." },
  { id: "fs.redirect_output", pattern: /(?:^|[^>])>{1,2}(?!>)/, reason: "Command redirects output to a file." },
];

const READONLY_PREFIX_RULES: Array<{ readonly id: string; readonly pattern: RegExp; readonly prefix: string; readonly reason: string }> = [
  { id: "git.inspect", pattern: /^\s*git\s+(?:status|diff|log|show|branch|rev-parse)\b/i, prefix: "git", reason: "git inspection command." },
  { id: "npm.verify_script", pattern: /^\s*npm\s+(?:(?:run\s+)?(?:test|typecheck|lint|build)|t)\b/i, prefix: "npm", reason: "npm script is verification-oriented." },
  { id: "node.verify", pattern: /^\s*node\s+(?:--test\b|-e\b)/i, prefix: "node", reason: "node command is verification-oriented." },
  { id: "python.verify", pattern: /^\s*(?:python|py)\s+(?:-m\s+(?:pytest|unittest|compileall)\b|-c\b)/i, prefix: "python", reason: "python command is verification-oriented." },
  { id: "fs.inspect", pattern: /^\s*(?:rg|grep|findstr|ls|dir|cat|type|Get-ChildItem|Get-Content|Select-String)\b/i, prefix: "read", reason: "read-only inspection command." },
];

export function analyzeCommandRisk(command: string, options: { readonly verification?: boolean } = {}): CommandRiskAssessment {
  const trimmed = command.trim();
  if (!trimmed) {
    return buildCommandAssessment("unknown", null, "command.empty", ["Command is empty."]);
  }

  const wrappedCommand = extractShellWrappedCommand(trimmed);
  const wrapperReasons: string[] = [];
  const commandToInspect = wrappedCommand ? unwrapShellArgument(wrappedCommand) : trimmed;
  if (wrappedCommand) {
    wrapperReasons.push("Command runs through a shell wrapper, so arguments require stricter review.");
  }

  for (const rule of DANGEROUS_COMMAND_RULES) {
    if (rule.pattern.test(commandToInspect) || rule.pattern.test(trimmed)) {
      return buildCommandAssessment(rule.kind, extractCommandPrefix(trimmed), rule.id, [...wrapperReasons, rule.reason]);
    }
  }

  const compoundReason = describeCompoundCommand(commandToInspect);
  const readonlyRule = READONLY_PREFIX_RULES.find((rule) => rule.pattern.test(commandToInspect));
  const mutatingRule = MUTATING_COMMAND_RULES.find((rule) => rule.pattern.test(commandToInspect));

  if (mutatingRule) {
    const kind: CommandRiskKind = options.verification && !compoundReason && !wrappedCommand ? "readonly" : "mutating";
    return buildCommandAssessment(kind, extractCommandPrefix(commandToInspect), mutatingRule.id, [
      ...wrapperReasons,
      mutatingRule.reason,
      ...(options.verification && kind === "readonly" ? ["Verification mode lowers non-destructive mutation risk."] : []),
      ...(compoundReason ? [compoundReason] : []),
    ]);
  }

  if (compoundReason) {
    return buildCommandAssessment("unknown", extractCommandPrefix(commandToInspect), "command.compound", [...wrapperReasons, compoundReason]);
  }

  if (readonlyRule) {
    return buildCommandAssessment("readonly", readonlyRule.prefix, readonlyRule.id, [...wrapperReasons, readonlyRule.reason]);
  }

  if (wrappedCommand) {
    return buildCommandAssessment("unknown", extractCommandPrefix(commandToInspect), "shell.wrapper_unknown", wrapperReasons);
  }

  return buildCommandAssessment(
    options.verification ? "readonly" : "unknown",
    extractCommandPrefix(commandToInspect),
    options.verification ? "verification.default" : "command.unknown_prefix",
    [options.verification ? "Verification command is treated as validation-oriented unless a dangerous pattern is detected." : "Command prefix is not recognized."],
  );
}

function buildCommandAssessment(
  kind: CommandRiskKind,
  prefix: string | null,
  ruleId: string,
  reasons: readonly string[],
): CommandRiskAssessment {
  return {
    kind,
    prefix,
    ruleId,
    riskTier: commandRiskTier(kind),
    mutating: kind === "mutating" || kind === "destructive" || kind === "privileged" || kind === "network_exec",
    reasons,
  };
}

function commandRiskTier(kind: CommandRiskKind): 0 | 1 | 2 | 3 {
  switch (kind) {
    case "readonly":
      return 1;
    case "mutating":
    case "unknown":
      return 2;
    case "destructive":
    case "privileged":
    case "network_exec":
      return 3;
  }
}

function describeCompoundCommand(command: string): string | null {
  if (/[|;&]/.test(command)) {
    return "Command contains a pipe, command separator, or background operator.";
  }
  if (/\$\(|`/.test(command)) {
    return "Command contains command substitution.";
  }
  return null;
}

function extractCommandPrefix(command: string): string | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return tokens.length > 0 ? tokens.join(" ") : null;
}

function extractShellWrappedCommand(command: string): string | null {
  const match = command.match(/^\s*(sh|bash|zsh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)\b\s+([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  const shell = String(match[1] ?? "").toLowerCase();
  const args = String(match[2] ?? "").trim();
  if (shell === "cmd" || shell === "cmd.exe") {
    const commandMatch = args.match(/(?:^|\s)\/c\s+([\s\S]+)$/i);
    return commandMatch ? commandMatch[1] ?? "" : null;
  }
  if (shell === "powershell" || shell === "powershell.exe" || shell === "pwsh" || shell === "pwsh.exe") {
    const commandMatch = args.match(/(?:^|\s)(?:-command|-c)\s+([\s\S]+)$/i);
    if (commandMatch) {
      return commandMatch[1] ?? "";
    }
    const encodedMatch = args.match(/(?:^|\s)-(?:e|ec|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)\s+([A-Za-z0-9+/=]+)/i);
    if (!encodedMatch) {
      return null;
    }
    try {
      return Buffer.from(encodedMatch[1] ?? "", "base64").toString("utf16le");
    } catch {
      return null;
    }
  }

  const commandMatch = args.match(/(?:^|\s)-[a-z]*c[a-z]*\s+([\s\S]+)$/i);
  return commandMatch ? commandMatch[1] ?? "" : null;
}

function unwrapShellArgument(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
