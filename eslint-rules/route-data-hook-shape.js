// @ts-check
/**
 * Pattern audit #2: "retry means two different things on sibling tabs" —
 * Pantry/Plan/Products converged on a `useXxxData`-shaped hook exposing
 * `{ loading, error, retry }`, but Recipes/Ingredients/Home loaded data in
 * an inline `useEffect` with no `retry` to call, so their `ErrorState`
 * fell back to `window.location.reload()` (a hard reload — see
 * `no-reload-outside-route-error.js`, the other half of this fix).
 *
 * Pins the SHAPE, not the instance: scoped (in eslint.config.js) to every
 * `useXxx.ts`/`useXxx.tsx` file under `src/routes/**` — the naming
 * convention the hooks themselves already follow — this flags any TS
 * interface/type-literal declared there that has both `loading` and
 * `error` properties but no `retry`. Deliberately NOT keyed off the type's
 * OWN name: the app's existing result types disagree on that
 * (`UsePlanWeekResult`, `ProductsData`, `PantryInventory`) so a name-based
 * check would miss real ones — the file naming convention is the one thing
 * every route data hook actually shares. A hook that has somewhere to
 * report an error but nowhere to retry from is exactly the bug this
 * package fixes — this catches the next one at the type declaration,
 * before a screen is even wired up to it.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A route data hook's result type that has both `loading` and `error` must also expose `retry` (UI_DESIGN.md / pattern-audit #2).",
    },
    schema: [],
    messages: {
      missingRetry:
        "`{{name}}` looks like a route data hook's result (has `loading` and `error`) but has no `retry`. Every route data hook must expose `{ loading, error, retry }` so its ErrorState can soft-retry instead of falling back to window.location.reload() (pattern-audit #2).",
    },
  },
  create(context) {
    /** @param {any} bodyMembers */
    function propertyNames(bodyMembers) {
      const names = [];
      for (const member of bodyMembers) {
        if (member.type !== "TSPropertySignature" || !member.key) continue;
        if (member.key.type === "Identifier") names.push(member.key.name);
        else if (member.key.type === "Literal") names.push(String(member.key.value));
      }
      return names;
    }

    return {
      TSInterfaceDeclaration(node) {
        const name = node.id.name;
        const names = propertyNames(node.body.body);
        if (names.includes("loading") && names.includes("error") && !names.includes("retry")) {
          context.report({ node: node.id, messageId: "missingRetry", data: { name } });
        }
      },
      TSTypeAliasDeclaration(node) {
        const name = node.id.name;
        if (!node.typeAnnotation || node.typeAnnotation.type !== "TSTypeLiteral") return;
        const names = propertyNames(node.typeAnnotation.members);
        if (names.includes("loading") && names.includes("error") && !names.includes("retry")) {
          context.report({ node: node.id, messageId: "missingRetry", data: { name } });
        }
      },
    };
  },
};

export default rule;
