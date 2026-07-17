using UnrealBuildTool;

public class UnrealDebugCopilotEditor : ModuleRules
{
  public UnrealDebugCopilotEditor(ReadOnlyTargetRules Target) : base(Target)
  {
    PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

    PrivateDependencyModuleNames.AddRange(
      new string[]
      {
        "Core",
        "CoreUObject",
        "Engine",
        "Slate",
        "SlateCore",
        "UnrealEd",
        "Sockets",
        "Networking",
        "Json",
        "JsonUtilities"
      }
    );
  }
}
