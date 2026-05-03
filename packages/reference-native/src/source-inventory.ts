export type ReferenceSourceInventorySource = "claudecode" | "hermes" | "openclaw";

export interface ReferenceSourceInventoryEntry {
  readonly source: ReferenceSourceInventorySource;
  readonly projectSegment: string | null;
  readonly sourcePath: string;
  readonly resolvedPath: string;
  readonly kind: "file" | "directory";
  readonly sizeBytes: number;
  readonly sha256: string | null;
  readonly fileCount: number | null;
  readonly jsonKeys?: readonly string[];
}

export const referenceSourceInventory = [
  {
    "source": "claudecode",
    "projectSegment": "claude-code-main",
    "sourcePath": "app/server.ts",
    "resolvedPath": "claude-code-main/app/server.ts",
    "kind": "file",
    "sizeBytes": 169615,
    "sha256": "dc089d87234c00e103fedb75a752ce42548b79e0f3d777eeb1f5029851428b95",
    "fileCount": null
  },
  {
    "source": "claudecode",
    "projectSegment": "claude-code-main",
    "sourcePath": "desktop-builder/main.mjs",
    "resolvedPath": "claude-code-main/desktop-builder/main.mjs",
    "kind": "file",
    "sizeBytes": 7157,
    "sha256": "398ad8beda97e9b9f8448a2e943619efcbcf859f197f061ac35326b1f6b5683d",
    "fileCount": null
  },
  {
    "source": "claudecode",
    "projectSegment": "claude-code-main",
    "sourcePath": "src/context",
    "resolvedPath": "claude-code-main/src/context",
    "kind": "directory",
    "sizeBytes": 29806,
    "sha256": null,
    "fileCount": 10
  },
  {
    "source": "claudecode",
    "projectSegment": "claude-code-main",
    "sourcePath": "src/coordinator",
    "resolvedPath": "claude-code-main/src/coordinator",
    "kind": "directory",
    "sizeBytes": 19244,
    "sha256": null,
    "fileCount": 2
  },
  {
    "source": "claudecode",
    "projectSegment": "claude-code-main",
    "sourcePath": "src/entrypoints/cli.tsx",
    "resolvedPath": "claude-code-main/src/entrypoints/cli.tsx",
    "kind": "file",
    "sizeBytes": 13436,
    "sha256": "69324bc17bb601fff51e6d3590539b288919176f03dfb6bddce925a37b6e34f7",
    "fileCount": null
  },
  {
    "source": "claudecode",
    "projectSegment": "claude-code-main",
    "sourcePath": "src/memdir",
    "resolvedPath": "claude-code-main/src/memdir",
    "kind": "directory",
    "sizeBytes": 83190,
    "sha256": null,
    "fileCount": 9
  },
  {
    "source": "claudecode",
    "projectSegment": "claude-code-main",
    "sourcePath": "src/plugins",
    "resolvedPath": "claude-code-main/src/plugins",
    "kind": "directory",
    "sizeBytes": 5823,
    "sha256": null,
    "fileCount": 2
  },
  {
    "source": "claudecode",
    "projectSegment": "claude-code-main",
    "sourcePath": "src/services/lsp",
    "resolvedPath": "claude-code-main/src/services/lsp",
    "kind": "directory",
    "sizeBytes": 80860,
    "sha256": null,
    "fileCount": 8
  },
  {
    "source": "claudecode",
    "projectSegment": "claude-code-main",
    "sourcePath": "src/skills",
    "resolvedPath": "claude-code-main/src/skills",
    "kind": "directory",
    "sizeBytes": 151025,
    "sha256": null,
    "fileCount": 27
  },
  {
    "source": "claudecode",
    "projectSegment": "claude-code-main",
    "sourcePath": "src/tools",
    "resolvedPath": "claude-code-main/src/tools",
    "kind": "directory",
    "sizeBytes": 1846159,
    "sha256": null,
    "fileCount": 285
  },
  {
    "source": "claudecode",
    "projectSegment": "claw-code-main",
    "sourcePath": "src/coordinator",
    "resolvedPath": "claw-code-main/src/coordinator",
    "kind": "directory",
    "sizeBytes": 631,
    "sha256": null,
    "fileCount": 1
  },
  {
    "source": "claudecode",
    "projectSegment": "claw-code-main",
    "sourcePath": "src/memdir",
    "resolvedPath": "claw-code-main/src/memdir",
    "kind": "directory",
    "sizeBytes": 621,
    "sha256": null,
    "fileCount": 1
  },
  {
    "source": "claudecode",
    "projectSegment": "claw-code-main",
    "sourcePath": "src/plugins",
    "resolvedPath": "claw-code-main/src/plugins",
    "kind": "directory",
    "sizeBytes": 623,
    "sha256": null,
    "fileCount": 1
  },
  {
    "source": "claudecode",
    "projectSegment": "claw-code-main",
    "sourcePath": "src/skills",
    "resolvedPath": "claw-code-main/src/skills",
    "kind": "directory",
    "sizeBytes": 621,
    "sha256": null,
    "fileCount": 1
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "acp_adapter",
    "resolvedPath": "acp_adapter",
    "kind": "directory",
    "sizeBytes": 86437,
    "sha256": null,
    "fileCount": 9
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "agent",
    "resolvedPath": "agent",
    "kind": "directory",
    "sizeBytes": 1100787,
    "sha256": null,
    "fileCount": 50
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "agent/context_compressor.py",
    "resolvedPath": "agent/context_compressor.py",
    "kind": "file",
    "sizeBytes": 59936,
    "sha256": "e3d13194d7bdab01c41250d23be2fa33b3cd573822892a58798642ded210e845",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools",
    "resolvedPath": "tools",
    "kind": "directory",
    "sizeBytes": 2638792,
    "sha256": null,
    "fileCount": 83
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/browser_cdp_tool.py",
    "resolvedPath": "tools/browser_cdp_tool.py",
    "kind": "file",
    "sizeBytes": 22344,
    "sha256": "cd4839815323dcfa3d87e6823bd461b0e45ce315a79bda6dd02f393ef43d1e74",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/browser_dialog_tool.py",
    "resolvedPath": "tools/browser_dialog_tool.py",
    "kind": "file",
    "sizeBytes": 5500,
    "sha256": "ba23b8307830794fbe57298c9a03baf74d3b6b48681cbee19a58cb53aec3eb99",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/browser_tool.py",
    "resolvedPath": "tools/browser_tool.py",
    "kind": "file",
    "sizeBytes": 105233,
    "sha256": "fb62a841e7c2912710189db04f7d86a717d6c05c5f38e27116fbe37a92d6cf19",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/clarify_tool.py",
    "resolvedPath": "tools/clarify_tool.py",
    "kind": "file",
    "sizeBytes": 4955,
    "sha256": "8eeab1b8c0d7bcf3a9f5983e256c905eb7a0f8b3bebf4923d8ac39dd0837bb7c",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/code_execution_tool.py",
    "resolvedPath": "tools/code_execution_tool.py",
    "kind": "file",
    "sizeBytes": 61555,
    "sha256": "ed3eea4690bd9edddeabcc11f4b296849352594d2c29616ba13198df5b4de971",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/cronjob_tools.py",
    "resolvedPath": "tools/cronjob_tools.py",
    "kind": "file",
    "sizeBytes": 25426,
    "sha256": "4ed357b4d8ef457b384fc033711163a04f5df867882e7a9da104261576b072ca",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/delegate_tool.py",
    "resolvedPath": "tools/delegate_tool.py",
    "kind": "file",
    "sizeBytes": 102591,
    "sha256": "ae6fb99abd81f846a2d70ff40fb5a860953c69cf971fffc7d43e578c941300dc",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/discord_tool.py",
    "resolvedPath": "tools/discord_tool.py",
    "kind": "file",
    "sizeBytes": 33585,
    "sha256": "d223ac37135da8123d285fcd6355d63180be076c01a29f8cdcd451e1027f730d",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/feishu_doc_tool.py",
    "resolvedPath": "tools/feishu_doc_tool.py",
    "kind": "file",
    "sizeBytes": 3991,
    "sha256": "64a8296c433c969d94cb151aeaa4c3b37f87edb177c54de0ce581bbadcf3a654",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/feishu_drive_tool.py",
    "resolvedPath": "tools/feishu_drive_tool.py",
    "kind": "file",
    "sizeBytes": 13143,
    "sha256": "43169405aca5a0df3ed176d662dc884456caa94f2bc748be2bc142480ec5488d",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/file_tools.py",
    "resolvedPath": "tools/file_tools.py",
    "kind": "file",
    "sizeBytes": 45212,
    "sha256": "43b68dd295226c940b883698fe986e432e52d4596b33e7a930b30dc47961e54f",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/homeassistant_tool.py",
    "resolvedPath": "tools/homeassistant_tool.py",
    "kind": "file",
    "sizeBytes": 18000,
    "sha256": "62246df13e5380c67ac98855edf640293b4dfd2c8191d6aa5f0f8ade06d93144",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/image_generation_tool.py",
    "resolvedPath": "tools/image_generation_tool.py",
    "kind": "file",
    "sizeBytes": 37653,
    "sha256": "b21ac1c8fd2bd31518e343264d1b86733fb72bcd7fcd4a8d9e473db5a761fb95",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/managed_tool_gateway.py",
    "resolvedPath": "tools/managed_tool_gateway.py",
    "kind": "file",
    "sizeBytes": 5424,
    "sha256": "32bdc2a7c9a942543afb6abe2d687fd2af5605b6c7b65b19ab5e94808d069b04",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/mcp_tool.py",
    "resolvedPath": "tools/mcp_tool.py",
    "kind": "file",
    "sizeBytes": 120450,
    "sha256": "5085128a7d16ac50c9c361c9698a533ea47b2a3ac844cd2aa7ed4db0b6a29a2d",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/memory_tool.py",
    "resolvedPath": "tools/memory_tool.py",
    "kind": "file",
    "sizeBytes": 23222,
    "sha256": "10a2d7b1bc4da16de6d1b1a4582a48b351fb3caa0ea8cfeafb8e8f0439179128",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/mixture_of_agents_tool.py",
    "resolvedPath": "tools/mixture_of_agents_tool.py",
    "kind": "file",
    "sizeBytes": 22151,
    "sha256": "4bc5c2e3ad37ac2100871c1a4952b03285585f17db9d91ed857610879f12f6c5",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/rl_training_tool.py",
    "resolvedPath": "tools/rl_training_tool.py",
    "kind": "file",
    "sizeBytes": 56971,
    "sha256": "3ba95744e63b91a2b91e3303818f93626ecb3f23763d1261474b8670e569d92c",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/send_message_tool.py",
    "resolvedPath": "tools/send_message_tool.py",
    "kind": "file",
    "sizeBytes": 65714,
    "sha256": "4b9ded01c04b7cf8d4d37061c1c0bb65e2ed1033fe32ce91b7dbedbfa7519ac5",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/session_search_tool.py",
    "resolvedPath": "tools/session_search_tool.py",
    "kind": "file",
    "sizeBytes": 24387,
    "sha256": "9074123addf107519e63890615cd783fccc7049464dc14b9996c2ab9860dfd94",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/skill_manager_tool.py",
    "resolvedPath": "tools/skill_manager_tool.py",
    "kind": "file",
    "sizeBytes": 30073,
    "sha256": "ada23fa02b74634b6c0834516d7dc2437f2797da4d9098877c6f99473cf57726",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/skills_tool.py",
    "resolvedPath": "tools/skills_tool.py",
    "kind": "file",
    "sizeBytes": 54016,
    "sha256": "8a7123c336d22b7ccd77d6c6179bc59dc75454812a3147d5f152f5ef9aae0a59",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/terminal_tool.py",
    "resolvedPath": "tools/terminal_tool.py",
    "kind": "file",
    "sizeBytes": 90442,
    "sha256": "140128e43b5aa119fbc902abac8f7732fede897b2b23569fb04ce6b61e8748ac",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/todo_tool.py",
    "resolvedPath": "tools/todo_tool.py",
    "kind": "file",
    "sizeBytes": 10049,
    "sha256": "476578d5590d8276159ccfdf9d57f9a315a2f7b69cc906948ac28bf15323499e",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/tool_backend_helpers.py",
    "resolvedPath": "tools/tool_backend_helpers.py",
    "kind": "file",
    "sizeBytes": 4561,
    "sha256": "d40686b5b6ac7a0906217c4175e4e03b2dd0139e6d5cef749047c020dbfcfdc5",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/tool_output_limits.py",
    "resolvedPath": "tools/tool_output_limits.py",
    "kind": "file",
    "sizeBytes": 3348,
    "sha256": "bb1645be38b20e81b327246c3881c8f57b0ca6b4073ad05f24cf57b204841be8",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/tool_result_storage.py",
    "resolvedPath": "tools/tool_result_storage.py",
    "kind": "file",
    "sizeBytes": 7983,
    "sha256": "215d8a9eca1e506fd8f5d70b52eb2df097c52e1eb7987aa9d2d0c8ed45b39d10",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/transcription_tools.py",
    "resolvedPath": "tools/transcription_tools.py",
    "kind": "file",
    "sizeBytes": 35671,
    "sha256": "81483ee2ec71c5aa049a6cb3261634322dd7330d6f279163b6efc7bb87032eba",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/tts_tool.py",
    "resolvedPath": "tools/tts_tool.py",
    "kind": "file",
    "sizeBytes": 58206,
    "sha256": "74e9be1b186a1afb2c63e0215986a6455ba14707f761a45bd95e2b2c4ed4362c",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/vision_tools.py",
    "resolvedPath": "tools/vision_tools.py",
    "kind": "file",
    "sizeBytes": 30904,
    "sha256": "f3827d6fdeee5430df48c97a1162d588a5a409c97b4d0642faa33ceaec6589e7",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "tools/web_tools.py",
    "resolvedPath": "tools/web_tools.py",
    "kind": "file",
    "sizeBytes": 87008,
    "sha256": "94989d7d59811c4273981fc80088c2c95bc5681884868cf18b30d831a098dbc0",
    "fileCount": null
  },
  {
    "source": "hermes",
    "projectSegment": "hermes-agent-main",
    "sourcePath": "trajectory_compressor.py",
    "resolvedPath": "trajectory_compressor.py",
    "kind": "file",
    "sizeBytes": 65305,
    "sha256": "d16511c9e29a15a856d7d63a3a471562bc5e6f9de8e41d240369a612cf8c3f50",
    "fileCount": null
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions",
    "resolvedPath": "extensions",
    "kind": "directory",
    "sizeBytes": 39652490,
    "sha256": null,
    "fileCount": 5636
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/acpx/openclaw.plugin.json",
    "resolvedPath": "extensions/acpx/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 5486,
    "sha256": "da72ac55541de77c8734127917ca7b7bd8706ccaf8d47ce839a149997459d073",
    "fileCount": null,
    "jsonKeys": [
      "configContracts",
      "configSchema",
      "description",
      "enabledByDefault",
      "id",
      "name",
      "skills",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/active-memory/openclaw.plugin.json",
    "resolvedPath": "extensions/active-memory/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 5207,
    "sha256": "872fd2132cdb5d213994cf7c263daa4826f75db14c2b27da12a80f0fb541e3d6",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "description",
      "id",
      "name",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/alibaba/openclaw.plugin.json",
    "resolvedPath": "extensions/alibaba/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 869,
    "sha256": "754e79b17323a56ac2ef9b3f91569e76de7a48bef0142c66d0c4e51e109dd927",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/amazon-bedrock-mantle/openclaw.plugin.json",
    "resolvedPath": "extensions/amazon-bedrock-mantle/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 209,
    "sha256": "ef984c018b696ddb9342c8a45880e7204e6c67bf25c3a143f11f411297cd4f05",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/amazon-bedrock/openclaw.plugin.json",
    "resolvedPath": "extensions/amazon-bedrock/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 2802,
    "sha256": "af45974e34d7c38ea3022eaad255cda0afc6a9c4ee759d51ca381afa11b79bc4",
    "fileCount": null,
    "jsonKeys": [
      "configContracts",
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "providers",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/anthropic-vertex/openclaw.plugin.json",
    "resolvedPath": "extensions/anthropic-vertex/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 353,
    "sha256": "54b690cacd5f9c0a4d37ce76032368d82606f2f54c629513ccae5314b63d0d9e",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "nonSecretAuthMarkers",
      "providerDiscoveryEntry",
      "providers",
      "syntheticAuthRefs"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/anthropic/openclaw.plugin.json",
    "resolvedPath": "extensions/anthropic/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1930,
    "sha256": "8172dbbf81d2e299d04376328aed35d16d504b2d12435ca18b7b7a9d3e479a89",
    "fileCount": null,
    "jsonKeys": [
      "cliBackends",
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "modelSupport",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers",
      "syntheticAuthRefs"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/arcee/openclaw.plugin.json",
    "resolvedPath": "extensions/arcee/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1245,
    "sha256": "5d5e4186b7943ac05c482ff4fbd8cc8d7149fd170f3fffddd01b477b546f8dc6",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/bluebubbles/openclaw.plugin.json",
    "resolvedPath": "extensions/bluebubbles/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 160,
    "sha256": "1dcea7f0a4637b56ca591a8f0e7cb6027341c6f60c31dc74afefe6d3278ac9ed",
    "fileCount": null,
    "jsonKeys": [
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/bonjour/openclaw.plugin.json",
    "resolvedPath": "extensions/bonjour/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 268,
    "sha256": "aff5a3e941116498953d0279a893f791480667f32f7bdd145f256af1f01c1ff8",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "description",
      "enabledByDefault",
      "id",
      "name"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/brave/openclaw.plugin.json",
    "resolvedPath": "extensions/brave/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 988,
    "sha256": "40005bfa475c438a604b845b19888258b733ffc2fb606f50eb0117430136cbd8",
    "fileCount": null,
    "jsonKeys": [
      "configContracts",
      "configSchema",
      "contracts",
      "id",
      "providerAuthEnvVars",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/browser/openclaw.plugin.json",
    "resolvedPath": "extensions/browser/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 179,
    "sha256": "38f384fd1abe4da0f6ab8e8728f636cb4b75418c23404fde78bf4705c1164b59",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "skills"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/byteplus/openclaw.plugin.json",
    "resolvedPath": "extensions/byteplus/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 892,
    "sha256": "2ff9d544eed195c2cf86b5640627d44b3b669de0dee6a447a2eaa180b2d8fb65",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "providerAuthAliases",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providerDiscoveryEntry",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/chutes/openclaw.plugin.json",
    "resolvedPath": "extensions/chutes/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1037,
    "sha256": "8f860cef0cdcfb26897bd40e1969b14bb567264d87fac929bc3cc42842907d17",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/cloudflare-ai-gateway/openclaw.plugin.json",
    "resolvedPath": "extensions/cloudflare-ai-gateway/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 931,
    "sha256": "c07cd8e54b10b4d545de485e22e7de2d39b0bb65bb4751104f641100b6173813",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/codex/openclaw.plugin.json",
    "resolvedPath": "extensions/codex/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 5767,
    "sha256": "0757b14904519e27b49c279c79c547fa2832d0dd13559bf6d466bb860832b5e7",
    "fileCount": null,
    "jsonKeys": [
      "activation",
      "commandAliases",
      "configSchema",
      "contracts",
      "description",
      "id",
      "mediaUnderstandingProviderMetadata",
      "name",
      "nonSecretAuthMarkers",
      "providerDiscoveryEntry",
      "providers",
      "syntheticAuthRefs",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/comfy/openclaw.plugin.json",
    "resolvedPath": "extensions/comfy/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 3514,
    "sha256": "accb3622152b9ca3916e37f0be772bc949e0ad6bb22270d91322fd80a7710cfb",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/copilot-proxy/openclaw.plugin.json",
    "resolvedPath": "extensions/copilot-proxy/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 583,
    "sha256": "4031df3b3dc731b16d871c503f79869d43167f04fe91b3cd26ce343e3d76e355",
    "fileCount": null,
    "jsonKeys": [
      "autoEnableWhenConfiguredProviders",
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/deepgram/openclaw.plugin.json",
    "resolvedPath": "extensions/deepgram/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 561,
    "sha256": "04b1268f8c7c42eeb8305733a6a0dc51a988690c76c3cc8e4f481dc4d012fdfb",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "providerAuthEnvVars"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/deepseek/openclaw.plugin.json",
    "resolvedPath": "extensions/deepseek/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 744,
    "sha256": "7c6cbc0c49c101b8f8e98d4aed216ccb8f1c1c0a815a309caeec5206c685e923",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providerDiscoveryEntry",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/device-pair/openclaw.plugin.json",
    "resolvedPath": "extensions/device-pair/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 576,
    "sha256": "627f0d9d268e292e1dc6c6cdb325b9bc908d6e36162bfef705dabc3994bdee90",
    "fileCount": null,
    "jsonKeys": [
      "commandAliases",
      "configSchema",
      "description",
      "enabledByDefault",
      "id",
      "name",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/diagnostics-otel/openclaw.plugin.json",
    "resolvedPath": "extensions/diagnostics-otel/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 134,
    "sha256": "66372494f8e7fd6d7c2fee381abbab8e53054786dfb82c513c8725233208d029",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/diffs/openclaw.plugin.json",
    "resolvedPath": "extensions/diffs/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 5411,
    "sha256": "ff137bbf34ead3c36829ffe988e06310bca2460d76c037d3a7766fe4ec91eb15",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "description",
      "id",
      "name",
      "skills",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/discord/openclaw.plugin.json",
    "resolvedPath": "extensions/discord/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 216,
    "sha256": "162d8e120b052ed3d018f66b0a163006453b43c160cc6a581a118e5341a78ebd",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/document-extract/openclaw.plugin.json",
    "resolvedPath": "extensions/document-extract/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 342,
    "sha256": "a088beea3e77180106b7157857fbebf9af1201c0b972276658ae4308a250cce3",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "description",
      "enabledByDefault",
      "id",
      "name"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/duckduckgo/openclaw.plugin.json",
    "resolvedPath": "extensions/duckduckgo/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 808,
    "sha256": "cae86a0f479bfcc197fd680f0860c88b3e84907b04345bfdd848db6b770b71b3",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "id",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/elevenlabs/openclaw.plugin.json",
    "resolvedPath": "extensions/elevenlabs/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 818,
    "sha256": "039d96c445e007ef4a357aaaa802dc9100592b006604c40b66e374025e095c73",
    "fileCount": null,
    "jsonKeys": [
      "configContracts",
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "providerAuthEnvVars"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/exa/openclaw.plugin.json",
    "resolvedPath": "extensions/exa/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 740,
    "sha256": "537c3ad0922ae84d7360aa5b8644a687ccedf1f23ed52c5946c3db5ecf126465",
    "fileCount": null,
    "jsonKeys": [
      "configContracts",
      "configSchema",
      "contracts",
      "id",
      "providerAuthEnvVars",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/fal/openclaw.plugin.json",
    "resolvedPath": "extensions/fal/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 805,
    "sha256": "65c995f3230048ee626abe80abf563773a7e77381ab0532ba50e6058417d83c9",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/feishu/openclaw.plugin.json",
    "resolvedPath": "extensions/feishu/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 3059,
    "sha256": "416270d90e342bbf2a1d4af5a27fc62778b8c2481ff741d95ddc8b4e926b1579",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id",
      "skills"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/firecrawl/openclaw.plugin.json",
    "resolvedPath": "extensions/firecrawl/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1919,
    "sha256": "c630fb07aa420df461b2780cb861cd6ef2c238d67cd1d0eba5c1f17312de2701",
    "fileCount": null,
    "jsonKeys": [
      "configContracts",
      "configSchema",
      "contracts",
      "id",
      "providerAuthEnvVars",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/fireworks/openclaw.plugin.json",
    "resolvedPath": "extensions/fireworks/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 702,
    "sha256": "bb8eb2edbe453d6e4ddaf683d60e70a69b94b4e0ead906d077c81c849f509c81",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/github-copilot/openclaw.plugin.json",
    "resolvedPath": "extensions/github-copilot/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1271,
    "sha256": "f077a4d971a40e7115c62b8844dec38e61a9df04a16f4d33092bfb7a4ce32737",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/google-meet/openclaw.plugin.json",
    "resolvedPath": "extensions/google-meet/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 11097,
    "sha256": "a63edcbc778e2c957c7dc1bee52972b4b3ac22d6f4057d0fc4fe5354a000b1c8",
    "fileCount": null,
    "jsonKeys": [
      "activation",
      "commandAliases",
      "configSchema",
      "description",
      "enabledByDefault",
      "id",
      "name",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/google/openclaw.plugin.json",
    "resolvedPath": "extensions/google/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 2665,
    "sha256": "48621e94945bee80106937cf617888766696260d4b81e4816004217a24f0d2ed",
    "fileCount": null,
    "jsonKeys": [
      "autoEnableWhenConfiguredProviders",
      "cliBackends",
      "configContracts",
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/googlechat/openclaw.plugin.json",
    "resolvedPath": "extensions/googlechat/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 271,
    "sha256": "d825cd7c48cb062d8b27507bd9e6868a93cfdb35a7ad165d78bdf6064433c47d",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/gradium/openclaw.plugin.json",
    "resolvedPath": "extensions/gradium/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 249,
    "sha256": "338c9e7aaadd2062bdef657ee456c43d56b73c54188d3844d28c11a95ff280ef",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "id",
      "providerAuthEnvVars"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/groq/openclaw.plugin.json",
    "resolvedPath": "extensions/groq/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 505,
    "sha256": "4c14cdae601a605ccc19884c63608567118adbd5f60e40937f5af72680ce31a7",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "providerAuthEnvVars"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/huggingface/openclaw.plugin.json",
    "resolvedPath": "extensions/huggingface/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1375,
    "sha256": "f632c82c8b2e3ef8ab67ec8fc90c0c094712fd8c32ee4a648a3cd120dc3bd544",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/imessage/openclaw.plugin.json",
    "resolvedPath": "extensions/imessage/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 154,
    "sha256": "e9d6179dac8ebfe8f7ab3f53d48b681ae6ddbf3ceb6b73cf61c4ef30c14678b0",
    "fileCount": null,
    "jsonKeys": [
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/irc/openclaw.plugin.json",
    "resolvedPath": "extensions/irc/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 416,
    "sha256": "4b25224b182e228dcb0c61741d23ddda6111eb643038074cc108e79e0521d499",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/kilocode/openclaw.plugin.json",
    "resolvedPath": "extensions/kilocode/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 780,
    "sha256": "a9db347662d55372d75fe16e7e1c8e6a0930eb611d35785a05536059fa095afb",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/kimi-coding/openclaw.plugin.json",
    "resolvedPath": "extensions/kimi-coding/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 813,
    "sha256": "e4e26bae87c9ad496b82dd8834ff7b62bc4f2531d2b3a67f066cd892287928e5",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/line/openclaw.plugin.json",
    "resolvedPath": "extensions/line/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 238,
    "sha256": "7e7e63e7b589623939509db24697290a27fb4c4beca76e2675093f9657a01080",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/litellm/openclaw.plugin.json",
    "resolvedPath": "extensions/litellm/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 767,
    "sha256": "1e31eff96fc8ce45ed6b52c9b32714a692c28ac244e0a740e388a810f9f073e2",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/llm-task/openclaw.plugin.json",
    "resolvedPath": "extensions/llm-task/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 653,
    "sha256": "b56283a3b9e705c873511f0e5dc145549b90a046ca41724f9877c82d40784437",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "description",
      "id",
      "name"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/lmstudio/openclaw.plugin.json",
    "resolvedPath": "extensions/lmstudio/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 865,
    "sha256": "e0d8710068910d1bdddb1f215bca235c836e7c2593e4f8a52c908f0c23fb6631",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "nonSecretAuthMarkers",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/lobster/openclaw.plugin.json",
    "resolvedPath": "extensions/lobster/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 212,
    "sha256": "97406758f2af468e8ed829ec5ff2034e6a2b87c923dbf4e7e8628d277e307373",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "description",
      "id",
      "name"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/matrix/openclaw.plugin.json",
    "resolvedPath": "extensions/matrix/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 483,
    "sha256": "c1e7b909bb1e9d4799ae7c76141a247c61637137f53d1a1fdcf870894c84b46c",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/mattermost/openclaw.plugin.json",
    "resolvedPath": "extensions/mattermost/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 246,
    "sha256": "06290c3384762890ec8054f7d83abf9957dd3d2fb54354564c171053fcd885f3",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/memory-core/openclaw.plugin.json",
    "resolvedPath": "extensions/memory-core/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 3898,
    "sha256": "af56e953d411741e56f59a73182d55e9a9c930d38a0ae0fd1748700ac7760b6c",
    "fileCount": null,
    "jsonKeys": [
      "commandAliases",
      "configSchema",
      "contracts",
      "id",
      "kind",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/memory-lancedb/openclaw.plugin.json",
    "resolvedPath": "extensions/memory-lancedb/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 2794,
    "sha256": "7e2ac3c8aa25907a96a9f0cb06c16a7f44705157c1bc112b262c25f2d7d798f1",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "id",
      "kind",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/memory-wiki/openclaw.plugin.json",
    "resolvedPath": "extensions/memory-wiki/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 4802,
    "sha256": "3be028d624e47231b4b55cbb83969ecd1e889db51a6cc5bea66ff1bb80ec5f8e",
    "fileCount": null,
    "jsonKeys": [
      "commandAliases",
      "configContracts",
      "configSchema",
      "description",
      "id",
      "name",
      "skills",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/microsoft-foundry/openclaw.plugin.json",
    "resolvedPath": "extensions/microsoft-foundry/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1044,
    "sha256": "9f2e22d972ec49a79dcb13c2665186d61a278c31248203b264afe4c35c7e01b6",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/microsoft/openclaw.plugin.json",
    "resolvedPath": "extensions/microsoft/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 214,
    "sha256": "884391ec09edd8ea2cfed891ebb723e9f8610a6d011b47f160db6bb247599c6f",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/minimax/openclaw.plugin.json",
    "resolvedPath": "extensions/minimax/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 3928,
    "sha256": "7d02e7f29a257fee775ce5dfa96e2ae44c4d6101fae20067e525e76cdbe107ca",
    "fileCount": null,
    "jsonKeys": [
      "autoEnableWhenConfiguredProviders",
      "configContracts",
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "legacyPluginIds",
      "mediaUnderstandingProviderMetadata",
      "nonSecretAuthMarkers",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/mistral/openclaw.plugin.json",
    "resolvedPath": "extensions/mistral/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1072,
    "sha256": "3159be99f6d43e56daa1c04c581d7d4b6f55aa3946fc122ad77b928da38f63c5",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/moonshot/openclaw.plugin.json",
    "resolvedPath": "extensions/moonshot/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 2432,
    "sha256": "2d8f6513843c6810709d1f6a972a259ccedb355ba999ef9360e96253b5ff76d9",
    "fileCount": null,
    "jsonKeys": [
      "configContracts",
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providerDiscoveryEntry",
      "providers",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/msteams/openclaw.plugin.json",
    "resolvedPath": "extensions/msteams/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 258,
    "sha256": "0db7e9fb77c3024c99d54fc20bb2187c9843c9a58726fef37ffb0f85108fc71d",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/nextcloud-talk/openclaw.plugin.json",
    "resolvedPath": "extensions/nextcloud-talk/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 276,
    "sha256": "f392e72cbae286bec3ef869b84b1221d005c2ee924e8033f12bc60668b7cd4ab",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/nostr/openclaw.plugin.json",
    "resolvedPath": "extensions/nostr/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 210,
    "sha256": "42d2d9aae4be7287d6b9beb841a7c939392dc3533bf4b425b6a144fb33fa0988",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/nvidia/openclaw.plugin.json",
    "resolvedPath": "extensions/nvidia/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 663,
    "sha256": "740a9189c03fdf82ee4e558f794161da10edf163f6d80f71535cd89992ce8238",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/ollama/openclaw.plugin.json",
    "resolvedPath": "extensions/ollama/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1339,
    "sha256": "92ccf1aa89abfbeb5730f3001104987dc647bfd20844b1967710ce52dea43a67",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "nonSecretAuthMarkers",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providerDiscoveryEntry",
      "providers",
      "syntheticAuthRefs",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/open-prose/openclaw.plugin.json",
    "resolvedPath": "extensions/open-prose/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 250,
    "sha256": "51f03f60f5c2be2190b57674f0e62e15b48773fdb9ddf2006efde11e84b311c4",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "description",
      "id",
      "name",
      "skills"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/openai/openclaw.plugin.json",
    "resolvedPath": "extensions/openai/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 2769,
    "sha256": "68bcf830205eb7ae1875d39a5c0f3b0bbc38784cad06cf078c1e09d049988013",
    "fileCount": null,
    "jsonKeys": [
      "cliBackends",
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "modelSupport",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/opencode-go/openclaw.plugin.json",
    "resolvedPath": "extensions/opencode-go/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1015,
    "sha256": "8516cd49c03b5232d898f676dc11f6e97b8022c3b26fd9570fc7b809e07851c0",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/opencode/openclaw.plugin.json",
    "resolvedPath": "extensions/opencode/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1004,
    "sha256": "3f25f329a7e515c5c1595fded8127482c1708819bd7ac25b2099663edbaa76d7",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/openrouter/openclaw.plugin.json",
    "resolvedPath": "extensions/openrouter/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1037,
    "sha256": "0c310e5274d972cfe66b21b6c093dc664107911cc929199b25f01b692299a98e",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/openshell/openclaw.plugin.json",
    "resolvedPath": "extensions/openshell/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 3076,
    "sha256": "156519a94e7d3ff81be3d89c9e234d1f6c2a60a23b48284f11dc254698219642",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "description",
      "id",
      "name",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/perplexity/openclaw.plugin.json",
    "resolvedPath": "extensions/perplexity/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1203,
    "sha256": "c394be7fbe86c91c38a2c39850a28e7900b9b4e966be30a069f1988b446b0b7b",
    "fileCount": null,
    "jsonKeys": [
      "configContracts",
      "configSchema",
      "contracts",
      "id",
      "providerAuthEnvVars",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/phone-control/openclaw.plugin.json",
    "resolvedPath": "extensions/phone-control/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 392,
    "sha256": "b907dc0e9a31a1a5895dfe4f25cce4aaf73341afec54d8a7e33b8363c7dcbbac",
    "fileCount": null,
    "jsonKeys": [
      "commandAliases",
      "configSchema",
      "description",
      "enabledByDefault",
      "id",
      "name"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/qa-channel/openclaw.plugin.json",
    "resolvedPath": "extensions/qa-channel/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 158,
    "sha256": "365ab792af1905786aa9f050410b4081c1b223e381f3c23c1dffdf03c83bf548",
    "fileCount": null,
    "jsonKeys": [
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/qa-lab/openclaw.plugin.json",
    "resolvedPath": "extensions/qa-lab/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 124,
    "sha256": "0e68f58f55cde3c2779fb35c9e48a23fdbc0c45d1620aa6512d52aff14169a43",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/qa-matrix/openclaw.plugin.json",
    "resolvedPath": "extensions/qa-matrix/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 373,
    "sha256": "63a902f56937838bf9455c1dd5913750eed16835d481133683ef90dc1e5da852",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "description",
      "id",
      "name",
      "qaRunners"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/qianfan/openclaw.plugin.json",
    "resolvedPath": "extensions/qianfan/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 676,
    "sha256": "a359014f70175795de37ee02cead9028366f24f8f420f481f545085b30cede2b",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/qqbot/openclaw.plugin.json",
    "resolvedPath": "extensions/qqbot/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 4407,
    "sha256": "4ec88df1dfdaafef7994ec0c226282b9721b67f49f54456a87b2da3968ccd789",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "enabledByDefault",
      "id",
      "skills"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/qwen/openclaw.plugin.json",
    "resolvedPath": "extensions/qwen/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 3329,
    "sha256": "41ab4811f717963d041a7578af7d34b498b598cccaa2e19ce75e9045d4f96c6f",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/runway/openclaw.plugin.json",
    "resolvedPath": "extensions/runway/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 724,
    "sha256": "c847b6fd72730aaaebe4e9ea303351b3457a2edfc8c4bbd678ac05f720a28340",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/searxng/openclaw.plugin.json",
    "resolvedPath": "extensions/searxng/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1041,
    "sha256": "fa62ab1f90276f4e573cd80df19d810b567835c3ceed2b9bd6a853a23c2fcf04",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "id",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/senseaudio/openclaw.plugin.json",
    "resolvedPath": "extensions/senseaudio/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 301,
    "sha256": "4fa8043255fc43aff8a80171caa1dda97c48474e715b938d6235d500016ca28e",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "providerAuthEnvVars"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/sglang/openclaw.plugin.json",
    "resolvedPath": "extensions/sglang/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 568,
    "sha256": "cebca0e3deb056099757507505b98ee165588f495fc33180b8a556ac28592ff9",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/signal/openclaw.plugin.json",
    "resolvedPath": "extensions/signal/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 150,
    "sha256": "50c492d7ac681ca6aa43b9124f9371ff2fe0bed7a6009608f3977cf0b5a10c16",
    "fileCount": null,
    "jsonKeys": [
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/skill-workshop/openclaw.plugin.json",
    "resolvedPath": "extensions/skill-workshop/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 2061,
    "sha256": "6eed34ada2b64e8ac3a65e23466cf22e0dbc8b678a01bba42b449f34d8275742",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "description",
      "id",
      "name",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/slack/openclaw.plugin.json",
    "resolvedPath": "extensions/slack/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 247,
    "sha256": "a6e0ab4986e8886c9986e7b6c815f8ba42f18d39ac0a73a0f7644b158576f3cb",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/stepfun/openclaw.plugin.json",
    "resolvedPath": "extensions/stepfun/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 2518,
    "sha256": "32b5a7bf9410cb8a10013af261f6332a23cb41d6c1184363ae68fc35a347d47a",
    "fileCount": null,
    "jsonKeys": [
      "autoEnableWhenConfiguredProviders",
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/synology-chat/openclaw.plugin.json",
    "resolvedPath": "extensions/synology-chat/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 402,
    "sha256": "e20215ab95e1f6507817bf1dde37c580c8e42b539aa9138a8104faf9efb08979",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/synthetic/openclaw.plugin.json",
    "resolvedPath": "extensions/synthetic/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 729,
    "sha256": "c0b17034f47bbfdea067a9ab82a38f9167b1bc42621b8584929355448b34aa6c",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/talk-voice/openclaw.plugin.json",
    "resolvedPath": "extensions/talk-voice/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 332,
    "sha256": "20145b3533eedabd45619d78fe62277ad9e9a6900cc1aa7e5b65c22af0753ec9",
    "fileCount": null,
    "jsonKeys": [
      "commandAliases",
      "configSchema",
      "description",
      "enabledByDefault",
      "id",
      "name"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/tavily/openclaw.plugin.json",
    "resolvedPath": "extensions/tavily/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1040,
    "sha256": "755d293931743d2da9dbd9ed8a6dfcc36bc0f3dc8ed665fc67272a19ca4a4dbc",
    "fileCount": null,
    "jsonKeys": [
      "configContracts",
      "configSchema",
      "contracts",
      "id",
      "providerAuthEnvVars",
      "skills",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/telegram/openclaw.plugin.json",
    "resolvedPath": "extensions/telegram/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 220,
    "sha256": "aeb7e548cb9054e26a9df63956001fa12846a75ce469fc42005c4ca7131725a6",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/tencent/openclaw.plugin.json",
    "resolvedPath": "extensions/tencent/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 788,
    "sha256": "274792ad9767158633f4084b13f9c4bc83faea17c2cfd38719c92f7cbb9e18c7",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providerDiscoveryEntry",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/thread-ownership/openclaw.plugin.json",
    "resolvedPath": "extensions/thread-ownership/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 782,
    "sha256": "11bd72dbed13a165cf6be97e470535802ae75da57accad9945fa15fe7746ef95",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "description",
      "id",
      "name",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/tlon/openclaw.plugin.json",
    "resolvedPath": "extensions/tlon/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 197,
    "sha256": "3b5982cf80cfc60378bd1c29a8e8f323b3fb91b5c9e411460ec92faedbdbd701",
    "fileCount": null,
    "jsonKeys": [
      "channels",
      "configSchema",
      "id",
      "skills"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/together/openclaw.plugin.json",
    "resolvedPath": "extensions/together/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 765,
    "sha256": "6cd74350443582e8f9b5c154cfac5c1c5fe927db26369fce205a407aaadbdc43",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/tokenjuice/openclaw.plugin.json",
    "resolvedPath": "extensions/tokenjuice/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 305,
    "sha256": "3e90506f981b71af30577d45e3ff1cb6a27c4b809e4602801855cd9d06e60601",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "description",
      "id",
      "name"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/tts-local-cli/openclaw.plugin.json",
    "resolvedPath": "extensions/tts-local-cli/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 229,
    "sha256": "630f26eac6030ff2b46e279a490274126a9545d962eb26a459ef214c377c2b15",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/twitch/openclaw.plugin.json",
    "resolvedPath": "extensions/twitch/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 224,
    "sha256": "67451cd79bff5cc71de0e32363437cc452d6365c5c6ba7e271336ecafe91e999",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/venice/openclaw.plugin.json",
    "resolvedPath": "extensions/venice/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 697,
    "sha256": "aac68b7d34b25c584a63fdd82352c043e124918669c7251f0a9bac5d616de68b",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/vercel-ai-gateway/openclaw.plugin.json",
    "resolvedPath": "extensions/vercel-ai-gateway/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 763,
    "sha256": "d06cdd2b2b5c5aa6c62adbdf8c6b7720e73323b61503d5a6b1d0ea2abe1e0c56",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/vllm/openclaw.plugin.json",
    "resolvedPath": "extensions/vllm/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 563,
    "sha256": "c3a4589242d1d730855dca2e4b54e1906eb8517cc61d335d56ebad79328342dd",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/voice-call/openclaw.plugin.json",
    "resolvedPath": "extensions/voice-call/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 18878,
    "sha256": "5c92dce56d4a89abc2076c520e4b7a246169f72608c51b6280f54132da90b9eb",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "configContracts",
      "configSchema",
      "id",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/volcengine/openclaw.plugin.json",
    "resolvedPath": "extensions/volcengine/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 873,
    "sha256": "81031f89d626cf81d63cfea0b505632f337b98baa864e49a4b264bdb5dfac255",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "enabledByDefault",
      "id",
      "providerAuthAliases",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providerDiscoveryEntry",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/voyage/openclaw.plugin.json",
    "resolvedPath": "extensions/voyage/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 282,
    "sha256": "348eeca427655d78dbfcc6e136bdad38c4eec67041a7471fa92b592f57bf48fb",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "providerAuthEnvVars"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/vydra/openclaw.plugin.json",
    "resolvedPath": "extensions/vydra/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 856,
    "sha256": "f9e92e2df3c28aa7470a5c15e96e3cf5541cc4b23b5f5bf1658a2bfe4d6632eb",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/web-readability/openclaw.plugin.json",
    "resolvedPath": "extensions/web-readability/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 357,
    "sha256": "e6ec9a9dc5dd1dd3f1a9da8c9daa71e061f9a9c045dc499c582ee1f26bdd945a",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "description",
      "enabledByDefault",
      "id",
      "name"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/webhooks/openclaw.plugin.json",
    "resolvedPath": "extensions/webhooks/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 1396,
    "sha256": "703078ab63a3efdef556cc0ded50f93f2a771130a4a8d88c3fc22fc272eb85b1",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "description",
      "id",
      "name"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/whatsapp/openclaw.plugin.json",
    "resolvedPath": "extensions/whatsapp/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 482,
    "sha256": "b736a8bd3319f493151305f7defaba73c86f9aaed03f9a6ece62c6adfd493c77",
    "fileCount": null,
    "jsonKeys": [
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/xai/openclaw.plugin.json",
    "resolvedPath": "extensions/xai/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 4593,
    "sha256": "5c9a7224005dc11f8078a1ea3190d7c45e34e4dd8bf77ec9e87bd8330fc322d8",
    "fileCount": null,
    "jsonKeys": [
      "configContracts",
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providerEndpoints",
      "providers",
      "syntheticAuthRefs",
      "uiHints"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/xiaomi/openclaw.plugin.json",
    "resolvedPath": "extensions/xiaomi/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 719,
    "sha256": "4684ad17db01843ac89654e380669a2b98b189bb35d093f1b96ac8e720a3d1d5",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/zai/openclaw.plugin.json",
    "resolvedPath": "extensions/zai/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 2697,
    "sha256": "d906ba0abd2558b438c3ca0f1ec896db3442c90e26cae1eaa096fe4d9cf9e151",
    "fileCount": null,
    "jsonKeys": [
      "configSchema",
      "contracts",
      "enabledByDefault",
      "id",
      "mediaUnderstandingProviderMetadata",
      "providerAuthChoices",
      "providerAuthEnvVars",
      "providers"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/zalo/openclaw.plugin.json",
    "resolvedPath": "extensions/zalo/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 227,
    "sha256": "7885d8ae17d1283c9f5c7e3edbcf3969966900c232fb7d7dc8c29dd13cc8a753",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "extensions/zalouser/openclaw.plugin.json",
    "resolvedPath": "extensions/zalouser/openclaw.plugin.json",
    "kind": "file",
    "sizeBytes": 233,
    "sha256": "43c236ffdd98b77bf5375b1b42ebbb230e8739b075b827aea50ef2563c836b5d",
    "fileCount": null,
    "jsonKeys": [
      "channelEnvVars",
      "channels",
      "configSchema",
      "id"
    ]
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "src/acp",
    "resolvedPath": "src/acp",
    "kind": "directory",
    "sizeBytes": 534069,
    "sha256": null,
    "fileCount": 64
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "src/mcp",
    "resolvedPath": "src/mcp",
    "kind": "directory",
    "sizeBytes": 58724,
    "sha256": null,
    "fileCount": 12
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "src/memory",
    "resolvedPath": "src/memory",
    "kind": "directory",
    "sizeBytes": 2033,
    "sha256": null,
    "fileCount": 1
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "src/security",
    "resolvedPath": "src/security",
    "kind": "directory",
    "sizeBytes": 516388,
    "sha256": null,
    "fileCount": 78
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "src/trajectory",
    "resolvedPath": "src/trajectory",
    "kind": "directory",
    "sizeBytes": 88453,
    "sha256": null,
    "fileCount": 8
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "src/tui",
    "resolvedPath": "src/tui",
    "kind": "directory",
    "sizeBytes": 373602,
    "sha256": null,
    "fileCount": 55
  },
  {
    "source": "openclaw",
    "projectSegment": "openclaw-main",
    "sourcePath": "src/web-search",
    "resolvedPath": "src/web-search",
    "kind": "directory",
    "sizeBytes": 26490,
    "sha256": null,
    "fileCount": 3
  }
] as const satisfies readonly ReferenceSourceInventoryEntry[];

export function getReferenceSourceInventoryEntry(input: {
  readonly source: ReferenceSourceInventorySource;
  readonly id: string;
  readonly sourcePath: string;
}): ReferenceSourceInventoryEntry | null {
  const projectSegment = input.id.split(":")[1] ?? null;
  const normalizedPath = normalizeReferenceSourcePath(input.sourcePath);
  return (
    referenceSourceInventory.find(
      (entry) =>
        entry.source === input.source &&
        entry.projectSegment === projectSegment &&
        entry.sourcePath === normalizedPath,
    ) ?? null
  );
}

export function hasReferenceSourceInventoryEntry(input: {
  readonly source: ReferenceSourceInventorySource;
  readonly id: string;
  readonly sourcePath: string;
}): boolean {
  return getReferenceSourceInventoryEntry(input) !== null;
}

export function normalizeReferenceSourcePath(sourcePath: string): string {
  return sourcePath.replaceAll("\\", "/");
}
