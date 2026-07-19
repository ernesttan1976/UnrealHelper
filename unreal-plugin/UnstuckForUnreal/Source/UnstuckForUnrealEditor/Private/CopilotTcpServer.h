#pragma once

#include "CoreMinimal.h"

class FSocket;
class FRunnableThread;

// Minimal, local-only, line-delimited JSON-RPC listener.
// Each request and response is a single JSON object terminated by "\n".
class FCopilotTcpServer
{
public:
  FCopilotTcpServer(const FString& InToken, int32 InPort);
  ~FCopilotTcpServer();

  void Start();
  void Stop();

private:
  FString Token;
  int32 Port = 17777;

  class FServerRunnable* Runnable = nullptr;
  FRunnableThread* Thread = nullptr;
};
