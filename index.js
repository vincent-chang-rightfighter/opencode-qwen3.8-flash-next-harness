import {
  buildChatTemplateKwargs,
  classifyTask,
  hasExplicitEffort,
  matchesTarget,
  messageText,
  partsText,
  remember,
  resolveOptions,
  toolPartsFailed,
} from "./lib.js";

export default async function strataReasoning(pluginInput, rawOptions = {}) {
  const options = resolveOptions(rawOptions);
  if (!options.enabled) return {};

  const client = pluginInput?.client;
  const sessions = new Map();

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
        remember(sessions, input.sessionID, {
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
      if (!matchesTarget(input, options)) return;
      if (options.ignoreAgents.includes(String(input.agent ?? "").toLowerCase())) return;

      const state = sessions.get(input.sessionID) ?? {};
      const text = messageText(input.message) || state.text || "";
      const classification = classifyTask(text, options, {
        agent: input.agent,
        toolTurn: Boolean(state.toolTurn),
        toolFailed: Boolean(state.toolFailed),
        failures: state.failures ?? 0,
      });

      const existing = output.options?.chat_template_kwargs;
      if (options.respectExplicitEffort && hasExplicitEffort(existing)) return;

      if (!output.options || typeof output.options !== "object") output.options = {};
      output.options.chat_template_kwargs = buildChatTemplateKwargs(
        existing,
        classification.effort,
      );
      if (options.overrideTemperature) output.temperature = classification.temperature;

      remember(sessions, input.sessionID, {
        ...state,
        text,
        toolTurn: false,
      });

      debug({
        sessionID: input.sessionID,
        agent: input.agent,
        provider: input.provider?.info?.id ?? input.provider?.id ?? null,
        model: input.model?.id ?? input.model?.modelID ?? input.model?.name ?? null,
        kind: classification.kind,
        effort: classification.effort,
        temperature: classification.temperature,
        reason: classification.reason,
      });
    },

    event: async ({ event }) => {
      if (event?.type === "session.deleted") {
        const sessionID = event.properties?.sessionID;
        if (sessionID) sessions.delete(sessionID);
      }
    },
  };
}
