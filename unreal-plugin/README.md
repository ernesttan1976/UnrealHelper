# Unreal Plugin

Plugin path: `unreal-plugin/UnstuckForUnreal`

## Install (UE 5.6)

1. Copy `unreal-plugin/UnstuckForUnreal` into your Unreal project at `Plugins/UnstuckForUnreal`.
   (Optional: `powershell -ExecutionPolicy Bypass -File scripts/install-plugin.ps1 -ProjectDir <path-to-your-project>`)
2. Enable it in the editor (Edit → Plugins).
3. Restart the editor.

On startup, the Output Log will print:

* the localhost port (`127.0.0.1:17777` by default)
* a session token (persisted in `EditorPerProjectUserSettings.ini`)

Set these when running the `mcp-server`:

* `UNREAL_HOST=127.0.0.1`
* `UNREAL_PORT=17777`
* `UNREAL_TOKEN=<token from Output Log>`
