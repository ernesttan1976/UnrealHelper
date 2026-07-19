#pragma once

#include "Modules/ModuleManager.h"

class FCopilotTcpServer;

class FUnstuckForUnrealEditorModule : public IModuleInterface
{
public:
  virtual void StartupModule() override;
  virtual void ShutdownModule() override;

private:
  FCopilotTcpServer* Server = nullptr;
};
