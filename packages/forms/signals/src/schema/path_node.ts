/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */
import {FieldPath, PathKind} from '../api/types';
import {DYNAMIC, Predicate} from './logic';
import {LogicNodeBuilder} from './logic_node';
import type {SchemaImpl} from './schema';

/**
 * Special key which is used to retrieve the `FieldPathNode` instance from its `FieldPath` proxy wrapper.
 */
const PATH = Symbol('PATH');

/**
 * A path in the schema on which logic is stored so that it can be added to the corresponding field
 * when the field is created.
 */
export class FieldPathNode<TValue, TPathKind extends PathKind = PathKind.Root> {
  /** The root path node from which this path node is descended. */
  readonly root: FieldPathNode<unknown, PathKind.Root>;

  /**
   * A map containing all child path nodes that have been created on this path.
   * Child path nodes are created automatically on first access if they do not exist already.
   */
  private readonly children = new Map<PropertyKey, FieldPathNode<unknown, PathKind.Child>>();

  /**
   * A proxy that wraps the path node, allowing navigation to its child paths via property access.
   */
  readonly fieldPathProxy: FieldPath<TValue, TPathKind> = new Proxy(
    this,
    FIELD_PATH_PROXY_HANDLER as ProxyHandler<FieldPathNode<TValue, TPathKind>>,
  ) as unknown as FieldPath<TValue, TPathKind>;

  protected constructor(
    /** The property keys used to navigate from the root path to this path. */
    readonly keys: PropertyKey[],
    /** The logic builder used to accumulate logic on this path node. */
    readonly logic: LogicNodeBuilder<TValue, TPathKind>,
    root: FieldPathNode<unknown, PathKind.Root>,
  ) {
    this.root = root ?? this;
  }

  /**
   * Gets the special path node containing the per-element logic that applies to *all* children paths.
   */
  get element(): FieldPathNode<
    TValue extends (infer TElement)[] ? TElement : never,
    PathKind.Item
  > {
    return this.getChild(DYNAMIC) as FieldPathNode<
      TValue extends (infer TElement)[] ? TElement : never,
      PathKind.Item
    >;
  }

  /**
   * Gets the path node for the given child property key.
   * Child paths are created automatically on first access if they do not exist already.
   */
  getChild(key: PropertyKey): FieldPathNode<unknown, PathKind.Child> {
    if (!this.children.has(key)) {
      this.children.set(
        key,
        new FieldPathNode([...this.keys, key], this.logic.getChild(key), this.root),
      );
    }
    return this.children.get(key)!;
  }

  /**
   * Merges in logic from another schema to this one.
   * @param other The other schema to merge in the logic from
   * @param predicate A predicate indicating when the merged in logic should be active.
   */
  mergeIn(other: SchemaImpl<TValue>, predicate?: Predicate) {
    const path = other.compile();
    this.logic.mergeIn(path.logic, predicate);
  }

  /** Extracts the underlying path node from the given path proxy. */
  static unwrapFieldPath<TValue, TPathKind extends PathKind = PathKind.Root>(
    formPath: FieldPath<TValue, TPathKind>,
  ): FieldPathNode<TValue, TPathKind> {
    return (formPath as any)[PATH] as FieldPathNode<TValue, TPathKind>;
  }

  /** Creates a new root path node to be passed in to a schema function. */
  static newRoot<TValue>() {
    return new FieldPathNode([], LogicNodeBuilder.newRoot<TValue>(), undefined!);
  }
}

/** Proxy handler which implements `FieldPath` on top of a `FieldPathNode`. */
export const FIELD_PATH_PROXY_HANDLER: ProxyHandler<FieldPathNode<unknown, PathKind>> = {
  get(node: FieldPathNode<unknown, PathKind>, property: string | symbol) {
    if (property === PATH) {
      return node;
    }

    return node.getChild(property).fieldPathProxy;
  },
};
