/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {AggregateProperty, Property} from '../api/property';
import type {
  AsyncValidationResult,
  DisabledReason,
  FieldContext,
  LogicFn,
  PathKind,
  ValidationResult,
} from '../api/types';
import {setBoundPathDepthForResolution} from '../field/resolution';
import {BoundPredicate, LogicContainer, Predicate} from './logic';

/**
 * Abstract base class for building a `LogicNode`.
 * This class defines the interface for adding various logic rules (e.g., hidden, disabled)
 * and data factories to a node in the logic tree.
 * LogicNodeBuilders are 1:1 with nodes in the Schema tree.
 */
export abstract class AbstractLogicNodeBuilder<TValue, TPathKind extends PathKind = PathKind.Root> {
  constructor(
    /** The depth of this node in the schema tree. */
    protected readonly depth: number,
  ) {}

  /** Adds a rule to determine if a field should be hidden. */
  abstract addHiddenRule(logic: LogicFn<TValue, boolean, TPathKind>): void;
  /** Adds a rule to determine if a field should be disabled, and for what reason. */
  abstract addDisabledReasonRule(
    logic: LogicFn<TValue, DisabledReason | undefined, TPathKind>,
  ): void;
  /** Adds a rule to determine if a field should be read-only. */
  abstract addReadonlyRule(logic: LogicFn<TValue, boolean, TPathKind>): void;
  /** Adds a rule for synchronous validation errors for a field. */
  abstract addSyncErrorRule(logic: LogicFn<TValue, ValidationResult, TPathKind>): void;
  /** Adds a rule for synchronous validation errors that apply to a subtree. */
  abstract addSyncTreeErrorRule(logic: LogicFn<TValue, ValidationResult, TPathKind>): void;
  /** Adds a rule for asynchronous validation errors for a field. */
  abstract addAsyncErrorRule(logic: LogicFn<TValue, AsyncValidationResult, TPathKind>): void;
  /** Adds a rule to compute an aggregate property for a field. */
  abstract addAggregatePropertyRule<TProperty>(
    key: AggregateProperty<unknown, TProperty>,
    logic: LogicFn<TValue, TProperty, TPathKind>,
  ): void;
  /** Adds a factory function to produce a data value associated with a field. */
  abstract addPropertyFactory<TProperty>(
    key: Property<TProperty>,
    factory: (ctx: FieldContext<TValue, TPathKind>) => TProperty,
  ): void;
  /**
   * Gets a builder for a child node associated with the given property key.
   * @param key The property key of the child.
   * @returns A `LogicNodeBuilder` for the child.
   */
  abstract getChild(key: PropertyKey): LogicNodeBuilder<unknown, PathKind.Child>;

  /**
   * Checks whether a particular `AbstractLogicNodeBuilder` has been merged into this one.
   * @param builder The builder to check for.
   * @returns True if the builder has been merged, false otherwise.
   */
  abstract hasLogic(builder: AbstractLogicNodeBuilder<TValue, TPathKind>): boolean;

  /**
   * Builds the `LogicNode` from the accumulated rules and child builders.
   * @returns The constructed `LogicNode`.
   */
  build(): LogicNode<TValue, TPathKind> {
    return new LeafLogicNode(this, [], 0);
  }
}

/**
 * A builder for `LogicNode`. Used to add logic to the final `LogicNode` tree.
 * This builder supports merging multiple sources of logic, potentially with predicates,
 * preserving the order of rule application.
 */
export class LogicNodeBuilder<
  TValue,
  TPathKind extends PathKind = PathKind.Root,
