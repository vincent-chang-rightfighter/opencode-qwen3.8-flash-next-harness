import test from "node:test";
import assert from "node:assert/strict";
import strataReasoning from "../index.js";
import { classifyTask, resolveOptions } from "../lib.js";

const model = { id: "qwen3.8-flash-next-iq3_s", providerID: "strata" };
const provider = { info: { id: "strata" } };

function request(text, sessionID) {
  return {
    sessionID,
    agent: "build",
    model,
    provider,
    message: { parts: [{ text }] },
  };
}

async function route(text, options, providerID = "strata") {
  const hooks = await strataReasoning({}, options);
  const output = { options: {}, temperature: 1 };
  await hooks["chat.params"](
    {
      ...request(text, "sampling-test"),
      model: { ...model, providerID },
      provider: { info: { id: providerID } },
    },
    output,
  );
  return output;
}

test("thinking requests always use the model-card sampler set", async () => {
  const cases = [
    ["hello", "simple", 1.0],
    ["rename this symbol", "mechanical", 1.0],
    ["implement src/a.ts", "implement", 0.6],
    ["TypeError in the worker: traceback", "debug", 0.6],
    ["Compare the architecture tradeoffs", "design", 1.0],
    ["ultrathink: plan this migration", "ultra", 1.0],
  ];

  for (const [prompt, expectedKind, expectedTemperature] of cases) {
    const options = resolveOptions({
      modelIncludes: ["qwen3.8-flash-next"],
      providers: ["strata"],
    });
    const classification = classifyTask(prompt, options);
    assert.equal(classification.kind, expectedKind, prompt);

    const output = await route(prompt, {
      modelIncludes: ["qwen3.8-flash-next"],
      providers: ["strata"],
    });
    assert.equal(output.temperature, expectedTemperature, prompt);
    assert.equal(output.topP, 0.95, prompt);
    assert.equal(output.options.top_k, 20, prompt);
    assert.equal(output.options.min_p, 0, prompt);
    assert.equal(output.options.presence_penalty, 0, prompt);
    assert.equal(output.options.repetition_penalty, 1, prompt);
    assert.equal(output.options.chat_template_kwargs.enable_thinking, true, prompt);
    assert.equal(
      output.options.chat_template_kwargs.reasoning_effort,
      classification.effort,
      prompt,
    );
  }
});

test("non-thinking requests use the non-thinking sampler set", async () => {
  const output = await route("hello", {
    modelIncludes: ["qwen3.8-flash-next"],
    providers: ["strata"],
    simpleEffort: "none",
  });
  assert.equal(output.temperature, 0.7);
  assert.equal(output.topP, 0.8);
  assert.equal(output.options.top_k, 20);
  assert.equal(output.options.min_p, 0);
  assert.equal(output.options.presence_penalty, 1.5);
  assert.equal(output.options.repetition_penalty, 1);
  assert.equal(output.options.chat_template_kwargs.enable_thinking, false);
  assert.equal(output.options.chat_template_kwargs.reasoning_effort, undefined);
});

test("provider profiles map to the expected request field", async () => {
  const strata = await route("hello", {
    modelIncludes: ["qwen3.8-flash-next"],
    providers: ["strata"],
  });
  assert.equal(strata.options.chat_template_kwargs.reasoning_effort, "low");
  assert.equal(strata.options.reasoningEffort, undefined);

  for (const providerID of ["ollama", "llamacpp", "vllm"]) {
    const output = await route(
      "hello",
      {
        modelIncludes: ["qwen3.8-flash-next"],
        providers: [providerID],
      },
      providerID,
    );
    assert.equal(output.options.reasoningEffort, "low", providerID);
    assert.equal(output.options.chat_template_kwargs, undefined, providerID);
  }
});

test("sampling can be disabled without disabling provider routing", async () => {
  const output = await route("hello", {
    modelIncludes: ["qwen3.8-flash-next"],
    providers: ["strata"],
    overrideSampling: false,
  });
  assert.equal(output.topP, undefined);
  assert.equal(output.options.top_k, undefined);
  assert.equal(output.options.presence_penalty, undefined);
  assert.equal(output.options.chat_template_kwargs.reasoning_effort, "low");
});
