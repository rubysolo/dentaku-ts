// Dependency graph + topological sort for the bulk solver (issue 012).
//
// Ruby dentaku used TSort (dependency_resolver.rb); this is a Tarjan SCC pass
// over the in-batch dependency edges. Emitting components in Tarjan completion
// order — with roots visited in key-insertion order — reproduces Ruby TSort's
// evaluation order exactly (both are DFS post-order emissions), while also
// reporting cycle *membership*, which TSort::Cyclic never did. That membership
// powers the successor improvement (PLAN.md "Additions"): a cycle fails only
// its members and their downstream dependents, not the whole batch.
import type { EvalContext, Node } from "../ast/node.js";

export interface DependencyGraphResult {
  /**
   * Every key, dependencies first. Cycle members appear grouped at their
   * component's topological position, in insertion order within the group;
   * ties between independent keys resolve to insertion order.
   */
  order: string[];
  /**
   * Cycle member → all members of its strongly-connected component (insertion
   * order). A component is a cycle when it has more than one member or a
   * single member that depends on itself.
   */
  cycles: Map<string, string[]>;
  /**
   * Non-cycle key that transitively depends on a cycle → the union of cycle
   * members it depends on (insertion order). These keys can never be
   * evaluated; the solver fails them with a CycleError naming the upstream
   * cycle instead of evaluating them.
   */
  blocked: Map<string, string[]>;
}

/**
 * A formula's dependency edges within a batch: identifiers still unresolved
 * against `ctx` (the calculator's memory + per-call vars), scoped to the
 * batch's own keys. Resolution against memory is what allows Ruby-parity
 * self-reference — `{x: "x + 1"}` with a stored `x` yields no self-edge.
 * Unresolved names *outside* the batch are not edges either; they surface
 * later as a per-key UnboundVariableError at evaluation time.
 */
export function inBatchDependencies(
  node: Node,
  ctx: EvalContext,
  batchKeys: ReadonlySet<string>,
): string[] {
  return [...new Set(node.dependencies(ctx))].filter((dep) => batchKeys.has(dep));
}

interface Frame {
  node: string;
  children: readonly string[];
  nextChild: number;
}

/**
 * Tarjan strongly-connected components over `edges` (key → in-batch
 * dependencies; unknown dependency names are ignored). Iterative, so deep
 * dependency chains cannot overflow the call stack.
 */
export function sortDependencies(
  edges: ReadonlyMap<string, readonly string[]>,
): DependencyGraphResult {
  const insertionIndex = new Map<string, number>();
  for (const key of edges.keys()) {
    insertionIndex.set(key, insertionIndex.size);
  }
  const byInsertion = (a: string, b: string): number =>
    (insertionIndex.get(a) ?? 0) - (insertionIndex.get(b) ?? 0);
  const childrenOf = (key: string): string[] =>
    (edges.get(key) ?? []).filter((dep) => edges.has(dep));

  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const visit = (key: string): void => {
    index.set(key, counter);
    lowLink.set(key, counter);
    counter += 1;
    stack.push(key);
    onStack.add(key);
  };

  const connectFrom = (root: string): void => {
    visit(root);
    const frames: Frame[] = [{ node: root, children: childrenOf(root), nextChild: 0 }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1] as Frame;
      if (frame.nextChild < frame.children.length) {
        const child = frame.children[frame.nextChild] as string;
        frame.nextChild += 1;
        if (!index.has(child)) {
          visit(child);
          frames.push({ node: child, children: childrenOf(child), nextChild: 0 });
        } else if (onStack.has(child)) {
          lowLink.set(
            frame.node,
            Math.min(lowLink.get(frame.node) as number, index.get(child) as number),
          );
        }
        continue;
      }
      // frame.node is fully explored: emit its component if it is a root.
      if (lowLink.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop() as string;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        component.sort(byInsertion);
        components.push(component);
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        lowLink.set(
          parent.node,
          Math.min(lowLink.get(parent.node) as number, lowLink.get(frame.node) as number),
        );
      }
    }
  };

  for (const key of edges.keys()) {
    if (!index.has(key)) {
      connectFrom(key);
    }
  }

  // Components emit dependencies-first, so one forward pass can both build the
  // evaluation order and propagate "which cycle members does this key sit
  // downstream of" (taint) from children to dependents.
  const order: string[] = [];
  const cycles = new Map<string, string[]>();
  const blocked = new Map<string, string[]>();
  const taint = new Map<string, ReadonlySet<string>>();

  for (const component of components) {
    const members = new Set(component);
    const isCycle =
      component.length > 1 || childrenOf(component[0] as string).includes(component[0] as string);
    const upstream = new Set<string>();
    for (const member of component) {
      for (const child of childrenOf(member)) {
        if (members.has(child)) {
          continue;
        }
        for (const tainted of taint.get(child) ?? []) {
          upstream.add(tainted);
        }
      }
    }
    if (isCycle) {
      const reach = new Set([...upstream, ...component]);
      for (const member of component) {
        cycles.set(member, component);
        taint.set(member, reach);
        order.push(member);
      }
    } else {
      const key = component[0] as string;
      taint.set(key, upstream);
      if (upstream.size > 0) {
        blocked.set(key, [...upstream].sort(byInsertion));
      }
      order.push(key);
    }
  }

  return { order, cycles, blocked };
}
