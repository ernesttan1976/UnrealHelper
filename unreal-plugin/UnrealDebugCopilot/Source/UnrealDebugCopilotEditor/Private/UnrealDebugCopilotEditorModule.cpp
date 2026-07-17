#include "UnrealDebugCopilotEditorModule.h"

#include "CopilotTcpServer.h"

#include "Interfaces/IPluginManager.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/Guid.h"
#include "Misc/Paths.h"

IMPLEMENT_MODULE(FUnrealDebugCopilotEditorModule, UnrealDebugCopilotEditor)

static FString GetOrCreateToken()
{
  FString Token;
  // Editor-only config because this endpoint is intended for local debugging.
  if (GConfig)
  {
    GConfig->GetString(TEXT("UnrealDebugCopilot"), TEXT("Token"), Token, GEditorPerProjectIni);
  }

  if (Token.IsEmpty())
  {
    Token = FGuid::NewGuid().ToString(EGuidFormats::Digits);
    if (GConfig)
    {
      GConfig->SetString(TEXT("UnrealDebugCopilot"), TEXT("Token"), *Token, GEditorPerProjectIni);
      GConfig->Flush(false, GEditorPerProjectIni);
    }
  }

  return Token;
}

void FUnrealDebugCopilotEditorModule::StartupModule()
{
  const FString Token = GetOrCreateToken();

  int32 Port = 17777;
  if (GConfig)
  {
    GConfig->GetInt(TEXT("UnrealDebugCopilot"), TEXT("Port"), Port, GEditorPerProjectIni);
  }

  Server = new FCopilotTcpServer(Token, Port);
  Server->Start();

  UE_LOG(LogTemp, Display, TEXT("[UnrealDebugCopilot] Listening on 127.0.0.1:%d"), Port);
  UE_LOG(LogTemp, Display, TEXT("[UnrealDebugCopilot] Token (set UNREAL_TOKEN for the mcp-server): %s"), *Token);
}

void FUnrealDebugCopilotEditorModule::ShutdownModule()
{
  if (Server)
  {
    Server->Stop();
    delete Server;
    Server = nullptr;
  }
}
