import type { SubscriptionsType } from "../types/reactivity/subscriptions.type.ts";

export const GeneralInternals: {
  "uniqueId"                 : number;
  "renderSubscriptions"      : Set<SubscriptionsType> | undefined;
  "cachedExpressionFunctions": Map<string, Function>;
} = {
  "uniqueId"                 : 0,
  "renderSubscriptions"      : undefined,
  "cachedExpressionFunctions": new Map,
};