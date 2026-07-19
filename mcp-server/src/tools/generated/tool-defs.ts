/* AUTO-GENERATED: do not edit by hand. */
export type ToolMeta = {
  domain: string;
  priority: number;
  access: 'read' | 'write';
  risk: 'low' | 'medium' | 'high';
  requires_editor: boolean;
  pie: 'any' | 'stopped' | 'running';
  packs: string[];
  skill: string | null;
  stability: 'experimental' | 'stable' | 'deprecated';
  owner: 'mcp' | 'plugin';
};

export const TOOL_DEFS = [
  {
    "name": "unreal.begin_transaction",
    "description": "Begin an Unreal editor transaction (for safe write workflows).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "description": "Human-readable transaction description."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.cancel_current_operation",
    "description": "Cancel an in-flight Unreal TCP request (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "request_id": {
          "type": "string",
          "description": "Optional Unreal request_id to cancel."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.cancel_transaction",
    "description": "Cancel (rollback) the active Unreal editor transaction.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "transaction_id": {
          "type": "string",
          "description": "Transaction id returned by begin_transaction."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.clear_debug_session",
    "description": "Clear the current debug session (drops accumulated evidence).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.compare_compile_results",
    "description": "Compare before and after diagnostics (pure MCP-side diff).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "before": {
          "type": "object",
          "description": "Previous compile payload (as returned by compile tools)."
        },
        "after": {
          "type": "object",
          "description": "New compile payload (as returned by compile tools)."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.compile_all_dirty_blueprints",
    "description": "Compile modified Blueprint assets.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.compile_and_capture_messages",
    "description": "Compile and return normalized diagnostics.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.compile_blueprint",
    "description": "Compile one Blueprint without automatically saving.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.compile_blueprints",
    "description": "Compile several named Blueprints.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "asset_paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Blueprint package/object paths."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.compile_selected_blueprint",
    "description": "Compile the active Blueprint.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.end_debug_session",
    "description": "End the current debug session and return a summary.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.end_transaction",
    "description": "End (commit) the active Unreal editor transaction.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "transaction_id": {
          "type": "string",
          "description": "Transaction id returned by begin_transaction."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_asset_references",
    "description": "Find references to an asset (heuristic; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "asset_query": {
          "type": "string",
          "description": "Substring match against pin default values and node title."
        },
        "query": {
          "type": "string"
        },
        "all_graphs": {
          "type": "boolean"
        },
        "limit": {
          "type": "number"
        },
        "max_graphs": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_callers",
    "description": "Find callers of a function or event (alias of find_blueprint_function_calls; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "function_name": {
          "type": "string"
        },
        "query": {
          "type": "string"
        },
        "all_graphs": {
          "type": "boolean"
        },
        "limit": {
          "type": "number"
        },
        "max_graphs": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_class_references",
    "description": "Find usages of a class (heuristic; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "class_query": {
          "type": "string",
          "description": "Substring match against pin types/defaults and node title."
        },
        "query": {
          "type": "string"
        },
        "all_graphs": {
          "type": "boolean"
        },
        "limit": {
          "type": "number"
        },
        "max_graphs": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_component_references",
    "description": "Find nodes targeting a component (heuristic; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "component_name": {
          "type": "string"
        },
        "query": {
          "type": "string"
        },
        "all_graphs": {
          "type": "boolean"
        },
        "limit": {
          "type": "number"
        },
        "max_graphs": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_dead_ends",
    "description": "Execution paths with no continuation (heuristic; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "limit": {
          "type": "number",
          "description": "Max nodes returned (default 50, max 500)."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_entry_points",
    "description": "Events and externally called functions (heuristic; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "limit": {
          "type": "number",
          "description": "Max nodes returned (default 50, max 500)."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_events",
    "description": "Locate overlap, input, tick and custom events (heuristic; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "query": {
          "type": "string",
          "description": "Substring match against node title (case-insensitive)."
        },
        "all_graphs": {
          "type": "boolean"
        },
        "limit": {
          "type": "number"
        },
        "max_graphs": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_function_calls",
    "description": "Find calls to a particular function (heuristic; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "function_name": {
          "type": "string",
          "description": "Substring match against node title."
        },
        "query": {
          "type": "string"
        },
        "all_graphs": {
          "type": "boolean"
        },
        "limit": {
          "type": "number"
        },
        "max_graphs": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_implementations",
    "description": "Find implementations of interface calls (best-effort; may be unimplemented).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "interface_name": {
          "type": "string"
        },
        "function_name": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_nodes",
    "description": "Search Blueprint graph nodes by title/class (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string",
          "description": "Graph name; if omitted uses the Blueprint's default graph."
        },
        "query": {
          "type": "string",
          "description": "Substring match against node title (case-insensitive)."
        },
        "title_contains": {
          "type": "string"
        },
        "class_contains": {
          "type": "string"
        },
        "all_graphs": {
          "type": "boolean",
          "description": "If true, scans all graphs in the Blueprint (bounded)."
        },
        "limit": {
          "type": "number",
          "description": "Max nodes returned (default 50, max 500)."
        },
        "max_graphs": {
          "type": "number",
          "description": "Max graphs scanned when all_graphs=true (default 25, max 100)."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_unconnected_pins",
    "description": "Locate unconnected pins (bounded; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "exec_only": {
          "type": "boolean",
          "description": "If true, only consider exec pins."
        },
        "data_only": {
          "type": "boolean",
          "description": "If true, only consider non-exec pins."
        },
        "limit": {
          "type": "number",
          "description": "Max pins returned (default 200, max 2000)."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_variable_reads",
    "description": "Locate reads of a variable (heuristic; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "variable_name": {
          "type": "string"
        },
        "query": {
          "type": "string"
        },
        "all_graphs": {
          "type": "boolean"
        },
        "limit": {
          "type": "number"
        },
        "max_graphs": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.find_blueprint_variable_writes",
    "description": "Locate assignments to a variable (heuristic; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "variable_name": {
          "type": "string"
        },
        "query": {
          "type": "string"
        },
        "all_graphs": {
          "type": "boolean"
        },
        "limit": {
          "type": "number"
        },
        "max_graphs": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.focus_blueprint_node",
    "description": "Navigate the editor to a node (not yet implemented; placeholder tool).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "node_id": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_active_asset_editor",
    "description": "Best-effort: get the currently active/focused asset editor.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_active_blueprint",
    "description": "Get the Blueprint currently being edited (best-effort: if multiple are open, returns a deterministic choice).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_active_blueprint_graph",
    "description": "Best-effort: get the currently active/focused Blueprint graph.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_active_debug_session",
    "description": "Return the current debug session (if any).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_bookmarks",
    "description": "Graph bookmarks (best-effort; currently returns empty).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_breakpoints",
    "description": "Existing Blueprint breakpoints (best-effort; currently returns empty).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_bytecode_summary",
    "description": "Optional compiled execution summary (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_class_defaults",
    "description": "Class Default Object values (bounded; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "include_transient": {
          "type": "boolean"
        },
        "max_properties": {
          "type": "number"
        },
        "name_contains": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_compile_status",
    "description": "Dirty, up-to-date, warning or error (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_component_tree",
    "description": "Parent-child component hierarchy derived from SCS (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_components",
    "description": "Simple Construction Script components (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_data_flow",
    "description": "Data-pin graph only (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "max_depth": {
          "type": "number"
        },
        "max_nodes": {
          "type": "number"
        },
        "max_edges": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_debug_object",
    "description": "Current runtime instance being debugged (best-effort; currently returns null).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_dependencies",
    "description": "Assets required by this Blueprint (AssetRegistry; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_dependents",
    "description": "Assets that depend on this Blueprint (AssetRegistry; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_event_dispatchers",
    "description": "Dispatchers and signatures (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_execution_flow",
    "description": "Execution-pin graph only (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "max_depth": {
          "type": "number"
        },
        "max_nodes": {
          "type": "number"
        },
        "max_edges": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_functions",
    "description": "Function names, inputs, outputs and flags (best-effort; signatures may be partial).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_graph",
    "description": "Structured nodes and connections for one graph (bounded; mode controls verbosity).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "mode": {
          "type": "string"
        },
        "node_id": {
          "type": "string"
        },
        "max_depth": {
          "type": "number"
        },
        "max_nodes": {
          "type": "number"
        },
        "max_edges": {
          "type": "number"
        },
        "include_pins": {
          "type": "boolean"
        },
        "include_edges": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_graph_comments",
    "description": "Comment boxes and contained nodes (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "max_nodes": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_graphs",
    "description": "All Event, function, macro and construction graphs (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_interfaces",
    "description": "Implemented interfaces (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_local_variables",
    "description": "Locals belonging to a function (best-effort; currently returns empty).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "function": {
          "type": "string",
          "description": "Function graph name."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_macros",
    "description": "Macro definitions (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_metadata",
    "description": "Type, parent class, interfaces and status (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_node",
    "description": "Full information about one node (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "node_id": {
          "type": "string"
        },
        "graph": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_node_comment",
    "description": "Comment associated with a node (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "node_id": {
          "type": "string"
        },
        "graph": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_node_connections",
    "description": "Connections for one node (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "node_id": {
          "type": "string"
        },
        "graph": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_node_defaults",
    "description": "Literal/default pin values (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "node_id": {
          "type": "string"
        },
        "graph": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_node_pins",
    "description": "Input/output pins and types for one node (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "node_id": {
          "type": "string"
        },
        "graph": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_nodes",
    "description": "Filtered list of graph nodes (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "title_contains": {
          "type": "string"
        },
        "class_contains": {
          "type": "string"
        },
        "limit": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_parent_class",
    "description": "Parent Blueprint or native class (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_references",
    "description": "Assets, classes and objects referenced (best-effort; currently returns empty).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_summary",
    "description": "Compact overview of the Blueprint (best-effort; returns blueprint_found=false if none is available).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_timelines",
    "description": "Timelines, tracks, lengths and settings (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_variables",
    "description": "Variables, types, defaults and flags (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_blueprint_watches",
    "description": "Watched pins and variables (best-effort; currently returns empty).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_compile_error_nodes",
    "description": "Map errors back to nodes (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_compile_message_details",
    "description": "Full details for one diagnostic (from last captured compile).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "message_id": {
          "type": "string",
          "description": "Message id (e.g. m0) returned by compile tools."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_compile_messages",
    "description": "Errors, warnings and notes (from last captured compile).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_compile_warning_nodes",
    "description": "Map warnings back to nodes (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_component_tree",
    "description": "Get the component tree for an actor (default: first selected actor; if actor_name is provided, will also search the current editor world).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "actor_name": {
          "type": "string",
          "description": "Optional actor name; if omitted uses first selected actor."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_connection_status",
    "description": "Return MCP server + Unreal transport status (optionally probes the Unreal plugin).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "probe": {
          "type": "boolean",
          "description": "If true, performs a ping/capabilities probe (default false)."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_content_browser_path",
    "description": "Get the current Content Browser path/folder (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_current_level",
    "description": "Get the active editor world and map.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_current_project",
    "description": "Get current project name and directory.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_dirty_assets",
    "description": "Get modified but unsaved packages/assets (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_downstream_nodes",
    "description": "Nodes affected by a node/output (heuristic graph traversal; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "node_id": {
          "type": "string"
        },
        "max_depth": {
          "type": "number",
          "description": "Traversal depth (default 3, max 20)."
        },
        "max_nodes": {
          "type": "number",
          "description": "Max nodes returned (default 200, max 2000)."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_editor_mode",
    "description": "Get active editor mode(s) (Select, Landscape, etc).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_editor_status",
    "description": "Get Unreal Editor readiness and PIE state.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_editor_viewport_state",
    "description": "Get editor viewport camera transform and view mode (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_engine_version",
    "description": "Get Unreal Engine version string.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_focused_blueprint_node",
    "description": "Best-effort: get the most relevant selected/focused Blueprint node.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_generated_class_status",
    "description": "Check generated class availability.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_last_successful_compile",
    "description": "Last known clean compile (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_last_tool_error",
    "description": "Retrieve the last bridge/plugin failure observed by this MCP server.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_message_log_summary",
    "description": "Get a summary of Unreal Message Log categories (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_node_neighbourhood",
    "description": "Small graph around one node (bounded; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "node_id": {
          "type": "string"
        },
        "max_depth": {
          "type": "number",
          "description": "Traversal depth (default 1, max 10)."
        },
        "max_nodes": {
          "type": "number",
          "description": "Max nodes returned (default 200, max 2000)."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_open_asset_editors",
    "description": "Alias for unreal.get_open_editors.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_open_editors",
    "description": "List assets that currently have an editor open (asset editors).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_open_levels",
    "description": "Get the persistent and streamed levels for the active editor world.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_pending_editor_notifications",
    "description": "Get pending editor notifications/modals (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_plugin_version",
    "description": "Get UnstuckForUnreal plugin version (and bridge protocol version).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_project_info",
    "description": "Alias for unreal.get_current_project.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_protocol_capabilities",
    "description": "List supported MCP tools and Unreal plugin methods (if available).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_selected_actors",
    "description": "Get currently selected actors in the editor.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_selected_assets",
    "description": "Get assets selected in the Content Browser.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_selected_blueprint_nodes",
    "description": "Best-effort: get selected nodes in the active Blueprint graph editor.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_selected_components",
    "description": "Get components currently selected in the editor.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_skeleton_class_status",
    "description": "Inspect Blueprint skeleton class.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_upstream_nodes",
    "description": "Nodes that contribute to a pin/value (heuristic graph traversal; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "node_id": {
          "type": "string"
        },
        "max_depth": {
          "type": "number",
          "description": "Traversal depth (default 3, max 20)."
        },
        "max_nodes": {
          "type": "number",
          "description": "Max nodes returned (default 200, max 2000)."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.get_world_outliner_selection",
    "description": "Alias for unreal.get_selected_actors (Outliner selection).",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.inspect_blueprint",
    "description": "Inspect a Blueprint asset (variables, graphs, SCS components; optionally CDO properties).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string",
          "description": "Blueprint object path, e.g. /Game/Foo/BP_My.BP_My"
        },
        "asset_path": {
          "type": "string",
          "description": "Blueprint asset package path, e.g. /Game/Foo/BP_My"
        },
        "include_cdo_properties": {
          "type": "boolean",
          "description": "If true, also exports properties from the generated class CDO."
        },
        "include_transient": {
          "type": "boolean",
          "description": "Include transient properties (default false)."
        },
        "max_properties": {
          "type": "number",
          "description": "Max CDO properties exported (default 200, max 2000)."
        },
        "name_contains": {
          "type": "string",
          "description": "Only include CDO properties whose name contains this substring."
        },
        "use_active_if_missing": {
          "type": "boolean",
          "description": "If no path is provided, uses the first open Blueprint editor asset if available (default true)."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.inspect_object",
    "description": "Inspect a UObject (or Actor by name) using Unreal reflection (no direct .uasset reads).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string",
          "description": "Object path, e.g. /Game/Foo/Bar.Bar"
        },
        "asset_path": {
          "type": "string",
          "description": "Asset package path, e.g. /Game/Foo/Bar"
        },
        "actor_name": {
          "type": "string",
          "description": "Actor name in the editor world (best-effort search)."
        },
        "include_transient": {
          "type": "boolean",
          "description": "Include transient properties (default false)."
        },
        "max_properties": {
          "type": "number",
          "description": "Max properties exported (default 200, max 2000)."
        },
        "name_contains": {
          "type": "string",
          "description": "Only include properties whose name contains this substring."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.list_assets",
    "description": "List assets via the Asset Registry (no direct .uasset reads).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Package path, e.g. /Game or /Game/ThirdPerson"
        },
        "class": {
          "type": "string",
          "description": "Optional UClass name filter, e.g. Blueprint, StaticMesh"
        },
        "recursive": {
          "type": "boolean",
          "description": "Whether to recurse into subpaths (default true)."
        },
        "limit": {
          "type": "number",
          "description": "Max number of results returned (default 200, max 2000)."
        },
        "name_contains": {
          "type": "string",
          "description": "Optional substring filter on asset name."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.open_blueprint_graph",
    "description": "Open and focus a graph (not yet implemented; placeholder tool).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.ping",
    "description": "Check connectivity with the Unreal Editor plugin.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.reconstruct_blueprint_node",
    "description": "Reconstruct a specific node (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "node_id": {
          "type": "string",
          "description": "Node GUID (DigitsWithHyphens)"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.refresh_blueprint_nodes",
    "description": "Refresh stale nodes (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.reinstance_blueprint",
    "description": "Advanced recovery after recompilation (best-effort; may be unsupported).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.select_blueprint_nodes",
    "description": "Select nodes for the user to inspect (not yet implemented; placeholder tool).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "node_ids": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.start_debug_session",
    "description": "Begin a scoped debug session for correlating tool calls and evidence.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "label": {
          "type": "string",
          "description": "Optional label for the session."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.trace_blueprint_path",
    "description": "Find a graph path between two nodes (bounded; best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        },
        "graph": {
          "type": "string"
        },
        "from_node_id": {
          "type": "string"
        },
        "to_node_id": {
          "type": "string"
        },
        "max_steps": {
          "type": "number",
          "description": "Max edges in the returned path (default 32, max 256)."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.validate_blueprint_asset",
    "description": "Run asset validation (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "unreal.validate_blueprint_dependencies",
    "description": "Detect missing or broken dependencies (best-effort).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "object_path": {
          "type": "string"
        },
        "asset_path": {
          "type": "string"
        },
        "use_active_if_missing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  }
] as const;

