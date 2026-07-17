#include "CopilotTcpServer.h"

#include "Async/Async.h"
#include "AssetRegistry/AssetData.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Dom/JsonObject.h"
#include "Editor.h"
#include "Engine/Selection.h"
#include "HAL/Runnable.h"
#include "HAL/RunnableThread.h"
#include "Interfaces/IPv4/IPv4Address.h"
#include "Json.h"
#include "Misc/Paths.h"
#include "Misc/App.h"
#include "Misc/EngineVersion.h"
#include "Misc/PackageName.h"
#include "Interfaces/IPluginManager.h"
#include "Selection.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Policies/CondensedJsonPrintPolicy.h"

#include "Components/SceneComponent.h"
#include "Engine/Blueprint.h"
#include "Engine/SCS_Node.h"
#include "Engine/SimpleConstructionScript.h"
#include "GameFramework/Actor.h"
#include "Subsystems/AssetEditorSubsystem.h"
#include "Sockets.h"
#include "SocketSubsystem.h"
#include "EngineUtils.h"
#include "UObject/UnrealType.h"
#include "EdGraph/EdGraphPin.h"

#include <atomic>

namespace
{
  constexpr int32 kMaxLineBytes = 256 * 1024;
  constexpr float kAcceptSleepSeconds = 0.01f;
  constexpr double kGameThreadWaitSeconds = 2.0;

  FString GetShortAssetNameFromPackagePath(const FString& AssetPath)
  {
    // "/Game/Foo/Bar" -> "Bar"
    return FPackageName::GetShortName(AssetPath);
  }

  FString NormalizeToObjectPath(const FString& ObjectOrAssetPath)
  {
    // If it already looks like an object path "/Game/X/Y.Asset", keep it.
    if (ObjectOrAssetPath.Contains(TEXT(".")))
    {
      return ObjectOrAssetPath;
    }

    // Otherwise treat it as a package path and form "/Game/X/Y.Y".
    const FString ShortName = GetShortAssetNameFromPackagePath(ObjectOrAssetPath);
    if (ShortName.IsEmpty())
    {
      return ObjectOrAssetPath;
    }
    return ObjectOrAssetPath + TEXT(".") + ShortName;
  }

  UObject* LoadObjectByPathBestEffort(const FString& ObjectOrAssetPath)
  {
    if (ObjectOrAssetPath.IsEmpty())
    {
      return nullptr;
    }

    const FString ObjectPath = NormalizeToObjectPath(ObjectOrAssetPath);
    return StaticLoadObject(UObject::StaticClass(), nullptr, *ObjectPath);
  }

  AActor* FindActorBestEffort(const FString& ActorName)
  {
    if (!GEditor)
    {
      return nullptr;
    }

    // Prefer selection (exact match), then fallback to editor world scan.
    if (USelection* Selection = GEditor->GetSelectedActors())
    {
      for (FSelectionIterator It(*Selection); It; ++It)
      {
        if (AActor* Actor = Cast<AActor>(*It))
        {
          if (Actor->GetName() == ActorName)
          {
            return Actor;
          }
        }
      }
    }

    UWorld* World = GEditor->GetEditorWorldContext().World();
    if (!World)
    {
      return nullptr;
    }

    AActor* ContainsMatch = nullptr;
    for (TActorIterator<AActor> It(World); It; ++It)
    {
      AActor* Actor = *It;
      if (!Actor)
      {
        continue;
      }

      const FString Name = Actor->GetName();
      if (Name == ActorName)
      {
        return Actor;
      }
      if (!ContainsMatch && Name.Contains(ActorName, ESearchCase::IgnoreCase))
      {
        ContainsMatch = Actor;
      }
    }

    return ContainsMatch;
  }

  FString PinTypeToString(const FEdGraphPinType& T)
  {
    FString Base = T.PinCategory.ToString();
    if (!T.PinSubCategory.IsNone())
    {
      Base += TEXT(":");
      Base += T.PinSubCategory.ToString();
    }
    if (T.PinSubCategoryObject.IsValid())
    {
      Base += TEXT(":");
      Base += T.PinSubCategoryObject->GetName();
    }

    switch (T.ContainerType)
    {
      case EPinContainerType::Array: return FString::Printf(TEXT("TArray<%s>"), *Base);
      case EPinContainerType::Set: return FString::Printf(TEXT("TSet<%s>"), *Base);
      case EPinContainerType::Map:
      {
        const FString Key = T.PinValueType.TerminalCategory.ToString();
        return FString::Printf(TEXT("TMap<%s,%s>"), *Key, *Base);
      }
      default: return Base;
    }
  }

