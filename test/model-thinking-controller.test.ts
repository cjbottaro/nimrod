import assert from "node:assert/strict";
import test from "node:test";
import { ModelIdentity, ModelThinkingController, ModelThinkingHost, ModelThinkingState, RpcTransport } from "../src/pi/model-thinking-controller";
import { JsonRecord } from "../src/pi/types";

class FakeTransport implements RpcTransport {
  calls: Array<{ type: string; fields?: JsonRecord }> = [];
  model: ModelIdentity | null;
  thinkingLevel = "medium";
  busy = false;
  models: ModelIdentity[];
  levels: string[];
  failSetModel = false;

  constructor(model: ModelIdentity | null, models: ModelIdentity[], levels: string[]) {
    this.model = model;
    this.models = models;
    this.levels = levels;
  }

  async request(type: string, fields?: JsonRecord): Promise<JsonRecord> {
    this.calls.push({ type, fields });
    if (type === "get_state") return { data: { model: this.model, thinkingLevel: this.thinkingLevel, isStreaming: this.busy, isCompacting: false } };
    if (type === "get_available_models") return { data: { models: this.models } };
    if (type === "get_available_thinking_levels") return { data: { levels: this.levels } };
    if (type === "set_model") {
      if (this.failSetModel) throw new Error("Pi set_model failed: unavailable");
      this.model = this.models.find((model) => model.provider === fields?.provider && model.id === fields?.modelId) || null;
      return { data: this.model };
    }
    if (type === "set_thinking_level") {
      this.thinkingLevel = String(fields?.level);
      return {};
    }
    throw new Error(`Unexpected RPC ${type}`);
  }
}

class FakeHost implements ModelThinkingHost {
  busy = false;
  states: ModelThinkingState[] = [];
  errors: unknown[] = [];
  modelChoice: ModelIdentity | undefined;
  thinkingChoice: string | undefined;
  seenModels: ModelIdentity[] = [];
  seenLevels: string[] = [];

  isMainAgentBusy(): boolean { return this.busy; }
  onRpcState(data: JsonRecord): void { this.busy = data.isStreaming === true || data.isCompacting === true; }
  onState(state: ModelThinkingState): void { this.states.push(state); }
  async chooseModel(models: ModelIdentity[]): Promise<ModelIdentity | undefined> { this.seenModels = models; return this.modelChoice; }
  async chooseThinkingLevel(levels: string[]): Promise<string | undefined> { this.seenLevels = levels; return this.thinkingChoice; }
  showError(error: unknown): void { this.errors.push(error); }
}

function current(host: FakeHost): ModelThinkingState {
  const state = host.states.at(-1);
  assert.ok(state);
  return state;
}

const first = { provider: "openai", id: "gpt-5.6", name: "GPT 5.6" };
const sameIdOtherProvider = { provider: "local", id: "gpt-5.6", name: "Local GPT 5.6" };

test("model picker retains provider/id identity when model IDs overlap", async () => {
  const rpc = new FakeTransport(null, [first, sameIdOtherProvider], ["off", "low"]);
  const host = new FakeHost();
  host.modelChoice = sameIdOtherProvider;
  const controller = new ModelThinkingController(rpc, host);
  await controller.initialize({ model: null });

  await controller.selectModel();

  assert.deepEqual(host.seenModels, [first, sameIdOtherProvider]);
  assert.deepEqual(rpc.calls.find((call) => call.type === "set_model")?.fields, { provider: "local", modelId: "gpt-5.6" });
  assert.deepEqual(current(host).model, sameIdOtherProvider);
});

test("thinking picker exposes only Pi-supported levels for the selected model", async () => {
  const rpc = new FakeTransport(first, [first], ["off", "minimal", "high"]);
  const host = new FakeHost();
  host.thinkingChoice = "high";
  const controller = new ModelThinkingController(rpc, host);
  await controller.initialize({ model: first, thinkingLevel: "medium" });

  await controller.selectThinkingLevel();

  assert.deepEqual(host.seenLevels, ["off", "minimal", "high"]);
  assert.deepEqual(rpc.calls.find((call) => call.type === "set_thinking_level")?.fields, { level: "high" });
  assert.equal(current(host).thinkingLevel, "high");
});

test("a null model disables thinking selection without issuing a mutation", async () => {
  const rpc = new FakeTransport(null, [first], ["off"]);
  const host = new FakeHost();
  const controller = new ModelThinkingController(rpc, host);
  await controller.initialize({ model: null });

  await controller.selectThinkingLevel();

  assert.equal(host.seenLevels.length, 0);
  assert.equal(rpc.calls.some((call) => call.type === "set_thinking_level"), false);
  assert.equal(current(host).model, null);
});

test("failed model mutation never displays an optimistic selection", async () => {
  const rpc = new FakeTransport(first, [first, sameIdOtherProvider], ["off", "medium"]);
  rpc.failSetModel = true;
  const host = new FakeHost();
  host.modelChoice = sameIdOtherProvider;
  const controller = new ModelThinkingController(rpc, host);
  await controller.initialize({ model: first, thinkingLevel: "medium" });

  await controller.selectModel();

  assert.deepEqual(current(host).model, first);
  assert.equal(current(host).changing, false);
  assert.match(String(host.errors[0]), /unavailable/);
});

test("disconnect while the model picker is open cannot reactivate controls or mutate Pi", async () => {
  const rpc = new FakeTransport(first, [first, sameIdOtherProvider], ["off"]);
  const host = new FakeHost();
  const controller = new ModelThinkingController(rpc, host);
  await controller.initialize({ model: first });
  host.chooseModel = async () => { controller.disconnect(); return sameIdOtherProvider; };
  await controller.selectModel();
  assert.equal(current(host).ready, false);
  assert.equal(rpc.calls.some(call => call.type === "set_model"), false);
});

test("work starting during the final thinking-level lookup prevents mutation", async () => {
  const rpc = new FakeTransport(first, [first], ["off", "high"]);
  const host = new FakeHost();
  const controller = new ModelThinkingController(rpc, host);
  await controller.initialize({ model: first });
  let picked = false;
  host.chooseThinkingLevel = async () => { picked = true; return "high"; };
  const request = rpc.request.bind(rpc);
  rpc.request = async (type, fields) => {
    const response = await request(type, fields);
    if (picked && type === "get_available_thinking_levels") host.busy = true;
    return response;
  };
  await controller.selectThinkingLevel();
  assert.equal(rpc.calls.some(call => call.type === "set_thinking_level"), false);
});

test("busy state blocks changes before opening a picker and after a picker race", async () => {
  const rpc = new FakeTransport(first, [first, sameIdOtherProvider], ["off", "medium"]);
  const host = new FakeHost();
  const controller = new ModelThinkingController(rpc, host);
  await controller.initialize({ model: first });

  host.busy = true;
  const callCount = rpc.calls.length;
  await controller.selectModel();
  assert.equal(rpc.calls.length, callCount, "busy gate should not fetch models or mutate");

  host.busy = false;
  host.modelChoice = sameIdOtherProvider;
  const originalChoose = host.chooseModel.bind(host);
  host.chooseModel = async (models) => {
    const choice = await originalChoose(models);
    rpc.busy = true;
    return choice;
  };
  await controller.selectModel();

  assert.equal(rpc.calls.some((call) => call.type === "set_model"), false, "post-picker state revalidation blocks mutation");
});