> extends AbstractLogicNodeBuilder<TValue, TPathKind> {
  constructor(depth: number) {
    super(depth);
  }

  /**
   * The current `NonMergeableLogicNodeBuilder` being used to add rules directly to this
   * `LogicNodeBuilder`. Do not use this directly, call `getCurrent()` which will create a current
   * builder if there is none.
   */
  private current: NonMergeableLogicNodeBuilder<TValue, TPathKind> | undefined;
  /**
   * Stores all builders that contribute to this node, along with any predicates
   * that gate their application.
   */
  readonly all: {builder: AbstractLogicNodeBuilder<TValue, TPathKind>; predicate?: Predicate}[] =
    [];

  override addHiddenRule(logic: LogicFn<TValue, boolean, TPathKind>): void {
    this.getCurrent().addHiddenRule(logic);
  }

  override addDisabledReasonRule(
    logic: LogicFn<TValue, DisabledReason | undefined, TPathKind>,
  ): void {
    this.getCurrent().addDisabledReasonRule(logic);
  }

  override addReadonlyRule(logic: LogicFn<TValue, boolean, TPathKind>): void {
    this.getCurrent().addReadonlyRule(logic);
  }

  override addSyncErrorRule(logic: LogicFn<TValue, ValidationResult, TPathKind>): void {
    this.getCurrent().addSyncErrorRule(logic);
  }

  override addSyncTreeErrorRule(logic: LogicFn<TValue, ValidationResult, TPathKind>): void {
    this.getCurrent().addSyncTreeErrorRule(logic);
  }

  override addAsyncErrorRule(logic: LogicFn<TValue, AsyncValidationResult, TPathKind>): void {
    this.getCurrent().addAsyncErrorRule(logic);
  }

  override addAggregatePropertyRule<TProperty>(
    key: AggregateProperty<unknown, TProperty>,
    logic: LogicFn<TValue, TProperty, TPathKind>,
  ): void {
    this.getCurrent().addAggregatePropertyRule(key, logic);
  }

  override addPropertyFactory<TProperty>(
    key: Property<TProperty>,
    factory: (ctx: FieldContext<TValue, TPathKind>) => TProperty,
  ): void {
    this.getCurrent().addPropertyFactory(key, factory);
  }

  override getChild(key: PropertyKey): LogicNodeBuilder<unknown, PathKind.Child> {
    return this.getCurrent().getChild(key);
  }

  override hasLogic(builder: AbstractLogicNodeBuilder<TValue, TPathKind>): boolean {
    if (this === builder) {
      return true;
    }
    return this.all.some(({builder: subBuilder}) => subBuilder.hasLogic(builder));
  }

  /**
   * Merges logic from another `LogicNodeBuilder` into this one.
   * If a `predicate` is provided, all logic from the `other` builder will only apply
   * when the predicate evaluates to true.
   * @param other The `LogicNodeBuilder` to merge in.
   * @param predicate An optional predicate to gate the merged logic.
   */
  mergeIn(other: LogicNodeBuilder<TValue, TPathKind>, predicate?: Predicate): void {
    // Add the other builder to our collection, we'll defer the actual merging of the logic until
    // the logic node is requested to be created. In order to preserve the original ordering of the
    // rules, we close off the current builder to any further edits. If additional logic is added,
    // a new current builder will be created to capture it.
    if (predicate) {
      this.all.push({
        builder: other,
        predicate: {
          fn: setBoundPathDepthForResolution(predicate.fn, this.depth),
          path: predicate.path,
        },
      });
    } else {
      this.all.push({builder: other});
    }
    this.current = undefined;
  }

  /**
   * Gets the current `NonMergeableLogicNodeBuilder` for adding rules directly to this
   * `LogicNodeBuilder`. If no current builder exists, a new one is created.
   * The current builder is cleared whenever `mergeIn` is called to preserve the order
   * of rules when merging separate builder trees.
   * @returns The current `NonMergeableLogicNodeBuilder`.
   */
  private getCurrent(): NonMergeableLogicNodeBuilder<TValue, TPathKind> {
    if (this.current === undefined) {
      this.current = new NonMergeableLogicNodeBuilder<TValue, TPathKind>(this.depth);
      this.all.push({builder: this.current});
    }
    return this.current;
  }

  /**
   * Creates a new root `LogicNodeBuilder`.
   * @returns A new instance of `LogicNodeBuilder`.
   */
  static newRoot<TValue>(): LogicNodeBuilder<TValue> {
    return new LogicNodeBuilder(0);
  }
}

