#include "CopilotTcpServer.h"

#include "Async/Async.h"
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
#include "Selection.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Policies/CondensedJsonPrintPolicy.h"

#include "Components/SceneComponent.h"
#include "Engine/Blueprint.h"
#include "GameFramework/Actor.h"
#include "Subsystems/AssetEditorSubsystem.h"
#include "Sockets.h"
#include "SocketSubsystem.h"
#include "EngineUtils.h"

#include <atomic>

namespace
{
  constexpr int32 kMaxLineBytes = 256 * 1024;
  constexpr float kAcceptSleepSeconds = 0.01f;
  constexpr double kGameThreadWaitSeconds = 2.0;

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
  TSharedPtr<FJsonObject> HandleOnGameThreadBlocking(const FString& Method, const FString& ActorName, bool& bCompleted)
  {
    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    FEvent* Done = FPlatformProcess::GetSynchEventFromPool(true);

    AsyncTask(ENamedThreads::GameThread, [Done, &Result, Method, ActorName]() {
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
        AActor* Target = nullptr;
        if (GEditor)
        {
          AActor* FirstSelected = nullptr;
          if (USelection* Selection = GEditor->GetSelectedActors())
          {
            for (FSelectionIterator It(*Selection); It; ++It)
            {
              AActor* Actor = Cast<AActor>(*It);
              if (!Actor)
              {
                continue;
              }

              if (!FirstSelected)
              {
                FirstSelected = Actor;
              }

              if (!ActorName.IsEmpty() && Actor->GetName() == ActorName)
              {
                Target = Actor;
                break;
              }
            }
          }

          if (!Target && ActorName.IsEmpty())
          {
            Target = FirstSelected;
          }

          // If an explicit actor_name was provided but it wasn't selected, fall back to a best-effort world scan.
          if (!Target && !ActorName.IsEmpty())
          {
            UWorld* World = GEditor->GetEditorWorldContext().World();
            if (World)
            {
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
                  Target = Actor;
                  break;
                }

                if (!ContainsMatch && Name.Contains(ActorName, ESearchCase::IgnoreCase))
                {
                  ContainsMatch = Actor;
                }
              }

              if (!Target)
              {
                Target = ContainsMatch;
              }
            }
          }
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

      if (Method == TEXT("get_editor_status") || Method == TEXT("get_engine_version") || Method == TEXT("get_current_project"))
      {
        bool bCompleted = false;
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, TEXT(""), bCompleted);
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
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, TEXT(""), bCompleted);
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
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, TEXT(""), bCompleted);
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
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, TEXT(""), bCompleted);
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
        FString ActorName;
        const TSharedPtr<FJsonObject>* ParamsPtr = nullptr;
        if (Req->TryGetObjectField(TEXTVIEW("params"), ParamsPtr) && ParamsPtr && ParamsPtr->IsValid())
        {
          (*ParamsPtr)->TryGetStringField(TEXTVIEW("actor_name"), ActorName);
        }

        bool bCompleted = false;
        TSharedPtr<FJsonObject> Result = HandleOnGameThreadBlocking(Method, ActorName, bCompleted);
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