  TArray<TSharedPtr<FJsonValue>> ExportObjectProperties(UObject* Obj, bool bIncludeTransient, int32 MaxProperties, const FString& NameContains)
  {
    TArray<TSharedPtr<FJsonValue>> Out;
    if (!Obj || !Obj->GetClass())
    {
      return Out;
    }

    int32 Added = 0;
    for (TFieldIterator<FProperty> It(Obj->GetClass()); It; ++It)
    {
      if (Added >= MaxProperties)
      {
        break;
      }

      FProperty* Prop = *It;
      if (!Prop)
      {
        continue;
      }

      if (!bIncludeTransient && Prop->HasAnyPropertyFlags(CPF_Transient | CPF_DuplicateTransient | CPF_NonPIEDuplicateTransient))
      {
        continue;
      }

      const FString PropName = Prop->GetName();
      if (!NameContains.IsEmpty() && !PropName.Contains(NameContains, ESearchCase::IgnoreCase))
      {
        continue;
      }

      FString ValueStr;
      const void* ValuePtr = Prop->ContainerPtrToValuePtr<void>(Obj);
      if (ValuePtr)
      {
        Prop->ExportTextItem_Direct(ValueStr, ValuePtr, nullptr, Obj, PPF_None);
      }

      TSharedPtr<FJsonObject> P = MakeShared<FJsonObject>();
      P->SetStringField(TEXT("name"), PropName);
      P->SetStringField(TEXT("type"), Prop->GetCPPType());
      P->SetStringField(TEXT("value"), ValueStr);
      Out.Add(MakeShared<FJsonValueObject>(P));
      Added++;
    }

    return Out;
  }

  // Avoid naming collisions with UE helpers like `MakeError(...)`.
  TSharedPtr<FJsonObject> MakeJsonErrorResponse(const FString& RequestId, const FString& Code, const FString& Message)
  {
    TSharedPtr<FJsonObject> Root = MakeShared<FJsonObject>();
    Root->SetNumberField(TEXT("protocol_version"), 1);
    Root->SetStringField(TEXT("request_id"), RequestId);
    Root->SetBoolField(TEXT("ok"), false);

    TSharedPtr<FJsonObject> Err = MakeShared<FJsonObject>();
    Err->SetStringField(TEXT("code"), Code);
    Err->SetStringField(TEXT("message"), Message);
    Root->SetObjectField(TEXT("error"), Err);
    return Root;
  }

  TSharedPtr<FJsonObject> MakeJsonSuccessResponse(const FString& RequestId, TSharedPtr<FJsonObject> Result)
  {
    TSharedPtr<FJsonObject> Root = MakeShared<FJsonObject>();
    Root->SetNumberField(TEXT("protocol_version"), 1);
    Root->SetStringField(TEXT("request_id"), RequestId);
    Root->SetBoolField(TEXT("ok"), true);
    Root->SetObjectField(TEXT("result"), Result);
    return Root;
  }

  FString ToLine(const TSharedPtr<FJsonObject>& Obj)
  {
    FString Out;
    // The TCP protocol is newline-delimited, so the JSON itself must not contain newlines.
    const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
      TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
    FJsonSerializer::Serialize(Obj.ToSharedRef(), Writer);
    Out.AppendChar(TEXT('\n'));
    return Out;
  }

  TArray<TSharedPtr<FJsonValue>> VecToJson(const FVector& V)
  {
    TArray<TSharedPtr<FJsonValue>> Arr;
    Arr.Add(MakeShared<FJsonValueNumber>(V.X));
    Arr.Add(MakeShared<FJsonValueNumber>(V.Y));
    Arr.Add(MakeShared<FJsonValueNumber>(V.Z));
    return Arr;
  }

  TArray<TSharedPtr<FJsonValue>> RotToJson(const FRotator& R)
  {
    TArray<TSharedPtr<FJsonValue>> Arr;
    Arr.Add(MakeShared<FJsonValueNumber>(R.Pitch));
    Arr.Add(MakeShared<FJsonValueNumber>(R.Yaw));
    Arr.Add(MakeShared<FJsonValueNumber>(R.Roll));
    return Arr;
  }

  FString MobilityToString(EComponentMobility::Type Mobility)
  {
    switch (Mobility)
    {
      case EComponentMobility::Static: return TEXT("Static");
      case EComponentMobility::Stationary: return TEXT("Stationary");
      case EComponentMobility::Movable: return TEXT("Movable");
      default: return TEXT("Unknown");
    }
  }