/**
 * A type of `AbstractLogicNodeBuilder` used internally by the `LogicNodeBuilder` to record "pure"
 * chunks of logic that do not require merging in other builders.
 */
class NonMergeableLogicNodeBuilder<
  TValue,
  TPathKind extends PathKind = PathKind.Root,
> extends AbstractLogicNodeBuilder<TValue, TPathKind> {
  /** The collection of logic rules directly added to this builder. */
  readonly logic = new LogicContainer<TValue, TPathKind>([]);

  /**
   * A map of child property keys to their corresponding `LogicNodeBuilder` instances.
   * This allows for building a tree of logic.
   */
  readonly children = new Map<PropertyKey, LogicNodeBuilder<unknown, PathKind.Child>>();

  constructor(depth: number) {
    super(depth);
  }

  override addHiddenRule(logic: LogicFn<TValue, boolean, TPathKind>): void {
    this.logic.hidden.push(setBoundPathDepthForResolution(logic, this.depth));
  }

  override addDisabledReasonRule(
    logic: LogicFn<TValue, DisabledReason | undefined, TPathKind>,
  ): void {
    this.logic.disabledReasons.push(setBoundPathDepthForResolution(logic, this.depth));
  }

  override addReadonlyRule(logic: LogicFn<TValue, boolean, TPathKind>): void {
    this.logic.readonly.push(setBoundPathDepthForResolution(logic, this.depth));
  }

  override addSyncErrorRule(logic: LogicFn<TValue, ValidationResult, TPathKind>): void {
    this.logic.syncErrors.push(setBoundPathDepthForResolution(logic, this.depth));
  }

  override addSyncTreeErrorRule(logic: LogicFn<TValue, ValidationResult, TPathKind>): void {
    this.logic.syncTreeErrors.push(setBoundPathDepthForResolution(logic, this.depth));
  }

  override addAsyncErrorRule(logic: LogicFn<TValue, AsyncValidationResult, TPathKind>): void {
    this.logic.asyncErrors.push(setBoundPathDepthForResolution(logic, this.depth));
  }

  override addAggregatePropertyRule<TProperty>(
    key: AggregateProperty<unknown, TProperty>,
    logic: LogicFn<TValue, TProperty, TPathKind>,
  ): void {
    this.logic.getAggregateProperty(key).push(setBoundPathDepthForResolution(logic, this.depth));
  }

  override addPropertyFactory<TProperty>(
    key: Property<TProperty>,
    factory: (ctx: FieldContext<TValue, TPathKind>) => TProperty,
  ): void {
    this.logic.addPropertyFactory(key, setBoundPathDepthForResolution(factory, this.depth));
  }

  override getChild(key: PropertyKey): LogicNodeBuilder<unknown, PathKind.Child> {
    if (!this.children.has(key)) {
      this.children.set(key, new LogicNodeBuilder(this.depth + 1));
    }
    return this.children.get(key)!;
  }

  override hasLogic(builder: AbstractLogicNodeBuilder<TValue, TPathKind>): boolean {
    return this === builder;
  }
}

/**
 * Represents a node in the logic tree, containing all logic applicable
 * to a specific field or path in the form structure.
 * LogicNodes are 1:1 with nodes in the Field tree.
 */
export interface LogicNode<TValue, TPathKind extends PathKind = PathKind.Root> {
  /** The collection of logic rules (hidden, disabled, errors, etc.) for this node. */
  readonly logic: LogicContainer<TValue, TPathKind>;

  /**
   * Retrieves the `LogicNode` for a child identified by the given property key.
   * @param key The property key of the child.
   * @returns The `LogicNode` for the specified child.
   */
  getChild(key: PropertyKey): LogicNode<unknown, PathKind.Child>;

