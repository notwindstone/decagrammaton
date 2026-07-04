import type { StateType } from "../types/reactivity/state.type.ts";
import { Reactivity } from "../variables/reactivity.ts";
import { GeneralInternals } from "../variables/general-internals.ts";
import type { SubscriptionsType } from "../types/reactivity/subscriptions.type.ts";
import type { MappingsType } from "../types/reactivity/mappings.type.ts";

const renderSubscriptions = GeneralInternals.renderSubscriptions;

export function $state<T>(input: T): StateType<T> {
  const wrapped: StateType<T> = { "value": input };
  const handler: ProxyHandler<StateType<T>> = {
    // Adds the current render function to a state property subscription set
    get(target, property, receiver) {
      // If the value was read outside a render function, we do not want to add any new subscriptions
      if (!Reactivity.Render.active) {
        return Reflect.get(target, property, receiver);
      }

      let mappings: MappingsType | undefined = Reactivity.Proxies.get(receiver);

      if (!mappings) {
        mappings = new Map;

        Reactivity.Proxies.set(receiver, mappings);
      }

      let stateSubscriptions: SubscriptionsType | undefined = mappings.get(property);

      if (!stateSubscriptions) {
        stateSubscriptions = new Set;

        mappings.set(property, stateSubscriptions);
      }

      stateSubscriptions.add(Reactivity.Render.active);
      renderSubscriptions?.add?.(stateSubscriptions);

      return Reflect.get(target, property, receiver);
    },
    // Fire all the state property subscriptions
    set(target, property, value, receiver) {
      // Fire the render functions only after the assignment
      const assigned: boolean = Reflect.set(target, property, value, receiver);
      const mappings: MappingsType | undefined = Reactivity.Proxies.get(receiver);

      if (!mappings) {
        return assigned;
      }

      const subscriptions: SubscriptionsType | undefined = mappings.get(property);

      if (!subscriptions) {
        return assigned;
      }

      for (const subscription of subscriptions) {
        subscription?.();
      }

      return assigned;
    },
  };

  return new Proxy(wrapped, handler);
}
