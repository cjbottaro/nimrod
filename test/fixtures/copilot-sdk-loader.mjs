export function resolve(specifier, context, next) {
  if (specifier === '@microsoft/copilot-sdk') return { url: new URL('./copilot-sdk.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
