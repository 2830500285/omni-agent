import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

test("local MCP stdio fixture completes a list and call roundtrip", async () => {
  const child = spawn(process.execPath, [
    "-e",
    [
      "process.stdin.setEncoding('utf8');",
      "let buffer='';",
      "process.stdin.on('data',(chunk)=>{",
      "buffer+=chunk;",
      "let index;",
      "while((index=buffer.indexOf('\\n'))>=0){",
      "const line=buffer.slice(0,index).trim();",
      "buffer=buffer.slice(index+1);",
      "if(!line) continue;",
      "const msg=JSON.parse(line);",
      "const result=msg.method==='tools/list'",
      "?{tools:[{name:'fixture_echo',description:'Echo fixture'}]}",
      ":{content:[{type:'text',text:String(msg.params?.arguments?.text??'')}]};",
      "process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result})+'\\n');",
      "}",
      "});",
    ].join(""),
  ], { stdio: ["pipe", "pipe", "pipe"] });

  try {
    const responses: unknown[] = [];
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      let index: number;
      while ((index = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, index).trim();
        stdout = stdout.slice(index + 1);
        if (line) {
          responses.push(JSON.parse(line));
        }
      }
    });

    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "fixture_echo", arguments: { text: "ok" } },
    }) + "\n");

    await waitFor(() => responses.length >= 2);
    const list = responses[0] as { result?: { tools?: Array<{ name?: string }> } };
    const call = responses[1] as { result?: { content?: Array<{ text?: string }> } };
    assert.equal(list.result?.tools?.[0]?.name, "fixture_echo");
    assert.equal(call.result?.content?.[0]?.text, "ok");
  } finally {
    child.kill();
    await once(child, "close").catch(() => undefined);
  }
});

if (process.env.OMNI_LIVE_MCP_TESTS !== "1") {
  test("live MCP tests are opt-in", { skip: "Set OMNI_LIVE_MCP_TESTS=1 to run live MCP checks." }, () => {});
} else {
  test("live MCP matrix has required server configuration", () => {
    assertRequiredEnv(["OMNI_LIVE_MCP_SERVER_ID", "OMNI_LIVE_MCP_COMMAND"]);
  });
}

function assertRequiredEnv(names: readonly string[]): void {
  const missing = names.filter((name) => !process.env[name]?.trim());
  assert.deepEqual(missing, []);
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for MCP fixture response.");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