  /**
   * Checks whether the logic from a particular `AbstractLogicNodeBuilder` has been merged into this
   * node.
   * @param builder The builder to check for.
   * @returns True if the builder has been merged, false otherwise.
   */
  hasLogic(builder: AbstractLogicNodeBuilder<TValue, TPathKind>): boolean;
}

/**
 * A tree structure of `Logic` corresponding to a tree of fields.
 * This implementation represents a leaf in the sense that its logic is derived
 * from a single builder.
 */
class LeafLogicNode<TValue, TPathKind extends PathKind = PathKind.Root>
  implements LogicNode<TValue, TPathKind>
{
  /** The computed logic for this node. */
  readonly logic: LogicContainer<TValue, TPathKind>;

  /**
   * Constructs a `LeafLogicNode`.
   * @param builder The `AbstractLogicNodeBuilder` from which to derive the logic.
   *   If undefined, an empty `Logic` instance is created.
   * @param predicates An array of predicates that gate the logic from the builder.
   */
  constructor(
    private builder: AbstractLogicNodeBuilder<TValue, TPathKind> | undefined,
    private predicates: BoundPredicate[],
    /** The depth of this node in the field tree. */
    private depth: number,
  ) {
    this.logic = builder ? createLogic(builder, predicates, depth) : new LogicContainer([]);
  }

  // TODO: cache here, or just rely on the user of this API to do caching?
  /**
   * Retrieves the `LogicNode` for a child identified by the given property key.
   * @param key The property key of the child.
   * @returns The `LogicNode` for the specified child.
   */
  getChild(key: PropertyKey): LogicNode<unknown, PathKind.Child> {
    // The logic for a particular child may be spread across multiple builders. We lazily combine
    // this logic at the time the child logic node is requested to be created.
    const childBuilders = this.builder ? getAllChildBuilders(this.builder, key) : [];
    if (childBuilders.length === 0) {
      return new LeafLogicNode(undefined, [], this.depth + 1);
    } else if (childBuilders.length === 1) {
      const {builder, predicates} = childBuilders[0];
      return new LeafLogicNode(
        builder,
        [...this.predicates, ...predicates.map((p) => bindLevel(p, this.depth))],
        this.depth + 1,
      );
    } else {
      const builtNodes = childBuilders.map(
        ({builder, predicates}) =>
          new LeafLogicNode(
            builder,
            [...this.predicates, ...predicates.map((p) => bindLevel(p, this.depth))],
            this.depth + 1,
          ),
      );
      return new CompositeLogicNode(builtNodes);
    }
  }

  /**
   * Checks whether the logic from a particular `AbstractLogicNodeBuilder` has been merged into this
   * node.
   * @param builder The builder to check for.
   * @returns True if the builder has been merged, false otherwise.
   */
  hasLogic(builder: AbstractLogicNodeBuilder<TValue, TPathKind>): boolean {
    return this.builder?.hasLogic(builder) ?? false;
  }
}

/**
 * A `LogicNode` that represents the composition of multiple `LogicNode` instances.
 * This is used when logic for a particular path is contributed by several distinct
 * builder branches that need to be merged.
 */
class CompositeLogicNode<TValue, TPathKind extends PathKind = PathKind.Root>
  implements LogicNode<TValue, TPathKind>
{
  /** The merged logic from all composed nodes. */
  readonly logic: LogicContainer<TValue, TPathKind>;

  /**
   * Constructs a `CompositeLogicNode`.
   * @param all An array of `LogicNode` instances to compose.
   */
  constructor(private all: LogicNode<TValue, TPathKind>[]) {
    this.logic = new LogicContainer([]);
    for (const node of all) {
      this.logic.mergeIn(node.logic);
    }
  }

  /**
   * Retrieves the child `LogicNode` by composing the results of `getChild` from all
   * underlying `LogicNode` instances.
   * @param key The property key of the child.
   * @returns A `CompositeLogicNode` representing the composed child.
   */
  getChild(key: PropertyKey): LogicNode<unknown, PathKind.Child> {
    return new CompositeLogicNode(this.all.flatMap((child) => child.getChild(key)));
  }

  /**
   * Checks whether the logic from a particular `AbstractLogicNodeBuilder` has been merged into this
   * node.
   * @param builder The builder to check for.
   * @returns True if the builder has been merged, false otherwise.
   */
  hasLogic(builder: AbstractLogicNodeBuilder<TValue, TPathKind>): boolean {
    return this.all.some((node) => node.hasLogic(builder));
  }
}

