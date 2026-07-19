using UnrealBuildTool;

public class UnstuckForUnrealEditor : ModuleRules
{
  public UnstuckForUnrealEditor(ReadOnlyTargetRules Target) : base(Target)
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
