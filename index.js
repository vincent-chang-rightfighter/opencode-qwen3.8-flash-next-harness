import {
  buildChatTemplateKwargs,
  classifyTask,
  editedPathsFromTool,
  hasExplicitEffort,
  isLocalEndpoint,
  isVerificationCommand,
  looksLikeToolFailure,
  matchesTarget,
  messageText,
  partsText,
  remember,
  resolveOptions,
  resolveProviderProfile,
  shouldPlanTask,
  SUBAGENT_DISABLED_INSTRUCTION,
  PLANNING_INSTRUCTION,
  TODO_REMINDER,
  VERIFICATION_FAILED_REMINDER,
  VERIFICATION_REMINDER,
  toolPartsFailed,
} from "./lib.js";

export default async function strataReasoning(pluginInput, rawOptions = {}) {
  const options = resolveOptions(rawOptions);
  if (!options.enabled) return {};

  const client = pluginInput?.client;
  const sessions = new Map();

  const requestModelID = (input) =>
    String(input?.model?.id ?? input?.model?.modelID ?? input?.model?.name ?? "");

  const addLocalProvider = (providerID) => {
    const id = String(providerID ?? "").toLowerCase();
    if (id && !options.localProviders.includes(id)) options.localProviders.push(id);
  };

  const debug = (payload) => {
    if (!options.debug) return;
    console.error("[qwen-harness]", JSON.stringify(payload));
    try {
      client?.app?.log?.({
        body: {
          service: "qwen-harness",
          level: "info",
          message: JSON.stringify(payload),
        },
      });
    } catch {}
  };

  return {
    config: async (config) => {
      const providers = config?.provider;
      if (!providers || typeof providers !== "object") return;
      for (const [providerID, provider] of Object.entries(providers)) {
        const baseURL =
          provider?.options?.baseURL ??
          provider?.options?.baseUrl ??
          provider?.baseURL;
        if (isLocalEndpoint(baseURL)) addLocalProvider(providerID);
      }
    },

    "chat.message": async (input, output) => {
      const text = partsText(output?.parts) || messageText(output?.message);
      debug({ stage: "chat.message", sessionID: input.sessionID, textLength: text.length });
      if (text) {
        const previous = sessions.get(input.sessionID) ?? {};
        const planning = shouldPlanTask(classifyTask(text, options), options);
        remember(sessions, input.sessionID, {
          ...previous,
          text,
          planning,
          toolTurn: false,
          toolFailed: false,
          failures: 0,
          lastToolKey: undefined,
        });
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      const messages = Array.isArray(output?.messages) ? output.messages : [];
      if (messages.length === 0) return;

      const last = messages[messages.length - 1];
      const info = last?.info ?? last;
      const sessionID = info?.sessionID ?? last?.sessionID;
      if (!sessionID) return;

      let text = "";
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const messageInfo = message?.info ?? message;
        if ((messageInfo?.role ?? message?.role) === "user") {
          text = partsText(message?.parts ?? messageInfo?.parts);
          if (text) break;
        }
      }

      const previous = sessions.get(sessionID);
      const role = info?.role ?? last?.role ?? null;
      const parts = last?.parts ?? info?.parts ?? [];
      const hasToolPart = Array.isArray(parts)
        ? parts.some(
            (part) =>
              part?.type === "tool" ||
              part?.type === "tool_result" ||
              part?.type === "tool-result",
          )
        : false;
      const toolCompleted =
        role === "tool" ||
        (hasToolPart &&
          parts.some(
            (part) =>
              part?.type === "tool" &&
              (part.state?.status === "completed" ||
                part.state?.status === "error" ||
                part.state?.output !== undefined ||
                part.state?.error),
          ));
      const toolTurn = toolCompleted;
      const toolFailed = toolTurn ? toolPartsFailed(parts) : false;
      const toolKey = toolTurn
        ? info?.id ?? last?.id ?? partsText(parts).slice(0, 160)
        : previous?.lastToolKey;
      let failures = previous?.failures ?? 0;
      if (toolTurn && toolFailed && toolKey !== previous?.lastToolKey) {
        failures = Math.min(3, failures + 1);
      }

      remember(sessions, sessionID, {
        ...previous,
        text: text || previous?.text || "",
        toolTurn,
        toolFailed,
        failures,
        lastToolKey: toolKey,
      });
      debug({
        stage: "transform",
        sessionID,
        messages: messages.length,
        role,
        toolTurn,
        toolFailed,
        failures,
        hasParts: Array.isArray(parts),
        partTypes: Array.isArray(parts) ? parts.map((part) => part?.type ?? null) : [],
        toolStates: Array.isArray(parts)
          ? parts
              .filter((part) => part?.type === "tool")
              .map((part) => ({
                status: part?.state?.status ?? null,
                hasOutput: part?.state?.output !== undefined,
                hasError: Boolean(part?.state?.error),
              }))
          : [],
      });
    },

    "chat.params": async (input, output) => {
      const state = sessions.get(input.sessionID) ?? {};
      const providerID = String(
        input.provider?.info?.id ?? input.provider?.id ?? input.model?.providerID ?? "",
      ).toLowerCase();
      const baseURL =
        input.provider?.options?.baseURL ??
        input.provider?.options?.baseUrl ??
        input.provider?.baseURL;
      if (isLocalEndpoint(baseURL)) addLocalProvider(providerID);
      if (!matchesTarget(input, options)) {
        if (state.subagentsDisabled || state.modelID || state.planning) {
          remember(sessions, input.sessionID, {
            ...state,
            subagentsDisabled: false,
            modelID: undefined,
            planning: false,
          });
        }
        return;
      }
      if (options.ignoreAgents.includes(String(input.agent ?? "").toLowerCase())) return;

      const text = messageText(input.message) || state.text || "";
      const modelID = requestModelID(input);
      const profile = resolveProviderProfile(providerID, options);
      const subagentsDisabled = options.disableSubagents;
      const classification = classifyTask(text, options, {
        agent: input.agent,
        toolTurn: Boolean(state.toolTurn),
        toolFailed: Boolean(state.toolFailed),
        failures: state.failures ?? 0,
      });
      const planning =
        typeof state.planning === "boolean"
          ? state.planning
          : shouldPlanTask(classification, options);

      remember(sessions, input.sessionID, {
        ...state,
        text,
        toolTurn: false,
        modelID,
        subagentsDisabled,
        planning,
      });

      const existing = output.options?.chat_template_kwargs;
      const explicitTopLevel =
        output.options &&
        typeof output.options === "object" &&
        (Object.prototype.hasOwnProperty.call(output.options, "reasoning_effort") ||
          Object.prototype.hasOwnProperty.call(output.options, "reasoning"));
      if (options.respectExplicitEffort && (hasExplicitEffort(existing) || explicitTopLevel)) {
        return;
      }

      if (!output.options || typeof output.options !== "object") output.options = {};
      if (profile.reasoning === "chat_template_kwargs") {
        output.options.chat_template_kwargs = buildChatTemplateKwargs(
          existing,
          classification.effort,
        );
      } else if (profile.reasoning === "reasoning_effort") {
        output.options.reasoning_effort = classification.effort;
      }
      if (profile.temperature && options.overrideTemperature) {
        output.temperature = classification.temperature;
      }

      debug({
        sessionID: input.sessionID,
        agent: input.agent,
        provider: providerID || null,
        model: modelID || null,
        reasoningMode: profile.reasoning,
        kind: classification.kind,
        effort: classification.effort,
        temperature: classification.temperature,
        reason: classification.reason,
        subagentsDisabled,
        planning,
      });
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (!Array.isArray(output?.system)) return;
      if (!matchesTarget({ model: input?.model }, options)) return;

      if (
        options.disableSubagents &&
        !output.system.includes(SUBAGENT_DISABLED_INSTRUCTION)
      ) {
        output.system.push(SUBAGENT_DISABLED_INSTRUCTION);
      }

      const state = sessions.get(input.sessionID);

      if (options.autoTodo) {
        const planning =
          typeof state?.planning === "boolean"
            ? state.planning
            : state?.text
              ? shouldPlanTask(classifyTask(state.text, options), options)
              : false;
        const instruction = state?.todosActive ? TODO_REMINDER : PLANNING_INSTRUCTION;
        if (planning && !output.system.includes(instruction)) {
          output.system.push(instruction);
        }
      }

      if (options.autoVerify) {
        const instruction = state?.verificationFailed
          ? VERIFICATION_FAILED_REMINDER
          : state?.verificationPending
            ? VERIFICATION_REMINDER
            : null;
        if (instruction && !output.system.includes(instruction)) {
          output.system.push(instruction);
        }
      }
    },

    "tool.execute.before": async (input) => {
      if (!options.disableSubagents || input.tool !== "task") return;
      const state = sessions.get(input.sessionID);
      if (!state?.subagentsDisabled) return;
      debug({
        stage: "tool.execute.before",
        sessionID: input.sessionID,
        tool: input.tool,
        model: state.modelID ?? null,
        blocked: true,
      });
      throw new Error(
        `Subagents are disabled for ${state.modelID || "this model"}. Do not call the task tool; complete the work with the direct tools.`,
      );
    },

    "tool.execute.after": async (input, output) => {
      const state = sessions.get(input.sessionID) ?? {};

      if (input.tool === "todowrite") {
        const todos = input.args?.todos;
        if (!Array.isArray(todos)) return;
        const todosActive = todos.some(
          (todo) => todo?.status === "pending" || todo?.status === "in_progress",
        );
        remember(sessions, input.sessionID, { ...state, todosActive });
        debug({
          stage: "tool.execute.after",
          tool: input.tool,
          sessionID: input.sessionID,
          todos: todos.length,
          todosActive,
        });
        return;
      }

      if (input.tool === "edit" || input.tool === "write" || input.tool === "apply_patch") {
        const paths = editedPathsFromTool(input.tool, input.args);
        const editedFiles = [
          ...new Set([...(Array.isArray(state.editedFiles) ? state.editedFiles : []), ...paths]),
        ].slice(-20);
        remember(sessions, input.sessionID, {
          ...state,
          editedFiles,
          verificationPending: true,
        });
        debug({
          stage: "tool.execute.after",
          tool: input.tool,
          sessionID: input.sessionID,
          paths,
          editedFiles: editedFiles.length,
        });
        return;
      }

      if (input.tool !== "bash") return;
      const command = typeof input.args?.command === "string" ? input.args.command : "";
      if (!isVerificationCommand(command)) return;
      const text = typeof output?.output === "string" ? output.output : "";
      const exitCode = Number(
        output?.metadata?.exitCode ?? output?.metadata?.exit_code ?? 0,
      );
      const failed =
        (Number.isFinite(exitCode) && exitCode !== 0) || looksLikeToolFailure(text);
      remember(sessions, input.sessionID, {
        ...state,
        verificationPending: failed,
        verificationFailed: failed,
        lastVerification: command.slice(0, 300),
        lastVerificationOutput: failed ? text.slice(-1200) : undefined,
      });
      debug({
        stage: "tool.execute.after",
        tool: input.tool,
        sessionID: input.sessionID,
        verification: failed ? "failed" : "passed",
        command: command.slice(0, 160),
      });
    },

    "experimental.session.compacting": async (input, output) => {
      const state = sessions.get(input.sessionID);
      if (!state || !Array.isArray(output?.context)) return;
      const lines = ["## Harness state (preserve)"];
      if (state.text) {
        lines.push(`Current request: ${String(state.text).replace(/\s+/g, " ").slice(0, 1200)}`);
      }
      lines.push(
        `Planning: ${state.planning ? "active" : "idle"}; todo list: ${state.todosActive ? "active" : "idle"}`,
      );
      if (Array.isArray(state.editedFiles) && state.editedFiles.length > 0) {
        lines.push(`Edited files: ${state.editedFiles.join(", ")}`);
      }
      lines.push(
        `Verification: ${
          state.verificationFailed
            ? "failed"
            : state.verificationPending
              ? "pending"
              : "not pending"
        }`,
      );
      if (state.lastVerification) {
        lines.push(`Last check: ${state.lastVerification}`);
      }
      if (state.verificationFailed && state.lastVerificationOutput) {
        lines.push(`Check error (tail): ${state.lastVerificationOutput.slice(-600)}`);
      }
      lines.push(
        "Rules: no subagents; use direct tools; keep the todo list current; verify before claiming completion.",
      );
      output.context.push(lines.join("\n"));
    },

    event: async ({ event }) => {
      if (event?.type === "session.deleted") {
        const sessionID = event.properties?.sessionID;
        if (sessionID) sessions.delete(sessionID);
      }
    },
  };
}