export const TOOL_META_BY_NAME: Record<string, ToolMeta> = {
  "unreal.begin_transaction": {
    "domain": "editor",
    "priority": 0,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.write"
    ],
    "skill": null,
    "stability": "experimental",
    "owner": "plugin"
  },
  "unreal.cancel_current_operation": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "mcp"
  },
  "unreal.cancel_transaction": {
    "domain": "editor",
    "priority": 0,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.write"
    ],
    "skill": null,
    "stability": "experimental",
    "owner": "plugin"
  },
  "unreal.clear_debug_session": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "mcp"
  },
  "unreal.compare_compile_results": {
    "domain": "diagnostics",
    "priority": 4,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "mcp"
  },
  "unreal.compile_all_dirty_blueprints": {
    "domain": "blueprint",
    "priority": 4,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.write",
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.compile_and_capture_messages": {
    "domain": "diagnostics",
    "priority": 4,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.write",
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.compile_blueprint": {
    "domain": "blueprint",
    "priority": 4,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.write",
      "unreal.diagnostics"
    ],
    "skill": "blueprint-edit-and-validate",
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.compile_blueprints": {
    "domain": "blueprint",
    "priority": 4,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.write",
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.compile_selected_blueprint": {
    "domain": "blueprint",
    "priority": 4,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.write",
      "unreal.diagnostics"
    ],
    "skill": "blueprint-edit-and-validate",
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.end_debug_session": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "mcp"
  },
  "unreal.end_transaction": {
    "domain": "editor",
    "priority": 0,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.write"
    ],
    "skill": null,
    "stability": "experimental",
    "owner": "plugin"
  },
  "unreal.find_blueprint_asset_references": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.find_blueprint_callers": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.find_blueprint_class_references": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.find_blueprint_component_references": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.find_blueprint_dead_ends": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.find_blueprint_entry_points": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.find_blueprint_events": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.find_blueprint_function_calls": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.find_blueprint_implementations": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "experimental",
    "owner": "plugin"
  },
  "unreal.find_blueprint_nodes": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.find_blueprint_unconnected_pins": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.find_blueprint_variable_reads": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.find_blueprint_variable_writes": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.focus_blueprint_node": {
    "domain": "blueprint",
    "priority": 3,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.write"
    ],
    "skill": null,
    "stability": "experimental",
    "owner": "plugin"
  },
  "unreal.get_active_asset_editor": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_active_blueprint": {
    "domain": "blueprint",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_active_blueprint_graph": {
    "domain": "blueprint",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_active_debug_session": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "mcp"
  },
  "unreal.get_blueprint_bookmarks": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_breakpoints": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_bytecode_summary": {
    "domain": "diagnostics",
    "priority": 4,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_class_defaults": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_compile_status": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_component_tree": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_components": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_data_flow": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_debug_object": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_dependencies": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_dependents": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_event_dispatchers": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_execution_flow": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_functions": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_graph": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": "blueprint-inspection",
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_graph_comments": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_graphs": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": "blueprint-inspection",
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_interfaces": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_local_variables": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_macros": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_metadata": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_node": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_node_comment": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_node_connections": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_node_defaults": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_node_pins": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_nodes": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_parent_class": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_references": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_summary": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": "blueprint-inspection",
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_timelines": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_variables": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_blueprint_watches": {
    "domain": "blueprint",
    "priority": 2,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_compile_error_nodes": {
    "domain": "diagnostics",
    "priority": 4,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_compile_message_details": {
    "domain": "diagnostics",
    "priority": 4,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_compile_messages": {
    "domain": "diagnostics",
    "priority": 4,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_compile_warning_nodes": {
    "domain": "diagnostics",
    "priority": 4,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_component_tree": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_connection_status": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "mcp"
  },
  "unreal.get_content_browser_path": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_current_level": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_current_project": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_dirty_assets": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_downstream_nodes": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_editor_mode": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_editor_status": {
    "domain": "editor",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_editor_viewport_state": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_engine_version": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_focused_blueprint_node": {
    "domain": "blueprint",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_generated_class_status": {
    "domain": "diagnostics",
    "priority": 4,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_last_successful_compile": {
    "domain": "diagnostics",
    "priority": 4,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_last_tool_error": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "mcp"
  },
  "unreal.get_message_log_summary": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_node_neighbourhood": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_open_asset_editors": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_open_editors": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_open_levels": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_pending_editor_notifications": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_plugin_version": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_project_info": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "mcp"
  },
  "unreal.get_protocol_capabilities": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "mcp"
  },
  "unreal.get_selected_actors": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_selected_assets": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_selected_blueprint_nodes": {
    "domain": "blueprint",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_selected_components": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_skeleton_class_status": {
    "domain": "diagnostics",
    "priority": 4,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_upstream_nodes": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.get_world_outliner_selection": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.inspect_blueprint": {
    "domain": "blueprint",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": "blueprint-inspection",
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.inspect_object": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.list_assets": {
    "domain": "editor",
    "priority": 1,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.editor.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.open_blueprint_graph": {
    "domain": "blueprint",
    "priority": 3,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.write"
    ],
    "skill": null,
    "stability": "experimental",
    "owner": "plugin"
  },
  "unreal.ping": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.reconstruct_blueprint_node": {
    "domain": "blueprint",
    "priority": 4,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.write"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.refresh_blueprint_nodes": {
    "domain": "blueprint",
    "priority": 4,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.write"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.reinstance_blueprint": {
    "domain": "blueprint",
    "priority": 4,
    "access": "write",
    "risk": "high",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.write"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.select_blueprint_nodes": {
    "domain": "blueprint",
    "priority": 3,
    "access": "write",
    "risk": "medium",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.write"
    ],
    "skill": null,
    "stability": "experimental",
    "owner": "plugin"
  },
  "unreal.start_debug_session": {
    "domain": "core",
    "priority": 0,
    "access": "read",
    "risk": "low",
    "requires_editor": false,
    "pie": "any",
    "packs": [
      "unreal.core"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "mcp"
  },
  "unreal.trace_blueprint_path": {
    "domain": "blueprint",
    "priority": 3,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.blueprint.read"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.validate_blueprint_asset": {
    "domain": "diagnostics",
    "priority": 4,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  },
  "unreal.validate_blueprint_dependencies": {
    "domain": "diagnostics",
    "priority": 4,
    "access": "read",
    "risk": "low",
    "requires_editor": true,
    "pie": "any",
    "packs": [
      "unreal.diagnostics"
    ],
    "skill": null,
    "stability": "stable",
    "owner": "plugin"
  }
};
