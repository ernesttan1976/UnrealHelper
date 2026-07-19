#include "UnstuckForUnrealEditorModule.h"

#include "CopilotTcpServer.h"

#include "Interfaces/IPluginManager.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/Guid.h"
#include "Misc/Paths.h"

IMPLEMENT_MODULE(FUnstuckForUnrealEditorModule, UnstuckForUnrealEditor)

static FString GetOrCreateToken()
{
  FString Token;
  // Editor-only config because this endpoint is intended for local debugging.
  if (GConfig)
  {
    GConfig->GetString(TEXT("UnstuckForUnreal"), TEXT("Token"), Token, GEditorPerProjectIni);
  }

  if (Token.IsEmpty())
  {
    Token = FGuid::NewGuid().ToString(EGuidFormats::Digits);
    if (GConfig)
    {
      GConfig->SetString(TEXT("UnstuckForUnreal"), TEXT("Token"), *Token, GEditorPerProjectIni);
      GConfig->Flush(false, GEditorPerProjectIni);
    }
  }

  return Token;
}

void FUnstuckForUnrealEditorModule::StartupModule()
{
  const FString Token = GetOrCreateToken();

  int32 Port = 17777;
  if (GConfig)
  {
    GConfig->GetInt(TEXT("UnstuckForUnreal"), TEXT("Port"), Port, GEditorPerProjectIni);
  }

  Server = new FCopilotTcpServer(Token, Port);
  Server->Start();
}

void FUnstuckForUnrealEditorModule::ShutdownModule()
{
  if (Server)
  {
    Server->Stop();
    delete Server;
    Server = nullptr;
  }
}