/**
 * Gets all of the builders that contribute logic to the given child of the parent builder.
 * This function recursively traverses the builder hierarchy.
 * @param builder The parent `AbstractLogicNodeBuilder`.
 * @param key The property key of the child.
 * @returns An array of objects, each containing a `LogicNodeBuilder` for the child and any associated predicates.
 */
function getAllChildBuilders<TValue, TPathKind extends PathKind = PathKind.Root>(
  builder: AbstractLogicNodeBuilder<TValue, TPathKind>,
  key: PropertyKey,
): {builder: LogicNodeBuilder<unknown, PathKind.Child>; predicates: Predicate[]}[] {
  if (builder instanceof LogicNodeBuilder) {
    return builder.all.flatMap(({builder, predicate}) => {
      const children = getAllChildBuilders(builder, key);
      if (predicate) {
        return children.map(({builder, predicates}) => ({
          builder,
          predicates: [...predicates, predicate],
        }));
      }
      return children;
    });
  } else if (builder instanceof NonMergeableLogicNodeBuilder) {
    if (builder.children.has(key)) {
      return [{builder: builder.children.get(key)!, predicates: []}];
    }
  } else {
    throw new Error('Unknown LogicNodeBuilder type');
  }
  return [];
}

/**
 * Creates the full `Logic` for a given builder.
 * This function handles different types of builders (`LogicNodeBuilder`, `NonMergeableLogicNodeBuilder`)
 * and applies the provided predicates.
 * @param builder The `AbstractLogicNodeBuilder` to process.
 * @param predicates Predicates to apply to the logic derived from the builder.
 * @param depth The depth in the field tree of the field which this logic applies to.
 * @returns The `Logic` instance.
 */
function createLogic<TValue, TPathKind extends PathKind = PathKind.Root>(
  builder: AbstractLogicNodeBuilder<TValue, TPathKind>,
  predicates: BoundPredicate[],
  depth: number,
): LogicContainer<TValue, TPathKind> {
  const logic = new LogicContainer<TValue, TPathKind>(predicates);
  if (builder instanceof LogicNodeBuilder) {
    const builtNodes = builder.all.map(
      ({builder, predicate}) =>
        new LeafLogicNode(
          builder,
          predicate ? [...predicates, bindLevel(predicate, depth)] : predicates,
          depth,
        ),
    );
    for (const node of builtNodes) {
      logic.mergeIn(node.logic);
    }
  } else if (builder instanceof NonMergeableLogicNodeBuilder) {
    logic.mergeIn(builder.logic);
  } else {
    throw new Error('Unknown LogicNodeBuilder type');
  }
  return logic;
}

/**
 * Create a bound version of the given predicate to a specific depth in the field tree.
 * This allows us to unambiguously know which `FieldContext` the predicate function should receive.
 *
 * This is of particular concern when a schema is applied recursively to itself. Since the schema is
 * only compiled once, each nested application adds the same predicate instance. We differentiate
 * these by recording the depth of the field they're bound to.
 *
 * @param predicate The unbound predicate
 * @param depth The depth of the field the predicate is bound to
 * @returns A bound predicate
 */
function bindLevel(predicate: Predicate, depth: number): BoundPredicate {
  return {...predicate, depth: depth};
}
