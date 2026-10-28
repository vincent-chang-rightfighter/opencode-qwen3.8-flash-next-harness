import {
  buildChatTemplateKwargs,
  classifyTask,
  hasExplicitEffort,
  matchesTarget,
  messageText,
  partsText,
  remember,
  resolveOptions,
  SUBAGENT_DISABLED_INSTRUCTION,
  toolPartsFailed,
} from "./lib.js";

export default async function strataReasoning(pluginInput, rawOptions = {}) {
  const options = resolveOptions(rawOptions);
  if (!options.enabled) return {};

  const client = pluginInput?.client;
  const sessions = new Map();

  const requestModelID = (input) =>
    String(input?.model?.id ?? input?.model?.modelID ?? input?.model?.name ?? "");

  const debug = (payload) => {
    if (!options.debug) return;
    console.error("[strata-reasoning]", JSON.stringify(payload));
    try {
      client?.app?.log?.({
        body: {
          service: "strata-reasoning",
          level: "info",
          message: JSON.stringify(payload),
        },
      });
    } catch {}
  };

  return {
    "chat.message": async (input, output) => {
      const text = partsText(output?.parts) || messageText(output?.message);
      debug({ stage: "chat.message", sessionID: input.sessionID, textLength: text.length });
      if (text) {
        const previous = sessions.get(input.sessionID) ?? {};
        remember(sessions, input.sessionID, {
          ...previous,
          text,
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
      if (!matchesTarget(input, options)) {
        if (state.subagentsDisabled || state.modelID) {
          remember(sessions, input.sessionID, {
            ...state,
            subagentsDisabled: false,
            modelID: undefined,
          });
        }
        return;
      }
      if (options.ignoreAgents.includes(String(input.agent ?? "").toLowerCase())) return;

      const text = messageText(input.message) || state.text || "";
      const modelID = requestModelID(input);
      const subagentsDisabled = options.disableSubagents;
      const classification = classifyTask(text, options, {
        agent: input.agent,
        toolTurn: Boolean(state.toolTurn),
        toolFailed: Boolean(state.toolFailed),
        failures: state.failures ?? 0,
      });

      remember(sessions, input.sessionID, {
        ...state,
        text,
        toolTurn: false,
        modelID,
        subagentsDisabled,
      });

      const existing = output.options?.chat_template_kwargs;
      if (options.respectExplicitEffort && hasExplicitEffort(existing)) return;

      if (!output.options || typeof output.options !== "object") output.options = {};
      output.options.chat_template_kwargs = buildChatTemplateKwargs(
        existing,
        classification.effort,
      );
      if (options.overrideTemperature) output.temperature = classification.temperature;

      debug({
        sessionID: input.sessionID,
        agent: input.agent,
        provider: input.provider?.info?.id ?? input.provider?.id ?? null,
        model: modelID || null,
        kind: classification.kind,
        effort: classification.effort,
        temperature: classification.temperature,
        reason: classification.reason,
        subagentsDisabled,
      });
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (!options.disableSubagents) return;
      if (!matchesTarget({ model: input?.model }, options)) return;
      if (!Array.isArray(output?.system)) return;
      if (!output.system.includes(SUBAGENT_DISABLED_INSTRUCTION)) {
        output.system.push(SUBAGENT_DISABLED_INSTRUCTION);
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

    event: async ({ event }) => {
      if (event?.type === "session.deleted") {
        const sessionID = event.properties?.sessionID;
        if (sessionID) sessions.delete(sessionID);
      }
    },
  };
}