  // Runs on the server thread. Most Unreal APIs require the game thread.
  TSharedPtr<FJsonObject> HandleOnGameThreadBlocking(const FString& Method, const TSharedPtr<FJsonObject>& Params, bool& bCompleted)
  {
    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    FEvent* Done = FPlatformProcess::GetSynchEventFromPool(true);

    AsyncTask(ENamedThreads::GameThread, [Done, &Result, Method, Params]() {
      if (Method == TEXT("get_editor_status"))
      {
        bool bEditorReady = (GEditor != nullptr);
        FString PieState = TEXT("unknown");
        if (GEditor)
        {
          if (GEditor->PlayWorld)
          {
            PieState = TEXT("running");
          }
          else
          {
            PieState = TEXT("stopped");
          }
        }

        Result->SetBoolField(TEXT("editor_ready"), bEditorReady);
        Result->SetStringField(TEXT("pie_state"), PieState);
      }
      else if (Method == TEXT("get_engine_version"))
      {
        Result->SetStringField(TEXT("engine_version"), FEngineVersion::Current().ToString());
      }
      else if (Method == TEXT("get_current_project"))
      {
        Result->SetStringField(TEXT("project_name"), FApp::GetProjectName());
        Result->SetStringField(TEXT("project_dir"), FPaths::ProjectDir());
      }
      else if (Method == TEXT("get_plugin_version"))
      {
        Result->SetStringField(TEXT("plugin_name"), TEXT("UnrealDebugCopilot"));
        Result->SetNumberField(TEXT("protocol_version"), 1);

        TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin(TEXT("UnrealDebugCopilot"));
        if (Plugin.IsValid())
        {
          const FPluginDescriptor& Desc = Plugin->GetDescriptor();
          Result->SetStringField(TEXT("plugin_version"), Desc.VersionName);
          Result->SetNumberField(TEXT("plugin_version_number"), Desc.Version);
          Result->SetStringField(TEXT("plugin_friendly_name"), Desc.FriendlyName);
        }
      }
      else if (Method == TEXT("get_protocol_capabilities"))
      {
        Result->SetNumberField(TEXT("protocol_version"), 1);

        // Keep this in sync with the server-side dispatch; it's a best-effort introspection surface.
        const TCHAR* Methods[] = {
          TEXT("ping"),
          TEXT("get_editor_status"),
          TEXT("get_engine_version"),
          TEXT("get_current_project"),
          TEXT("get_plugin_version"),
          TEXT("get_protocol_capabilities"),
          TEXT("get_open_editors"),
          TEXT("get_active_blueprint"),
          TEXT("get_selected_actors"),
          TEXT("get_component_tree"),
          TEXT("list_assets"),
          TEXT("inspect_object"),
          TEXT("inspect_blueprint")
        };

        TArray<TSharedPtr<FJsonValue>> Supported;
        for (const TCHAR* M : Methods)
        {
          Supported.Add(MakeShared<FJsonValueString>(M));
        }
        Result->SetArrayField(TEXT("supported_methods"), Supported);
      }
      else if (Method == TEXT("get_selected_actors"))
      {
        TArray<TSharedPtr<FJsonValue>> Actors;
        if (GEditor)
        {
          USelection* Selection = GEditor->GetSelectedActors();
          for (FSelectionIterator It(*Selection); It; ++It)
          {
            AActor* Actor = Cast<AActor>(*It);
            if (!Actor)
            {
              continue;
            }

            TSharedPtr<FJsonObject> A = MakeShared<FJsonObject>();
            A->SetStringField(TEXT("name"), Actor->GetName());
            A->SetStringField(TEXT("class"), Actor->GetClass() ? Actor->GetClass()->GetName() : TEXT(""));
            A->SetArrayField(TEXT("location"), VecToJson(Actor->GetActorLocation()));
            A->SetArrayField(TEXT("rotation"), RotToJson(Actor->GetActorRotation()));
            A->SetArrayField(TEXT("scale"), VecToJson(Actor->GetActorScale3D()));
            A->SetBoolField(TEXT("hidden"), Actor->IsHidden());
            A->SetBoolField(TEXT("pending_kill"), Actor->IsPendingKillPending());
            Actors.Add(MakeShared<FJsonValueObject>(A));
          }
        }

        Result->SetArrayField(TEXT("actors"), Actors);
      }
      else if (Method == TEXT("get_open_editors"))
      {
        TArray<TSharedPtr<FJsonValue>> Editors;
        if (GEditor)
        {
          UAssetEditorSubsystem* AssetEditorSubsystem = GEditor->GetEditorSubsystem<UAssetEditorSubsystem>();
          if (AssetEditorSubsystem)
          {
            const TArray<UObject*> EditedAssets = AssetEditorSubsystem->GetAllEditedAssets();
            for (UObject* Asset : EditedAssets)
            {
              if (!Asset)
              {
                continue;
              }

              TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
              Obj->SetStringField(TEXT("name"), Asset->GetName());
              Obj->SetStringField(TEXT("class"), Asset->GetClass() ? Asset->GetClass()->GetName() : TEXT(""));
              Obj->SetStringField(TEXT("object_path"), Asset->GetPathName());
              Obj->SetStringField(TEXT("asset_path"), Asset->GetOutermost() ? Asset->GetOutermost()->GetName() : TEXT(""));
              Editors.Add(MakeShared<FJsonValueObject>(Obj));
            }
          }
        }

        Result->SetArrayField(TEXT("editors"), Editors);
      }
      else if (Method == TEXT("get_active_blueprint"))
      {
        FString AssetPath;
        FString ObjectPath;
        int32 OpenBlueprintCount = 0;

        if (GEditor)
        {
          UAssetEditorSubsystem* AssetEditorSubsystem = GEditor->GetEditorSubsystem<UAssetEditorSubsystem>();
          if (AssetEditorSubsystem)
          {
            TArray<UBlueprint*> Blueprints;
            const TArray<UObject*> EditedAssets = AssetEditorSubsystem->GetAllEditedAssets();
            for (UObject* Asset : EditedAssets)
            {
              if (UBlueprint* BP = Cast<UBlueprint>(Asset))
              {
                Blueprints.Add(BP);
              }
            }

            Blueprints.Sort([](const UBlueprint& A, const UBlueprint& B) {
              return A.GetPathName() < B.GetPathName();
            });

            OpenBlueprintCount = Blueprints.Num();
            if (Blueprints.Num() > 0)
            {
              UBlueprint* Chosen = Blueprints[0];
              ObjectPath = Chosen->GetPathName();
              AssetPath = Chosen->GetOutermost() ? Chosen->GetOutermost()->GetName() : TEXT("");
            }
          }
        }

        Result->SetStringField(TEXT("asset_path"), AssetPath);
        Result->SetStringField(TEXT("object_path"), ObjectPath);
        Result->SetNumberField(TEXT("open_blueprint_count"), OpenBlueprintCount);
        if (OpenBlueprintCount > 1)
        {
          Result->SetStringField(
            TEXT("note"),
            TEXT("Multiple Blueprint editors are open; returning the first Blueprint by object path sort (not necessarily focused).")
          );
        }
      }
      else if (Method == TEXT("get_component_tree"))
      {
        FString ActorName;
        if (Params.IsValid())
        {
          Params->TryGetStringField(TEXT("actor_name"), ActorName);
        }

        AActor* Target = nullptr;
        if (ActorName.IsEmpty())
        {
          // Default: first selected actor.
          if (GEditor)
          {
            if (USelection* Selection = GEditor->GetSelectedActors())
            {
              for (FSelectionIterator It(*Selection); It; ++It)
              {
                if (AActor* Actor = Cast<AActor>(*It))
                {
                  Target = Actor;
                  break;
                }
              }
            }
          }
        }
        else
        {
          Target = FindActorBestEffort(ActorName);
        }

        Result->SetStringField(TEXT("actor"), Target ? Target->GetName() : TEXT(""));

        TArray<TSharedPtr<FJsonValue>> Components;
        if (Target)
        {
          // Breadth-first walk from root scene component.
          TArray<USceneComponent*> Queue;
          if (USceneComponent* Root = Target->GetRootComponent())
          {
            Queue.Add(Root);
          }

          while (Queue.Num() > 0)
          {
            USceneComponent* C = Queue[0];
            Queue.RemoveAt(0);
            if (!C)
            {
              continue;
            }

            TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
            Obj->SetStringField(TEXT("name"), C->GetName());
            Obj->SetStringField(TEXT("class"), C->GetClass() ? C->GetClass()->GetName() : TEXT(""));
            Obj->SetStringField(TEXT("parent"), C->GetAttachParent() ? C->GetAttachParent()->GetName() : TEXT(""));
            Obj->SetArrayField(TEXT("relative_location"), VecToJson(C->GetRelativeLocation()));
            Obj->SetArrayField(TEXT("world_location"), VecToJson(C->GetComponentLocation()));
            Obj->SetStringField(TEXT("mobility"), MobilityToString(C->Mobility));
            Components.Add(MakeShared<FJsonValueObject>(Obj));

            TArray<USceneComponent*> Children;
            C->GetChildrenComponents(false, Children);
            for (USceneComponent* Child : Children)
            {
              Queue.Add(Child);
            }
          }
        }

        Result->SetArrayField(TEXT("components"), Components);
      }
      else if (Method == TEXT("list_assets"))
      {
        FString Path = TEXT("/Game");
        FString ClassName;
        bool bRecursive = true;
        int32 Limit = 200;
        FString NameContains;

        if (Params.IsValid())
        {
          Params->TryGetStringField(TEXT("path"), Path);
          Params->TryGetStringField(TEXT("class"), ClassName);
          Params->TryGetBoolField(TEXT("recursive"), bRecursive);
          double LimitNum = 0;
          if (Params->TryGetNumberField(TEXT("limit"), LimitNum))
          {
            Limit = static_cast<int32>(LimitNum);
          }
          Params->TryGetStringField(TEXT("name_contains"), NameContains);
        }

        if (Limit <= 0)
        {
          Limit = 200;
        }
        Limit = FMath::Min(Limit, 2000);

        TArray<TSharedPtr<FJsonValue>> Assets;
        FAssetRegistryModule& AssetRegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
        IAssetRegistry& AssetRegistry = AssetRegistryModule.Get();

        FARFilter Filter;
        Filter.PackagePaths.Add(*Path);
        Filter.bRecursivePaths = bRecursive;

        if (!ClassName.IsEmpty())
        {
          if (UClass* Class = FindObject<UClass>(ANY_PACKAGE, *ClassName))
          {
            Filter.ClassPaths.Add(Class->GetClassPathName());
          }
          else
          {
            Result->SetStringField(TEXT("class_note"), TEXT("Class filter not resolved (expected a UClass name like 'Blueprint' or 'StaticMesh'). Ignoring class filter."));
          }
        }

        TArray<FAssetData> Found;
        AssetRegistry.GetAssets(Filter, Found);

        int32 Added = 0;
        for (const FAssetData& A : Found)
        {
          if (Added >= Limit)
          {
            break;
          }

          const FString AssetName = A.AssetName.ToString();
          if (!NameContains.IsEmpty() && !AssetName.Contains(NameContains, ESearchCase::IgnoreCase))
          {
            continue;
          }

          TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
          Obj->SetStringField(TEXT("name"), AssetName);
          Obj->SetStringField(TEXT("class"), A.AssetClassPath.ToString());
          Obj->SetStringField(TEXT("asset_path"), A.PackageName.ToString());
          Obj->SetStringField(TEXT("object_path"), A.GetObjectPathString());
          Assets.Add(MakeShared<FJsonValueObject>(Obj));
          Added++;
        }

        Result->SetArrayField(TEXT("assets"), Assets);
        Result->SetNumberField(TEXT("returned"), Added);
        Result->SetNumberField(TEXT("matched"), Found.Num());
      }
      else if (Method == TEXT("inspect_object"))
      {
        FString ObjectPath;
        FString AssetPath;
        FString ActorName;
        bool bIncludeTransient = false;
        int32 MaxProperties = 200;
        FString NameContains;

        if (Params.IsValid())
        {
          Params->TryGetStringField(TEXT("object_path"), ObjectPath);
          Params->TryGetStringField(TEXT("asset_path"), AssetPath);
          Params->TryGetStringField(TEXT("actor_name"), ActorName);
          Params->TryGetBoolField(TEXT("include_transient"), bIncludeTransient);
          double MaxPropsNum = 0;
          if (Params->TryGetNumberField(TEXT("max_properties"), MaxPropsNum))
          {
            MaxProperties = static_cast<int32>(MaxPropsNum);
          }
          Params->TryGetStringField(TEXT("name_contains"), NameContains);
        }

        UObject* Obj = nullptr;
        if (!ActorName.IsEmpty())
        {
          Obj = FindActorBestEffort(ActorName);
        }
        else if (!ObjectPath.IsEmpty())
        {
          Obj = LoadObjectByPathBestEffort(ObjectPath);
        }
        else if (!AssetPath.IsEmpty())
        {
          Obj = LoadObjectByPathBestEffort(AssetPath);
        }

        Result->SetStringField(TEXT("name"), Obj ? Obj->GetName() : TEXT(""));
        Result->SetStringField(TEXT("class"), Obj && Obj->GetClass() ? Obj->GetClass()->GetName() : TEXT(""));
        Result->SetStringField(TEXT("object_path"), Obj ? Obj->GetPathName() : TEXT(""));
        Result->SetStringField(TEXT("asset_path"), Obj && Obj->GetOutermost() ? Obj->GetOutermost()->GetName() : TEXT(""));
        Result->SetStringField(TEXT("outer"), Obj && Obj->GetOuter() ? Obj->GetOuter()->GetPathName() : TEXT(""));

        MaxProperties = FMath::Clamp(MaxProperties, 0, 2000);
        Result->SetArrayField(TEXT("properties"), ExportObjectProperties(Obj, bIncludeTransient, MaxProperties, NameContains));
      }
      else if (Method == TEXT("inspect_blueprint"))
      {
        FString ObjectPath;
        FString AssetPath;
        bool bIncludeCdoProperties = false;
        bool bIncludeTransient = false;
        int32 MaxProperties = 200;
        FString NameContains;
        bool bUseActiveIfMissing = true;

        if (Params.IsValid())
        {
          Params->TryGetStringField(TEXT("object_path"), ObjectPath);
          Params->TryGetStringField(TEXT("asset_path"), AssetPath);
          Params->TryGetBoolField(TEXT("include_cdo_properties"), bIncludeCdoProperties);
          Params->TryGetBoolField(TEXT("include_transient"), bIncludeTransient);
          double MaxPropsNum = 0;
          if (Params->TryGetNumberField(TEXT("max_properties"), MaxPropsNum))
          {
            MaxProperties = static_cast<int32>(MaxPropsNum);
          }
          Params->TryGetStringField(TEXT("name_contains"), NameContains);
          Params->TryGetBoolField(TEXT("use_active_if_missing"), bUseActiveIfMissing);
        }

        UBlueprint* BP = nullptr;
        if (!ObjectPath.IsEmpty())
        {
          BP = Cast<UBlueprint>(LoadObjectByPathBestEffort(ObjectPath));
        }
        else if (!AssetPath.IsEmpty())
        {
          BP = Cast<UBlueprint>(LoadObjectByPathBestEffort(AssetPath));
        }
        else if (bUseActiveIfMissing && GEditor)
        {
          UAssetEditorSubsystem* AssetEditorSubsystem = GEditor->GetEditorSubsystem<UAssetEditorSubsystem>();
          if (AssetEditorSubsystem)
          {
            TArray<UBlueprint*> Blueprints;
            const TArray<UObject*> EditedAssets = AssetEditorSubsystem->GetAllEditedAssets();
            for (UObject* Asset : EditedAssets)
            {
              if (UBlueprint* EditedBP = Cast<UBlueprint>(Asset))
              {
                Blueprints.Add(EditedBP);
              }
            }
            Blueprints.Sort([](const UBlueprint& A, const UBlueprint& B) {
              return A.GetPathName() < B.GetPathName();
            });
            if (Blueprints.Num() > 0)
            {
              BP = Blueprints[0];
            }
          }
        }

        Result->SetStringField(TEXT("name"), BP ? BP->GetName() : TEXT(""));
        Result->SetStringField(TEXT("class"), BP && BP->GetClass() ? BP->GetClass()->GetName() : TEXT(""));
        Result->SetStringField(TEXT("object_path"), BP ? BP->GetPathName() : TEXT(""));
        Result->SetStringField(TEXT("asset_path"), BP && BP->GetOutermost() ? BP->GetOutermost()->GetName() : TEXT(""));
        Result->SetStringField(TEXT("parent_class"), BP && BP->ParentClass ? BP->ParentClass->GetPathName() : TEXT(""));
        Result->SetStringField(TEXT("generated_class"), BP && BP->GeneratedClass ? BP->GeneratedClass->GetPathName() : TEXT(""));
        Result->SetStringField(TEXT("blueprint_type"), BP ? StaticEnum<EBlueprintType>()->GetNameStringByValue(static_cast<int64>(BP->BlueprintType)) : TEXT(""));

        TArray<TSharedPtr<FJsonValue>> Vars;
        TArray<TSharedPtr<FJsonValue>> FunctionGraphs;
        TArray<TSharedPtr<FJsonValue>> MacroGraphs;
        TArray<TSharedPtr<FJsonValue>> UbergraphPages;
        TArray<TSharedPtr<FJsonValue>> Components;

        if (BP)
        {
          for (const FBPVariableDescription& V : BP->NewVariables)
          {
            TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
            Obj->SetStringField(TEXT("name"), V.VarName.ToString());
            Obj->SetStringField(TEXT("type"), PinTypeToString(V.VarType));
            Obj->SetStringField(TEXT("category"), V.Category.ToString());
            Obj->SetBoolField(TEXT("instance_editable"), V.PropertyFlags & CPF_Edit);
            Vars.Add(MakeShared<FJsonValueObject>(Obj));
          }

          for (UEdGraph* G : BP->FunctionGraphs)
          {
            if (G)
            {
              FunctionGraphs.Add(MakeShared<FJsonValueString>(G->GetName()));
            }
          }
          for (UEdGraph* G : BP->MacroGraphs)
          {
            if (G)
            {
              MacroGraphs.Add(MakeShared<FJsonValueString>(G->GetName()));
            }
          }
          for (UEdGraph* G : BP->UbergraphPages)
          {
            if (G)
            {
              UbergraphPages.Add(MakeShared<FJsonValueString>(G->GetName()));
            }
          }

          if (USimpleConstructionScript* SCS = BP->SimpleConstructionScript)
          {
            UBlueprintGeneratedClass* BPGC = Cast<UBlueprintGeneratedClass>(BP->GeneratedClass);
            TArray<USCS_Node*> Nodes = SCS->GetAllNodes();
            for (USCS_Node* N : Nodes)
            {
              if (!N)
              {
                continue;
              }

              UActorComponent* Template = BPGC ? N->GetActualComponentTemplate(BPGC) : nullptr;
              TSharedPtr<FJsonObject> C = MakeShared<FJsonObject>();
              C->SetStringField(TEXT("name"), N->GetVariableName().ToString());
              C->SetStringField(TEXT("component_class"), Template && Template->GetClass() ? Template->GetClass()->GetName() : TEXT(""));
              // USCS_Node no longer exposes GetParent()/GetAttachToName() in UE 5.6; use the public fields instead.
              C->SetStringField(TEXT("parent"), N->ParentComponentOrVariableName.ToString());
              C->SetStringField(TEXT("attach_socket"), N->AttachToName.ToString());
              Components.Add(MakeShared<FJsonValueObject>(C));
            }
          }
        }

        Result->SetArrayField(TEXT("variables"), Vars);
        Result->SetArrayField(TEXT("function_graphs"), FunctionGraphs);
        Result->SetArrayField(TEXT("macro_graphs"), MacroGraphs);
        Result->SetArrayField(TEXT("ubergraph_pages"), UbergraphPages);
        Result->SetArrayField(TEXT("components"), Components);

        if (BP && bIncludeCdoProperties && BP->GeneratedClass)
        {
          UObject* CDO = BP->GeneratedClass->GetDefaultObject();
          MaxProperties = FMath::Clamp(MaxProperties, 0, 2000);
          Result->SetArrayField(TEXT("cdo_properties"), ExportObjectProperties(CDO, bIncludeTransient, MaxProperties, NameContains));
          Result->SetStringField(TEXT("cdo_object_path"), CDO ? CDO->GetPathName() : TEXT(""));
        }
      }

      Done->Trigger();
    });

    bCompleted = Done->Wait(static_cast<uint32>(kGameThreadWaitSeconds * 1000.0));
    FPlatformProcess::ReturnSynchEventToPool(Done);

    if (!bCompleted)
    {
      return nullptr;
    }

    return Result;
  }

