using UnrealBuildTool;

public class UnrealDebugCopilotEditor : ModuleRules
{
  public UnrealDebugCopilotEditor(ReadOnlyTargetRules Target) : base(Target)
  {
    PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

    PrivateDependencyModuleNames.AddRange(
      new string[]
      {
        "AssetRegistry",
        "ContentBrowser",
        "Core",
        "CoreUObject",
        "Engine",
        "MessageLog",
        "Projects",
        "Slate",
        "SlateCore",
        "UnrealEd",
        "Sockets",
        "Networking",
        "Json",
        "JsonUtilities",

        // Blueprint compilation + diagnostics
        "Kismet",
        "KismetCompiler",
        "BlueprintGraph"
      }
    );
  }
}
