#pragma once

#include "Modules/ModuleManager.h"

class FCopilotTcpServer;

class FUnrealDebugCopilotEditorModule : public IModuleInterface
{
public:
  virtual void StartupModule() override;
  virtual void ShutdownModule() override;

private:
  FCopilotTcpServer* Server = nullptr;
};