  bool ParseJsonLine(const FString& Line, TSharedPtr<FJsonObject>& OutObj)
  {
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Line);
    return FJsonSerializer::Deserialize(Reader, OutObj) && OutObj.IsValid();
  }
}

class FServerRunnable : public FRunnable
{
public:
  FServerRunnable(const FString& InToken, int32 InPort)
    : Token(InToken), Port(InPort)
  {
  }

  virtual uint32 Run() override
  {
    ISocketSubsystem* SocketSubsystem = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);
    if (!SocketSubsystem)
    {
      return 0;
    }

    Listener = SocketSubsystem->CreateSocket(NAME_Stream, TEXT("UnrealDebugCopilotListener"), false);
    if (!Listener)
    {
      return 0;
    }

    FIPv4Address Addr;
    FIPv4Address::Parse(TEXT("127.0.0.1"), Addr);
    const TSharedRef<FInternetAddr> InternetAddr = SocketSubsystem->CreateInternetAddr();
    InternetAddr->SetIp(Addr.Value);
    InternetAddr->SetPort(Port);

    int32 Reuse = 1;
    Listener->SetReuseAddr(true);
    Listener->SetRecvErr(true);
    Listener->SetLinger(false, 0);
    Listener->SetNonBlocking(true);

    if (!Listener->Bind(*InternetAddr) || !Listener->Listen(16))
    {
      UE_LOG(LogTemp, Error, TEXT("[UnrealDebugCopilot] Failed to bind/listen on 127.0.0.1:%d"), Port);
      SocketSubsystem->DestroySocket(Listener);
      Listener = nullptr;
      return 0;
    }

