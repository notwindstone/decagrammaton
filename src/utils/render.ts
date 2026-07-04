import type { TemplateNode, ElementNode, Attribute } from "../compiler/parse.ts";
import type { SubscriptionsType } from "../types/reactivity/subscriptions.type.ts";
import { GeneralInternals } from "../variables/general-internals.ts";
import type { CleanupType } from "../types/component/cleanup.type.ts";
import { Reactivity } from "../variables/reactivity.ts";

const { Render, HTMLElements } = Reactivity;

export function mount(
  nodes: Array<TemplateNode>,
  container: HTMLElement,
  scope: Record<string, unknown>,
): () => void {
  const cleanups: Array<CleanupType> = nodes.map(node => {
    return mountNode(node, container, scope);
  });

  return () => {
    for (const cleanup of cleanups) {
      cleanup?.();
    }
  };
}

function mountNode(
  node: TemplateNode,
  parent: HTMLElement,
  scope: Record<string, unknown>,
): CleanupType {
  switch (node.type) {
    case "element":
      return mountElement(node, parent, scope);
    case "text":
      return mountText(node, parent);
    case "expression":
      return mountExpression(node, parent, scope);
  }
}

function mountElement(
  node: ElementNode,
  parent: HTMLElement,
  scope: Record<string, unknown>
): CleanupType {
  const id = Render.getUniqueId();
  const element = document.createElement(node.tag);

  HTMLElements.set(id, element);
  applyAttributes(element, node.attributes, scope);

  const childCleanups: Array<CleanupType> = node.children.map(node => {
    return mountNode(node, element, scope);
  });

  parent.appendChild(element);

  return () => {
    for (const cleanup of childCleanups) {
      cleanup?.();
    }

    HTMLElements.delete(id);
    element.remove();
  };
}

function mountText(node: { value: string }, parent: HTMLElement): CleanupType {
  const textNode = document.createTextNode(node.value);

  parent.appendChild(textNode);

  return null;
}

function mountExpression(
  node: { value: string },
  parent: HTMLElement,
  scope: Record<string, unknown>
): CleanupType {
  const textNode = document.createTextNode("");
  const subscribedSets = new Set<SubscriptionsType>();

  parent.appendChild(textNode);

  const render = (): void => {
    // The getter of a state needs these subscriptions, so we expose them
    GeneralInternals.renderSubscriptions = subscribedSets;

    Render.active = render;
    textNode.textContent = String(
      evaluateExpression(node.value, scope) ?? "",
    );
    Render.active = undefined;

    // 'evaluateExpression' triggered the getter of a state, so now we do not need these subscriptions
    GeneralInternals.renderSubscriptions = undefined;
  };

  render();

  return () => {
    for (const subscriptions of subscribedSets) {
      subscriptions.delete(render);
    }

    subscribedSets.clear();
    textNode.remove();
  };
}

function applyAttributes(
  element: HTMLElement,
  attributes: Array<Attribute>,
  scope: Record<string, unknown>,
): void {
  for (const attribute of attributes) {
    switch (attribute.type) {
      case "attribute": {
        const attributeValue: string = attribute.value === true
          ? ""
          : attribute.value;

        element.setAttribute(attribute.name, attributeValue);

        break;
      }
      case "expression-attribute": {
        if (attribute.name.startsWith("@")) {
          const eventName = attribute.name.slice(1);
          const handler = evaluateExpression(attribute.value, scope);

          if (typeof handler === 'function') {
            element.addEventListener(eventName, handler as EventListener);
          }

          break;
        }

        const subscribedSets = new Set<SubscriptionsType>();
        const render = (): void => {
          // The getter of a state needs these subscriptions, so we expose them
          GeneralInternals.renderSubscriptions = subscribedSets;

          Render.active = render;
          element.setAttribute(
            attribute.name,
            String(
              evaluateExpression(attribute.value, scope) ?? "",
            ),
          );
          Render.active = undefined;

          // 'evaluateExpression' triggered the getter of a state, so now we do not need these subscriptions
          GeneralInternals.renderSubscriptions = undefined;
        };

        render();

        break;
      }
    }
  }
}

// Suppose the 'expression' is 'myState.value', and 'scope' is '{ myState, increment }'
function evaluateExpression(expression: string, scope: Record<string, unknown>): unknown {
  // In such case, we will get '["myState", "increment"]'
  const keys: Array<string> = Object.keys(scope);
  // Here we will get actual values: '[{ "value": ... }, () => { ... }]'
  const values: Array<unknown> = Object.values(scope);
  // Functions do not change for the same expression and scope
  const cachedKey: string = keys.join("-") + "-" + expression;
  let evaluate = GeneralInternals.cachedExpressionFunctions.get(cachedKey);

  if (!evaluate) {
    // Here we want to evaluate our expression ('myState.value'), so we build a function with an appropriate scope
    evaluate = new Function(...keys, `return (${expression});`);
  }

  // This function will evaluate 'myState.value' with the provided values
  return evaluate(...values);
}
