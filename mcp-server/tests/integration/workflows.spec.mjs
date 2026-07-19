import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function serverEntry() {
  const p = path.resolve(process.cwd(), "dist", "index.js");
  if (!fs.existsSync(p)) throw new Error(`Server not built: missing ${p} (run: npm run build)`);
  return p;
}

async function withServer(env, fn) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--enable-source-maps", serverEntry()],
    cwd: process.cwd(),
    env: {
      ...env,
      UNREAL_MOCK: "1"
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "integration-test", version: "0.0.1" });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await transport.close();
  }
}

function parseToolText(res) {
  assert.ok(res);
  assert.ok(Array.isArray(res.content));
  const txt = res.content.find((c) => c.type === "text")?.text;
  assert.equal(typeof txt, "string");
  return JSON.parse(txt);
}

test("default policy hides write tools", async () => {
  await withServer({}, async (client) => {
    const listed = await client.listTools();
    const names = new Set(listed.tools.map((t) => t.name));

    assert.ok(names.has("unreal.ping"));
    assert.ok(names.has("unreal.get_connection_status"));
    assert.ok(names.has("unreal.inspect_blueprint"));

    assert.equal(names.has("unreal.compile_blueprint"), false);
    assert.equal(names.has("unreal.begin_transaction"), false);
  });
});

test("policy denial returns structured error envelope", async () => {
  await withServer({}, async (client) => {
    const res = await client.callTool({ name: "unreal.compile_blueprint", arguments: {} });
    assert.equal(Boolean(res.isError), true);
    const body = parseToolText(res);
    assert.equal(body.ok, false);
    assert.ok(body.error.code === "POLICY_PACK_DISABLED" || body.error.code === "POLICY_WRITE_DISABLED");
  });
});

test("write-enabled workflow allows compile and transactions", async () => {
  await withServer(
    {
      UNREAL_MCP_PACKS: [
        "unreal.core",
        "unreal.editor.read",
        "unreal.editor.write",
        "unreal.blueprint.read",
        "unreal.blueprint.write",
        "unreal.diagnostics"
      ].join(","),
      UNREAL_MCP_WRITE_ENABLED: "1"
    },
    async (client) => {
      const listed = await client.listTools();
      const names = new Set(listed.tools.map((t) => t.name));
      assert.ok(names.has("unreal.compile_blueprint"));
      assert.ok(names.has("unreal.begin_transaction"));

      const begin = await client.callTool({ name: "unreal.begin_transaction", arguments: { description: "test" } });
      assert.equal(Boolean(begin.isError), false);
      const beginBody = parseToolText(begin);
      assert.equal(beginBody.ok, true);
      const tid = beginBody.result.transaction_id;
      assert.equal(typeof tid, "string");
      assert.ok(tid.length > 0);

      const badCancel = await client.callTool({ name: "unreal.cancel_transaction", arguments: { transaction_id: "nope" } });
      assert.equal(Boolean(badCancel.isError), true);
      const badCancelBody = parseToolText(badCancel);
      assert.equal(badCancelBody.ok, false);
      assert.equal(badCancelBody.error.code, "TRANSACTION_ID_MISMATCH");

      const cancel = await client.callTool({ name: "unreal.cancel_transaction", arguments: { transaction_id: tid } });
      assert.equal(Boolean(cancel.isError), false);

      const compile = await client.callTool({ name: "unreal.compile_blueprint", arguments: {} });
      assert.equal(Boolean(compile.isError), false);
      const compileBody = parseToolText(compile);
      assert.equal(compileBody.ok, true);
    }
  );
});

test("plugin failure propagates as isError with unreal error code", async () => {
  await withServer({}, async (client) => {
    const res = await client.callTool({ name: "unreal.inspect_object", arguments: {} });
    assert.equal(Boolean(res.isError), true);
    const body = parseToolText(res);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "OBJECT_NOT_FOUND");
  });
});