    UE_LOG(LogTemp, Display, TEXT("[UnrealDebugCopilot] Listening on 127.0.0.1:%d"), Port);
    UE_LOG(LogTemp, Display, TEXT("[UnrealDebugCopilot] Token (set UNREAL_TOKEN for the mcp-server): %s"), *Token);

    while (!bStopRequested)
    {
      bool bHasPending = false;
      if (Listener->HasPendingConnection(bHasPending) && bHasPending)
      {
        TSharedRef<FInternetAddr> ClientAddr = SocketSubsystem->CreateInternetAddr();
        FSocket* Client = Listener->Accept(*ClientAddr, TEXT("UnrealDebugCopilotClient"));
        if (Client)
        {
          Client->SetNonBlocking(false);
          HandleClient(Client);
          SocketSubsystem->DestroySocket(Client);
        }
      }

      FPlatformProcess::Sleep(kAcceptSleepSeconds);
    }

    SocketSubsystem->DestroySocket(Listener);
    Listener = nullptr;
    return 0;
  }

  virtual void Stop() override
  {
    bStopRequested = true;
  }

private:
  void HandleClient(FSocket* Client)
  {
    TArray<uint8> Recv;
    Recv.SetNumUninitialized(4096);

    FString Buffer;
    while (!bStopRequested)
    {
      int32 BytesRead = 0;
      if (!Client->Recv(Recv.GetData(), Recv.Num(), BytesRead))
      {
        return;
      }
      if (BytesRead <= 0)
      {
        return;
      }

      // Convert raw UTF-8 bytes into TCHARs without assuming null-termination.
      const FUTF8ToTCHAR Convert(reinterpret_cast<const ANSICHAR*>(Recv.GetData()), BytesRead);
      Buffer.AppendChars(Convert.Get(), Convert.Length());
      if (Buffer.Len() > kMaxLineBytes)
      {
        return;
      }

      int32 NewlineIndex = INDEX_NONE;
      if (!Buffer.FindChar(TEXT('\n'), NewlineIndex))
      {
        continue;
      }

      const FString Line = Buffer.Left(NewlineIndex).TrimStartAndEnd();
      Buffer = Buffer.Mid(NewlineIndex + 1);

      TSharedPtr<FJsonObject> Req;
       if (!ParseJsonLine(Line, Req))
       {
        const FString ErrLine = ToLine(MakeJsonErrorResponse(TEXT(""), TEXT("INVALID_REQUEST"), TEXT("Invalid JSON")));
        SendLine(Client, ErrLine);
        return;
       }

      FString RequestId;
      FString InToken;
      FString Method;

      const bool bHasRequestId = Req->TryGetStringField(TEXT("request_id"), RequestId);
      const bool bHasToken = Req->TryGetStringField(TEXT("token"), InToken);
      const bool bHasMethod = Req->TryGetStringField(TEXT("method"), Method);
       if (!bHasRequestId || !bHasToken || !bHasMethod)
       {
        SendLine(Client, ToLine(MakeJsonErrorResponse(TEXT(""), TEXT("INVALID_REQUEST"), TEXT("Missing required fields"))));
        return;
       }

       if (InToken != Token)
       {
        SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("UNAUTHORIZED"), TEXT("Bad token"))));
        return;
       }

      if (Method == TEXT("ping"))
      {
         TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
         Result->SetBoolField(TEXT("pong"), true);
        SendLine(Client, ToLine(MakeJsonSuccessResponse(RequestId, Result)));
         return;
      }

      const TSharedPtr<FJsonObject>* ParamsPtr = nullptr;
      TSharedPtr<FJsonObject> Params;
      if (Req->TryGetObjectField(TEXTVIEW("params"), ParamsPtr) && ParamsPtr && ParamsPtr->IsValid())
      {
        Params = *ParamsPtr;
      }

       if (
         Method == TEXT("get_editor_status") || Method == TEXT("get_engine_version") || Method == TEXT("get_current_project") ||
         Method == TEXT("get_plugin_version") || Method == TEXT("get_protocol_capabilities"))
       {
         bool bCompleted = false;
         TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, nullptr, bCompleted);
         if (!bCompleted || !Result.IsValid())
         {
          SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("REQUEST_TIMEOUT"), TEXT("Timed out waiting for game thread"))));
          return;
        }

        SendLine(Client, ToLine(MakeJsonSuccessResponse(RequestId, Result)));
        return;
      }

      if (Method == TEXT("get_open_editors"))
      {
        bool bCompleted = false;
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, nullptr, bCompleted);
        if (!bCompleted || !Result.IsValid())
        {
          SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("REQUEST_TIMEOUT"), TEXT("Timed out waiting for game thread"))));
          return;
        }

        SendLine(Client, ToLine(MakeJsonSuccessResponse(RequestId, Result)));
        return;
      }

      if (Method == TEXT("get_active_blueprint"))
      {
        bool bCompleted = false;
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, nullptr, bCompleted);
        if (!bCompleted || !Result.IsValid())
        {
          SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("REQUEST_TIMEOUT"), TEXT("Timed out waiting for game thread"))));
          return;
        }

        FString AssetPath;
        Result->TryGetStringField(TEXT("asset_path"), AssetPath);
        if (AssetPath.IsEmpty())
        {
          SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("BLUEPRINT_NOT_FOUND"), TEXT("No Blueprint asset editor is open"))));
          return;
        }

        SendLine(Client, ToLine(MakeJsonSuccessResponse(RequestId, Result)));
        return;
      }

      if (Method == TEXT("get_selected_actors"))
      {
        bool bCompleted = false;
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, nullptr, bCompleted);
        if (!bCompleted || !Result.IsValid())
        {
          SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("REQUEST_TIMEOUT"), TEXT("Timed out waiting for game thread"))));
          return;
        }

        SendLine(Client, ToLine(MakeJsonSuccessResponse(RequestId, Result)));
        return;
      }

      if (Method == TEXT("get_component_tree"))
      {
        bool bCompleted = false;
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, Params, bCompleted);
        if (!bCompleted || !Result.IsValid())
        {
          SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("REQUEST_TIMEOUT"), TEXT("Timed out waiting for game thread"))));
          return;
        }

        // Fail fast if the actor was not found/selected.
        FString OutActor;
        Result->TryGetStringField(TEXT("actor"), OutActor);
        if (OutActor.IsEmpty())
        {
          SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("ACTOR_NOT_FOUND"), TEXT("No matching actor (selection or actor_name)"))));
          return;
        }

        SendLine(Client, ToLine(MakeJsonSuccessResponse(RequestId, Result)));
        return;
      }

      if (Method == TEXT("list_assets") || Method == TEXT("inspect_object") || Method == TEXT("inspect_blueprint"))
      {
        bool bCompleted = false;
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, Params, bCompleted);
        if (!bCompleted || !Result.IsValid())
        {
          SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("REQUEST_TIMEOUT"), TEXT("Timed out waiting for game thread"))));
          return;
        }

        // For inspect_* fail fast when no object is found.
        if (Method == TEXT("inspect_object") || Method == TEXT("inspect_blueprint"))
        {
          FString OutObjectPath;
          Result->TryGetStringField(TEXT("object_path"), OutObjectPath);
          if (OutObjectPath.IsEmpty())
          {
            SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("OBJECT_NOT_FOUND"), TEXT("Object not found (check object_path/asset_path/actor_name)"))));
            return;
          }
        }

        SendLine(Client, ToLine(MakeJsonSuccessResponse(RequestId, Result)));
        return;
      }

      SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("INVALID_REQUEST"), TEXT("Unknown method"))));
      return;
    }
  }

  void SendLine(FSocket* Client, const FString& Line)
  {
    FTCHARToUTF8 Convert(*Line);
    int32 BytesSent = 0;
    Client->Send(reinterpret_cast<const uint8*>(Convert.Get()), Convert.Length(), BytesSent);
  }

private:
  FString Token;
  int32 Port = 17777;
  FSocket* Listener = nullptr;
  std::atomic<bool> bStopRequested{false};
};

FCopilotTcpServer::FCopilotTcpServer(const FString& InToken, int32 InPort)
  : Token(InToken), Port(InPort)
{
}

FCopilotTcpServer::~FCopilotTcpServer()
{
  Stop();
}

void FCopilotTcpServer::Start()
{
  if (Thread)
  {
    return;
  }

  Runnable = new FServerRunnable(Token, Port);
  Thread = FRunnableThread::Create(Runnable, TEXT("UnrealDebugCopilotServer"));
}

void FCopilotTcpServer::Stop()
{
  if (!Thread)
  {
    return;
  }

  Runnable->Stop();
  Thread->WaitForCompletion();
  delete Thread;
  Thread = nullptr;
  delete Runnable;
  Runnable = nullptr;
}
