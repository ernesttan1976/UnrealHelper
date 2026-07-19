# Errors

All tools return a JSON envelope:

Success:
```json
{ "ok": true, "result": {} }
```

Failure:
```json
{ "ok": false, "error": { "code": "...", "message": "...", "details": {} } }
```

## MCP-Side Error Codes

* `TOOL_NOT_REGISTERED`: tool name is not in `MCP/tools/registry.json`.
* `POLICY_PACK_DISABLED`: tool is not in any enabled pack.
* `POLICY_WRITE_DISABLED`: tool is write-access and `UNREAL_MCP_WRITE_ENABLED` is not enabled.
* `PRECONDITION_EDITOR_STATUS_FAILED`: failed to query `get_editor_status`.
* `PRECONDITION_EDITOR_NOT_READY`: editor not ready.
* `PRECONDITION_PIE_STATE`: PIE state violated a tool precondition.
* `INTERNAL_MCP_ERROR`: unexpected exception on the MCP server.

## Unreal Plugin Error Codes

These are emitted by the Unreal Editor plugin (`ok:false`):
* `UNREAL_NOT_CONNECTED`
* `UNAUTHORIZED`
* `REQUEST_TIMEOUT`
* `INVALID_REQUEST`
* `ACTOR_NOT_FOUND`
* `BLUEPRINT_NOT_FOUND`
* `OBJECT_NOT_FOUND`
* `INTERNAL_UNREAL_ERROR`
* `TRANSACTION_ALREADY_ACTIVE`
* `TRANSACTION_NOT_ACTIVE`
* `TRANSACTION_ID_MISMATCH`
