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

#include "ContentBrowserModule.h"
#include "IContentBrowserSingleton.h"
#include "EditorViewportClient.h"
#include "FileHelpers.h"
#include "ScopedTransaction.h"
#include "Framework/Application/SlateApplication.h"
#include "Widgets/SWindow.h"
#include "EditorModeManager.h"

#include "Misc/Guid.h"

#include "Components/SceneComponent.h"
#include "Engine/Blueprint.h"
#include "Engine/SCS_Node.h"
#include "Engine/SimpleConstructionScript.h"
#include "Engine/TimelineTemplate.h"
#include "GameFramework/Actor.h"
#include "Subsystems/AssetEditorSubsystem.h"
#include "Sockets.h"
#include "SocketSubsystem.h"
#include "EngineUtils.h"
#include "UObject/UObjectGlobals.h"
#include "UObject/UnrealType.h"
#include "EdGraph/EdGraphPin.h"
#include "EdGraph/EdGraph.h"
#include "EdGraph/EdGraphNode.h"
#include "EdGraphNode_Comment.h"

// Blueprint compilation
#include "Kismet2/KismetEditorUtilities.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/CompilerResultsLog.h"

// Diagnostic message tokens
#include "Logging/TokenizedMessage.h"
#include "Misc/UObjectToken.h"

#include <atomic>

namespace
{
  constexpr int32 kMaxLineBytes = 256 * 1024;
  constexpr float kAcceptSleepSeconds = 0.01f;
  constexpr double kDefaultGameThreadWaitSeconds = 2.0;
  constexpr double kCompileGameThreadWaitSeconds = 30.0;

  FCriticalSection GCompileMutex;

  // Single active transaction for safe write workflows (v0.1 primitive).
  TUniquePtr<FScopedTransaction> GActiveTransaction;
  FString GActiveTransactionId;

  // Stores the last captured compile/diagnostic payloads so follow-up tools can query details.
  // Keys are Blueprint object path (preferred) or asset/package path.
  TMap<FString, TSharedPtr<FJsonObject>> GLastCompileByBlueprint;
  TSharedPtr<FJsonObject> GLastCompileAny;
  TMap<FString, TSharedPtr<FJsonObject>> GLastSuccessfulCompileByBlueprint;

  FString SeverityToString(EMessageSeverity::Type Sev)
  {
    switch (Sev)
    {
      case EMessageSeverity::Error: return TEXT("error");
      case EMessageSeverity::Warning: return TEXT("warning");
      case EMessageSeverity::Info: return TEXT("info");
      case EMessageSeverity::PerformanceWarning: return TEXT("warning");
      default: return TEXT("note");
    }
  }

  double GameThreadWaitSecondsForMethod(const FString& Method)
  {
    if (
      Method.StartsWith(TEXT("compile_")) ||
      Method.StartsWith(TEXT("get_compile_")) ||
      Method.StartsWith(TEXT("validate_blueprint")) ||
      Method == TEXT("refresh_blueprint_nodes") ||
      Method == TEXT("reconstruct_blueprint_node") ||
      Method == TEXT("reinstance_blueprint")
    )
    {
      // Compilation and validation can easily exceed the default 2s.
      return kCompileGameThreadWaitSeconds;
    }
    return kDefaultGameThreadWaitSeconds;
  }

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

