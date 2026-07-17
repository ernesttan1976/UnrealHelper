
+ Thought: Summarizing project updates · 4.6s
Objective
- Build a local UE 5.6 Unreal Editor debugging copilot with an MCP server + Unreal Editor plugin, starting with a safe, low-scope vertical slice (connectivity + basic editor/context queries) to help diagnose/teach Blueprint door interactions.
Important Details
- UE version target: 5.6 first; other versions later.
- User: self first, coders unfamiliar with Unreal; primary goal is assisting learner to fix bugs until it works.
- Safety constraints: editor stability is highest priority; “fail fast” behavior is acceptable.
- Plugin restart after enabling is acceptable.
- Transport chosen/implemented: localhost-only TCP, line-delimited JSON (“one JSON object + \n”), port default 17777, bind 127.0.0.1.
- Auth: per-project token stored in GEditorPerProjectIni under section UnrealDebugCopilot key Token; printed to Output Log for user to set UNREAL_TOKEN.
- MCP server: Node/TypeScript using @modelcontextprotocol/sdk over stdio; env vars UNREAL_HOST, UNREAL_PORT, UNREAL_TOKEN, UNREAL_TIMEOUT_MS, UNREAL_MOCK.
Work State
Completed
- Replanned roadmap to prioritize low-hanging fruit (connectivity, selection snapshot, compile diagnostics, PIE control, scoped logs) and listed research gaps (active blueprint detection, compile mapping, log capture, safe transport/threading).
- Repo scaffolding created under D:\UnrealHelper:
- mcp-server/ TypeScript MCP server + TCP Unreal client (builds successfully).
- unreal-plugin/UnrealDebugCopilot/ UE Editor plugin stub exposing JSON-RPC-like methods.
- Fixed Node build error TS2688: Cannot find type definition file for 'node' by adding @types/node.
- Added .gitignore, repo README.md, and mcp-server/README.md.
Active
- Unreal plugin implements methods:
- ping, get_editor_status, get_engine_version, get_current_project
- get_selected_actors, get_component_tree (actor name optional; default first selected)
- MCP server tools currently exposed:
- unreal.ping, unreal.get_editor_status, unreal.get_engine_version, unreal.get_current_project
- unreal.get_selected_actors, unreal.get_component_tree
- Unreal server runs on a background thread; calls requiring Unreal APIs are marshaled to game thread with a 2s wait and return REQUEST_TIMEOUT on timeout.
Blocked
- Unreal plugin not yet compiled/installed in a UE 5.6 project; end-to-end connectivity not yet verified.
- Plugin returns error code ACTOR_NOT_FOUND for missing selection, but this code is not included in mcp-server/src/protocol.ts failure code union.
Next Move
1. Install unreal-plugin/UnrealDebugCopilot into a UE 5.6 project (<Project>/Plugins/UnrealDebugCopilot), regenerate project files, build, enable plugin, restart editor, confirm Output Log shows listening + token.
2. Run mcp-server against the live plugin (UNREAL_TOKEN=... npm run build && node dist/index.js) and manually exercise tools (unreal.ping, unreal.get_selected_actors, unreal.get_component_tree) while selecting an actor.
Relevant Files
- D:\UnrealHelper\plan.md: original ambitious plan + later reprioritization context.
- D:\UnrealHelper\README.md: repo overview and first vertical slice goal.
- D:\UnrealHelper\.gitignore: ignores node/unreal build artifacts.
- D:\UnrealHelper\mcp-server\package.json: deps/scripts; includes @modelcontextprotocol/sdk, zod, @types/node, typescript.
- D:\UnrealHelper\mcp-server\src\index.ts: MCP tool definitions and dispatch.
- D:\UnrealHelper\mcp-server\src\unreal-client.ts: TCP client (newline-delimited JSON request/response).
- D:\UnrealHelper\mcp-server\src\protocol.ts: response type definitions (needs ACTOR_NOT_FOUND added if kept).
- D:\UnrealHelper\mcp-server\README.md: run instructions (mock/real; env vars).
- D:\UnrealHelper\unreal-plugin\UnrealDebugCopilot\UnrealDebugCopilot.uplugin: plugin descriptor.
- D:\UnrealHelper\unreal-plugin\UnrealDebugCopilot\Source\UnrealDebugCopilotEditor\Private\UnrealDebugCopilotEditorModule.cpp: token creation + server startup + Output Log token/port.
- D:\UnrealHelper\unreal-plugin\UnrealDebugCopilot\Source\UnrealDebugCopilotEditor\Private\CopilotTcpServer.cpp: TCP listener, JSON parsing, game-thread dispatch, methods (ping, status/version/project, selection/component tree).