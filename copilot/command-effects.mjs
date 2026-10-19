const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const message = error => error instanceof Error ? error.message : String(error);

async function finalize(session, effect, outcome) {
  const result = await session.rpc.commands.finalizeInvocationEffect({ effect, outcome });
  if (!record(result) || result.success !== true) {
    throw new Error(typeof result?.error === 'string' && result.error
      ? result.error
      : `Copilot did not finalize the ${effect.kind} command effect.`);
  }
}

async function failed(session, effect, error, mutationAttempted) {
  try {
    await finalize(session, effect, 'cancelled');
    return { kind: 'command-effect-failed', effectKind: effect.kind,
      outcome: mutationAttempted ? 'unknown' : 'cancelled', error: message(error) };
  } catch (finalizationError) {
    return { kind: 'command-effect-failed', effectKind: effect.kind, outcome: 'unknown',
      error: `${message(error)} Copilot also failed to cancel its provisional settings: ${message(finalizationError)}` };
  }
}

/**
 * Completes SDK-defined command effects without knowing the originating command.
 * Commands composed from existing result kinds therefore work without name handlers.
 */
export async function completeCommandEffect(session, effect) {
  if (!record(effect) || !['set-model', 'set-plan-model'].includes(effect.kind)) return effect;
  if (effect.kind === 'set-plan-model') {
    if (effect.planModel !== undefined && (typeof effect.planModel !== 'string' || !effect.planModel)
      || typeof effect.message !== 'string') return failed(session, effect, new Error('Copilot returned an invalid plan-model effect.'), false);
    try {
      await finalize(session, effect, 'applied');
      return { ...effect, effectFinalized: true };
    } catch (error) {
      return { kind: 'command-effect-failed', effectKind: effect.kind, outcome: 'unknown', error: message(error) };
    }
  }

  if (typeof effect.model !== 'string' || !effect.model
    || effect.reasoningEffort !== undefined && (typeof effect.reasoningEffort !== 'string' || !effect.reasoningEffort)
    || effect.autoTier !== undefined && (typeof effect.autoTier !== 'string' || !effect.autoTier)) {
    return failed(session, effect, new Error('Copilot returned an invalid model effect.'), false);
  }

  try {
    await session.setModel(effect.model, {
      ...(effect.reasoningEffort === undefined ? {} : { reasoningEffort: effect.reasoningEffort }),
      ...(effect.autoTier === undefined ? {} : { autoTier: effect.autoTier }),
    });
    const model = await session.rpc.model.getCurrent();
    if (!record(model) || model.modelId !== effect.model
      || effect.reasoningEffort !== undefined && model.reasoningEffort !== effect.reasoningEffort) {
      return failed(session, effect, new Error('Copilot did not confirm the model selected by its command.'), true);
    }
    try {
      await finalize(session, effect, 'applied');
      return { ...effect, effectFinalized: true, model };
    } catch (error) {
      return { kind: 'command-effect-failed', effectKind: effect.kind, outcome: 'unknown', error: message(error) };
    }
  } catch (error) {
    return failed(session, effect, error, true);
  }
}