  UBlueprint* ResolveBlueprintBestEffort(const TSharedPtr<FJsonObject>& Params)
  {
    FString ObjectPath;
    FString AssetPath;
    bool bUseActiveIfMissing = true;

    if (Params.IsValid())
    {
      Params->TryGetStringField(TEXT("object_path"), ObjectPath);
      Params->TryGetStringField(TEXT("asset_path"), AssetPath);
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

    return BP;
  }

  UEdGraph* ResolveGraphBestEffort(UBlueprint* BP, const FString& GraphName, FString& OutGraphType)
  {
    OutGraphType = TEXT("unknown");
    if (!BP)
    {
      return nullptr;
    }

    auto FindByName = [&GraphName](const TArray<UEdGraph*>& Graphs) -> UEdGraph* {
      for (UEdGraph* G : Graphs)
      {
        if (G && !GraphName.IsEmpty() && G->GetName() == GraphName)
        {
          return G;
        }
      }
      return nullptr;
    };

    if (!GraphName.IsEmpty())
    {
      if (UEdGraph* G = FindByName(BP->UbergraphPages))
      {
        OutGraphType = TEXT("ubergraph");
        return G;
      }
      if (UEdGraph* G = FindByName(BP->FunctionGraphs))
      {
        OutGraphType = TEXT("function");
        return G;
      }
      if (UEdGraph* G = FindByName(BP->MacroGraphs))
      {
        OutGraphType = TEXT("macro");
        return G;
      }
    }

    if (BP->UbergraphPages.Num() > 0 && BP->UbergraphPages[0])
    {
      OutGraphType = TEXT("ubergraph");
      return BP->UbergraphPages[0];
    }
    if (BP->FunctionGraphs.Num() > 0 && BP->FunctionGraphs[0])
    {
      OutGraphType = TEXT("function");
      return BP->FunctionGraphs[0];
    }
    if (BP->MacroGraphs.Num() > 0 && BP->MacroGraphs[0])
    {
      OutGraphType = TEXT("macro");
      return BP->MacroGraphs[0];
    }

    return nullptr;
  }

  bool IsExecPin(const UEdGraphPin* Pin)
  {
    if (!Pin)
    {
      return false;
    }
    // Avoid BlueprintGraph module dependency; K2 exec pins use category "exec".
    return Pin->PinType.PinCategory == FName(TEXT("exec"));
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

           // v0.1 transaction primitives
           TEXT("begin_transaction"),
           TEXT("end_transaction"),
           TEXT("cancel_transaction"),

           TEXT("get_current_level"),
          TEXT("get_open_levels"),
          TEXT("get_open_editors"),
          TEXT("get_open_asset_editors"),
          TEXT("get_active_asset_editor"),
          TEXT("get_active_blueprint"),
          TEXT("get_active_blueprint_graph"),
          TEXT("get_selected_blueprint_nodes"),
          TEXT("get_focused_blueprint_node"),
          TEXT("get_selected_assets"),
          TEXT("get_selected_actors"),
          TEXT("get_selected_components"),
          TEXT("get_world_outliner_selection"),
          TEXT("get_editor_viewport_state"),
          TEXT("get_content_browser_path"),
          TEXT("get_editor_mode"),
          TEXT("get_dirty_assets"),
          TEXT("get_pending_editor_notifications"),
          TEXT("get_message_log_summary"),
           TEXT("get_component_tree"),
           TEXT("list_assets"),
           TEXT("inspect_object"),
           TEXT("inspect_blueprint"),
           TEXT("get_blueprint_graph"),
           TEXT("get_blueprint_dependencies"),
           TEXT("get_blueprint_dependents"),

           // Priority 4 — Compilation and diagnostics
           TEXT("compile_blueprint"),
           TEXT("compile_selected_blueprint"),
           TEXT("compile_blueprints"),
           TEXT("compile_all_dirty_blueprints"),
           TEXT("get_compile_messages"),
           TEXT("get_compile_message_details"),
           TEXT("get_compile_error_nodes"),
           TEXT("get_compile_warning_nodes"),
           TEXT("compile_and_capture_messages"),
           TEXT("get_generated_class_status"),
           TEXT("get_skeleton_class_status"),
           TEXT("get_blueprint_bytecode_summary"),
           TEXT("get_last_successful_compile"),
           TEXT("refresh_blueprint_nodes"),
           TEXT("reconstruct_blueprint_node"),
           TEXT("reinstance_blueprint"),
           TEXT("validate_blueprint_asset"),
           TEXT("validate_blueprint_dependencies")
          };

        TArray<TSharedPtr<FJsonValue>> Supported;
        for (const TCHAR* M : Methods)
        {
          Supported.Add(MakeShared<FJsonValueString>(M));
        }
        Result->SetArrayField(TEXT("supported_methods"), Supported);
      }
      else if (Method == TEXT("begin_transaction"))
      {
        if (GActiveTransaction.IsValid())
        {
          Result->SetStringField(TEXT("error_code"), TEXT("TRANSACTION_ALREADY_ACTIVE"));
          Result->SetStringField(TEXT("error_message"), TEXT("A transaction is already active"));
        }
        else
        {
          FString Desc = TEXT("Unreal MCP Transaction");
          if (Params.IsValid())
          {
            Params->TryGetStringField(TEXT("description"), Desc);
          }

          GActiveTransactionId = FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens);
          GActiveTransaction = MakeUnique<FScopedTransaction>(FText::FromString(Desc));
          Result->SetStringField(TEXT("transaction_id"), GActiveTransactionId);
          Result->SetBoolField(TEXT("active"), true);
        }
      }
      else if (Method == TEXT("end_transaction") || Method == TEXT("cancel_transaction"))
      {
        if (!GActiveTransaction.IsValid())
        {
          Result->SetStringField(TEXT("error_code"), TEXT("TRANSACTION_NOT_ACTIVE"));
          Result->SetStringField(TEXT("error_message"), TEXT("No active transaction"));
        }
        else
        {
          FString RequestedId;
          if (!Params.IsValid() || !Params->TryGetStringField(TEXT("transaction_id"), RequestedId) || RequestedId.IsEmpty())
          {
            Result->SetStringField(TEXT("error_code"), TEXT("INVALID_REQUEST"));
            Result->SetStringField(TEXT("error_message"), TEXT("Missing transaction_id"));
          }
          else if (RequestedId != GActiveTransactionId)
          {
            Result->SetStringField(TEXT("error_code"), TEXT("TRANSACTION_ID_MISMATCH"));
            Result->SetStringField(TEXT("error_message"), TEXT("transaction_id does not match the active transaction"));
            Result->SetStringField(TEXT("active_transaction_id"), GActiveTransactionId);
          }
          else
          {
            if (Method == TEXT("cancel_transaction"))
            {
              GActiveTransaction->Cancel();
            }
            GActiveTransaction.Reset();
            GActiveTransactionId.Empty();
            Result->SetBoolField(TEXT("active"), false);
          }
        }
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
      else if (Method == TEXT("get_open_asset_editors"))
      {
        // RPC alias.
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
      else if (Method == TEXT("get_active_asset_editor"))
      {
        // Best-effort: returns a deterministic choice from open editors.
        TSharedPtr<FJsonObject> Chosen = MakeShared<FJsonObject>();
        bool bHasAny = false;

        if (GEditor)
        {
          UAssetEditorSubsystem* AssetEditorSubsystem = GEditor->GetEditorSubsystem<UAssetEditorSubsystem>();
          if (AssetEditorSubsystem)
          {
            TArray<UObject*> EditedAssets = AssetEditorSubsystem->GetAllEditedAssets();
            EditedAssets.Sort([](const UObject& A, const UObject& B) {
              return A.GetPathName() < B.GetPathName();
            });

            if (EditedAssets.Num() > 0 && EditedAssets[0])
            {
              UObject* Asset = EditedAssets[0];
              Chosen->SetStringField(TEXT("name"), Asset->GetName());
              Chosen->SetStringField(TEXT("class"), Asset->GetClass() ? Asset->GetClass()->GetName() : TEXT(""));
              Chosen->SetStringField(TEXT("object_path"), Asset->GetPathName());
              Chosen->SetStringField(TEXT("asset_path"), Asset->GetOutermost() ? Asset->GetOutermost()->GetName() : TEXT(""));
              bHasAny = true;
            }
          }
        }

        if (bHasAny)
        {
          Result->SetObjectField(TEXT("asset"), Chosen);
          Result->SetStringField(TEXT("note"), TEXT("Best-effort: returned the first open asset editor by object path sort (not necessarily focused)."));
        }
        else
        {
          Result->SetField(TEXT("asset"), MakeShared<FJsonValueNull>());
          Result->SetStringField(TEXT("note"), TEXT("No asset editors are open"));
        }
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
        if (OpenBlueprintCount == 0)
        {
          Result->SetStringField(TEXT("note"), TEXT("No Blueprint asset editor is open"));
        }
      }
      else if (Method == TEXT("get_current_level"))
      {
        UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
        const bool bValid = (World != nullptr);
        Result->SetBoolField(TEXT("is_valid"), bValid);
        Result->SetStringField(TEXT("world_name"), bValid ? World->GetName() : TEXT(""));
        Result->SetStringField(TEXT("map_package"), bValid && World->GetOutermost() ? World->GetOutermost()->GetName() : TEXT(""));
        Result->SetStringField(
          TEXT("persistent_level"),
          bValid && World->PersistentLevel && World->PersistentLevel->GetOutermost() ? World->PersistentLevel->GetOutermost()->GetName() : TEXT("")
        );
      }
      else if (Method == TEXT("get_open_levels"))
      {
        UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
        const bool bValid = (World != nullptr);
        Result->SetBoolField(TEXT("is_valid"), bValid);

        Result->SetStringField(
          TEXT("persistent_level"),
          bValid && World->PersistentLevel && World->PersistentLevel->GetOutermost() ? World->PersistentLevel->GetOutermost()->GetName() : TEXT("")
        );

        TArray<TSharedPtr<FJsonValue>> Levels;
        TArray<TSharedPtr<FJsonValue>> Streaming;

        if (bValid)
        {
          const TArray<ULevel*>& AllLevels = World->GetLevels();
          for (ULevel* L : AllLevels)
          {
            if (!L) continue;
            TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
            Obj->SetStringField(TEXT("package"), L->GetOutermost() ? L->GetOutermost()->GetName() : TEXT(""));
            Obj->SetBoolField(TEXT("is_persistent"), L == World->PersistentLevel);
            Levels.Add(MakeShared<FJsonValueObject>(Obj));
          }

          const TArray<ULevelStreaming*> StreamingLevels = World->GetStreamingLevels();
          for (ULevelStreaming* SL : StreamingLevels)
          {
            if (!SL) continue;
            TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
            Obj->SetStringField(TEXT("package"), SL->GetWorldAssetPackageName());
            Obj->SetBoolField(TEXT("loaded"), SL->IsLevelLoaded());
            Obj->SetBoolField(TEXT("visible"), SL->GetShouldBeVisibleFlag());
            Streaming.Add(MakeShared<FJsonValueObject>(Obj));
          }
        }

        Result->SetArrayField(TEXT("levels"), Levels);
        Result->SetArrayField(TEXT("streaming_levels"), Streaming);
      }
      else if (Method == TEXT("get_selected_assets"))
      {
        TArray<TSharedPtr<FJsonValue>> Assets;

        FContentBrowserModule& ContentBrowserModule = FModuleManager::LoadModuleChecked<FContentBrowserModule>(TEXT("ContentBrowser"));
        TArray<FAssetData> Selected;
        ContentBrowserModule.Get().GetSelectedAssets(Selected);

        for (const FAssetData& A : Selected)
        {
          TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
          Obj->SetStringField(TEXT("name"), A.AssetName.ToString());
          Obj->SetStringField(TEXT("class"), A.AssetClassPath.ToString());
          Obj->SetStringField(TEXT("asset_path"), A.PackageName.ToString());
          Obj->SetStringField(TEXT("object_path"), A.GetObjectPathString());
          Assets.Add(MakeShared<FJsonValueObject>(Obj));
        }

        Result->SetArrayField(TEXT("assets"), Assets);
      }
      else if (Method == TEXT("get_selected_components"))
      {
        TArray<TSharedPtr<FJsonValue>> Components;
        if (GEditor)
        {
          if (USelection* Selection = GEditor->GetSelectedComponents())
          {
            for (FSelectionIterator It(*Selection); It; ++It)
            {
              UActorComponent* C = Cast<UActorComponent>(*It);
              if (!C) continue;

              TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
              Obj->SetStringField(TEXT("name"), C->GetName());
              Obj->SetStringField(TEXT("class"), C->GetClass() ? C->GetClass()->GetName() : TEXT(""));
              Obj->SetStringField(TEXT("owner"), C->GetOwner() ? C->GetOwner()->GetName() : TEXT(""));

              if (USceneComponent* SC = Cast<USceneComponent>(C))
              {
                Obj->SetArrayField(TEXT("relative_location"), VecToJson(SC->GetRelativeLocation()));
                Obj->SetArrayField(TEXT("world_location"), VecToJson(SC->GetComponentLocation()));
              }
              Components.Add(MakeShared<FJsonValueObject>(Obj));
            }
          }
        }
        Result->SetArrayField(TEXT("components"), Components);
      }
      else if (Method == TEXT("get_world_outliner_selection"))
      {
        // Best-effort alias: actors only.
        TArray<TSharedPtr<FJsonValue>> Actors;
        if (GEditor)
        {
          USelection* Selection = GEditor->GetSelectedActors();
          for (FSelectionIterator It(*Selection); It; ++It)
          {
            AActor* Actor = Cast<AActor>(*It);
            if (!Actor) continue;
            TSharedPtr<FJsonObject> A = MakeShared<FJsonObject>();
            A->SetStringField(TEXT("name"), Actor->GetName());
            A->SetStringField(TEXT("class"), Actor->GetClass() ? Actor->GetClass()->GetName() : TEXT(""));
            Actors.Add(MakeShared<FJsonValueObject>(A));
          }
        }
        Result->SetArrayField(TEXT("actors"), Actors);
        Result->SetStringField(TEXT("note"), TEXT("Outliner selection is returned as actors only (best-effort)."));
      }
      else if (Method == TEXT("get_active_blueprint_graph"))
      {
        // Best-effort: derive from the chosen active Blueprint asset (not editor focus).
        FString BPObjectPath;
        FString GraphName;
        FString GraphType;

        UBlueprint* BP = nullptr;
        if (GEditor)
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

        if (BP)
        {
          BPObjectPath = BP->GetPathName();
          if (BP->UbergraphPages.Num() > 0 && BP->UbergraphPages[0])
          {
            GraphName = BP->UbergraphPages[0]->GetName();
            GraphType = TEXT("ubergraph");
          }
          else if (BP->FunctionGraphs.Num() > 0 && BP->FunctionGraphs[0])
          {
            GraphName = BP->FunctionGraphs[0]->GetName();
            GraphType = TEXT("function");
          }
          else if (BP->MacroGraphs.Num() > 0 && BP->MacroGraphs[0])
          {
            GraphName = BP->MacroGraphs[0]->GetName();
            GraphType = TEXT("macro");
          }
        }

        Result->SetStringField(TEXT("blueprint_object_path"), BPObjectPath);
        Result->SetStringField(TEXT("graph_name"), GraphName);
        Result->SetStringField(TEXT("graph_type"), GraphType);
        Result->SetStringField(TEXT("note"), TEXT("Best-effort: does not currently read focused graph from the Blueprint editor UI."));
      }
      else if (Method == TEXT("get_selected_blueprint_nodes"))
      {
        // TODO: Requires integration with the Blueprint editor GraphEditor selection.
        Result->SetArrayField(TEXT("nodes"), TArray<TSharedPtr<FJsonValue>>());
        Result->SetStringField(TEXT("note"), TEXT("Not yet implemented: GraphEditor selection is not exported."));
      }
      else if (Method == TEXT("get_focused_blueprint_node"))
      {
        Result->SetField(TEXT("node"), MakeShared<FJsonValueNull>());
        Result->SetStringField(TEXT("note"), TEXT("Not yet implemented: focused node is not exported."));
      }
      else if (Method == TEXT("get_editor_viewport_state"))
      {
        const FViewport* Viewport = GEditor ? GEditor->GetActiveViewport() : nullptr;
        const FViewportClient* VC = Viewport ? Viewport->GetClient() : nullptr;
        const FEditorViewportClient* EVC = VC ? static_cast<const FEditorViewportClient*>(VC) : nullptr;

        const bool bValid = (EVC != nullptr);
        Result->SetBoolField(TEXT("is_valid"), bValid);
        if (bValid)
        {
          const FVector Loc = EVC->GetViewLocation();
          const FRotator Rot = EVC->GetViewRotation();
          Result->SetArrayField(TEXT("camera_location"), VecToJson(Loc));
          Result->SetArrayField(TEXT("camera_rotation"), RotToJson(Rot));
          Result->SetNumberField(TEXT("view_mode_index"), static_cast<int32>(EVC->GetViewMode()));
        }
        else
        {
          Result->SetArrayField(TEXT("camera_location"), VecToJson(FVector::ZeroVector));
          Result->SetArrayField(TEXT("camera_rotation"), RotToJson(FRotator::ZeroRotator));
          Result->SetNumberField(TEXT("view_mode_index"), -1);
        }
      }
      else if (Method == TEXT("get_content_browser_path"))
      {
        TArray<FString> Paths;
        FContentBrowserModule& ContentBrowserModule = FModuleManager::LoadModuleChecked<FContentBrowserModule>(TEXT("ContentBrowser"));
        ContentBrowserModule.Get().GetSelectedPathViewFolders(Paths);

        Result->SetArrayField(TEXT("paths"), [&Paths]() {
          TArray<TSharedPtr<FJsonValue>> Arr;
          for (const FString& P : Paths) Arr.Add(MakeShared<FJsonValueString>(P));
          return Arr;
        }());
        Result->SetStringField(TEXT("path"), Paths.Num() > 0 ? Paths[0] : TEXT(""));
      }
      else if (Method == TEXT("get_editor_mode"))
      {
        // UE 5.6: FEditorModeTools doesn't expose a simple public "GetActiveModeIDs" API.
        // Keeping this tool best-effort (and compile-safe) until we add a more direct editor integration.
        Result->SetArrayField(TEXT("active_mode_ids"), TArray<TSharedPtr<FJsonValue>>());
        Result->SetStringField(TEXT("note"), TEXT("Not yet implemented: active editor modes are not exported."));
      }
      else if (Method == TEXT("get_dirty_assets"))
      {
        TArray<UPackage*> Dirty;
        FEditorFileUtils::GetDirtyContentPackages(Dirty);
        TArray<UPackage*> DirtyWorld;
        FEditorFileUtils::GetDirtyWorldPackages(DirtyWorld);
        Dirty.Append(DirtyWorld);

        TArray<TSharedPtr<FJsonValue>> Packages;
        for (UPackage* Pkg : Dirty)
        {
          if (!Pkg) continue;
          Packages.Add(MakeShared<FJsonValueString>(Pkg->GetName()));
        }
        Result->SetArrayField(TEXT("dirty_packages"), Packages);
      }
      else if (Method == TEXT("get_pending_editor_notifications"))
      {
        TArray<TSharedPtr<FJsonValue>> Modals;
        int32 Count = 0;
        if (FSlateApplication::IsInitialized())
        {
          const TArray<TSharedRef<SWindow>> ModalWindows = FSlateApplication::Get().GetInteractiveTopLevelWindows();
          for (const TSharedRef<SWindow>& W : ModalWindows)
          {
            if (!W->IsModalWindow()) continue;
            Count++;
            TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
            Obj->SetStringField(TEXT("title"), W->GetTitle().ToString());
            Modals.Add(MakeShared<FJsonValueObject>(Obj));
          }
        }
        Result->SetNumberField(TEXT("modal_count"), Count);
        Result->SetArrayField(TEXT("modal_windows"), Modals);
        Result->SetStringField(TEXT("note"), TEXT("Best-effort: only modal windows are reported."));
      }
      else if (Method == TEXT("get_message_log_summary"))
      {
        Result->SetArrayField(TEXT("categories"), TArray<TSharedPtr<FJsonValue>>());
        Result->SetStringField(TEXT("note"), TEXT("Not yet implemented: Message Log summary export is pending."));
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
          // ANY_PACKAGE is deprecated; prefer a global search.
          UClass* Class = FindFirstObject<UClass>(*ClassName, EFindFirstObjectOptions::None);
          if (!Class)
          {
            // Common fallback: Engine script classes.
            const FString EnginePath = FString::Printf(TEXT("/Script/Engine.%s"), *ClassName);
            Class = FindObject<UClass>(nullptr, *EnginePath);
          }

          if (Class)
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

        // Re-parse the three params we support here rather than relying on the helper (keeps this block self-contained).
        // (The helper is used by get_blueprint_* methods below.)
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
        Result->SetStringField(TEXT("status"), BP ? StaticEnum<EBlueprintStatus>()->GetNameStringByValue(static_cast<int64>(BP->Status)) : TEXT(""));

        TArray<TSharedPtr<FJsonValue>> Vars;
        TArray<TSharedPtr<FJsonValue>> FunctionGraphs;
        TArray<TSharedPtr<FJsonValue>> MacroGraphs;
        TArray<TSharedPtr<FJsonValue>> UbergraphPages;
        TArray<TSharedPtr<FJsonValue>> Components;
        TArray<TSharedPtr<FJsonValue>> Interfaces;
        TArray<TSharedPtr<FJsonValue>> Timelines;
        TArray<TSharedPtr<FJsonValue>> Dispatchers;

        if (BP)
        {
          for (const FBPInterfaceDescription& I : BP->ImplementedInterfaces)
          {
            if (I.Interface)
            {
              Interfaces.Add(MakeShared<FJsonValueString>(I.Interface->GetPathName()));
            }
          }

          for (const FBPVariableDescription& V : BP->NewVariables)
          {
            TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
            Obj->SetStringField(TEXT("name"), V.VarName.ToString());
            Obj->SetStringField(TEXT("type"), PinTypeToString(V.VarType));
            Obj->SetStringField(TEXT("category"), V.Category.ToString());
            Obj->SetBoolField(TEXT("instance_editable"), V.PropertyFlags & CPF_Edit);
            Vars.Add(MakeShared<FJsonValueObject>(Obj));

            // Heuristic: event dispatchers are typically multicast delegates.
            const FString Cat = V.VarType.PinCategory.ToString();
            if (Cat.Equals(TEXT("multicastdelegate"), ESearchCase::IgnoreCase) || Cat.Equals(TEXT("delegate"), ESearchCase::IgnoreCase))
            {
              TSharedPtr<FJsonObject> D = MakeShared<FJsonObject>();
              D->SetStringField(TEXT("name"), V.VarName.ToString());
              D->SetStringField(TEXT("type"), PinTypeToString(V.VarType));
              Dispatchers.Add(MakeShared<FJsonValueObject>(D));
            }
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

          for (UTimelineTemplate* T : BP->Timelines)
          {
            if (!T)
            {
              continue;
            }
            TSharedPtr<FJsonObject> TL = MakeShared<FJsonObject>();
            TL->SetStringField(TEXT("name"), T->GetFName().ToString());
            TL->SetNumberField(TEXT("length"), T->TimelineLength);
            TL->SetBoolField(TEXT("looping"), T->bLoop);
            TL->SetBoolField(TEXT("ignore_time_dilation"), T->bIgnoreTimeDilation);
            Timelines.Add(MakeShared<FJsonValueObject>(TL));
          }
        }

        Result->SetArrayField(TEXT("variables"), Vars);
        Result->SetArrayField(TEXT("function_graphs"), FunctionGraphs);
        Result->SetArrayField(TEXT("macro_graphs"), MacroGraphs);
        Result->SetArrayField(TEXT("ubergraph_pages"), UbergraphPages);
        Result->SetArrayField(TEXT("components"), Components);
        Result->SetArrayField(TEXT("interfaces"), Interfaces);
        Result->SetArrayField(TEXT("timelines"), Timelines);
        Result->SetArrayField(TEXT("event_dispatchers"), Dispatchers);

        if (BP && bIncludeCdoProperties && BP->GeneratedClass)
        {
          UObject* CDO = BP->GeneratedClass->GetDefaultObject();
          MaxProperties = FMath::Clamp(MaxProperties, 0, 2000);
          Result->SetArrayField(TEXT("cdo_properties"), ExportObjectProperties(CDO, bIncludeTransient, MaxProperties, NameContains));
          Result->SetStringField(TEXT("cdo_object_path"), CDO ? CDO->GetPathName() : TEXT(""));
        }
      }

      // Priority 4 — Compilation and diagnostics
      else if (
        Method == TEXT("compile_blueprint") || Method == TEXT("compile_selected_blueprint") || Method == TEXT("compile_blueprints") ||
        Method == TEXT("compile_all_dirty_blueprints") || Method == TEXT("compile_and_capture_messages") ||
        Method == TEXT("get_compile_messages") || Method == TEXT("get_compile_message_details") ||
        Method == TEXT("get_compile_error_nodes") || Method == TEXT("get_compile_warning_nodes") ||
        Method == TEXT("get_generated_class_status") || Method == TEXT("get_skeleton_class_status") ||
        Method == TEXT("get_blueprint_bytecode_summary") || Method == TEXT("get_last_successful_compile") ||
        Method == TEXT("refresh_blueprint_nodes") || Method == TEXT("reconstruct_blueprint_node") ||
        Method == TEXT("reinstance_blueprint") || Method == TEXT("validate_blueprint_asset") || Method == TEXT("validate_blueprint_dependencies")
      )
      {
        auto KeyForBlueprint = [](UBlueprint* BP) -> FString {
          if (!BP) return TEXT("");
          const FString ObjPath = BP->GetPathName();
          if (!ObjPath.IsEmpty()) return ObjPath;
          return BP->GetOutermost() ? BP->GetOutermost()->GetName() : TEXT("");
        };

        auto StoreCompilePayload = [](const FString& Key, const TSharedPtr<FJsonObject>& Payload, bool bSuccessful) {
          if (!Payload.IsValid() || Key.IsEmpty()) return;
          FScopeLock Lock(&GCompileMutex);
          GLastCompileAny = Payload;
          GLastCompileByBlueprint.Add(Key, Payload);
          if (bSuccessful)
          {
            GLastSuccessfulCompileByBlueprint.Add(Key, Payload);
          }
        };

        auto LoadLastPayload = [](const FString& Key, bool bSuccessfulOnly) -> TSharedPtr<FJsonObject> {
          FScopeLock Lock(&GCompileMutex);
          if (!Key.IsEmpty())
          {
            if (bSuccessfulOnly)
            {
              if (const TSharedPtr<FJsonObject>* Found = GLastSuccessfulCompileByBlueprint.Find(Key)) return *Found;
            }
            else
            {
              if (const TSharedPtr<FJsonObject>* Found = GLastCompileByBlueprint.Find(Key)) return *Found;
            }
          }
          return GLastCompileAny;
        };

        auto ExportCompilerLog = [](UBlueprint* BP, const FCompilerResultsLog& Log, double ElapsedSeconds, const FString& Operation) {
          TSharedPtr<FJsonObject> Payload = MakeShared<FJsonObject>();

          const FString ObjPath = BP ? BP->GetPathName() : TEXT("");
          const FString AssetPath = (BP && BP->GetOutermost()) ? BP->GetOutermost()->GetName() : TEXT("");

          Payload->SetStringField(TEXT("operation"), Operation);
          Payload->SetStringField(TEXT("blueprint_object_path"), ObjPath);
          Payload->SetStringField(TEXT("blueprint_asset_path"), AssetPath);
          Payload->SetNumberField(TEXT("elapsed_seconds"), ElapsedSeconds);

          TArray<TSharedPtr<FJsonValue>> Messages;
          int32 Errors = 0;
          int32 Warnings = 0;
          int32 Notes = 0;

          int32 Idx = 0;
          for (const TSharedRef<FTokenizedMessage>& M : Log.Messages)
          {
            const FString Severity = SeverityToString(M->GetSeverity());
            if (Severity == TEXT("error")) Errors++;
            else if (Severity == TEXT("warning")) Warnings++;
            else Notes++;

            TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
            Obj->SetStringField(TEXT("id"), FString::Printf(TEXT("m%d"), Idx++));
            Obj->SetStringField(TEXT("severity"), Severity);
            Obj->SetStringField(TEXT("message"), M->ToText().ToString());

            // Best-effort: pull out referenced objects and a node (if present).
            FString GraphName;
            FString NodeId;
            FString NodeTitle;
            TArray<TSharedPtr<FJsonValue>> Objects;

            for (const TSharedRef<IMessageToken>& Tok : M->GetMessageTokens())
            {
              if (Tok->GetType() != EMessageToken::Object)
              {
                continue;
              }

              const TSharedRef<FUObjectToken> OT = StaticCastSharedRef<FUObjectToken>(Tok);
              UObject* UObj = OT->GetObject().Get();
              if (!UObj)
              {
                continue;
              }

              Objects.Add(MakeShared<FJsonValueString>(UObj->GetPathName()));

              if (NodeId.IsEmpty())
              {
                if (UEdGraphNode* Node = Cast<UEdGraphNode>(UObj))
                {
                  NodeId = Node->NodeGuid.ToString(EGuidFormats::DigitsWithHyphens);
                  NodeTitle = Node->GetNodeTitle(ENodeTitleType::ListView).ToString();
                  if (UEdGraph* G = Node->GetGraph())
                  {
                    GraphName = G->GetName();
                  }
                }
              }
            }

            Obj->SetArrayField(TEXT("objects"), Objects);
            Obj->SetStringField(TEXT("graph"), GraphName);
            Obj->SetStringField(TEXT("node_id"), NodeId);
            Obj->SetStringField(TEXT("node_title"), NodeTitle);
            Messages.Add(MakeShared<FJsonValueObject>(Obj));
          }

          Payload->SetBoolField(TEXT("success"), Errors == 0);
          Payload->SetNumberField(TEXT("errors"), Errors);
          Payload->SetNumberField(TEXT("warnings"), Warnings);
          Payload->SetNumberField(TEXT("notes"), Notes);
          Payload->SetArrayField(TEXT("messages"), Messages);

          if (BP)
          {
            Payload->SetStringField(TEXT("blueprint_status"), StaticEnum<EBlueprintStatus>()->GetNameStringByValue(static_cast<int64>(BP->Status)));
          }
          return Payload;
        };

        auto CompileOne = [&](UBlueprint* BP, const FString& Operation) -> TSharedPtr<FJsonObject> {
          if (!BP)
          {
            TSharedPtr<FJsonObject> Empty = MakeShared<FJsonObject>();
            Empty->SetStringField(TEXT("operation"), Operation);
            Empty->SetBoolField(TEXT("compiled"), false);
            Empty->SetBoolField(TEXT("success"), false);
            Empty->SetNumberField(TEXT("errors"), 0);
            Empty->SetNumberField(TEXT("warnings"), 0);
            Empty->SetArrayField(TEXT("messages"), TArray<TSharedPtr<FJsonValue>>());
            Empty->SetStringField(TEXT("note"), TEXT("Blueprint not found"));
            return Empty;
          }

          const double StartSeconds = FPlatformTime::Seconds();
          FCompilerResultsLog Log;
          Log.bLogDetailedResults = true;

          // Compile without saving.
          FKismetEditorUtilities::CompileBlueprint(BP, EBlueprintCompileOptions::None, &Log);
          const double Elapsed = FPlatformTime::Seconds() - StartSeconds;

          TSharedPtr<FJsonObject> Payload = ExportCompilerLog(BP, Log, Elapsed, Operation);
          Payload->SetBoolField(TEXT("compiled"), true);
          return Payload;
        };

        if (
          Method == TEXT("compile_blueprint") || Method == TEXT("compile_selected_blueprint") || Method == TEXT("compile_and_capture_messages") ||
          Method == TEXT("refresh_blueprint_nodes") || Method == TEXT("reconstruct_blueprint_node") || Method == TEXT("reinstance_blueprint") ||
          Method == TEXT("validate_blueprint_asset") || Method == TEXT("validate_blueprint_dependencies") ||
          Method == TEXT("get_compile_messages") || Method == TEXT("get_compile_message_details") || Method == TEXT("get_compile_error_nodes") ||
          Method == TEXT("get_compile_warning_nodes") || Method == TEXT("get_generated_class_status") || Method == TEXT("get_skeleton_class_status") ||
          Method == TEXT("get_blueprint_bytecode_summary") || Method == TEXT("get_last_successful_compile")
        )
        {
          UBlueprint* BP = ResolveBlueprintBestEffort(Params);
          const FString Key = KeyForBlueprint(BP);

          if (Method == TEXT("refresh_blueprint_nodes"))
          {
            if (BP)
            {
              FBlueprintEditorUtils::RefreshAllNodes(BP);
              Result->SetBoolField(TEXT("refreshed"), true);
              Result->SetStringField(TEXT("blueprint_object_path"), BP->GetPathName());
              Result->SetStringField(TEXT("blueprint_asset_path"), BP->GetOutermost() ? BP->GetOutermost()->GetName() : TEXT(""));
            }
            else
            {
              Result->SetBoolField(TEXT("refreshed"), false);
              Result->SetStringField(TEXT("note"), TEXT("Blueprint not found"));
            }
          }
          else if (Method == TEXT("reconstruct_blueprint_node"))
          {
            FString NodeId;
            if (Params.IsValid()) Params->TryGetStringField(TEXT("node_id"), NodeId);

            bool bReconstructed = false;
            if (BP && !NodeId.IsEmpty())
            {
              FGuid Target;
              if (FGuid::Parse(NodeId, Target))
              {
                auto ScanGraphs = [&](const TArray<UEdGraph*>& Graphs) {
                  for (UEdGraph* G : Graphs)
                  {
                    if (!G) continue;
                    for (UEdGraphNode* N : G->Nodes)
                    {
                      if (N && N->NodeGuid == Target)
                      {
                        N->ReconstructNode();
                        bReconstructed = true;
                        return;
                      }
                    }
                  }
                };

                ScanGraphs(BP->UbergraphPages);
                if (!bReconstructed) ScanGraphs(BP->FunctionGraphs);
                if (!bReconstructed) ScanGraphs(BP->MacroGraphs);
              }
            }

            Result->SetBoolField(TEXT("reconstructed"), bReconstructed);
            Result->SetStringField(TEXT("node_id"), NodeId);
            Result->SetStringField(TEXT("blueprint_object_path"), BP ? BP->GetPathName() : TEXT(""));
            if (!bReconstructed)
            {
              Result->SetStringField(TEXT("note"), TEXT("Best-effort: node not found or node_id missing"));
            }
          }
          else if (Method == TEXT("reinstance_blueprint"))
          {
            // Advanced: reinstancing is implicit during compile; keeping this tool as a safe placeholder.
            Result->SetBoolField(TEXT("supported"), false);
            Result->SetStringField(TEXT("note"), TEXT("Not implemented yet: explicit reinstancing requires deeper editor integration."));
          }
          else if (Method == TEXT("validate_blueprint_dependencies"))
          {
            // Best-effort: check that content dependencies resolve to existing packages.
            TArray<TSharedPtr<FJsonValue>> Missing;
            FString Package;
            if (BP && BP->GetOutermost())
            {
              Package = BP->GetOutermost()->GetName();
            }
            else if (Params.IsValid())
            {
              Params->TryGetStringField(TEXT("asset_path"), Package);
            }

            Result->SetStringField(TEXT("package"), Package);
            if (!Package.IsEmpty())
            {
              FAssetRegistryModule& AssetRegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
              IAssetRegistry& Registry = AssetRegistryModule.Get();
              TArray<FName> Deps;

  #if (ENGINE_MAJOR_VERSION > 5) || (ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 5)
              Registry.GetDependencies(
                FName(*Package),
                Deps,
                UE::AssetRegistry::EDependencyCategory::All,
                UE::AssetRegistry::FDependencyQuery());
  #else
              Registry.GetDependencies(FName(*Package), Deps, EAssetRegistryDependencyType::All);
  #endif

              for (const FName& N : Deps)
              {
                const FString Dep = N.ToString();
                if (Dep.StartsWith(TEXT("/Script/"))) continue;
                if (!Dep.StartsWith(TEXT("/"))) continue;
                if (!FPackageName::DoesPackageExist(Dep))
                {
                  Missing.Add(MakeShared<FJsonValueString>(Dep));
                }
              }
            }
            Result->SetArrayField(TEXT("missing_dependencies"), Missing);
            Result->SetNumberField(TEXT("missing_count"), Missing.Num());
          }
          else if (Method == TEXT("validate_blueprint_asset"))
          {
            // Best-effort: validate by compiling and returning normalized diagnostics.
            TSharedPtr<FJsonObject> Payload = CompileOne(BP, TEXT("validate_blueprint_asset"));
            const bool bSuccess = Payload.IsValid() && Payload->HasField(TEXT("success")) ? Payload->GetBoolField(TEXT("success")) : false;
            if (Payload.IsValid())
            {
              StoreCompilePayload(Key, Payload, bSuccess);
              Result = Payload;
            }
          }
          else if (Method == TEXT("compile_blueprint") || Method == TEXT("compile_selected_blueprint") || Method == TEXT("compile_and_capture_messages"))
          {
            TSharedPtr<FJsonObject> Payload = CompileOne(BP, Method);
            const bool bSuccess = Payload.IsValid() && Payload->HasField(TEXT("success")) ? Payload->GetBoolField(TEXT("success")) : false;
            StoreCompilePayload(Key, Payload, bSuccess);
            Result = Payload;
          }
          else if (Method == TEXT("get_compile_messages"))
          {
            TSharedPtr<FJsonObject> Payload = LoadLastPayload(Key, false);
            if (Payload.IsValid())
            {
              Result = Payload;
            }
            else
            {
              Result->SetArrayField(TEXT("messages"), TArray<TSharedPtr<FJsonValue>>());
              Result->SetNumberField(TEXT("errors"), 0);
              Result->SetNumberField(TEXT("warnings"), 0);
              Result->SetBoolField(TEXT("success"), true);
              Result->SetStringField(TEXT("note"), TEXT("No compile payload has been captured yet."));
            }
          }
          else if (Method == TEXT("get_compile_message_details"))
          {
            FString MessageId;
            if (Params.IsValid()) Params->TryGetStringField(TEXT("message_id"), MessageId);
            TSharedPtr<FJsonObject> Payload = LoadLastPayload(Key, false);

            Result->SetStringField(TEXT("message_id"), MessageId);
            Result->SetBoolField(TEXT("found"), false);

            if (Payload.IsValid())
            {
              const TArray<TSharedPtr<FJsonValue>>* Msgs = nullptr;
              if (Payload->TryGetArrayField(TEXT("messages"), Msgs) && Msgs)
              {
                for (const TSharedPtr<FJsonValue>& V : *Msgs)
                {
                  if (!V.IsValid()) continue;
                  const TSharedPtr<FJsonObject>* O = nullptr;
                  if (!V->TryGetObject(O) || !O || !O->IsValid()) continue;
                  FString Id;
                  if ((*O)->TryGetStringField(TEXT("id"), Id) && Id == MessageId)
                  {
                    Result->SetBoolField(TEXT("found"), true);
                    Result->SetObjectField(TEXT("message"), *O);
                    break;
                  }
                }
              }
            }

            if (MessageId.IsEmpty())
            {
              Result->SetStringField(TEXT("note"), TEXT("message_id is required"));
            }
          }
          else if (Method == TEXT("get_compile_error_nodes") || Method == TEXT("get_compile_warning_nodes"))
          {
            const FString Wanted = (Method == TEXT("get_compile_error_nodes")) ? TEXT("error") : TEXT("warning");
            TSharedPtr<FJsonObject> Payload = LoadLastPayload(Key, false);
            TArray<TSharedPtr<FJsonValue>> Nodes;

            if (Payload.IsValid())
            {
              const TArray<TSharedPtr<FJsonValue>>* Msgs = nullptr;
              if (Payload->TryGetArrayField(TEXT("messages"), Msgs) && Msgs)
              {
                TSet<FString> Seen;
                for (const TSharedPtr<FJsonValue>& V : *Msgs)
                {
                  const TSharedPtr<FJsonObject>* O = nullptr;
                  if (!V.IsValid() || !V->TryGetObject(O) || !O || !O->IsValid()) continue;
                  FString Sev;
                  FString NodeId;
                  FString NodeTitle;
                  FString Graph;
                  (*O)->TryGetStringField(TEXT("severity"), Sev);
                  (*O)->TryGetStringField(TEXT("node_id"), NodeId);
                  (*O)->TryGetStringField(TEXT("node_title"), NodeTitle);
                  (*O)->TryGetStringField(TEXT("graph"), Graph);
                  if (Sev != Wanted) continue;
                  if (NodeId.IsEmpty()) continue;
                  if (Seen.Contains(NodeId)) continue;
                  Seen.Add(NodeId);

                  TSharedPtr<FJsonObject> N = MakeShared<FJsonObject>();
                  N->SetStringField(TEXT("graph"), Graph);
                  N->SetStringField(TEXT("node_id"), NodeId);
                  N->SetStringField(TEXT("node_title"), NodeTitle);
                  Nodes.Add(MakeShared<FJsonValueObject>(N));
                }
              }
            }

            Result->SetArrayField(TEXT("nodes"), Nodes);
            Result->SetNumberField(TEXT("returned"), Nodes.Num());
            Result->SetStringField(TEXT("severity"), Wanted);
          }
          else if (Method == TEXT("get_generated_class_status"))
          {
            Result->SetBoolField(TEXT("blueprint_found"), BP != nullptr);
            Result->SetStringField(TEXT("generated_class"), BP && BP->GeneratedClass ? BP->GeneratedClass->GetPathName() : TEXT(""));
            Result->SetBoolField(TEXT("has_generated_class"), BP && BP->GeneratedClass != nullptr);
          }
          else if (Method == TEXT("get_skeleton_class_status"))
          {
            Result->SetBoolField(TEXT("blueprint_found"), BP != nullptr);
            Result->SetStringField(TEXT("skeleton_class"), BP && BP->SkeletonGeneratedClass ? BP->SkeletonGeneratedClass->GetPathName() : TEXT(""));
            Result->SetBoolField(TEXT("has_skeleton_class"), BP && BP->SkeletonGeneratedClass != nullptr);
          }
          else if (Method == TEXT("get_blueprint_bytecode_summary"))
          {
            int32 FunctionCount = 0;
            int64 BytecodeBytes = 0;
            if (BP && BP->GeneratedClass)
            {
              for (TFieldIterator<UFunction> It(BP->GeneratedClass, EFieldIteratorFlags::ExcludeSuper); It; ++It)
              {
                UFunction* F = *It;
                if (!F) continue;
                FunctionCount++;
                BytecodeBytes += F->Script.Num();
              }
            }
            Result->SetBoolField(TEXT("blueprint_found"), BP != nullptr);
            Result->SetStringField(TEXT("generated_class"), BP && BP->GeneratedClass ? BP->GeneratedClass->GetPathName() : TEXT(""));
            Result->SetNumberField(TEXT("function_count"), FunctionCount);
            Result->SetNumberField(TEXT("bytecode_bytes"), static_cast<double>(BytecodeBytes));
            Result->SetStringField(TEXT("note"), TEXT("Best-effort: sums UFunction::Script size for functions defined on the generated class."));
          }
          else if (Method == TEXT("get_last_successful_compile"))
          {
            TSharedPtr<FJsonObject> Payload = LoadLastPayload(Key, true);
            if (Payload.IsValid())
            {
              Result = Payload;
            }
            else
            {
              Result->SetBoolField(TEXT("found"), false);
              Result->SetStringField(TEXT("note"), TEXT("No successful compile payload has been captured yet."));
            }
          }
        }
        else
        {
          // Multi-compile operations
          if (Method == TEXT("compile_blueprints"))
          {
            const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
            if (!Params.IsValid() || !Params->TryGetArrayField(TEXT("asset_paths"), Arr) || !Arr)
            {
              Result->SetNumberField(TEXT("compiled"), 0);
              Result->SetNumberField(TEXT("errors"), 0);
              Result->SetNumberField(TEXT("warnings"), 0);
              Result->SetArrayField(TEXT("results"), TArray<TSharedPtr<FJsonValue>>());
              Result->SetStringField(TEXT("note"), TEXT("asset_paths is required (array of Blueprint package/object paths)."));
            }
            else
            {
              TArray<TSharedPtr<FJsonValue>> Per;
              int32 Compiled = 0;
              int32 Errors = 0;
              int32 Warnings = 0;
              for (const TSharedPtr<FJsonValue>& V : *Arr)
              {
                if (!V.IsValid()) continue;
                FString P;
                if (!V->TryGetString(P)) continue;
                UBlueprint* BP = Cast<UBlueprint>(LoadObjectByPathBestEffort(P));
                TSharedPtr<FJsonObject> Payload = CompileOne(BP, TEXT("compile_blueprints"));
                const bool bSuccess = Payload.IsValid() && Payload->HasField(TEXT("success")) ? Payload->GetBoolField(TEXT("success")) : false;
                const FString Key = KeyForBlueprint(BP);
                StoreCompilePayload(Key, Payload, bSuccess);
                Per.Add(MakeShared<FJsonValueObject>(Payload));
                if (BP) Compiled++;
                Errors += Payload.IsValid() && Payload->HasTypedField<EJson::Number>(TEXT("errors")) ? static_cast<int32>(Payload->GetNumberField(TEXT("errors"))) : 0;
                Warnings += Payload.IsValid() && Payload->HasTypedField<EJson::Number>(TEXT("warnings")) ? static_cast<int32>(Payload->GetNumberField(TEXT("warnings"))) : 0;
              }
              Result->SetNumberField(TEXT("compiled"), Compiled);
              Result->SetNumberField(TEXT("errors"), Errors);
              Result->SetNumberField(TEXT("warnings"), Warnings);
              Result->SetArrayField(TEXT("results"), Per);
            }
          }
          else if (Method == TEXT("compile_all_dirty_blueprints"))
          {
            TArray<UPackage*> Dirty;
            FEditorFileUtils::GetDirtyContentPackages(Dirty);
            TArray<UPackage*> DirtyWorld;
            FEditorFileUtils::GetDirtyWorldPackages(DirtyWorld);
            Dirty.Append(DirtyWorld);

            TArray<TSharedPtr<FJsonValue>> Per;
            int32 Compiled = 0;
            int32 Errors = 0;
            int32 Warnings = 0;
            for (UPackage* Pkg : Dirty)
            {
              if (!Pkg) continue;
              const FString PackageName = Pkg->GetName();
              UBlueprint* BP = Cast<UBlueprint>(LoadObjectByPathBestEffort(PackageName));
              if (!BP) continue;
              TSharedPtr<FJsonObject> Payload = CompileOne(BP, TEXT("compile_all_dirty_blueprints"));
              const bool bSuccess = Payload.IsValid() && Payload->HasField(TEXT("success")) ? Payload->GetBoolField(TEXT("success")) : false;
              StoreCompilePayload(KeyForBlueprint(BP), Payload, bSuccess);
              Per.Add(MakeShared<FJsonValueObject>(Payload));
              Compiled++;
              Errors += Payload.IsValid() && Payload->HasTypedField<EJson::Number>(TEXT("errors")) ? static_cast<int32>(Payload->GetNumberField(TEXT("errors"))) : 0;
              Warnings += Payload.IsValid() && Payload->HasTypedField<EJson::Number>(TEXT("warnings")) ? static_cast<int32>(Payload->GetNumberField(TEXT("warnings"))) : 0;
            }
            Result->SetNumberField(TEXT("compiled"), Compiled);
            Result->SetNumberField(TEXT("errors"), Errors);
            Result->SetNumberField(TEXT("warnings"), Warnings);
            Result->SetArrayField(TEXT("results"), Per);
          }
        }
      }

      else if (Method == TEXT("get_blueprint_graph") || Method == TEXT("get_blueprint_dependencies") || Method == TEXT("get_blueprint_dependents"))
      {
        UBlueprint* BP = ResolveBlueprintBestEffort(Params);
        FString GraphName;
        FString Mode = TEXT("summary");
        FString NodeId;
        int32 MaxNodes = 200;
        int32 MaxEdges = 2000;
        bool bIncludePins = false;
        bool bIncludeEdges = false;

        if (Params.IsValid())
        {
          Params->TryGetStringField(TEXT("graph"), GraphName);
          Params->TryGetStringField(TEXT("mode"), Mode);
          Params->TryGetStringField(TEXT("node_id"), NodeId);

          double Num = 0;
          if (Params->TryGetNumberField(TEXT("max_nodes"), Num)) MaxNodes = static_cast<int32>(Num);
          if (Params->TryGetNumberField(TEXT("max_edges"), Num)) MaxEdges = static_cast<int32>(Num);
          Params->TryGetBoolField(TEXT("include_pins"), bIncludePins);
          Params->TryGetBoolField(TEXT("include_edges"), bIncludeEdges);
        }

        MaxNodes = FMath::Clamp(MaxNodes, 0, 2000);
        MaxEdges = FMath::Clamp(MaxEdges, 0, 20000);

        if (Method == TEXT("get_blueprint_dependencies") || Method == TEXT("get_blueprint_dependents"))
        {
          FString Package;
          if (BP && BP->GetOutermost())
          {
            Package = BP->GetOutermost()->GetName();
          }
          else if (Params.IsValid())
          {
            Params->TryGetStringField(TEXT("asset_path"), Package);
          }

          Result->SetStringField(TEXT("package"), Package);

          TArray<TSharedPtr<FJsonValue>> Items;
          if (!Package.IsEmpty())
          {
            FAssetRegistryModule& AssetRegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
            IAssetRegistry& Registry = AssetRegistryModule.Get();

            TArray<FName> Out;
            if (Method == TEXT("get_blueprint_dependencies"))
            {
#if (ENGINE_MAJOR_VERSION > 5) || (ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 5)
              Registry.GetDependencies(
                FName(*Package),
                Out,
                UE::AssetRegistry::EDependencyCategory::All,
                UE::AssetRegistry::FDependencyQuery());
#else
              Registry.GetDependencies(FName(*Package), Out, EAssetRegistryDependencyType::All);
#endif
              for (const FName& N : Out)
              {
                Items.Add(MakeShared<FJsonValueString>(N.ToString()));
              }
              Result->SetArrayField(TEXT("dependencies"), Items);
              Result->SetNumberField(TEXT("returned"), Items.Num());
            }
            else
            {
#if (ENGINE_MAJOR_VERSION > 5) || (ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 5)
              Registry.GetReferencers(
                FName(*Package),
                Out,
                UE::AssetRegistry::EDependencyCategory::All,
                UE::AssetRegistry::FDependencyQuery());
#else
              Registry.GetReferencers(FName(*Package), Out, EAssetRegistryDependencyType::All);
#endif
              for (const FName& N : Out)
              {
                Items.Add(MakeShared<FJsonValueString>(N.ToString()));
              }
              Result->SetArrayField(TEXT("dependents"), Items);
              Result->SetNumberField(TEXT("returned"), Items.Num());
            }
          }
        }
        else
        {
          // Graph export
          Result->SetStringField(TEXT("blueprint_object_path"), BP ? BP->GetPathName() : TEXT(""));
          Result->SetStringField(TEXT("blueprint_asset_path"), BP && BP->GetOutermost() ? BP->GetOutermost()->GetName() : TEXT(""));

          FString GraphType;
          UEdGraph* Graph = ResolveGraphBestEffort(BP, GraphName, GraphType);
          Result->SetStringField(TEXT("graph_name"), Graph ? Graph->GetName() : TEXT(""));
          Result->SetStringField(TEXT("graph_type"), GraphType);
          Result->SetStringField(TEXT("mode"), Mode);

          // Summary always includes comment boxes (cheap) and can be used by get_blueprint_graph_comments.
          TArray<TSharedPtr<FJsonValue>> CommentBoxes;
          if (Graph)
          {
            for (UEdGraphNode* N : Graph->Nodes)
            {
              if (UEdGraphNode_Comment* C = Cast<UEdGraphNode_Comment>(N))
              {
                TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
                Obj->SetStringField(TEXT("id"), C->NodeGuid.ToString(EGuidFormats::DigitsWithHyphens));
                Obj->SetStringField(TEXT("title"), C->GetNodeTitle(ENodeTitleType::ListView).ToString());
                Obj->SetStringField(TEXT("comment"), C->NodeComment);
                Obj->SetNumberField(TEXT("pos_x"), C->NodePosX);
                Obj->SetNumberField(TEXT("pos_y"), C->NodePosY);
                Obj->SetNumberField(TEXT("width"), C->NodeWidth);
                Obj->SetNumberField(TEXT("height"), C->NodeHeight);
                CommentBoxes.Add(MakeShared<FJsonValueObject>(Obj));
              }
            }
          }
          Result->SetArrayField(TEXT("comment_boxes"), CommentBoxes);

          if (!Graph)
          {
            Result->SetNumberField(TEXT("node_count"), 0);
            Result->SetNumberField(TEXT("edge_count"), 0);
            Result->SetArrayField(TEXT("nodes"), TArray<TSharedPtr<FJsonValue>>{});
            Result->SetArrayField(TEXT("edges"), TArray<TSharedPtr<FJsonValue>>{});
          }
          else
          {
            const bool bExecOnly = Mode.Equals(TEXT("execution_only"), ESearchCase::IgnoreCase);
            const bool bDataOnly = Mode.Equals(TEXT("data_flow"), ESearchCase::IgnoreCase);
            const bool bSummary = Mode.Equals(TEXT("summary"), ESearchCase::IgnoreCase);

            // If targeting a specific node_id, return only that node (and optionally its pins).
            FGuid TargetGuid;
            const bool bHasTarget = !NodeId.IsEmpty() && FGuid::Parse(NodeId, TargetGuid);

            TArray<TSharedPtr<FJsonValue>> Nodes;
            TArray<TSharedPtr<FJsonValue>> Edges;

            int32 AddedNodes = 0;
            int32 AddedEdges = 0;

            for (UEdGraphNode* N : Graph->Nodes)
            {
              if (!N)
              {
                continue;
              }
              if (bHasTarget && N->NodeGuid != TargetGuid)
              {
                continue;
              }

              if (AddedNodes >= MaxNodes)
              {
                break;
              }

              TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
              Obj->SetStringField(TEXT("id"), N->NodeGuid.ToString(EGuidFormats::DigitsWithHyphens));
              Obj->SetStringField(TEXT("title"), N->GetNodeTitle(ENodeTitleType::ListView).ToString());
              Obj->SetStringField(TEXT("class"), N->GetClass() ? N->GetClass()->GetName() : TEXT(""));
              Obj->SetNumberField(TEXT("pos_x"), N->NodePosX);
              Obj->SetNumberField(TEXT("pos_y"), N->NodePosY);
              Obj->SetStringField(TEXT("node_comment"), N->NodeComment);

              if (!bSummary && bIncludePins)
              {
                TArray<TSharedPtr<FJsonValue>> Pins;
                for (UEdGraphPin* P : N->Pins)
                {
                  if (!P)
                  {
                    continue;
                  }

                  const bool bIsExec = IsExecPin(P);
                  if (bExecOnly && !bIsExec) continue;
                  if (bDataOnly && bIsExec) continue;

                  TSharedPtr<FJsonObject> PP = MakeShared<FJsonObject>();
                  PP->SetStringField(TEXT("name"), P->PinName.ToString());
                  PP->SetStringField(TEXT("direction"), P->Direction == EGPD_Input ? TEXT("input") : TEXT("output"));
                  PP->SetStringField(TEXT("type"), PinTypeToString(P->PinType));
                  PP->SetBoolField(TEXT("is_exec"), bIsExec);
                  PP->SetStringField(TEXT("default_value"), P->DefaultValue);
                  Pins.Add(MakeShared<FJsonValueObject>(PP));
                }
                Obj->SetArrayField(TEXT("pins"), Pins);
              }

              Nodes.Add(MakeShared<FJsonValueObject>(Obj));
              AddedNodes++;

              if (bHasTarget)
              {
                // No need to scan further nodes once the target is found.
                break;
              }
            }

            // Only build edges when requested.
            if (!bSummary && (bIncludeEdges || bExecOnly || bDataOnly))
            {
              // Build an allowlist of node guids we emitted, so edges are bounded to the returned nodes.
              TSet<FGuid> Allowed;
              for (const TSharedPtr<FJsonValue>& V : Nodes)
              {
                if (!V.IsValid()) continue;
                const TSharedPtr<FJsonObject>* O = nullptr;
                if (V->TryGetObject(O) && O && O->IsValid())
                {
                  FString Id;
                  if ((*O)->TryGetStringField(TEXT("id"), Id))
                  {
                    FGuid G;
                    if (FGuid::Parse(Id, G)) Allowed.Add(G);
                  }
                }
              }

              TSet<FString> Seen;
              for (UEdGraphNode* N : Graph->Nodes)
              {
                if (!N) continue;
                if (Allowed.Num() > 0 && !Allowed.Contains(N->NodeGuid)) continue;

                for (UEdGraphPin* P : N->Pins)
                {
                  if (!P) continue;

                  const bool bIsExec = IsExecPin(P);
                  if (bExecOnly && !bIsExec) continue;
                  if (bDataOnly && bIsExec) continue;

                  // Only emit edges from output pins to reduce duplicates.
                  if (P->Direction != EGPD_Output) continue;

                  for (UEdGraphPin* L : P->LinkedTo)
                  {
                    if (!L || !L->GetOwningNode()) continue;
                    UEdGraphNode* ToNode = L->GetOwningNode();
                    if (Allowed.Num() > 0 && !Allowed.Contains(ToNode->NodeGuid)) continue;

                    const FString Key =
                      N->NodeGuid.ToString(EGuidFormats::DigitsWithHyphens) + TEXT(":") + P->PinName.ToString() +
                      TEXT("->") + ToNode->NodeGuid.ToString(EGuidFormats::DigitsWithHyphens) + TEXT(":") + L->PinName.ToString();
                    if (Seen.Contains(Key)) continue;
                    Seen.Add(Key);

                    if (AddedEdges >= MaxEdges) break;

                    TSharedPtr<FJsonObject> E = MakeShared<FJsonObject>();
                    E->SetStringField(TEXT("from_node_id"), N->NodeGuid.ToString(EGuidFormats::DigitsWithHyphens));
                    E->SetStringField(TEXT("from_pin"), P->PinName.ToString());
                    E->SetStringField(TEXT("to_node_id"), ToNode->NodeGuid.ToString(EGuidFormats::DigitsWithHyphens));
                    E->SetStringField(TEXT("to_pin"), L->PinName.ToString());
                    Edges.Add(MakeShared<FJsonValueObject>(E));
                    AddedEdges++;
                  }

                  if (AddedEdges >= MaxEdges) break;
                }

                if (AddedEdges >= MaxEdges) break;
              }
            }

            Result->SetNumberField(TEXT("node_count"), Graph->Nodes.Num());
            Result->SetNumberField(TEXT("edge_count"), Edges.Num());
            Result->SetArrayField(TEXT("nodes"), Nodes);
            Result->SetArrayField(TEXT("edges"), Edges);
          }
        }
      }

      Done->Trigger();
    });

    bCompleted = Done->Wait(static_cast<uint32>(GameThreadWaitSecondsForMethod(Method) * 1000.0));
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

      if (Method == TEXT("begin_transaction") || Method == TEXT("end_transaction") || Method == TEXT("cancel_transaction"))
      {
        bool bCompleted = false;
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, Params, bCompleted);
        if (!bCompleted || !Result.IsValid())
        {
          SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("REQUEST_TIMEOUT"), TEXT("Timed out waiting for game thread"))));
          return;
        }

        FString ErrCode;
        FString ErrMsg;
        if (Result->TryGetStringField(TEXT("error_code"), ErrCode))
        {
          Result->TryGetStringField(TEXT("error_message"), ErrMsg);
          SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, *ErrCode, ErrMsg.IsEmpty() ? TEXT("Transaction operation failed") : *ErrMsg)));
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

        SendLine(Client, ToLine(MakeJsonSuccessResponse(RequestId, Result)));
        return;
      }

      if (
        Method == TEXT("get_current_level") || Method == TEXT("get_open_levels") || Method == TEXT("get_selected_assets") ||
        Method == TEXT("get_selected_components") || Method == TEXT("get_active_asset_editor") ||
        Method == TEXT("get_open_asset_editors") || Method == TEXT("get_active_blueprint_graph") ||
        Method == TEXT("get_selected_blueprint_nodes") || Method == TEXT("get_focused_blueprint_node") ||
        Method == TEXT("get_editor_viewport_state") || Method == TEXT("get_world_outliner_selection") ||
        Method == TEXT("get_content_browser_path") || Method == TEXT("get_editor_mode") || Method == TEXT("get_dirty_assets") ||
        Method == TEXT("get_pending_editor_notifications") || Method == TEXT("get_message_log_summary")
      )
      {
        bool bCompleted = false;
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, Params, bCompleted);
        if (!bCompleted || !Result.IsValid())
        {
          SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("REQUEST_TIMEOUT"), TEXT("Timed out waiting for game thread"))));
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

      if (
        Method == TEXT("list_assets") || Method == TEXT("inspect_object") || Method == TEXT("inspect_blueprint") ||
        Method == TEXT("get_blueprint_graph") || Method == TEXT("get_blueprint_dependencies") || Method == TEXT("get_blueprint_dependents")
      )
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

      if (
        Method == TEXT("compile_blueprint") || Method == TEXT("compile_selected_blueprint") || Method == TEXT("compile_blueprints") ||
        Method == TEXT("compile_all_dirty_blueprints") || Method == TEXT("get_compile_messages") || Method == TEXT("get_compile_message_details") ||
        Method == TEXT("get_compile_error_nodes") || Method == TEXT("get_compile_warning_nodes") || Method == TEXT("compile_and_capture_messages") ||
        Method == TEXT("get_generated_class_status") || Method == TEXT("get_skeleton_class_status") || Method == TEXT("get_blueprint_bytecode_summary") ||
        Method == TEXT("get_last_successful_compile") || Method == TEXT("refresh_blueprint_nodes") || Method == TEXT("reconstruct_blueprint_node") ||
        Method == TEXT("reinstance_blueprint") || Method == TEXT("validate_blueprint_asset") || Method == TEXT("validate_blueprint_dependencies")
      )
      {
        bool bCompleted = false;
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, Params, bCompleted);
        if (!bCompleted || !Result.IsValid())
        {
          SendLine(Client, ToLine(MakeJsonErrorResponse(RequestId, TEXT("REQUEST_TIMEOUT"), TEXT("Timed out waiting for game thread"))));
          return;
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
